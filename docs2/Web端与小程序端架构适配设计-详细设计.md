# Web端与小程序端架构适配设计 - 详细设计

## 1. 模块概述

### 1.1 功能定位

基于 PrimeTop 现有移动端（Flutter Android/iOS）架构，设计 Web 端与微信小程序端的技术架构方案，实现多端统一体验、API 层共享、业务逻辑复用，为 V2.0 阶段多平台拓展提供可直接编码的技术蓝图。

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| 统一 API | 所有端共用同一套后端 API，不因新增端而改动服务端 |
| 体验一致 | 核心交互（AI对话、拍题、错题本、学习进度）在多端保持一致 |
| 差异化适配 | 各端根据平台特性做必要交互和性能优化 |
| 独立部署 | Web 端和小程序端可独立构建、发布、回滚 |
| 渐进覆盖 | 优先覆盖 P0 功能，P1/P2 功能按阶段上线 |

### 1.3 目标用户与场景

| 端 | 用户场景 | 优先级 |
|---|---------|--------|
| Web 端 | 电脑端学习（大屏解题、家长查看报告、教师管理） | P1 |
| 微信小程序 | 免下载体验核心功能、家长快速查看、社交裂变引流 | P1 |

### 1.4 约束

1. **不可修改现有 API 的请求/响应结构**；新增端需要的适配通过新增接口或扩展字段实现
2. 小程序包大小限制：主包 ≤ 2MB，总包 ≤ 20MB
3. Web 端首屏加载 FCP ≤ 2s（常规网络）
4. 小程序冷启动 ≤ 1.5s

---

## 2. 技术选型

### 2.1 Web 端技术选型

| 维度 | 选型 | 理由 |
|------|------|------|
| 框架 | **Next.js 14+ (App Router)** | SSR/SSG、React 生态、API Routes、ISR 增量更新 |
| 语言 | TypeScript | 与后端 API 类型共享、类型安全 |
| 状态管理 | Zustand + TanStack Query | Zustand 轻量全局状态；TanStack Query 管理服务端缓存 |
| UI 组件库 | 自建设计系统 (Radix UI 基底) | 匹配 PrimeTop 分龄 UI Token 体系 |
| 样式方案 | Tailwind CSS + CSS Variables (Design Tokens) | 与 Flutter 端共享 Token 定义 |
| 数学公式 | KaTeX (行内) + MathJax (复杂) | 覆盖 LaTeX 公式渲染 |
| SSE 流式 | EventSource + 自定义封装 | AI 对话流式响应 |
| 富文本 | 自定义渲染引擎（同移动端 Markdown 规范） | 参考 `富文本与学科内容渲染引擎-详细设计.md` |
| 构建工具 | Turbopack (Next.js 内置) | 开发体验好，HMR 快 |
| 部署 | Vercel / 自建 Node.js + Nginx | 初期 Vercel 快速部署；规模后自建 |

### 2.2 小程序端技术选型

| 维度 | 选型 | 理由 |
|------|------|------|
| 框架 | **Taro 4 (React)** | 多端编译（微信/支付宝/字节）、React 生态统一、社区成熟 |
| 语言 | TypeScript | 与 Web 端共享类型定义和工具函数 |
| 状态管理 | Zustand | 与 Web 端统一，Taro 兼容 |
| UI 组件库 | Taro UI + 自定义分龄组件 | 基础组件用 Taro UI，业务组件自建 |
| 样式方案 | Sass + Design Tokens (SCSS Variables) | 小程序不支持 CSS Variables，编译时转换 |
| 数学公式 | WxMarkdown + 自定义 LaTeX 渲染组件 | 小程序限制较多，需定制方案 |
| SSE 替代 | WebSocket / 轮询降级 | 小程序不支持原生 SSE，需 WebSocket 或轮询 |

### 2.3 共享层设计（Monorepo packages）

```
packages/
├── shared-types/          # TypeScript 类型定义
│   ├── api.d.ts           # API 请求/响应类型
│   ├── models.d.ts        # 业务模型类型（GradeLevel、Subject 等枚举）
│   ├── enums.ts           # 枚举常量
│   └── constants.ts       # 共享常量（学段、学科、错误码等）
├── shared-utils/          # 纯工具函数（无平台依赖）
│   ├── format.ts          # 格式化（日期、数字、学段显示名）
│   ├── validators.ts      # 表单校验（手机号、年级等）
│   ├── subject-tools.ts   # 学科工具（公式、单位换算）
│   └── learning-algo.ts   # 学习算法（遗忘曲线、掌握度计算）
├── shared-api/            # API 客户端封装
│   ├── client.ts          # HTTP 客户端抽象接口
│   ├── interceptors.ts    # Token 刷新、错误处理拦截器
│   └── modules/           # 按业务模块划分的 API 函数
│       ├── auth.ts
│       ├── learning.ts
│       ├── mistake.ts
│       ├── ai.ts
│       └── payment.ts
└── shared-hooks/          # 共享 React Hooks
    ├── useAuth.ts
    ├── useStreaming.ts
    ├── useMistake.ts
    └── useLearning.ts
```

**关键原则**：共享层只包含纯逻辑和平台无关代码。涉及 DOM、小程序 API、文件系统等平台特性的代码由各端自行实现。

---

## 3. 多端功能覆盖矩阵

### 3.1 功能分级

| 功能模块 | Web 端 | 小程序端 | 说明 |
|---------|--------|---------|------|
| 用户注册登录 | ✅ 完整 | ✅ 完整（微信授权登录优先） | 小程序支持微信一键授权 |
| AI 文字问答 | ✅ 完整 | ✅ 完整 | 核心功能 |
| AI 语音提问 | ✅ 完整 | ⚠️ 降级（录音→文字→问答） | 小程序不支持实时流式 ASR |
| 拍题答疑 | ✅ 完整（文件上传） | ✅ 完整（相机/相册） | 小程序用 wx.chooseMedia |
| 拍题裁剪 | ✅ 完整 | ⚠️ 简化裁剪 | 小程序裁剪能力有限 |
| 多题识别选择 | ✅ 完整 | ⚠️ 简化（最多选3题） | 小程序性能限制 |
| 同步课堂 | ✅ 完整 | ✅ 完整 | |
| 错题本 | ✅ 完整 | ✅ 完整（只读+基础操作） | 小程序不做批量操作 |
| 学情分析 | ✅ 完整（大屏图表） | ⚠️ 简化（关键指标） | 小程序展示精简版 |
| 学习规划 | ✅ 完整 | ⚠️ 查看+简单操作 | |
| 作文辅导 | ✅ 完整 | ⚠️ 仅查看批改结果 | 小程序不做长文编辑 |
| 文科背诵 | ⚠️ 文本检测 | ❌ 不支持 | 需要语音长时录音 |
| 拼音识字 | ❌ 不适合 | ⚠️ 简化版 | 幼儿主要用移动端 |
| 家长中心 | ✅ 完整（大屏体验优） | ✅ 完整 | 家长查看报告场景 |
| 教师端 | ✅ 完整 | ⚠️ 基础查看 | 教师管理主要用 Web |
| 支付订阅 | ✅ 完整 | ✅ 完整（微信支付） | 小程序用微信支付 |
| 个人中心 | ✅ 完整 | ✅ 完整 | |
| 消息通知 | ✅ 完整 | ✅ 完整（订阅消息） | 小程序用订阅消息替代 Push |
| 离线缓存 | ⚠️ Service Worker | ❌ 不支持 | 小程序无持久离线缓存 |

### 3.2 小程序端功能取舍原则

1. **核心学习功能必上**：AI 问答、拍题、同步课堂、错题查看
2. **引流转化功能必上**：注册登录、体验 AI（每日免费额度）、会员购买入口
3. **家长查看功能必上**：学情报告、学习提醒
4. **编辑密集型功能不上**：长文作文编辑、复杂背诵检测
5. **幼儿互动功能不上**：拼音识字需触屏+语音+长时交互

---

## 4. Web 端架构详细设计

### 4.1 项目结构

```
web/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # 认证路由组
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── layout.tsx
│   ├── (main)/                   # 主应用路由组
│   │   ├── layout.tsx            # 主布局（侧边栏+顶栏）
│   │   ├── page.tsx              # 首页/学习工作台
│   │   ├── ai/page.tsx           # AI 对话页
│   │   ├── camera/page.tsx       # 拍题答疑页
│   │   ├── learn/page.tsx        # 同步课堂
│   │   ├── mistakes/page.tsx     # 错题本
│   │   ├── plan/page.tsx         # 学习规划
│   │   ├── report/page.tsx       # 学情报告
│   │   ├── essay/page.tsx        # 作文辅导
│   │   ├── profile/page.tsx      # 个人中心
│   │   ├── parent/page.tsx       # 家长中心
│   │   └── teacher/page.tsx      # 教师端
│   ├── api/                      # BFF API Routes
│   │   ├── stream/route.ts       # SSE 代理
│   │   └── upload/route.ts       # 文件上传代理
│   ├── layout.tsx                # 根布局
│   └── globals.css
├── components/
│   ├── ui/                       # 基础 UI 组件
│   ├── layout/                   # 布局组件
│   ├── chat/                     # AI 对话组件
│   ├── learning/                 # 学习相关组件
│   ├── formula/                  # 公式渲染组件
│   └── report/                   # 报表组件
├── hooks/                        # 自定义 Hooks
├── lib/                          # 工具库（API客户端、SSE、存储）
├── styles/
│   ├── tokens.css                # Design Tokens
│   └── themes/                   # 分龄主题 CSS
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

### 4.2 核心数据结构

#### 4.2.1 路由配置

```typescript
// lib/routes.ts
import type { GradeLevel } from '@primetop/shared-types';

export interface RouteConfig {
  path: string;
  label: string;
  icon: string;
  requireAuth: boolean;
  requireRole?: ('student' | 'parent' | 'teacher')[];
  minGrade?: GradeLevel;
  featureFlag?: string;
  children?: RouteConfig[];
}

export const WEB_ROUTES: RouteConfig[] = [
  { path: '/', label: '首页', icon: 'home', requireAuth: true },
  { path: '/ai', label: 'AI 辅导', icon: 'message', requireAuth: true },
  { path: '/camera', label: '拍题答疑', icon: 'camera', requireAuth: true },
  { path: '/learn', label: '同步课堂', icon: 'book', requireAuth: true },
  { path: '/mistakes', label: '错题本', icon: 'warning', requireAuth: true },
  { path: '/plan', label: '学习规划', icon: 'calendar', requireAuth: true, minGrade: 'primary' },
  { path: '/essay', label: '作文辅导', icon: 'pen', requireAuth: true, minGrade: 'primary' },
  { path: '/report', label: '学情报告', icon: 'chart', requireAuth: true },
  { path: '/parent', label: '家长中心', icon: 'family', requireAuth: true, requireRole: ['parent'] },
  {
    path: '/teacher', label: '教师端', icon: 'school', requireAuth: true,
    requireRole: ['teacher'], featureFlag: 'teacher_portal',
  },
  { path: '/profile', label: '个人中心', icon: 'user', requireAuth: true },
];
```

#### 4.2.2 用户会话状态

```typescript
// stores/authStore.ts（Zustand）

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WebUserSession {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: 'student' | 'parent' | 'teacher';
  gradeLevel: GradeLevel;
  gradeYear: number;
  textbookVersion: string;
  membership: {
    plan: 'free' | 'monthly' | 'yearly' | 'exam_prep';
    expiresAt: string | null;
    remainingQuota: {
      aiQuestions: number;
      photoQuestions: number;
      resetAt: string;
    };
  };
  children?: Array<{
    userId: string;
    nickname: string;
    gradeLevel: GradeLevel;
  }>;
  accessToken: string;
  refreshToken: string;
}

interface AuthStore {
  session: WebUserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  setSession: (session: WebUserSession) => void;
  clearSession: () => void;
  setLoading: (loading: boolean) => void;
  updateQuota: (quota: Partial<WebUserSession['membership']['remainingQuota']>) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      session: null,
      isAuthenticated: false,
      isLoading: true,

      setSession: (session) => set({ session, isAuthenticated: true, isLoading: false }),
      clearSession: () => set({ session: null, isAuthenticated: false, isLoading: false }),
      setLoading: (isLoading) => set({ isLoading }),
      updateQuota: (quota) =>
        set((state) => {
          if (!state.session) return state;
          return {
            session: {
              ...state.session,
              membership: {
                ...state.session.membership,
                remainingQuota: { ...state.session.membership.remainingQuota, ...quota },
              },
            },
          };
        }),
    }),
    { name: 'primetop-auth' },  // localStorage key
  ),
);
```

#### 4.2.3 SSE 流式对话状态

```typescript
// hooks/useStreamingChat.ts

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  renderNodes?: RenderNode[];
  createdAt: string;
  metadata?: {
    model: string;
    tokens: number;
    latencyMs: number;
    feedback?: 'like' | 'dislike' | null;
  };
}

export interface StreamingState {
  conversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamContent: string;
  streamNodes: RenderNode[];
  error: string | null;
}

export function useStreamingChat() {
  const [state, setState] = useState<StreamingState>({
    conversationId: null,
    messages: [],
    isStreaming: false,
    streamContent: '',
    streamNodes: [],
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string, attachments?: File[]) => {
    const abortController = new AbortController();
    abortRef.current = abortController;

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: generateId(),
      conversationId: state.conversationId || generateId(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMsg],
      isStreaming: true,
      streamContent: '',
      streamNodes: [],
      error: null,
      conversationId: prev.conversationId || userMsg.conversationId,
    }));

    try {
      await connectSSE({
        url: '/api/stream',
        body: {
          conversationId: state.conversationId,
          message: content,
          gradeLevel: useAuthStore.getState().session?.gradeLevel,
          subject: detectSubject(content),
        },
        headers: {
          Authorization: `Bearer ${useAuthStore.getState().session?.accessToken}`,
        },
        onToken: (token) => {
          setState(prev => {
            const newContent = prev.streamContent + token;
            return {
              ...prev,
              streamContent: newContent,
              streamNodes: parseRenderNodes(newContent),
            };
          });
        },
        onComplete: (fullText) => {
          const assistantMsg: ChatMessage = {
            id: generateId(),
            conversationId: state.conversationId!,
            role: 'assistant',
            content: fullText,
            renderNodes: parseRenderNodes(fullText),
            createdAt: new Date().toISOString(),
          };
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, assistantMsg],
            isStreaming: false,
            streamContent: '',
          }));
        },
        onError: (error) => {
          setState(prev => ({
            ...prev,
            isStreaming: false,
            error: error.message,
          }));
        },
        signal: abortController.signal,
      });
    } catch (err) {
      setState(prev => ({ ...prev, isStreaming: false, error: String(err) }));
    }
  }, [state.conversationId]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setState(prev => {
      if (prev.streamContent) {
        // 保存已接收的内容作为一条消息
        const partialMsg: ChatMessage = {
          id: generateId(),
          conversationId: prev.conversationId!,
          role: 'assistant',
          content: prev.streamContent,
          renderNodes: parseRenderNodes(prev.streamContent),
          createdAt: new Date().toISOString(),
        };
        return {
          ...prev,
          messages: [...prev.messages, partialMsg],
          isStreaming: false,
          streamContent: '',
        };
      }
      return { ...prev, isStreaming: false };
    });
  }, []);

  return { state, sendMessage, stopGeneration };
}
```

### 4.3 SSE 连接实现

```typescript
// lib/sse.ts

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface SSEOptions {
  url: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

export async function connectSSE(options: SSEOptions): Promise<void> {
  const { url, body, headers = {}, onToken, onComplete, onError, signal } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    onError(new ApiError(response.status, errBody.code || 'STREAM_ERROR', errBody.message));
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) { onError(new Error('No readable stream')); return; }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { onComplete(fullText); return; }

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'token') {
            fullText += parsed.content;
            onToken(parsed.content);
          } else if (parsed.type === 'error') {
            onError(new Error(parsed.message));
            return;
          } else if (parsed.type === 'metadata') {
            // 模型、token 数等元数据，可记录但不渲染
          }
        } catch {
          fullText += data;
          onToken(data);
        }
      }
    }
    onComplete(fullText);
  } catch (err) {
    if (signal?.aborted) return;
    onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    reader.releaseLock();
  }
}
```

### 4.4 分龄主题系统

```css
/* styles/tokens.css — 基础色板与分龄覆盖 */

:root {
  --color-primary: #4F46E5;
  --color-primary-light: #818CF8;
  --color-primary-dark: #3730A3;
  --color-success: #10B981;
  --color-warning: #F59E0B;
  --color-error: #EF4444;
  --spacing-xs: 4px;  --spacing-sm: 8px;
  --spacing-md: 16px; --spacing-lg: 24px; --spacing-xl: 32px;
  --radius-sm: 4px;   --radius-md: 8px;   --radius-lg: 16px;
  --font-sans: 'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-math: 'STIX Two Math', 'Latin Modern Math', serif;
}

[data-theme="kindergarten"] {
  --color-primary: #FF6B6B; --color-primary-light: #FFA0A0;
  --radius-md: 12px; --radius-lg: 20px; --font-size-base: 18px;
}
[data-theme="primary"] {
  --color-primary: #4ECDC4; --color-primary-light: #7EDDD6;
  --font-size-base: 16px;
}
[data-theme="junior"] {
  --color-primary: #5B7FFF; --color-primary-light: #8BA3FF;
  --font-size-base: 15px;
}
[data-theme="senior"] {
  --color-primary: #4F46E5; --color-primary-light: #818CF8;
  --font-size-base: 14px;
}
```

```typescript
// components/ThemeProvider.tsx
'use client';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import type { GradeLevel } from '@primetop/shared-types';

const GRADE_THEME: Record<GradeLevel, string> = {
  kindergarten: 'kindergarten', primary: 'primary',
  junior: 'junior', senior: 'senior',
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session);
  useEffect(() => {
    const t = session ? (GRADE_THEME[session.gradeLevel] || 'senior') : null;
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }, [session]);
  return <>{children}</>;
}
```

### 4.5 Web 端 BFF 层

Web 端使用 Next.js API Routes 作为 BFF，负责 SSE 流代理和文件上传代理：

```typescript
// app/api/stream/route.ts — SSE 代理
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const token = req.headers.get('authorization');

  const backendRes = await fetch(`${process.env.API_BASE_URL}/api/v1/ai/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token || '' },
    body: JSON.stringify(body),
  });

  return new Response(backendRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

```typescript
// app/api/upload/route.ts — 文件上传代理
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const token = req.headers.get('authorization');

  const res = await fetch(`${process.env.API_BASE_URL}/api/v1/files/upload`, {
    method: 'POST',
    headers: { 'Authorization': token || '' },
    body: formData,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

---

## 5. 小程序端架构详细设计

### 5.1 项目结构

```
miniapp/
├── src/
│   ├── app.config.ts             # Taro 全局配置
│   ├── app.ts                    # 入口
│   ├── app.scss                  # 全局样式
│   ├── pages/
│   │   ├── index/                # 首页
│   │   ├── ai/                   # AI 对话
│   │   ├── camera/               # 拍题答疑
│   │   ├── learn/                # 同步课堂
│   │   ├── learn-detail/         # 章节详情
│   │   ├── mistakes/             # 错题本
│   │   ├── report/               # 学情报告
│   │   ├── profile/              # 个人中心
│   │   ├── parent/               # 家长中心
│   │   ├── subscribe/            # 会员订阅
│   │   ├── tools/                # 学科工具箱
│   │   └── webview/              # WebView 承载页（复杂内容）
│   ├── components/
│   │   ├── ui/                   # 基础 UI 组件
│   │   ├── chat/                 # 对话组件
│   │   ├── formula/              # 公式渲染组件
│   │   ├── learning/             # 学习组件
│   │   └── report/               # 报表组件
│   ├── stores/                   # Zustand 状态管理
│   ├── services/                 # API 服务层
│   ├── utils/                    # 工具函数
│   └── styles/
│       ├── variables.scss        # Design Tokens (SCSS)
│       └── mixins.scss           # 通用混入
├── project.config.json           # 微信开发者工具配置
├── config/
│   ├── dev.ts                    # 开发环境
│   ├── prod.ts                   # 生产环境
│   └── index.ts                  # 基础配置
└── package.json
```

#### 5.1.1 Taro 全局配置

```typescript
// src/app.config.ts
export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/ai/index',
    'pages/camera/index',
    'pages/learn/index',
    'pages/learn-detail/index',
    'pages/mistakes/index',
    'pages/report/index',
    'pages/profile/index',
    'pages/parent/index',
    'pages/subscribe/index',
    'pages/tools/index',
    'pages/webview/index',
  ],
  tabBar: {
    color: '#999999',
    selectedColor: '#4F46E5',
    backgroundColor: '#ffffff',
    list: [
      { pagePath: 'pages/index/index', text: '首页', iconPath: 'assets/tab/home.png', selectedIconPath: 'assets/tab/home-active.png' },
      { pagePath: 'pages/ai/index', text: 'AI辅导', iconPath: 'assets/tab/ai.png', selectedIconPath: 'assets/tab/ai-active.png' },
      { pagePath: 'pages/learn/index', text: '同步学', iconPath: 'assets/tab/learn.png', selectedIconPath: 'assets/tab/learn-active.png' },
      { pagePath: 'pages/profile/index', text: '我的', iconPath: 'assets/tab/profile.png', selectedIconPath: 'assets/tab/profile-active.png' },
    ],
  },
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '启硕 PrimeTop',
    navigationBarTextStyle: 'black',
  },
});
```

### 5.2 小程序端认证流程

微信小程序的认证与移动端/Web端显著不同，核心是利用微信开放能力实现低摩擦登录。

#### 5.2.1 登录方式矩阵

| 方式 | 场景 | 优先级 | 用户体验 |
|------|------|--------|----------|
| 微信一键授权 | 新用户首次/老用户快速登录 | P0 | 最优：无需输入手机号 |
| 手机号+验证码 | 微信授权失败兜底 | P1 | 需切换输入 |
| 扫码登录 | 已有账号用户关联 | P2 | 需在其他端扫码 |

#### 5.2.2 微信登录时序

```
小程序端                  后端                     微信服务
   │                       │                         │
   │  1. wx.login()        │                         │
   │──────────────────────>│                         │
   │  返回 code            │                         │
   │<──────────────────────│                         │
   │                       │                         │
   │  2. POST /auth/wx-login {code}                   │
   │──────────────────────>│                         │
   │                       │  3. jscode2session(code)│
   │                       │────────────────────────>│
   │                       │  openid + session_key   │
   │                       │<────────────────────────│
   │                       │                         │
   │                       │  4. 查询用户是否已注册    │
   │                       │  (by openid)            │
   │                       │                         │
   │  5a. 已注册 → 直接返回 Token                     │
   │<──────────────────────│                         │
   │                       │                         │
   │  5b. 未注册 → 需获取手机号                        │
   │<──────────────────────│                         │
   │                       │                         │
   │  6. button(open-type="getPhoneNumber")          │
   │  → 获取 code + encryptedData + iv               │
   │──────────────────────>│                         │
   │                       │  7. 解密手机号           │
   │                       │  8. 创建账号 + 绑定openid│
   │                       │  9. 返回 JWT Token      │
   │<──────────────────────│                         │
```

#### 5.2.3 小程序端认证状态管理

```typescript
// miniapp/src/stores/authStore.ts
import { create } from 'zustand';
import Taro from '@tarojs/taro';

interface MiniAppSession {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: 'student' | 'parent' | 'teacher';
  gradeLevel: string;
  gradeYear: number;
  textbookVersion: string;
  membership: {
    plan: 'free' | 'monthly' | 'yearly' | 'exam_prep';
    expiresAt: string | null;
    remainingQuota: { aiQuestions: number; photoQuestions: number; resetAt: string };
  };
  openid: string;
}

interface AuthStore {
  session: MiniAppSession | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (session: MiniAppSession, token: string) => void;
  clearAuth: () => void;
}

const TOKEN_KEY = 'primetop_token';
const SESSION_KEY = 'primetop_session';

export const useAuthStore = create<AuthStore>((set) => ({
  session: null,
  token: null,
  isAuthenticated: false,

  setAuth: (session, token) => {
    // 持久化到小程序 Storage
    Taro.setStorageSync(TOKEN_KEY, token);
    Taro.setStorageSync(SESSION_KEY, JSON.stringify(session));
    set({ session, token, isAuthenticated: true });
  },

  clearAuth: () => {
    Taro.removeStorageSync(TOKEN_KEY);
    Taro.removeStorageSync(SESSION_KEY);
    set({ session: null, token: null, isAuthenticated: false });
  },
}));

// 启动时恢复会话
export function restoreSession(): { session: MiniAppSession; token: string } | null {
  try {
    const token = Taro.getStorageSync(TOKEN_KEY);
    const raw = Taro.getStorageSync(SESSION_KEY);
    if (token && raw) {
      const session = JSON.parse(raw) as MiniAppSession;
      useAuthStore.getState().setAuth(session, token);
      return { session, token };
    }
  } catch { /* ignore */ }
  return null;
}
```

#### 5.2.4 微信登录 API 接口

```
POST /api/v1/auth/wx-mini-login
```

请求体（步骤2）：
```json
{
  "code": "071abc123def456",
  "type": "login"
}
```

响应 — 已注册用户（步骤5a）：
```json
{
  "code": 0,
  "data": {
    "status": "registered",
    "token": "eyJhbG...",
    "refreshToken": "dGhpcy...",
    "session": { "userId": "...", "nickname": "...", ... }
  }
}
```

响应 — 新用户需绑定手机号（步骤5b）：
```json
{
  "code": 0,
  "data": {
    "status": "need_phone",
    "tempKey": "wx_bind_abc123",
    "ttl": 300
  }
}
```

请求体（步骤6，绑定手机号）：
```json
{
  "type": "bind_phone",
  "tempKey": "wx_bind_abc123",
  "phoneCode": "phone_code_from_wx_button",
  "nickname": "小明",
  "gradeLevel": "junior",
  "gradeYear": 8,
  "textbookVersion": "PEP"
}
```

响应（步骤9）：
```json
{
  "code": 0,
  "data": {
    "status": "registered",
    "token": "eyJhbG...",
    "refreshToken": "dGhpcy...",
    "session": { ... }
  }
}
```

### 5.3 小程序端 SSE 替代方案

微信小程序不支持原生 `EventSource`（SSE），需要替代方案实现 AI 流式对话。

#### 5.3.1 方案对比

| 方案 | 延迟 | 实现复杂度 | 用户体验 | 推荐 |
|------|------|-----------|---------|------|
| WebSocket 长连接 | 低（~50ms） | 中 | 流式输出，体验最佳 | ✅ 首选 |
| HTTP 分块传输（enableChunked） | 低（~100ms） | 低 | 可流式，但需要基础库 2.20.2+ | ✅ 备选 |
| 短轮询（500ms 间隔） | 高（~500ms） | 低 | 等待感明显，非流式 | ⚠️ 降级兜底 |

#### 5.3.2 WebSocket 流式方案

```typescript
// miniapp/src/services/wsStream.ts

export interface WSStreamOptions {
  url: string;
  body: Record<string, unknown>;
  token: string;
  onToken: (text: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

export class WSStreamManager {
  private socket: Weapp.SocketTask | null = null;
  private fullText = '';
  private reconnectAttempts = 0;
  private maxReconnect = 3;
  private static instance: WSStreamManager;

  static getInstance(): WSStreamManager {
    if (!WSStreamManager.instance) {
      WSStreamManager.instance = new WSStreamManager();
    }
    return WSStreamManager.instance;
  }

  connect(serverUrl: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = serverUrl.replace(/^http/, 'ws') + `/ws/chat?token=${token}`;

      this.socket = Taro.connectSocket({ url: wsUrl, header: { Authorization: `Bearer ${token}` } });

      this.socket.onOpen(() => {
        this.reconnectAttempts = 0;
        resolve();
      });

      this.socket.onError((err) => {
        reject(new Error(`WebSocket error: ${JSON.stringify(err)}`));
      });

      this.socket.onClose(() => {
        this.socket = null;
      });
    });
  }

  async startStream(options: WSStreamOptions): Promise<void> {
    const { onToken, onComplete, onError } = options;
    this.fullText = '';

    if (!this.socket) {
      try {
        await this.connect(options.url, options.token);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
        return;
      }
    }

    // 发送消息
    this.socket.send!({ data: JSON.stringify(options.body) });

    // 监听消息
    const messageHandler = (res: { data: string | ArrayBuffer }) => {
      const data = typeof res.data === 'string' ? res.data : '';

      if (data === '[DONE]') {
        this.socket!.offMessage(messageHandler);
        onComplete(this.fullText);
        return;
      }

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'token') {
          this.fullText += parsed.content;
          onToken(parsed.content);
        } else if (parsed.type === 'error') {
          this.socket!.offMessage(messageHandler);
          onError(new Error(parsed.message));
        }
      } catch {
        // 纯文本 token
        this.fullText += data;
        onToken(data);
      }
    };

    this.socket!.onMessage(messageHandler);
  }

  close(): void {
    this.socket?.close({});
    this.socket = null;
  }
}
```

#### 5.3.3 HTTP 分块传输方案（enableChunked）

```typescript
// miniapp/src/services/chunkedStream.ts
// 适用于基础库 2.20.2+

export interface ChunkedStreamOptions {
  url: string;
  body: Record<string, unknown>;
  token: string;
  onToken: (text: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

export function startChunkedStream(options: ChunkedStreamOptions): void {
  const { url, body, token, onToken, onComplete, onError } = options;
  let fullText = '';

  const requestTask = Taro.request({
    url,
    method: 'POST',
    data: body,
    header: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/event-stream',
    },
    enableChunked: true,  // 关键：启用分块传输
    success: () => {
      onComplete(fullText);
    },
    fail: (err) => {
      onError(new Error(err.errMsg));
    },
  });

  // 监听分块数据
  requestTask.onChunkReceived((res) => {
    const text = new TextDecoder('utf-8').decode(new Uint8Array(res.data as ArrayBuffer));
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'token') {
          fullText += parsed.content;
          onToken(parsed.content);
        }
      } catch {
        fullText += data;
        onToken(data);
      }
    }
  });
}
```

#### 5.3.4 降级短轮询方案

```typescript
// miniapp/src/services/pollingStream.ts

export async function startPollingStream(options: {
  url: string;
  body: Record<string, unknown>;
  token: string;
  pollInterval?: number;  // 默认 500ms
  onToken: (text: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}): Promise<{ stop: () => void }> {
  const { url, body, token, pollInterval = 500, onToken, onComplete, onError } = options;
  let stopped = false;
  let lastOffset = 0;

  // 先发起流式请求，获取 conversationId
  const initRes = await Taro.request({
    url: url.replace('/stream', '/start'),
    method: 'POST',
    data: body,
    header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  });

  if (initRes.statusCode !== 200) {
    onError(new Error(initRes.data?.message || '启动失败'));
    return { stop: () => {} };
  }

  const { conversationId, messageId } = initRes.data.data;

  // 轮询获取增量内容
  const poll = async () => {
    if (stopped) return;
    try {
      const res = await Taro.request({
        url: `${url.replace('/stream', '/poll')}?conversationId=${conversationId}&messageId=${messageId}&offset=${lastOffset}`,
        header: { 'Authorization': `Bearer ${token}` },
      });

      if (res.statusCode !== 200) return;

      const { tokens, offset, done } = res.data.data;
      for (const t of tokens) {
        onToken(t);
      }
      lastOffset = offset;

      if (done) {
        const fullRes = await Taro.request({
          url: `${url.replace('/stream', '/result')}?messageId=${messageId}`,
          header: { 'Authorization': `Bearer ${token}` },
        });
        onComplete(fullRes.data?.data?.content || '');
        return;
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (!stopped) setTimeout(poll, pollInterval);
  };

  setTimeout(poll, pollInterval);
  return { stop: () => { stopped = true; } };
}
```

#### 5.3.5 流式方案自动选择

```typescript
// miniapp/src/services/streamFactory.ts

import { WSStreamManager } from './wsStream';
import { startChunkedStream } from './chunkedStream';
import { startPollingStream } from './pollingStream';
import Taro from '@tarojs/taro';

export type StreamStrategy = 'websocket' | 'chunked' | 'polling';

function detectStrategy(): StreamStrategy {
  const systemInfo = Taro.getSystemInfoSync();
  const baseLibraryVersion = systemInfo.SDKVersion;

  // 基础库 2.20.2+ 支持 enableChunked
  if (compareVersion(baseLibraryVersion, '2.20.2') >= 0) {
    return 'chunked';
  }

  // 降级到 WebSocket
  return 'websocket';
}

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export interface StreamOptions {
  url: string;
  body: Record<string, unknown>;
  token: string;
  onToken: (text: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

export async function startStream(options: StreamOptions): Promise<{ stop: () => void }> {
  const strategy = detectStrategy();

  try {
    switch (strategy) {
      case 'chunked': {
        startChunkedStream(options);
        return { stop: () => {} }; // Taro requestTask 无法中断
      }
      case 'websocket': {
        const manager = WSStreamManager.getInstance();
        await manager.startStream(options);
        return { stop: () => manager.close() };
      }
      default: {
        return startPollingStream({ ...options, pollInterval: 500 });
      }
    }
  } catch (err) {
    // 策略失败，降级
    console.warn(`Stream strategy '${strategy}' failed, falling back to polling`, err);
    return startPollingStream({ ...options, pollInterval: 500 });
  }
}
```

### 5.4 小程序端相机与图片处理

#### 5.4.1 拍照流程

```typescript
// miniapp/src/services/camera.ts

export interface PhotoResult {
  tempFilePath: string;
  width: number;
  height: number;
  size: number;  // bytes
}

export async function takePhoto(): Promise<PhotoResult> {
  const { tempFiles } = await Taro.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: ['camera'],
    sizeType: ['compressed'],
    maxDuration: 0,
    camera: 'back',  // 默认后置摄像头（拍作业）
  });

  const file = tempFiles[0];
  return {
    tempFilePath: file.tempFilePath,
    width: file.width || 0,
    height: file.height || 0,
    size: file.size || 0,
  };
}

export async function chooseFromAlbum(maxCount = 1): Promise<PhotoResult[]> {
  const { tempFiles } = await Taro.chooseMedia({
    count: maxCount,
    mediaType: ['image'],
    sourceType: ['album'],
    sizeType: ['compressed'],
  });

  return tempFiles.map(f => ({
    tempFilePath: f.tempFilePath,
    width: f.width || 0,
    height: f.height || 0,
    size: f.size || 0,
  }));
}
```

#### 5.4.2 图片上传与压缩

```typescript
// miniapp/src/services/upload.ts

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
const TARGET_WIDTH = 1920;
const JPEG_QUALITY = 80;

export async function compressAndUpload(
  filePath: string,
  token: string,
  onProgress?: (progress: number) => void,
): Promise<{ fileId: string; url: string }> {
  // 1. 压缩图片
  let compressedPath = filePath;
  try {
    const info = await Taro.getImageInfo({ src: filePath });
    if (info.width > TARGET_WIDTH || info.height > TARGET_WIDTH) {
      const result = await Taro.compressImage({
        src: filePath,
        quality: JPEG_QUALITY,
      });
      compressedPath = result.tempFilePath;
    }
  } catch {
    // 压缩失败，使用原图
  }

  // 2. 上传
  const uploadTask = Taro.uploadFile({
    url: `${getBaseUrl()}/api/v1/files/upload`,
    filePath: compressedPath,
    name: 'file',
    header: { 'Authorization': `Bearer ${token}` },
    formData: {
      purpose: 'photo_question',
      maxSize: String(MAX_IMAGE_SIZE),
    },
  });

  uploadTask.progress((res) => {
    onProgress?.(res.progress);
  });

  return new Promise((resolve, reject) => {
    uploadTask.then((res) => {
      if (res.statusCode === 200) {
        const data = JSON.parse(res.data);
        resolve(data.data);
      } else {
        reject(new Error(`Upload failed: ${res.statusCode}`));
      }
    }).catch(reject);
  });
}
```

### 5.5 小程序端消息通知

小程序使用微信「订阅消息」替代 App Push，需要用户主动授权。

#### 5.5.1 订阅消息模板

| 模板ID（申请后） | 场景 | 触发时机 |
|-----------------|------|----------|
| tmpl_daily_plan | 今日学习任务提醒 | 每日定时（用户设定时间） |
| tmpl_review_due | 错题复习提醒 | 遗忘曲线到期 |
| tmpl_weekly_report | 周报生成通知 | 每周一生成 |
| tmpl_membership | 会员到期提醒 | 到期前 3 天 |
| tmpl_parent_daily | 家长日结报告 | 每晚 21:00 |

#### 5.5.2 订阅消息授权与发送

```typescript
// miniapp/src/services/subscribeMessage.ts

const TEMPLATE_IDS = [
  'tmpl_daily_plan',
  'tmpl_review_due',
  'tmpl_weekly_report',
  'tmpl_membership',
  'tmpl_parent_daily',
];

/** 请求订阅消息授权（每次只能授权一次） */
export async function requestSubscribe(): Promise<string[]> {
  try {
    const result = await Taro.requestSubscribeMessage({
      tmplIds: TEMPLATE_IDS,
    });

    const accepted = TEMPLATE_IDS.filter(
      id => result[id] === 'accept'
    );

    // 上报授权结果
    await post('/api/v1/notifications/subscribe-status', {
      platform: 'wx_miniapp',
      accepted,
      rejected: TEMPLATE_IDS.filter(id => result[id] === 'reject'),
    });

    return accepted;
  } catch (err) {
    console.warn('Subscribe message rejected:', err);
    return [];
  }
}

/** 在合适时机引导授权 */
export function promptSubscribeOnAction(action: 'login' | 'add_mistake' | 'create_plan') {
  // 登录后、添加错题后、创建学习计划后引导
  // 避免频繁弹出
  const lastPromptTime = Taro.getStorageSync('last_subscribe_prompt') || 0;
  const now = Date.now();
  if (now - lastPromptTime < 24 * 60 * 60 * 1000) return; // 24h 内不重复提示

  Taro.showModal({
    title: '开启学习提醒',
    content: '开启后可以在微信收到学习任务和复习提醒，不错过重要学习计划',
    confirmText: '开启提醒',
    success: async (res) => {
      if (res.confirm) {
        await requestSubscribe();
        Taro.setStorageSync('last_subscribe_prompt', now);
      }
    },
  });
}
```

### 5.6 小程序端微信支付

```typescript
// miniapp/src/services/payment.ts

export interface CreateOrderResult {
  orderId: string;
  paymentParams: {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: string;
    paySign: string;
  };
}

export async function createAndPay(params: {
  planType: 'monthly' | 'yearly' | 'exam_prep';
  couponCode?: string;
}): Promise<{ orderId: string; transactionId: string }> {
  const token = useAuthStore.getState().token!;

  // 1. 创建订单
  const orderRes = await Taro.request({
    url: `${getBaseUrl()}/api/v1/payment/orders`,
    method: 'POST',
    data: {
      planType: params.planType,
      channel: 'wx_miniapp',
      couponCode: params.couponCode,
    },
    header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  });

  if (orderRes.statusCode !== 200) {
    throw new Error(orderRes.data?.message || '创建订单失败');
  }

  const order: CreateOrderResult = orderRes.data.data;

  // 2. 调起微信支付
  return new Promise((resolve, reject) => {
    Taro.requestPayment({
      ...order.paymentParams,
      success: async () => {
        // 3. 前端确认支付（后端也会收到微信回调）
        try {
          await Taro.request({
            url: `${getBaseUrl()}/api/v1/payment/orders/${order.orderId}/confirm`,
            method: 'POST',
            header: { 'Authorization': `Bearer ${token}` },
          });
        } catch { /* 后端回调为准 */ }

        resolve({ orderId: order.orderId, transactionId: '' });
      },
      fail: (err) => {
        if (err.errMsg?.includes('cancel')) {
          reject(new Error('PAYMENT_CANCELLED'));
        } else {
          reject(new Error(`Payment failed: ${err.errMsg}`));
        }
      },
    });
  });
}
```

### 5.7 小程序端分龄主题

小程序不支持 CSS Variables 运行时切换，需编译时生成多套样式。

```scss
// styles/variables.scss

// 默认（高中 senior）主题
$color-primary: #4F46E5;
$color-primary-light: #818CF8;
$radius-md: 8px;
$font-size-base: 28rpx;

// 小学主题覆盖
// 通过运行时添加 class 实现
.theme-primary {
  --color-primary: #4ECDC4;
  --color-primary-light: #7EDDD6;
}

.theme-junior {
  --color-primary: #5B7FFF;
  --color-primary-light: #8BA3FF;
}

.theme-kindergarten {
  --color-primary: #FF6B6B;
  --color-primary-light: #FFA0A0;
  --radius-md: 24rpx;
  --font-size-base: 36rpx;
}
```

```typescript
// 小程序端通过 page 上添加 class 实现主题切换
// stores/themeStore.ts
import { create } from 'zustand';
import Taro from '@tarojs/taro';

const GRADE_THEME_MAP: Record<string, string> = {
  kindergarten: 'theme-kindergarten',
  primary: 'theme-primary',
  junior: 'theme-junior',
  senior: 'theme-senior',  // 默认，无需额外 class
};

export function getThemeClass(gradeLevel?: string): string {
  return GRADE_THEME_MAP[gradeLevel || 'senior'] || '';
}
```

---

## 6. 共享层 API 客户端

Web 端和小程序端共享统一的 API 客户端抽象层，隐藏平台差异。

### 6.1 HTTP 客户端抽象

```typescript
// packages/shared-api/src/client.ts

export interface HttpRequestConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  data?: Record<string, unknown>;
  header?: Record<string, string>;
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  statusCode: number;
  data: T;
  header: Record<string, string>;
}

// 平台实现此接口
export interface HttpClient {
  request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>>;
}

// Web 端实现（基于 fetch）
export class WebHttpClient implements HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const res = await fetch(`${this.baseUrl}${config.url}`, {
      method: config.method,
      headers: { 'Content-Type': 'application/json', ...config.header },
      body: config.data ? JSON.stringify(config.data) : undefined,
    });

    const data = await res.json();
    return {
      statusCode: res.status,
      data,
      header: Object.fromEntries(res.headers.entries()),
    };
  }
}

// 小程序端实现（基于 Taro.request）
import Taro from '@tarojs/taro';

export class MiniAppHttpClient implements HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    const res = await Taro.request({
      url: `${this.baseUrl}${config.url}`,
      method: config.method,
      data: config.data,
      header: { 'Content-Type': 'application/json', ...config.header },
      timeout: config.timeout || 30000,
    });

    return {
      statusCode: res.statusCode,
      data: res.data as T,
      header: res.header as Record<string, string>,
    };
  }
}
```

### 6.2 Token 刷新拦截器

```typescript
// packages/shared-api/src/interceptors.ts

export class TokenRefreshInterceptor {
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private getRefreshToken: () => string | null,
    private onRefreshed: (newToken: string, newRefreshToken: string) => void,
    private onRefreshFailed: () => void,
  ) {}

  async intercept(
    config: HttpRequestConfig,
    next: (config: HttpRequestConfig) => Promise<HttpResponse>,
  ): Promise<HttpResponse> {
    // 注入 token
    const token = this.getAccessToken();
    if (token) {
      config.header = { ...config.header, Authorization: `Bearer ${token}` };
    }

    const response = await next(config);

    // 401 → 尝试刷新
    if (response.statusCode === 401) {
      const newToken = await this.refreshToken();
      if (newToken) {
        config.header = { ...config.header, Authorization: `Bearer ${newToken}` };
        return next(config);
      } else {
        this.onRefreshFailed();
        return response;
      }
    }

    return response;
  }

  private getAccessToken(): string | null {
    // 平台各自从 storage 中获取
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('primetop-auth');
      return raw ? JSON.parse(raw)?.state?.session?.accessToken : null;
    }
    // 小程序端由调用方注入
    return null;
  }

  private async refreshToken(): Promise<string | null> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const refreshToken = this.getRefreshToken();
        if (!refreshToken) return null;

        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (!res.ok) return null;

        const data = await res.json();
        this.onRefreshed(data.data.token, data.data.refreshToken);
        return data.data.token;
      } catch {
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }
}
```

---

## 7. 跨端共享服务端接口

### 7.1 平台标识约定

所有 API 请求通过 `X-Platform` Header 标识来源平台，服务端根据此标识做差异化处理。

| Header 值 | 平台 | 影响 |
|-----------|------|------|
| `android` | Android App | 推送通道、版本更新检查 |
| `ios` | iOS App | APNs 推送、App Store 版本检查 |
| `web` | Web 端 | 无 Push、验证码登录 |
| `wx_miniapp` | 微信小程序 | 微信支付、订阅消息、微信登录 |

```typescript
// 平台端注入 X-Platform header
// Web:
headers: { 'X-Platform': 'web', ... }
// 小程序:
headers: { 'X-Platform': 'wx_miniapp', ... }
```

### 7.2 服务端新增接口

现有 API 不需修改，仅新增以下接口支持多端：

| 接口 | 说明 | 新增原因 |
|------|------|----------|
| `POST /auth/wx-mini-login` | 微信小程序登录 | 小程序特有认证 |
| `GET /auth/wx-bind-status` | 查询 openid 绑定状态 | 关联已有账号 |
| `POST /payment/orders` (扩展 channel 字段) | 增加 `wx_miniapp` 渠道 | 微信支付参数不同 |
| `POST /notifications/subscribe-status` | 小程序订阅消息授权结果 | 小程序特有 |
| `GET /stream/poll` | 轮询获取增量内容 | 小程序 SSE 替代 |
| `GET /stream/result` | 获取完整结果 | 轮询结束后获取 |
| `POST /ws/chat` | WebSocket 连接 | 小程序 SSE 替代 |

### 7.3 WebSocket 服务端扩展

服务端需新增 WebSocket 端点用于小程序端流式通信：

```python
# server/routes/ws.py
from fastapi import WebSocket, WebSocketDisconnect, Depends
from services.auth import verify_ws_token
from services.ai_stream import stream_ai_response
import json

@router.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket, token: str):
    """WebSocket 端点，用于小程序端 AI 流式对话"""
    # 鉴权
    user = await verify_ws_token(token)
    if not user:
        await websocket.close(code=4001, reason="Invalid token")
        return

    await websocket.accept()

    try:
        while True:
            raw = await websocket.receive_text()
            message = json.loads(raw)

            # 流式生成
            full_text = ""
            async for chunk in stream_ai_response(
                user_id=user.id,
                conversation_id=message.get('conversationId'),
                content=message['message'],
                grade_level=user.grade_level,
                subject=message.get('subject'),
            ):
                full_text += chunk
                await websocket.send_text(json.dumps({
                    'type': 'token',
                    'content': chunk,
                }))

            # 发送完成信号
            await websocket.send_text('[DONE]')

    except WebSocketDisconnect:
        pass  # 客户端断开
    except json.JSONDecodeError:
        await websocket.send_text(json.dumps({
            'type': 'error',
            'message': 'Invalid message format',
        }))
    except Exception as e:
        await websocket.send_text(json.dumps({
            'type': 'error',
            'message': str(e),
        }))
        await websocket.close(code=1011, reason="Internal error")
```

---

## 8. 构建与部署

### 8.1 Monorepo 结构

```
primetop/
├── apps/
│   ├── mobile/              # Flutter 移动端
│   ├── web/                 # Next.js Web 端
│   └── miniapp/             # Taro 小程序端
├── packages/
│   ├── shared-types/        # 共享类型
│   ├── shared-utils/        # 共享工具
│   ├── shared-api/          # 共享 API 客户端
│   └── shared-hooks/        # 共享 React Hooks
├── server/                  # 后端服务
├── docs/
└── docs2/
```

**包管理器**：pnpm workspace

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### 8.2 Web 端构建与部署

```yaml
# .github/workflows/web-deploy.yml
name: Web Deploy

on:
  push:
    branches: [main]
    paths: ['apps/web/**', 'packages/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with: { node-version: 20 }

      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @primetop/web build
      - run: pnpm --filter @primetop/web test

      # 部署到 Vercel
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: apps/web
``n
### 8.3 小程序端构建与上传

```yaml
# .github/workflows/miniapp-deploy.yml
name: Miniapp Deploy

on:
  push:
    branches: [main]
    paths: ['apps/miniapp/**', 'packages/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with: { node-version: 20 }

      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @primetop/miniapp build -- --type weapp

      # 使用 miniprogram-ci 上传
      - uses: YaoZeyuan/miniprogram-ci@v1
        with:
          appid: ${{ secrets.WX_APPID }}
          private-key: ${{ secrets.WX_PRIVATE_KEY }}
          project-path: apps/miniapp/dist
          version: ${{ github.ref_name }}
          desc: "Deploy from CI"
```

### 8.4 环境变量管理

| 变量 | Web 端 | 小程序端 | 说明 |
|------|--------|---------|------|
| `NEXT_PUBLIC_API_BASE_URL` | ✅ | - | API 基础地址 |
| `API_BASE_URL` | ✅ (Server) | - | 服务端 API 地址 |
| `TARO_APP_API_BASE_URL` | - | ✅ | API 基础地址 |
| `TARO_APP_WS_URL` | - | ✅ | WebSocket 地址 |
| `TARO_APP_WX_APPID` | - | ✅ | 微信 AppID |

---

## 9. 性能优化策略

### 9.1 Web 端性能优化

| 策略 | 具体措施 | 目标效果 |
|------|---------|---------|
| 代码分割 | Next.js 自动按路由分割 + dynamic import 大组件 | 首屏 JS ≤ 200KB (gzipped) |
| 图片优化 | next/image + WebP/AVIF 自动格式 | 图片体积减少 50% |
| 字体优化 | font-display: swap + 子集化中文字体 | 字体加载不阻塞渲染 |
| 公式预渲染 | KaTeX SSR 渲染 + 客户端 hydrate | 公式闪烁最小化 |
| ISR 缓存 | 教材目录、公式库等静态内容 ISR 5min | 重复访问秒开 |
| Prefetch | 路由 prefetch + 预加载用户常用页面 | 页面切换 < 200ms |
| Service Worker | 离线缓存学习记录、错题数据 | 离线可访问核心数据 |

### 9.2 小程序端性能优化

| 策略 | 具体措施 | 目标效果 |
|------|---------|---------|
| 分包加载 | 按功能模块分包，主包仅放核心页面 | 主包 ≤ 1.5MB |
| 图片资源 | 所有图片走 CDN，代码包不放图片 | 减少包体积 |
| 分包预下载 | 在首页静默预下载常用分包 | 分包打开 < 500ms |
| 数据预拉取 | 利用小程序「数据预拉取」能力 | 冷启动更快 |
| 列表虚拟化 | 长列表（错题本、对话历史）虚拟滚动 | 内存占用可控 |
| 防抖节流 | 搜索输入、滚动事件节流 | 减少无效渲染 |
| 减少 setData | 合并 setData 调用，避免频繁更新 | 渲染帧率稳定 |

#### 9.2.1 分包配置

```typescript
// app.config.ts 分包配置
export default defineAppConfig({
  subPackages: [
    {
      root: 'pages/learn',
      pages: ['index', 'detail'],
    },
    {
      root: 'pages/mistakes',
      pages: ['index'],
    },
    {
      root: 'pages/report',
      pages: ['index'],
    },
    {
      root: 'pages/parent',
      pages: ['index'],
    },
    {
      root: 'pages/tools',
      pages: ['index'],
    },
  ],
  // 分包预下载
  preloadRule: {
    'pages/index/index': {
      network: 'all',
      packages: ['pages/learn', 'pages/mistakes'],
    },
  },
});
```

---

## 10. 错误处理与降级策略

### 10.1 跨端统一错误码

在共享层定义统一错误处理逻辑，各端适配 UI 表现：

```typescript
// packages/shared-api/src/errors.ts

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number,
    public retryable: boolean = false,
  public platform?: 'web' | 'miniapp',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function handleApiError(error: unknown, platform: 'web' | 'miniapp'): void {
  if (error instanceof AppError) {
    switch (error.code) {
      case 'AUTH_002':  // Token 过期
        // 各端跳转登录
        if (platform === 'web') {
          window.location.href = '/login';
        } else {
          Taro.redirectTo({ url: '/pages/index/index' });
        }
        break;
      case 'QUOTA_001':  // AI 额度用尽
        showUpgradePrompt(platform);
        break;
      case 'STREAM_001':  // 流式连接失败
        showRetryDialog(platform, error.message);
        break;
      default:
        showErrorToast(platform, error.message);
    }
  } else {
    showErrorToast(platform, '网络异常，请稍后重试');
  }
}

function showUpgradePrompt(platform: 'web' | 'miniapp') {
  if (platform === 'web') {
    // Web: 弹窗引导
    window.location.href = '/profile?tab=subscribe';
  } else {
    Taro.navigateTo({ url: '/pages/subscribe/index' });
  }
}

function showRetryDialog(platform: 'web' | 'miniapp', message: string) {
  if (platform === 'web') {
    window.confirm(`${message}\n是否重试？`);
  } else {
    Taro.showModal({ title: '提示', content: message, confirmText: '重试' });
  }
}

function showErrorToast(platform: 'web' | 'miniapp', message: string) {
  if (platform === 'web') {
    // Web 端 toast 方案
    console.error(message);
  } else {
    Taro.showToast({ title: message, icon: 'none', duration: 2000 });
  }
}
```

### 10.2 降级矩阵

| 场景 | Web 端降级 | 小程序端降级 |
|------|-----------|-------------|
| SSE 不可用 | HTTP 轮询（备用） | WebSocket → enableChunked → 轮询 |
| 公式渲染失败 | 显示 LaTeX 原文本 | 显示 Unicode 近似文本 |
| 图片上传失败 | 重试 + 本地暂存 | 重试 + 提示重拍 |
| API 请求超时 | Skeleton 等待 + 取消按钮 | Loading 态 + 重试按钮 |
| WebSocket 断开 | N/A | 自动重连（最多 3 次）后降级轮询 |
| 小程序包超限 | N/A | WebView 加载复杂页面 |

---

## 11. 测试策略

### 11.1 共享层测试

| 类型 | 工具 | 覆盖范围 |
|------|------|----------|
| 单元测试 | Vitest | shared-utils、shared-api 中的纯逻辑 |
| 类型测试 | tsd | shared-types 类型正确性 |
| 快照测试 | Vitest | API 响应类型与序列化 |

### 11.2 Web 端测试

| 类型 | 工具 | 说明 |
|------|------|------|
| 组件测试 | React Testing Library + Vitest | UI 组件交互逻辑 |
| E2E 测试 | Playwright | 核心流程（登录→对话→查看报告） |
| 视觉回归 | Playwright 截图对比 | 分龄主题 UI 一致性 |
| 性能测试 | Lighthouse CI | LCP/FCP/CLS 指标 |
| 无障碍 | axe-core | WCAG 2.1 AA 合规 |

### 11.3 小程序端测试

| 类型 | 工具 | 说明 |
|------|------|------|
| 组件测试 | Vitest + @tarojs/test-utils | 组件逻辑和渲染 |
| 小程序 API Mock | miniprogram-simulate | 模拟 wx API |
| 真机测试 | 微信开发者工具自动测试 | 核心流程回归 |
| 兼容性 | 微信开发者工具多版本 | 基础库版本兼容 |

### 11.4 关键测试场景

| 场景 | Web 端 | 小程序端 |
|------|--------|---------|
| 登录流程 | 验证码登录完整流程 | 微信授权 → 手机号绑定 → 完整流程 |
| AI 流式对话 | SSE 连接 → 流式渲染 → 断线重连 | WebSocket/chunked → 流式渲染 → 降级 |
| 拍题上传 | 文件选择 → 预览 → 上传 → 解析 | 相机/相册 → 压缩 → 上传 → 解析 |
| 支付流程 | 选购 → 创建订单 → 支付宝/微信 H5 支付 | 选购 → 创建订单 → 微信支付 → 验证 |
| 分龄主题 | 切换学段 → 主题即时变更 | 切换学段 → 页面 class 变更 → 样式生效 |
| 401 Token 过期 | 请求 → 401 → 静默刷新 → 重试 | 请求 → 401 → 静默刷新 → 重试 |

---

## 12. 监控与埋点

### 12.1 性能指标采集

```typescript
// packages/shared-utils/src/perf.ts

export interface PlatformPerfMetrics {
  // Web 端
  fcp?: number;      // First Contentful Paint
  lcp?: number;      // Largest Contentful Paint
  cls?: number;      // Cumulative Layout Shift
  fid?: number;      // First Input Delay

  // 小程序端
  coldStart?: number;  // 冷启动耗时
  hotStart?: number;   // 热启动耗时
  pageReady?: number;  // 页面就绪耗时
  setDataSize?: number; // 单次 setData 数据量
}

export function collectWebMetrics(): PlatformPerfMetrics {
  if (typeof window === 'undefined' || !window.performance) return {};

  const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return {
    fcp: nav?.loadEventEnd - nav?.startTime || 0,
    lcp: 0, // 通过 PerformanceObserver 异步获取
  };
}

export function collectMiniAppMetrics(): PlatformPerfMetrics {
  const start = Date.now();
  return {
    coldStart: start, // 在 app.ts onLaunch 中采集差值
    pageReady: 0,     // 在各页面 onReady 中采集
  };
}
```

### 12.2 错误监控

| 指标 | Web 端 | 小程序端 |
|------|--------|---------|
| JS 错误率 | window.onerror + unhandledrejection | Taro.onError 全局捕获 |
| API 错误率 | fetch interceptor | Taro.request interceptor |
| 资源加载失败 | PerformanceObserver | N/A（小程序无此 API） |
| 白屏率 | FCP > 5s 判定 | pageReady > 3s 判定 |
| SSE 连接失败 | onError 回调 | WebSocket close 事件 |

---

## 13. 版本兼容与迁移

### 13.1 浏览器兼容目标

| 浏览器 | 最低版本 | 说明 |
|--------|---------|------|
| Chrome | 90+ | SSE、ES2020 |
| Safari | 15+ | iOS 设备 |
| Firefox | 90+ | 主流桌面 |
| Edge | 90+ | Chromium 内核 |
| IE | ❌ 不支持 | - |

### 13.2 微信基础库兼容

| 基础库版本 | 支持能力 | 最低要求 |
|-----------|---------|----------|
| 2.20.2+ | enableChunked（推荐） | 推荐 |
| 2.10.0+ | WebSocket 稳定版 | 兼容 |
| 2.7.0+ | 基础能力 | 最低 |

### 13.3 数据迁移

Web 端和小程序端共享同一个后端账号体系，无需数据迁移。用户在任意端的学习数据实时同步。注意点：

1. **Token 不跨端共享**：各端各自管理 Token 生命周期
2. **缓存各自管理**：Web 用 localStorage/IndexedDB，小程序用 Taro.setStorage
3. **会话续接**：通过 conversationId + messageId 在不同端恢复 AI 对话上下文
4. **进度同步**：所有学习进度写入服务端，各端从服务端读取最新状态

---

## 14. 上线计划与里程碑

### 14.1 Web 端上线里程碑

| 阶段 | 时间 | 范围 |
|------|------|------|
| Alpha | 2 周 | 基础框架搭建 + 认证 + AI 对话页 |
| Beta | 4 周 | 拍题 + 同步课堂 + 错题本 + 学情报告 |
| RC | 2 周 | 支付 + 性能优化 + 兼容性测试 |
| GA | 1 周 | 灰度发布 + 全量上线 |

### 14.2 小程序端上线里程碑

| 阶段 | 时间 | 范围 |
|------|------|------|
| Alpha | 2 周 | 基础框架 + 微信登录 + AI 对话（WebSocket） |
| Beta | 3 周 | 拍题 + 同步课堂 + 错题本（只读） |
| RC | 2 周 | 微信支付 + 订阅消息 + 分包优化 + 真机测试 |
| 提审 | 1 周 | 提交微信审核 + 问题修复 |
| 上线 | 1 周 | 审核通过 + 发布 |

### 14.3 首批上线功能范围

**Web 端 GA**：AI 对话、拍题答疑、同步课堂、错题本、学情报告、学习规划、作文辅导、家长中心、个人中心、支付订阅

**小程序端 GA**：AI 对话、拍题答疑（简化）、同步课堂、错题本（只读+基础操作）、学情报告（精简版）、个人中心、微信支付、家长日结报告

---

## 15. 安全与合规

### 15.1 Web 端安全措施

| 风险 | 措施 |
|------|------|
| XSS | CSP Header + DOMPurify 富文本消毒 + React 自动转义 |
| CSRF | SameSite Cookie + CSRF Token（表单提交时） |
| Token 泄露 | httpOnly refresh token cookie + 内存中 access token |
| 点击劫持 | X-Frame-Options: DENY |
| 敏感数据 | localStorage 不存储明文密码/手机号 |

### 15.2 小程序端安全措施

| 风险 | 措施 |
|------|------|
| 代码包反编译 | 代码混淆 + 关键逻辑放后端 |
| 接口盗用 | 请求签名 + session_key 不下发客户端 |
| openid 泄露 | 仅后端存储和使用 openid |
| 敏感数据 | Storage 加密存储 token（Taro.setStorage + AES） |
| 微信支付篡改 | 后端验证支付回调签名 |

### 15.3 隐私合规

| 要求 | Web 端 | 小程序端 |
|------|--------|---------|
| 隐私政策 | 首次访问弹窗确认 | 小程序隐私协议组件 |
| Cookie 同意 | Cookie Banner（GDPR 如适用） | N/A |
| 儿童信息保护 | 注册时年龄确认 + 家长授权流程 | 微信实名 + 家长绑定 |
| 数据导出 | 设置页提供导出功能 | 跳转 Web 端导出 |
| 账号注销 | 设置页注销 | 跳转 Web 端注销 |