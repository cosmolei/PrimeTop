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
│   ├── app.scss
│   ├── pages/
│   │   ├── index/                # 首页
│   │   ├── ai/                   # AI 对话
│   │   ├── camera/               # 拍题答疑
│   │   ├── learn/                # 同步课堂
│   │   ├── mistakes/             # 错题本
│   │   ├── report/               # 学情报告
│   │   ├── profile/              # 个人中心
│   │   ├── parent/               # 家长中心
│   │   ├── subscribe/            # 会员订阅
│   │   └