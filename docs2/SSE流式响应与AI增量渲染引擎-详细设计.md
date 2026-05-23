# SSE 流式响应与 AI 增量渲染引擎 — 详细设计

> **模块定位：** 客户端–服务端协同的 AI 流式输出基础设施，负责将大模型 Token 级流式响应实时推送到客户端，并实现增量 Markdown 渲染、公式排版、代码高亮等富内容展示。
>
> **关联模块：** AI对话引擎与会话管理、客户端网络请求治理、多模型调度与成本治理、AI-Prompt编排与场景模板系统

---

## 1. 背景与目标

### 1.1 问题

AI 辅导场景的核心交互是"学生提问 → AI 流式回答"。一个完整回答通常包含 200–2000 Token，若等全部生成完毕再展示，用户需等待 5–30 秒，体验极差。流式输出（Streaming）是刚需：

- **首 Token 延迟体感**：用户发送后 0.5–2 秒内应看到首个字符出现
- **增量渲染复杂度**：AI 回答中混合纯文本、Markdown、LaTeX 公式、代码块、列表、表格等，流式拼接时需处理不完整语法
- **网络不稳定**：移动端弱网、切换网络、后台恢复等场景需要健壮的重连与续传机制
- **取消与重试**：用户可能在生成中途取消、切换问题或要求"换一种讲法"

### 1.2 设计目标

| 指标 | 目标值 |
|------|--------|
| 首 Token 展示延迟 | ≤ 1.5s（正常网络） |
| 增量渲染帧率 | ≥ 30fps（不卡顿） |
| 断线重连恢复时间 | ≤ 3s |
| 流式中断率（非模型侧） | ≤ 0.5% |
| 内存占用（单会话流式 buffer） | ≤ 2MB |

### 1.3 技术选型

| 层面 | 选择 | 理由 |
|------|------|------|
| 传输协议 | SSE（Server-Sent Events） | 比 WebSocket 更轻量；AI 响应是单向推送场景，SSE 足够；HTTP/2 原生支持；自动重连 |
| 备选方案 | WebSocket | 仅在需要双向实时通信时升级（如语音陪练实时交互） |
| 客户端解析 | 增量 Markdown AST Builder | 流式拼接 → 增量构建 AST → Diff 渲染 |
| 公式渲染 | KaTeX（优先）/ MathJax（降级） | KaTeX 渲染快，适合流式；MathJax 功能更全，用于降级 |

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      客户端                              │
│                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ SSEClient │───▶│ StreamBuffer │───▶│ IncrRenderer  │  │
│  │ (连接管理) │    │ (增量缓冲)    │    │ (增量渲染器)   │  │
│  └──────────┘    └──────────────┘    └───────────────┘  │
│       │                  │                    │          │
│       ▼                  ▼                    ▼          │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Reconnect│    │ RollbackMgr  │    │ UI Components │  │
│  │ (重连策略) │    │ (回滚管理)    │    │ (富文本组件)   │  │
│  └──────────┘    └──────────────┘    └───────────────┘  │
└─────────────────────────────────────────────────────────┘
                          │ SSE (HTTP)
                          ▼
┌─────────────────────────────────────────────────────────┐
│                      服务端                              │
│                                                         │
│  ┌───────────┐    ┌──────────────┐    ┌─────────────┐  │
│  │ API Gateway│───▶│ StreamGate   │───▶│ ModelAdapter│  │
│  │ (鉴权限流)  │    │ (流式网关)    │    │ (模型适配)   │  │
│  └───────────┘    └──────────────┘    └─────────────┘  │
│                          │                    │          │
│                          ▼                    ▼          │
│                   ┌──────────────┐    ┌─────────────┐  │
│                   │ TokenPipeline│    │ SafetyFilter│  │
│                   │ (Token管线)   │    │ (安全过滤)   │  │
│                   └──────────────┘    └─────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 服务端设计

### 3.1 SSE 端点设计

#### 3.1.1 建立 SSE 连接

```
POST /api/v1/ai/chat/stream
Content-Type: application/json
Authorization: Bearer <token>

请求体:
{
  "conversation_id": "conv_abc123",       // 会话ID（可选，新建传null）
  "message": "请帮我讲解一元二次方程的求根公式",
  "context": {                             // 客户端上下文
    "grade": "初二",
    "subject": "math",
    "textbook_version": "人教版",
    "chapter_id": "ch_math_8_2_3"
  },
  "stream_options": {
    "include_thinking": false,             // 是否返回思维链
    "max_tokens": 2048,
    "temperature": 0.7
  }
}

响应:
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache, no-store, must-revalidate
Connection: keep-alive
X-Request-ID: req_xyz789
X-Accel-Buffering: no                      // Nginx 禁用缓冲
```

#### 3.1.2 SSE 事件格式

```typescript
// SSE 事件类型枚举
enum StreamEventType {
  // 连接生命周期
  SESSION_START    = 'session_start',     // 会话开始，携带元信息
  SESSION_END      = 'session_end',       // 会话正常结束
  
  // 内容流
  TEXT_DELTA       = 'text_delta',        // 文本增量
  THINKING_DELTA   = 'thinking_delta',    // 思维链增量（可选）
  
  // 结构化标记
  PARAGRAPH_START  = 'paragraph_start',   // 新段落开始
  CODE_BLOCK_START = 'code_block_start',  // 代码块开始
  FORMULA_BLOCK    = 'formula_block',     // 完整公式块（非流式）
  IMAGE_URL        = 'image_url',         // 图片URL
  
  // 辅助内容
  KNOWLEDGE_REF    = 'knowledge_ref',     // 知识点引用
  RELATED_QUESTION = 'related_question',  // 推荐追问
  RELATED_EXERCISE = 'related_exercise',  // 同类题推荐
  
  // 元信息
  USAGE            = 'usage',             // Token 用量统计
  MODEL_INFO       = 'model_info',        // 使用的模型信息
  
  // 错误与控制
  ERROR            = 'error',             // 错误事件
  RETRY_HINT       = 'retry_hint',        // 建议重试
  RATE_LIMITED     = 'rate_limited',      // 被限流
}
```

#### 3.1.3 SSE 事件示例

```
event: session_start
data: {"conversation_id":"conv_abc123","request_id":"req_xyz789","model":"glm-4-plus","timestamp":1716470400000}

event: text_delta
data: {"content":"一元二次方程","index":0}

event: text_delta
data: {"content":" $ax^2+bx+c=0$","index":1}

event: formula_block
data: {"latex":"x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}","display":true,"index":2}

event: text_delta
data: {"content":"\n\n这个公式叫做**求根公式**。","index":3}

event: text_delta
data: {"content":"它的推导过程如下：","index":4}

event: code_block_start
data: {"language":"推导步骤","index":5}

event: text_delta
data: {"content":"1. 从 $ax^2 + bx + c = 0$ 出发\n2. 两边同除以 $a$","index":5}

event: knowledge_ref
data: {"kp_id":"kp_一元二次方程","name":"一元二次方程","chapter":"八年级下册 第二章第三节"}

event: usage
data: {"prompt_tokens":256,"completion_tokens":180,"total_tokens":436}

event: session_end
data: {"conversation_id":"conv_abc123","finish_reason":"stop","total_tokens":436,"timestamp":1716470405000}
```

### 3.2 Token Pipeline（服务端流式管线）

```python
# 服务端流式管线伪代码
class TokenPipeline:
    """
    将模型原始流式输出转换为结构化 SSE 事件流
    """
    
    async def process_stream(self, raw_stream: AsyncIterator[ModelChunk]) -> AsyncIterator[SSEEvent]:
        buffer = StreamBuffer()
        parser = MarkdownStreamParser()
        
        async for chunk in raw_stream:
            # 1. 安全过滤（增量）
            safe_content = await self.safety_filter.filter_incremental(chunk.text)
            if safe_content is None:
                continue  # 被过滤的 chunk
            
            # 2. 追加到缓冲区
            buffer.append(safe_content)
            
            # 3. 增量 Markdown 解析
            events = parser.feed(safe_content)
            
            # 4. 逐事件发送
            for event in events:
                yield event
        
        # 5. 刷新剩余缓冲区
        remaining = parser.flush()
        for event in remaining:
            yield event
```

### 3.3 MarkdownStreamParser（服务端增量解析器）

```python
class MarkdownStreamParser:
    """
    增量 Markdown 解析器：将流式文本分割为有意义的 SSE 事件
    
    核心思路：
    - 维护一个有限状态机（FSM），追踪当前所处的 Markdown 上下文
    - 每次收到新 chunk 时，尝试完成或扩展当前语法结构
    - 对于无法确定的结构（如可能的公式开始符号 $），缓存至下次判断
    """
    
    # 状态枚举
    STATE_NORMAL = 'normal'           # 普通文本
    STATE_CODE_BLOCK = 'code_block'   # 代码块中
    STATE_FORMULA_INLINE = 'formula_inline'   # 行内公式 $...$
    STATE_FORMULA_BLOCK = 'formula_block'     # 块级公式 $$...$$
    STATE_LIST = 'list'               # 列表中
    STATE_TABLE = 'table'             # 表格中
    
    def __init__(self):
        self.state = self.STATE_NORMAL
        self.pending = ""              # 未确定文本缓冲
        self.index = 0                 # 全局事件索引
        self.code_lang = None          # 当前代码块语言
        self.formula_buffer = ""       # 公式缓冲
    
    def feed(self, text: str) -> list[SSEEvent]:
        """接收增量文本，返回可立即发送的事件列表"""
        events = []
        self.pending += text
        
        while self.pending:
            if self.state == self.STATE_NORMAL:
                event, consumed = self._try_parse_normal(self.pending)
                if consumed > 0:
                    events.append(event)
                    self.pending = self.pending[consumed:]
                else:
                    break  # 等待更多文本
            
            elif self.state == self.STATE_CODE_BLOCK:
                event, consumed = self._try_parse_code_block(self.pending)
                # ...
        
        return events
    
    def _try_parse_normal(self, text: str) -> tuple[SSEEvent | None, int]:
        """尝试从普通文本中解析出事件"""
        # 检测代码块开始 ```
        # 检测块级公式开始 $$
        # 检测行内公式开始 $
        # 检测列表项 - 或 数字.
        # 检测标题 #
        # 否则作为 text_delta 输出
        pass
    
    def flush(self) -> list[SSEEvent]:
        """流结束时，将所有未发送的缓冲内容作为最终事件输出"""
        events = []
        if self.pending:
            events.append(TextDeltaEvent(content=self.pending, index=self.index))
            self.pending = ""
        return events
```

### 3.4 安全过滤（流式）

```python
class StreamSafetyFilter:
    """
    流式安全过滤器：在 Token 级别进行增量内容安全检查
    
    设计原则：
    - 不能等全文生成完再过滤（否则失去流式意义）
    - 采用滑动窗口 + 前缀匹配策略
    - 检测到违规内容时截断流式输出并替换为安全提示
    """
    
    # 需要拦截的内容模式
    VIOLATION_PATTERNS = [
        # 直接给出完整答案（应改为分步提示）
        # 暴力/色情/政治敏感词
        # 个人信息泄露（手机号、身份证号模式）
    ]
    
    async def filter_incremental(self, text: str) -> str | None:
        """
        增量过滤：返回安全内容或 None（被过滤）
        
        策略：
        1. 累积最近 N 个 Token 作为滑动窗口
        2. 在窗口内匹配违规模式
        3. 命中时：发送 ERROR 事件，终止流，记录日志
        4. 未命中时：通过
        """
        self.window += text
        if len(self.window) > self.WINDOW_SIZE:
            self.window = self.window[-self.WINDOW_SIZE:]
        
        violation = await self._check_patterns(self.window)
        if violation:
            # 记录审计日志
            await self.audit_log.log(violation)
            return None
        
        return text
```

### 3.5 断点续传支持

```python
class StreamResumeService:
    """
    支持客户端断线后从断点续传 AI 响应
    
    实现：
    1. 服务端对每个流式请求维护一个环形缓冲区（RingBuffer），存储最近 N 个事件
    2. 客户端重连时携带 last_event_id（SSE 标准字段）
    3. 服务端从缓冲区中找到对应位置，重发后续事件
    """
    
    RING_BUFFER_SIZE = 500  # 每个会话缓存最近 500 个事件
    
    async def handle_resume(
        self, 
        conversation_id: str, 
        last_event_id: str
    ) -> AsyncIterator[SSEEvent]:
        buffer = self.ring_buffers.get(conversation_id)
        if not buffer:
            # 缓存已过期，返回完整回答（降级为非流式）
            full_answer = await self.get_full_answer(conversation_id)
            yield SSEEvent(type='text_delta', data={'content': full_answer})
            return
        
        # 从断点位置重发
        resume_index = buffer.find_index(last_event_id)
        if resume_index < 0:
            # 找不到断点，降级为非流式
            full_answer = await self.get_full_answer(conversation_id)
            yield SSEEvent(type='text_delta', data={'content': full_answer})
            return
        
        for event in buffer.events[resume_index:]:
            yield event
        
        # 如果原始流还在进行中，继续转发实时事件
        if buffer.is_active:
            async for event in buffer.live_stream:
                yield event
```

---

## 4. 客户端设计

### 4.1 SSEClient（连接管理器）

```typescript
/**
 * SSE 客户端：管理连接生命周期、自动重连、心跳
 */
class SSEClient {
  private eventSource: EventSource | null = null;
  private reconnectStrategy: ReconnectStrategy;
  private heartbeatTimer: number | null = null;
  private lastEventId: string | null = null;
  
  // 状态
  private _state: ConnectionState = 'disconnected';
  get state(): ConnectionState { return this._state; }
  
  // 事件回调
  onEvent: ((event: SSEEvent) => void) | null = null;
  onError: ((error: StreamError) => void) | null = null;
  onComplete: (() => void) | null = null;
  
  // 配置
  private readonly config: SSEClientConfig = {
    maxReconnectAttempts: 3,
    reconnectBaseDelay: 1000,       // 初始重连延迟 1s
    reconnectMaxDelay: 10000,       // 最大重连延迟 10s
    heartbeatInterval: 15000,       // 心跳间隔 15s
    heartbeatTimeout: 30000,        // 心跳超时 30s
    lastEventIdHeader: 'Last-Event-ID',  // SSE 标准断点续传
  };

  async connect(url: string, body: StreamRequest): Promise<void> {
    this._state = 'connecting';
    
    // 使用 fetch + ReadableStream 替代原生 EventSource
    // 原因：EventSource 不支持 POST 请求和自定义 Header
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      this._handleHTTPError(response);
      return;
    }

    this._state = 'connected';
    this._startHeartbeat();
    
    // 解析 SSE 流
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        
        // 按双换行分割 SSE 事件
        const parts = buffer.split('\n\n');
        buffer = parts.pop()!; // 最后一段可能不完整
        
        for (const part of parts) {
          const event = this._parseSSEEvent(part);
          if (event) {
            this.lastEventId = event.id;
            this.onEvent?.(event);
          }
        }
      }
      
      // 处理剩余缓冲
      if (buffer.trim()) {
        const event = this._parseSSEEvent(buffer);
        if (event) this.onEvent?.(event);
      }
      
      this._state = 'completed';
      this.onComplete?.();
      
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return; // 主动取消
      }
      this._handleStreamError(error);
    }
  }

  /**
   * 取消当前流式请求
   */
  cancel(): void {
    this._cleanup();
    this._state = 'cancelled';
  }

  /**
   * 自动重连逻辑（指数退避 + 抖动）
   */
  private async _reconnect(): Promise<void> {
    if (this.reconnectAttempt >= this.config.maxReconnectAttempts) {
      this.onError?.({ type: 'max_reconnect_exceeded' });
      this._state = 'failed';
      return;
    }

    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempt) 
      + Math.random() * 1000, // 抖动
      this.config.reconnectMaxDelay
    );

    this.reconnectAttempt++;
    await sleep(delay);

    // 携带 lastEventId 重连
    // 服务端据此决定是否续传
    await this.connect(this.lastUrl, {
      ...this.lastBody,
      resume_from_event_id: this.lastEventId,
    });
  }

  private _parseSSEEvent(raw: string): SSEEvent | null {
    const lines = raw.split('\n');
    let eventType = 'message';
    let data = '';
    let id: string | null = null;

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data = line.slice(5).trim();
      } else if (line.startsWith('id:')) {
        id = line.slice(3).trim();
      }
    }

    if (!data) return null;

    return {
      type: eventType,
      data: JSON.parse(data),
      id: id ?? undefined,
    };
  }
}

type ConnectionState = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'completed' 
  | 'cancelled' 
  | 'failed';

interface SSEEvent {
  type: string;
  data: any;
  id?: string;
}
```

### 4.2 StreamBuffer（增量缓冲管理器）

```typescript
/**
 * 管理流式文本的增量缓冲，为渲染器提供增量更新
 */
class StreamBuffer {
  // 完整文本（持续追加）
  private fullText: string = '';
  
  // 待渲染的增量队列
  private pendingDeltas: TextDelta[] = [];
  
  // 当前段落/块级上下文
  private currentBlock: BlockContext | null = null;
  
  // 版本号（用于渲染器 Diff）
  private version: number = 0;
  
  /**
   * 追加增量内容
   */
  append(delta: TextDelta): void {
    this.fullText += delta.content;
    this.pendingDeltas.push(delta);
    this.version++;
  }
  
  /**
   * 获取并清空待处理增量
   */
  flushDeltas(): { deltas: TextDelta[]; version: number; fullText: string } {
    const deltas = this.pendingDeltas;
    this.pendingDeltas = [];
    return {
      deltas,
      version: this.version,
      fullText: this.fullText,
    };
  }
  
  /**
   * 回滚到指定版本（用于公式/代码块等需要完整内容的场景）
   */
  rollbackTo(version: number): void {
    // 重建文本到指定版本
    // ...
  }
  
  get text(): string { return this.fullText; }
  get currentVersion(): number { return this.version; }
}

interface TextDelta {
  content: string;
  index: number;
  timestamp: number;
}

interface BlockContext {
  type: 'paragraph' | 'code' | 'formula' | 'list' | 'table';
  startIndex: number;
  metadata?: Record<string, any>;
}
```

### 4.3 IncrementalRenderer（增量渲染器）

```typescript
/**
 * 增量渲染器：将流式文本高效渲染为 UI 组件树
 * 
 * 核心策略：
 * 1. 维护一个虚拟 Markdown AST
 * 2. 每次收到增量时，仅更新受影响的 AST 节点
 * 3. 通过 Diff 算法计算出最小 UI 更新集
 * 4. 批量合并渲染（requestAnimationFrame）
 */
class IncrementalRenderer {
  private ast: MarkdownAST;
  private lastRenderVersion: number = -1;
  private renderScheduled: boolean = false;
  private container: HTMLElement;
  
  // 专用渲染器
  private formulaRenderer: FormulaRenderer;
  private codeRenderer: CodeHighlighter;
  
  constructor(container: HTMLElement) {
    this.container = container;
    this.ast = new MarkdownAST();
    this.formulaRenderer = new FormulaRenderer();
    this.codeRenderer = new CodeHighlighter();
  }

  /**
   * 接收流式更新，调度渲染
   */
  feed(buffer: StreamBuffer): void {
    const { deltas, version, fullText } = buffer.flushDeltas();
    if (version <= this.lastRenderVersion) return;

    // 重新解析完整 Markdown（AST 层面的增量优化后续迭代）
    this.ast = parseMarkdown(fullText);
    
    this.lastRenderVersion = version;
    this._scheduleRender();
  }

  private _scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    
    requestAnimationFrame(() => {
      this._render();
      this.renderScheduled = false;
    });
  }

  private _render(): void {
    const fragment = document.createDocumentFragment();
    
    for (const node of this.ast.children) {
      fragment.appendChild(this._renderNode(node));
    }
    
    // 替换容器内容（实际实现中应使用更细粒度的 Diff 更新）
    this.container.innerHTML = '';
    this.container.appendChild(fragment);
    
    // 后处理：渲染公式
    this.formulaRenderer.renderAll(this.container);
  }

  private _renderNode(node: ASTNode): HTMLElement {
    switch (node.type) {
      case 'text':
        return this._renderText(node);
      case 'paragraph':
        return this._renderParagraph(node);
      case 'code_block':
        return this._renderCodeBlock(node);
      case 'formula_inline':
      case 'formula_block':
        return this._renderFormula(node);
      case 'list':
        return this._renderList(node);
      case 'heading':
        return this._renderHeading(node);
      case 'table':
        return this._renderTable(node);
      default:
        return this._renderText(node);
    }
  }

  /**
   * 公式渲染的特殊处理
   * 
   * 流式中公式的挑战：$...$ 或 $$...$$ 是一个完整语法单元，
   * 但在流式场景下公式内容可能分多个 chunk 到达。
   * 
   * 策略：
   * - 块级公式：服务端通过 formula_block 事件发送完整公式（非增量）
   * - 行内公式：客户端检测 $ 边界，缓存到公式结束再渲染
   */
  private _renderFormula(node: FormulaNode): HTMLElement {
    const el = document.createElement(node.display ? 'div' : 'span');
    el.className = node.display ? 'formula-block' : 'formula-inline';
    
    try {
      katex.render(node.latex, el, {
        displayMode: node.display,
        throwOnError: false,
        trust: true,
      });
    } catch {
      // KaTeX 渲染失败时显示原始 LaTeX
      el.textContent = node.latex;
      el.classList.add('formula-fallback');
    }
    
    return el;
  }
}
```

### 4.4 公式流式渲染策略

```
场景分析：AI 输出 "计算 $x^2 + 2x + 1$ 的值"

流式到达序列：
  chunk 1: "计算 "
  chunk 2: "$x"           ← 检测到 $ 开始，进入公式缓冲模式
  chunk 3: "^2 + 2"       ← 追加到公式缓冲
  chunk 4: "x + 1"        ← 追加到公式缓冲
  chunk 5: "$ 的值"        ← 检测到 $ 结束，渲染完整公式

客户端状态机：

  ┌──────────┐  "$"   ┌──────────────┐  "$"   ┌──────────┐
  │ TEXT     │───────▶│ FORMULA_BUF  │───────▶│ RENDER   │
  │ 普通文本  │◀──────│ 公式缓冲中     │       │ 渲染公式  │
  └──────────┘ 其他   └──────────────┘       └──────────┘
                文字
               (退出)
```

```typescript
class FormulaStreamHandler {
  private inFormula: boolean = false;
  private formulaBuffer: string = '';
  private formulaStartIndex: number = -1;
  
  /**
   * 处理增量文本中的公式
   * 返回可直接渲染的文本和待缓冲的公式
   */
  process(delta: string): { 
    renderableText: string;      // 可直接渲染的文本
    pendingFormula: string | null; // 缓冲中的公式（未完成，不渲染）
  } {
    if (!this.inFormula) {
      const dollarIndex = delta.indexOf('$');
      if (dollarIndex === -1) {
        return { renderableText: delta, pendingFormula: null };
      }
      
      // 检查是否是 $$ (块级公式)
      if (delta[dollarIndex + 1] === '$') {
        this.inFormula = true;
        this.formulaBuffer = '';
        this.formulaStartIndex = dollarIndex;
        const before = delta.substring(0, dollarIndex);
        const after = delta.substring(dollarIndex + 2);
        return this.process(after.prepend(before)); // 递归处理剩余部分
      }
      
      // 行内公式开始
      this.inFormula = true;
      this.formulaBuffer = '';
      this.formulaStartIndex = dollarIndex;
      const before = delta.substring(0, dollarIndex);
      const after = delta.substring(dollarIndex + 1);
      return this.process(after.prepend(before));
    }
    
    // 公式缓冲中，查找结束 $
    const endIndex = delta.indexOf('$');
    if (endIndex === -1) {
      // 公式未结束，全部进入缓冲
      this.formulaBuffer += delta;
      return { renderableText: '', pendingFormula: this.formulaBuffer };
    }
    
    // 公式结束
    this.formulaBuffer += delta.substring(0, endIndex);
    this.inFormula = false;
    
    const renderedFormula = this.formulaBuffer; // 将被 KaTeX 渲染
    this.formulaBuffer = '';
    
    const remaining = delta.substring(endIndex + 1);
    const result = this.process(remaining);
    
    return {
      renderableText: renderedFormula + result.renderableText,
      pendingFormula: result.pendingFormula,
    };
  }
}
```

### 4.5 AI 对话页完整流式交互流程

```typescript
/**
 * AI 对话页面的流式交互编排
 * 
 * 这是整个流式响应在 UI 层的胶水代码
 */
class AIChatStreamController {
  private sseClient: SSEClient;
  private streamBuffer: StreamBuffer;
  private renderer: IncrementalRenderer;
  private formulaHandler: FormulaStreamHandler;
  
  // UI 引用
  private chatBubble: HTMLElement;      // 当前 AI 回答气泡
  private contentArea: HTMLElement;     // 内容渲染区
  private typingIndicator: HTMLElement; // 打字指示器
  private actionButtons: HTMLElement;   // 操作按钮区

  /**
   * 发送用户消息并开始流式接收
   */
  async sendAndStream(userMessage: string, context: ChatContext): Promise<void> {
    // 1. 展示用户消息
    this._addUserBubble(userMessage);
    
    // 2. 创建 AI 回答气泡（初始显示打字指示器）
    this.chatBubble = this._createAIBubble();
    this.contentArea = this.chatBubble.querySelector('.content')!;
    this.typingIndicator = this._showTypingIndicator();
    this.actionButtons = this.chatBubble.querySelector('.actions')!;
    
    // 3. 初始化流式组件
    this.streamBuffer = new StreamBuffer();
    this.renderer = new IncrementalRenderer(this.contentArea);
    this.formulaHandler = new FormulaStreamHandler();
    
    // 4. 配置 SSE 回调
    this.sseClient = new SSEClient();
    this.sseClient.onEvent = (event) => this._handleStreamEvent(event);
    this.sseClient.onError = (error) => this._handleStreamError(error);
    this.sseClient.onComplete = () => this._handleStreamComplete();
    
    // 5. 建立连接
    try {
      await this.sseClient.connect('/api/v1/ai/chat/stream', {
        conversation_id: context.conversationId,
        message: userMessage,
        context: {
          grade: context.grade,
          subject: context.subject,
          textbook_version: context.textbookVersion,
        },
      });
    } catch (error) {
      this._handleConnectionError(error);
    }
  }

  private _handleStreamEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'session_start':
        // 隐藏打字指示器，准备接收内容
        this.typingIndicator.remove();
        break;
        
      case 'text_delta':
        this.streamBuffer.append({
          content: event.data.content,
          index: event.data.index,
          timestamp: Date.now(),
        });
        // 调度渲染
        this.renderer.feed(this.streamBuffer);
        // 自动滚动到底部
        this._scrollToBottom();
        break;
        
      case 'formula_block':
        // 完整公式块，直接渲染
        this.streamBuffer.append({
          content: `\n$$${event.data.latex}$$\n`,
          index: event.data.index,
          timestamp: Date.now(),
        });
        this.renderer.feed(this.streamBuffer);
        break;
        
      case 'knowledge_ref':
        // 知识点引用，在底部显示标签
        this._addKnowledgeRef(event.data);
        break;
        
      case 'related_exercise':
        // 缓存同类题推荐，流结束后展示
        this._cacheRelatedExercise(event.data);
        break;
        
      case 'usage':
        // Token 用量（可用于前端用量统计）
        this._updateTokenUsage(event.data);
        break;
        
      case 'session_end':
        // 服务端确认流结束
        break;
        
      case 'error':
        this._handleStreamError(event.data);
        break;
    }
  }

  private _handleStreamComplete(): void {
    // 1. 确保最终渲染
    this.renderer.feed(this.streamBuffer);
    
    // 2. 展示操作按钮
    this._showActionButtons([
      { label: '再讲简单点', action: 'simplify' },
      { label: '换个讲法', action: 'rephrase' },
      { label: '练一道同类题', action: 'practice' },
      { label: '加入错题本', action: 'add_mistake' },
    ]);
    
    // 3. 展示知识点引用
    this._renderKnowledgeRefs();
    
    // 4. 展示同类题推荐（如有）
    this._renderRelatedExercises();
    
    // 5. 恢复输入框
    this._enableInput();
  }

  /**
   * 用户取消当前流式生成
   */
  cancelStream(): void {
    this.sseClient.cancel();
    
    // 在当前内容后追加取消标记
    const cancelNote = document.createElement('div');
    cancelNote.className = 'stream-cancelled';
    cancelNote.innerHTML = '<span class="text-muted">（已停止生成）</span>';
    this.contentArea.appendChild(cancelNote);
    
    this._showActionButtons([
      { label: '继续生成', action: 'continue' },
      { label: '重新提问', action: 'retry' },
    ]);
  }
}
```

---

## 5. 状态流转

### 5.1 流式会话状态机

```
                    ┌───────────────┐
                    │               │
         ┌────────▶│    IDLE       │◀────────┐
         │         │  (空闲等待)    │          │
         │         └───────┬───────┘          │
         │                 │ send()            │
         │                 ▼                   │
         │         ┌───────────────┐          │
         │         │  CONNECTING   │          │
         │         │  (建立连接)    │          │
         │         └───────┬───────┘          │
         │            ┌────┴────┐             │
         │      error │         │ connected    │
         │            ▼         ▼              │
         │   ┌──────────┐ ┌──────────┐        │
         │   │  ERROR   │ │STREAMING │        │
         │   │ (连接失败)│ │ (流式传输)│        │
         │   └────┬─────┘ └────┬─────┘        │
         │        │ retry      │ stream_end   │
         │        │            ▼              │
         │        │     ┌──────────┐          │
         │        │     │RENDERING │──────────┘
         │        │     │(最终渲染) │  完成
         │        │     └────┬─────┘
         │        │          │
         │        │    ┌─────┴─────┐
         │        │    │           │
         │        │    ▼           ▼
         │        │  ┌──────┐ ┌────────┐
         │        │  │CANCEL│ │COMPLETE│
         │        │  │(取消) │ │(完成)  │
         └────────┤  └──────┘ └────────┘
          reset   │
                  │  ┌──────────┐
                  └──│RECONNECT │
                     │(重连中)   │
                     └──────────┘
```

### 5.2 客户端渲染状态

```typescript
enum RenderState {
  TYPING_INDICATOR = 'typing_indicator',  // 等待首 Token
  FIRST_TOKEN      = 'first_token',       // 首个 Token 到达
  STREAMING        = 'streaming',         // 正常流式渲染
  FORMULA_BUFFER   = 'formula_buffer',    // 公式缓冲中（暂停文本渲染）
  CODE_BLOCK       = 'code_block',        // 代码块中
  PAUSED           = 'paused',            // 网络暂停
  CANCELLED        = 'cancelled',         // 用户取消
  COMPLETE         = 'complete',          // 渲染完成
  ERROR            = 'error',             // 错误
}
```

---

## 6. 错误处理

### 6.1 错误分类与处理策略

| 错误类型 | 场景 | 处理策略 | 用户提示 |
|----------|------|----------|----------|
| `CONNECTION_TIMEOUT` | 网络超时，无法建立连接 | 自动重试（最多 3 次） | "网络不太好，正在重新连接…" |
| `CONNECTION_LOST` | 流式中途断网 | 自动重连 + 断点续传 | "连接中断，正在恢复…" |
| `MODEL_ERROR` | 大模型返回错误 | 降级到备用模型 | "正在换一种方式回答…" |
| `MODEL_OVERLOAD` | 模型过载（503） | 排队重试 + 延迟 | "AI 正在思考，请稍候…" |
| `CONTENT_FILTERED` | 内容被安全过滤拦截 | 截断 + 替换回答 | "抱歉，这个问题我无法回答" |
| `RATE_LIMITED` | 用户调用被限流 | 展示剩余额度 | "今日 AI 问答次数已达上限" |
| `TOKEN_LIMIT` | 回答超过最大 Token | 截断 + 提示继续 | "回答较长，点击继续查看" |
| `STREAM_PARSE_ERROR` | SSE 解析异常 | 降级为非流式请求 | 静默降级，用户无感 |
| `AUTH_EXPIRED` | Token 过期 | 刷新 Token 后重试 | 静默处理 |

### 6.2 降级策略

```typescript
class StreamDegradation {
  /**
   * 流式请求降级链：
   * 
   * SSE(POST) → SSE(GET) → Long Polling → 非流式请求
   * 
   * 每一级降级的触发条件：
   * Level 0 → 1: SSE POST 连续失败 2 次
   * Level 1 → 2: SSE GET 连续失败 2 次
   * Level 2 → 3: Long Polling 超时
   */
  
  private currentLevel: number = 0;
  private failureCount: number = 0;
  
  async request(message: string, context: ChatContext): Promise<void> {
    while (this.currentLevel <= 3) {
      try {
        switch (this.currentLevel) {
          case 0: return await this._ssePost(message, context);
          case 1: return await this._sseGet(message, context);
          case 2: return await this._longPoll(message, context);
          case 3: return await this._syncRequest(message, context);
        }
      } catch (error) {
        this.failureCount++;
        if (this.failureCount >= 2) {
          this.currentLevel++;
          this.failureCount = 0;
          // 记录降级事件（用于监控）
          this._reportDegradation(this.currentLevel, error);
        }
      }
    }
    
    // 所有方式都失败
    throw new StreamError('ALL_METHODS_FAILED');
  }
}
```

---

## 7. 性能优化

### 7.1 渲染优化

```typescript
/**
 * 渲染优化策略
 */
class RenderOptimizer {
  // 1. 批量合并：将多个快速到达的 delta 合并为一次渲染
  private batchInterval: number = 16; // ~60fps → 约 16ms 合并一次
  
  // 2. 虚拟滚动：长回答只渲染可视区域
  private virtualScrollThreshold: number = 5000; // 超过 5000 字符启用虚拟滚动
  
  // 3. 公式延迟渲染：公式在进入可视区域时才渲染
  private formulaLazyRender: boolean = true;
  
  // 4. 代码高亮延迟：代码块完成后才高亮（避免流式中重复高亮）
  private codeHighlightOnComplete: boolean = true;
  
  /**
   * 批量渲染调度器
   */
  private batchQueue: TextDelta[] = [];
  private batchTimer: number | null = null;
  
  scheduleRender(delta: TextDelta): void {
    this.batchQueue.push(delta);
    
    if (!this.batchTimer) {
      this.batchTimer = window.setTimeout(() => {
        this._flushBatch();
        this.batchTimer = null;
      }, this.batchInterval);
    }
  }
  
  private _flushBatch(): void {
    const batch = this.batchQueue;
    this.batchQueue = [];
    
    // 合并所有 delta 为一次 AST 更新 + 一次 DOM 渲染
    const combined = batch.map(d => d.content).join('');
    this.renderer.update(combined);
  }
}
```

### 7.2 内存优化

```typescript
/**
 * 长对话内存管理
 * 
 * 问题：单次 AI 回答可能非常长（2000+ Token），
 * 且包含大量 DOM 节点（公式、代码、列表等）。
 * 需要控制内存占用。
 */
class MemoryManager {
  // 单条回答的最大 DOM 节点数
  private readonly MAX_NODES_PER_ANSWER = 2000;
  
  // 已渲染回答的折叠阈值
  private readonly COLLAPSE_THRESHOLD = 3; // 超过 3 条折叠旧回答
  
  /**
   * 检查并优化 DOM
   */
  optimize(chatContainer: HTMLElement): void {
    const answers = chatContainer.querySelectorAll('.ai-answer');
    
    // 折叠旧回答：仅保留摘要，释放 DOM 节点
    answers.forEach((answer, index) => {
      if (index < answers.length - this.COLLAPSE_THRESHOLD) {
        this._collapseAnswer(answer as HTMLElement);
      }
    });
  }
  
  private _collapseAnswer(el: HTMLElement): void {
    const summary = el.getAttribute('data-summary') || el.textContent!.substring(0, 50) + '…';
    el.innerHTML = `<div class="collapsed-summary">${summary}</div>
                    <button class="expand-btn">展开查看</button>`;
    el.classList.add('collapsed');
  }
}
```

### 7.3 网络优化

| 优化点 | 方案 |
|--------|------|
| HTTP/2 多路复用 | 确保 API 网关启用 HTTP/2，多个 SSE 连接共享 TCP 连接 |
| 压缩 | SSE 文本流启用 gzip/brotli 压缩（AI 回答文本压缩率高） |
| 预连接 | 客户端启动时预建立到 API 域名的 DNS + TCP + TLS 连接 |
| 批量 Token | 服务端可将多个快速到达的 Token 合并为单个 SSE 事件，减少帧数 |

---

## 8. 监控指标

### 8.1 服务端指标

| 指标 | 含义 | 采集方式 |
|------|------|----------|
| `stream.request.total` | 流式请求总数 | Counter |
| `stream.request.success` | 流式成功完成数 | Counter |
| `stream.first_token_latency` | 首 Token 延迟（P50/P95/P99） | Histogram |
| `stream.total_duration` | 流式总时长 | Histogram |
| `stream.tokens_per_second` | Token 吞吐率 | Gauge |
| `stream.error.rate` | 流式错误率 | Counter by type |
| `stream.reconnect.count` | 客户端重连次数 | Counter |
| `stream.degradation.count` | 降级次数 | Counter by level |
| `stream.buffer.size` | 服务端环形缓冲区大小 | Gauge |

### 8.2 客户端指标

| 指标 | 含义 |
|------|------|
| `client.stream.first_render` | 首字符渲染延迟 |
| `client.stream.render_fps` | 渲染帧率 |
| `client.stream.disconnect` | 断线次数 |
| `client.stream.degradation` | 降级事件 |
| `client.stream.cancel_rate` | 用户取消率 |
| `client.formula.render_time` | 公式渲染耗时 |

---

## 9. API 接口汇总

### 9.1 建立流式连接

```
POST /api/v1/ai/chat/stream
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| conversation_id | string | 否 | 会话ID，不传则新建 |
| message | string | 是 | 用户消息 |
| context.grade | string | 是 | 年级 |
| context.subject | string | 是 | 学科 |
| context.textbook_version | string | 否 | 教材版本 |
| context.chapter_id | string | 否 | 章节ID |
| stream_options.include_thinking | boolean | 否 | 是否包含思维链 |
| stream_options.max_tokens | number | 否 | 最大 Token 数 |
| stream_options.temperature | number | 否 | 温度参数 |
| resume_from_event_id | string | 否 | 断点续传：从哪个事件 ID 开始 |

**响应**: `Content-Type: text/event-stream`

### 9.2 取消流式生成

```
POST /api/v1/ai/chat/stream/{conversation_id}/cancel
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keep_partial | boolean | 否 | 是否保留已生成的部分内容（默认 true） |

**响应**:
```json
{
  "conversation_id": "conv_abc123",
  "status": "cancelled",
  "generated_tokens": 156,
  "partial_content": "已生成的部分内容..."
}
```

### 9.3 获取历史完整回答（降级用）

```
GET /api/v1/ai/chat/{conversation_id}/answer
```

**响应**:
```json
{
  "conversation_id": "conv_abc123",
  "content": "完整的 Markdown 格式回答",
  "token_count": 436,
  "created_at": "2026-05-23T13:08:00Z"
}
```

---

## 10. 数据结构定义

### 10.1 服务端数据模型

```sql
-- 流式会话记录表
CREATE TABLE stream_sessions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    conversation_id VARCHAR(64) NOT NULL,
    request_id      VARCHAR(64) NOT NULL UNIQUE,
    user_id         BIGINT NOT NULL,
    model           VARCHAR(64) NOT NULL COMMENT '使用的模型标识',
    
    -- 状态
    status          ENUM('streaming', 'completed', 'cancelled', 'error') NOT NULL,
    
    -- Token 统计
    prompt_tokens   INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    total_tokens    INT DEFAULT 0,
    
    -- 性能
    first_token_ms  INT COMMENT '首 Token 延迟(ms)',
    total_duration_ms INT COMMENT '总耗时(ms)',
    
    -- 错误信息
    error_type      VARCHAR(64) COMMENT '错误类型',
    error_message   TEXT COMMENT '错误详情',
    
    -- 降级信息
    degradation_level TINYINT DEFAULT 0 COMMENT '降级级别 0-3',
    
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_conv (conversation_id),
    INDEX idx_user_time (user_id, created_at),
    INDEX idx_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 10.2 客户端本地缓存

```typescript
interface StreamSessionCache {
  conversationId: string;
  requestId: string;
  status: 'streaming' | 'completed' | 'cancelled';
  fullContent: string;           // 完整 Markdown 内容
  lastEventId: string;           // 最后接收的事件 ID（用于续传）
  tokenCount: number;
  startedAt: number;             // 开始时间戳
  completedAt: number | null;    // 完成时间戳
  knowledgeRefs: KnowledgeRef[]; // 知识点引用
  relatedExercises: Exercise[];  // 同类题
}
```

---

## 11. 安全考虑

| 风险 | 缓解措施 |
|------|----------|
| SSE 连接被劫持 | 每次 SSE 连接携带短期 Token（5 分钟有效），连接建立后失效 |
| 恶意客户端模拟流式请求 | API 网关层限流（用户级 QPS 限制）+ Token 预算控制 |
| SSE 注入攻击 | 服务端对所有 data 字段进行 JSON 序列化，客户端不执行原始文本 |
| 流式内容绕过安全检查 | 增量安全过滤 + 最终完整内容二次审核 |
| 重放攻击 | request_id 一次性使用，服务端去重 |

---

## 12. 开放问题

| # | 问题 | 备注 |
|---|------|------|
| 1 | Flutter 端 SSE 客户端方案选型 | 原生 EventSource 不支持 POST，需评估 `flutter_client_sse` 或自建 |
| 2 | 超长回答（>4096 Token）的流式渲染性能 | 可能需要分段渲染 + 虚拟化 |
| 3 | 思维链（Thinking）是否需要单独的流式通道 | 某些模型（如 o1）有独立的 thinking 输出 |
| 4 | 多模型协作场景的流式编排 | 如主模型回答 + 审核模型并行复核，如何合并流 |
| 5 | 离线场景下的缓存回答展示 | 弱网时是否展示上次完整回答作为参考 |
