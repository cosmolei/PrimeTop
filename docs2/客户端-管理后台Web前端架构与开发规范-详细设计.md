# 客户端-管理后台 Web 前端架构与开发规范 详细设计

## 1. 概述

### 1.1 模块定位

管理后台 Web 前端是 PrimeTop 平台运营管理人员、内容编辑人员、审核人员和平台管理员使用的 Web 管理控制台。它是连接平台运营策略与系统数据的核心操作界面，支撑内容管理、用户管理、AI 配置、数据分析、审核工单、运营活动等全部后台业务流程。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 统一管理入口 | 为不同角色提供统一登录、统一鉴权、差异化菜单 |
| 内容生产与管理 | 教材、知识点、题库、考点、课程资源的 CRUD 与审核流程 |
| AI 模型与 Prompt 配置 | 大模型供应商管理、Prompt 模板编辑、调用策略配置 |
| 用户与权限管理 | 用户查询、角色分配、权限调整、账号封禁 |
| 数据分析看板 | 运营数据、用户活跃、AI 调用成本、内容质量监控 |
| 运营活动管理 | 弹窗配置、优惠券发放、打卡活动创建、AB 实验配置 |
| 财务与订单管理 | 会员订单查询、退款审核、发票管理、对账查看 |
| 系统配置 | 枚举管理、参数配置、特性开关、日志查看 |

### 1.3 用户角色

| 角色 | 权限范围 | 典型操作 |
| --- | --- | --- |
| 超级管理员 | 全部模块 | 角色管理、系统配置、全部数据访问 |
| 内容运营 | 内容管理模块 | 教材/知识点/题库 CRUD、内容审核提交 |
| 内容审核 | 审核工作台 | AI 输出审核、用户内容审核、UGC 审核 |
| AI 配置员 | AI 管理模块 | Prompt 模板编辑、模型参数调整、AB 测试配置 |
| 数据分析员 | 数据看板模块 | 运营报表查看、数据导出、漏斗分析 |
| 财务运营 | 财务模块 | 订单查询、退款审核、发票开具、对账 |
| 客服运营 | 客服工单模块 | 工单处理、用户反馈查看、FAQ 维护 |
| 只读访客 | 指定模块只读 | 数据查看、报表导出（无编辑权限） |

### 1.4 依赖关系

```
管理后台 Web 前端
    │
    ├── 依赖 → 统一认证授权服务 (SSO / JWT)
    ├── 依赖 → API 网关 (所有业务接口)
    ├── 依赖 → 文件存储服务 (图片/文档上传)
    ├── 依赖 → WebSocket 服务 (实时通知/审核状态推送)
    └── 被依赖 ← 运营人员浏览器访问
```

### 1.5 与移动端的区别

| 维度 | 管理后台 Web | 学生/家长 APP |
| --- | --- | --- |
| 技术栈 | React 18 + TypeScript | Flutter |
| 目标用户 | 内部运营/管理人员 | C 端用户（学生/家长） |
| 交互模式 | 高信息密度、表格驱动、键盘友好 | 触摸友好、卡片化、低认知负担 |
| 设计系统 | Ant Design Pro | 自定义移动端设计系统 |
| 部署方式 | CDN 静态部署 | 应用商店/热更新 |
| 认证方式 | 账号密码 + 二次验证 | 手机验证码 + 第三方登录 |
| 性能要求 | 首屏 ≤ 3s、表格渲染 ≤ 1s | 首屏 ≤ 2s、交互 ≤ 100ms |

---

## 2. 技术选型与架构总览

### 2.1 技术栈

| 层面 | 选型 | 版本 | 选择理由 |
| --- | --- | --- | --- |
| 核心框架 | React | 18.x | 生态成熟、团队熟悉度高、Ant Design 原生支持 |
| 开发语言 | TypeScript | 5.x | 类型安全、重构友好、IDE 补全 |
| UI 框架 | Ant Design Pro | 5.x | 企业级管理后台首选方案，组件丰富 |
| 状态管理 | Zustand + React Query | latest | 轻量全局状态 + 服务端状态缓存分离 |
| 路由 | React Router | 6.x | React 生态标准路由方案 |
| 构建工具 | Vite | 5.x | 极速 HMR、ESM 原生支持、打包优化 |
| HTTP 客户端 | Axios + React Query | latest | 请求拦截 + 自动缓存与重试 |
| 图表库 | ECharts + @ant-design/charts | 5.x | 数据可视化、运营看板渲染 |
| 富文本编辑器 | TinyMCE / Plate | latest | 内容编辑、知识点描述排版 |
| 代码编辑器 | Monaco Editor | latest | Prompt 模板编辑（含高亮） |
| 表单方案 | Ant Design Form + zod | latest | 表单校验 + 类型推导 |
| 国际化 | react-i18next | latest | 预留多语言能力（初期仅中文） |
| 样式方案 | Tailwind CSS + CSS Modules | 3.x | 原子化样式 + 组件级隔离 |
| 测试框架 | Vitest + Playwright | latest | 单元测试 + ETD 端到端测试 |
| 代码规范 | ESLint + Prettier + Husky | latest | 代码质量保障 |

### 2.2 架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                        管理后台 Web 前端                              │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  内容管理 │  │  用户管理 │  │  AI 管理  │  │  数据看板 │   功能模块  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  审核工作 │  │  运营活动 │  │  财务订单 │  │  系统配置 │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    共享业务组件层                              │   │
│  │  ProTable │ ProForm │ SchemaForm │ RichEditor │ ChartContainer │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    基础设施层                                  │   │
│  │  Auth │ RBAC │ Router │ HTTP │ WebSocket │ Upload │ i18n     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    核心框架层                                  │   │
│  │  React 18 │ TypeScript │ Vite │ Ant Design Pro │ Tailwind    │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.3 项目目录结构

```
primetop-admin/
├── public/
│   ├── favicon.ico
│   └── index.html
├── src/
│   ├── main.tsx                    # 应用入口
│   ├── App.tsx                     # 根组件 + 路由配置
│   ├── api/                        # API 接口层
│   │   ├── client.ts               # Axios 实例 + 拦截器
│   │   ├── types.ts                # 通用响应类型
│   │   ├── content/                # 内容管理接口
│   │   │   ├── textbook.ts
│   │   │   ├── knowledge.ts
│   │   │   ├── question.ts
│   │   │   └── review.ts
│   │   ├── user/                   # 用户管理接口
│   │   ├── ai/                     # AI 配置接口
│   │   ├── analytics/              # 数据分析接口
│   │   ├── operation/              # 运营管理接口
│   │   └── system/                 # 系统配置接口
│   ├── components/                 # 共享业务组件
│   │   ├── ProTable/               # 增强数据表格
│   │   ├── SchemaForm/             # Schema 驱动表单
│   │   ├── RichEditor/             # 富文本编辑器
│   │   ├── PromptEditor/           # Prompt 代码编辑器
│   │   ├── ChartContainer/         # 图表容器
│   │   ├── FileUploader/           # 文件上传组件
│   │   ├── AuditTrail/             # 操作审计展示
│   │   ├── PermissionWrapper/      # 权限包裹组件
│   │   └── DataDictionarySelect/   # 数据字典选择器
│   ├── hooks/                      # 自定义 Hooks
│   │   ├── useAuth.ts              # 认证状态
│   │   ├── usePermission.ts        # 权限检查
│   │   ├── usePagination.ts        # 分页逻辑
│   │   ├── useDownload.ts          # 文件下载
│   │   └── useWebSocket.ts         # WebSocket 连接
│   ├── layouts/                    # 布局组件
│   │   ├── BasicLayout.tsx         # 基础布局（侧边栏+顶栏+内容）
│   │   ├── Header.tsx              # 顶部导航
│   │   ├── Sider.tsx               # 侧边菜单
│   │   └── BlankLayout.tsx         # 空白布局（登录页用）
│   ├── pages/                      # 页面模块
│   │   ├── login/                  # 登录页
│   │   ├── dashboard/              # 首页看板
│   │   ├── content/                # 内容管理
│   │   │   ├── textbook/
│   │   │   ├── knowledge/
│   │   │   ├── question/
│   │   │   ├── chapter/
│   │   │   └── review/
│   │   ├── user/                   # 用户管理
│   │   │   ├── list/
│   │   │   ├── role/
│   │   │   └── permission/
│   │   ├── ai/                     # AI 管理
│   │   │   ├── model/
│   │   │   ├── prompt/
│   │   │   └── quality/
│   │   ├── analytics/              # 数据分析
│   │   │   ├── overview/
│   │   │   ├── retention/
│   │   │   ├── revenue/
│   │   │   └── ai-cost/
│   │   ├── operation/              # 运营管理
│   │   │   ├── activity/
│   │   │   ├── coupon/
│   │   │   ├── banner/
│   │   │   └── experiment/
│   │   ├── finance/                # 财务管理
│   │   │   ├── order/
│   │   │   ├── refund/
│   │   │   └── invoice/
│   │   ├── review/                 # 审核工作台
│   │   │   ├── ai-output/
│   │   │   ├── ugc/
│   │   │   └── appeal/
│   │   ├── customer-service/       # 客服工单
│   │   └── system/                 # 系统配置
│   │       ├── enum/
│   │       ├── config/
│   │       ├── feature-flag/
│   │       ├── audit-log/
│   │       └── schedule/
│   ├── router/                     # 路由配置
│   │   ├── index.ts                # 路由定义
│   │   ├── guards.ts               # 路由守卫
│   │   └── routes.config.tsx       # 菜单与权限映射
│   ├── stores/                     # Zustand 全局状态
│   │   ├── authStore.ts            # 登录状态与用户信息
│   │   ├── permissionStore.ts      # 角色权限数据
│   │   ├── appStore.ts             # 全局 UI 状态（折叠、主题）
│   │   └── tagsStore.ts            # 页签管理
│   ├── types/                      # TypeScript 类型定义
│   │   ├── api.ts                  # API 通用类型
│   │   ├── content.ts              # 内容业务类型
│   │   ├── user.ts                 # 用户业务类型
│   │   └── enum.ts                 # 枚举类型
│   ├── utils/                      # 工具函数
│   │   ├── auth.ts                 # Token 管理
│   │   ├── permission.ts           # 权限判断工具
│   │   ├── format.ts               # 格式化（日期、金额、文件大小）
│   │   ├── download.ts             # 文件下载工具
│   │   └── validator.ts            # 表单校验规则
│   └── styles/                     # 全局样式
│       ├── variables.css           # CSS 变量
│       └── global.css              # 全局样式
├── .env.development                # 开发环境变量
├── .env.staging                    # 预发布环境变量
├── .env.production                 # 生产环境变量
├── vite.config.ts                  # Vite 配置
├── tsconfig.json                   # TypeScript 配置
├── tailwind.config.ts              # Tailwind 配置
├── .eslintrc.cjs                   # ESLint 配置
├── .prettierrc                     # Prettier 配置
└── package.json
```

---

## 3. 认证与权限体系

### 3.1 认证流程

管理后台采用独立的认证体系，与移动端 C 用户认证隔离。

```
┌────────┐     1. 输入账号密码      ┌──────────┐
│  浏览器 │ ──────────────────────→ │  登录页面 │
└────────┘                         └──────────┘
      │                                   │
      │                             2. POST /admin/auth/login
      │                                   │
      │                              ┌─────▼──────┐
      │                              │ API Gateway │
      │                              └─────┬──────┘
      │                                    │
      │                             3. 验证账号密码
      │                                    │
      │                              ┌─────▼──────┐
      │                              │ 认证服务    │
      │                              └─────┬──────┘
      │                                    │
      │                             4. 生成 JWT + RefreshToken
      │                                    │
      │                              ┌─────▼──────┐
      │                              │ 返回 Token  │
      │                              └─────┬──────┘
      │                                    │
      │                    5. 存储 Token (httpOnly Cookie + 内存)
      │                                    │
      │                    6. GET /admin/auth/userInfo (获取角色+权限)
      │                                    │
      │                    7. GET /admin/auth/menus (获取动态菜单)
      │                                    │
      ▼                                    │
┌──────────┐                               │
│ 后台主页 │ ◄───────────────────────────────┘
└──────────┘
```

### 3.2 Token 管理策略

```typescript
// src/utils/auth.ts

const ACCESS_TOKEN_KEY = 'primetop_admin_access_token';
const REFRESH_TOKEN_KEY = 'primetop_admin_refresh_token';
const TOKEN_EXPIRE_BUFFER = 5 * 60 * 1000; // 提前 5 分钟刷新

/**
 * Token 管理器
 * - accessToken 存储在内存中（防止 XSS 读取）
 * - refreshToken 存储在 httpOnly Cookie 中（防止 XSS）
 * - 页面刷新时通过 refreshToken 重新获取 accessToken
 */
class TokenManager {
  private accessToken: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshPromise: Promise<string> | null = null;

  setAccessToken(token: string, expiresIn: number): void {
    this.accessToken = token;
    // 设置自动刷新定时器
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const refreshDelay = (expiresIn * 1000) - TOKEN_EXPIRE_BUFFER;
    this.refreshTimer = setTimeout(() => {
      this.refresh().catch(() => this.logout());
    }, refreshDelay);
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * 刷新 Token（防并发：多个请求同时触发刷新时只发一次）
   */
  async refresh(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = apiClient.post('/admin/auth/refresh', {}, {
      withCredentials: true, // 携带 httpOnly Cookie 中的 refreshToken
    }).then((res) => {
      const { accessToken, expiresIn } = res.data.data;
      this.setAccessToken(accessToken, expiresIn);
      return accessToken;
    }).finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  clear(): void {
    this.accessToken = null;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  logout(): void {
    this.clear();
    window.location.href = '/login';
  }
}

export const tokenManager = new TokenManager();
```

### 3.3 RBAC 权限模型

权限系统采用 **RBAC（Role-Based Access Control）** 模型，支持菜单级、按钮级和数据级三层权限控制。

#### 3.3.1 数据结构

```typescript
// src/types/permission.ts

/** 权限类型 */
type PermissionType = 'menu' | 'button' | 'data';

/** 权限操作 */
type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'export' | 'audit';

/** 权限标识格式：模块:资源:操作 */
// 示例：content:question:create, user:list:view, finance:refund:audit

interface Permission {
  id: number;
  parentId: number | null;
  name: string;           // 权限名称
  code: string;           // 权限标识，如 "content:question:create"
  type: PermissionType;
  action: PermissionAction;
  sort: number;
}

interface Role {
  id: number;
  name: string;           // 角色名称
  code: string;           // 角色编码
  permissions: Permission[];
  dataScope: DataScope;   // 数据权限范围
  status: 'active' | 'disabled';
}

/** 数据权限范围 */
interface DataScope {
  type: 'all' | 'dept' | 'self';  // 全部/部门/仅本人
  customDeptIds?: number[];        // 自定义部门范围
}

interface AdminUser {
  id: number;
  username: string;
  realName: string;
  avatar?: string;
  roles: Role[];
  deptId: number;
  status: 'active' | 'disabled' | 'locked';
  lastLoginAt: string;
  lastLoginIp: string;
}
```

#### 3.3.2 权限检查实现

```typescript
// src/hooks/usePermission.ts

import { useAuthStore } from '@/stores/authStore';
import { useMemo } from 'react';

/**
 * 权限检查 Hook
 */
export function usePermission() {
  const { user } = useAuthStore();

  const permissionCodes = useMemo(() => {
    if (!user?.roles) return new Set<string>();
    const codes = new Set<string>();
    user.roles.forEach(role => {
      role.permissions.forEach(p => codes.add(p.code));
    });
    return codes;
  }, [user]);

  /**
   * 检查是否拥有指定权限
   * @param code 权限标识，如 "content:question:create"
   */
  const hasPermission = (code: string): boolean => {
    // 超级管理员拥有全部权限
    if (user?.roles.some(r => r.code === 'super_admin')) return true;
    return permissionCodes.has(code);
  };

  /**
   * 检查是否拥有任一权限
   */
  const hasAnyPermission = (codes: string[]): boolean => {
    return codes.some(code => hasPermission(code));
  };

  /**
   * 检查是否拥有全部权限
   */
  const hasAllPermissions = (codes: string[]): boolean => {
    return codes.every(code => hasPermission(code));
  };

  /**
   * 检查数据范围
   */
  const hasDataScope = (scope: 'all' | 'dept' | 'self'): boolean => {
    if (user?.roles.some(r => r.code === 'super_admin')) return scope === 'all';
    return user?.roles.some(role => {
      const ds = role.dataScope;
      if (ds.type === 'all') return true;
      if (ds.type === scope) return true;
      return false;
    }) ?? false;
  };

  return { hasPermission, hasAnyPermission, hasAllPermissions, hasDataScope };
}
```

#### 3.3.3 权限组件包裹器

```typescript
// src/components/PermissionWrapper/index.tsx

import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

interface PermissionWrapperProps {
  /** 需要的权限码，支持单个或多个 */
  code: string | string[];
  /** 多个权限的判断逻辑 */
  logic?: 'and' | 'or';
  /** 无权限时的 fallback */
  fallback?: ReactNode;
  children: ReactNode;
}

export function PermissionWrapper({
  code,
  logic = 'and',
  fallback = null,
  children,
}: PermissionWrapperProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermission();

  const codes = Array.isArray(code) ? code : [code];
  const passed = logic === 'and'
    ? hasAllPermissions(codes)
    : hasAnyPermission(codes);

  return passed ? <>{children}</> : <>{fallback}</>;
}

// 使用示例：
// <PermissionWrapper code="content:question:create">
//   <Button type="primary">新建题目</Button>
// </PermissionWrapper>
```

### 3.4 路由守卫

```typescript
// src/router/guards.tsx

import { Navigate, type RouteObject } from 'react-router-dom';
import { tokenManager } from '@/utils/auth';
import { usePermissionStore } from '@/stores/permissionStore';
import type { JSX } from 'react';

/**
 * 需要登录的路由守卫
 */
export function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  const token = tokenManager.getAccessToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

/**
 * 权限路由守卫
 */
export function RequirePermission({
  permissionCode,
  children,
}: {
  permissionCode: string;
  children: JSX.Element;
}): JSX.Element {
  const { hasPermission } = usePermission();
  const { permissionCodes } = usePermissionStore();

  // 超级管理员直接放行
  if (permissionCodes.has('*')) return children;

  if (!hasPermission(permissionCode)) {
    return <Navigate to="/403" replace />;
  }
  return children;
}

/**
 * 路由配置生成
 * 根据后端返回的菜单数据动态生成路由
 */
export function generateRoutes(menus: MenuConfig[]): RouteObject[] {
  const routes: RouteObject[] = [];

  for (const menu of menus) {
    if (menu.type === 'menu' && menu.component) {
      const LazyComponent = lazyRoutes[menu.component];
      if (LazyComponent) {
        routes.push({
          path: menu.path,
          element: (
            <RequireAuth>
              <RequirePermission permissionCode={menu.permissionCode}>
                <LazyComponent />
              </RequirePermission>
            </RequireAuth>
          ),
        });
      }
    }
    if (menu.children?.length) {
      routes.push(...generateRoutes(menu.children));
    }
  }
  return routes;
}
```

### 3.5 动态菜单加载

```typescript
// src/stores/permissionStore.ts

import { create } from 'zustand';
import { getMenuTree, getPermissionCodes } from '@/api/system/permission';

interface MenuConfig {
  id: number;
  parentId: number | null;
  name: string;
  path: string;
  icon?: string;
  component?: string;       // 对应 lazyRoutes 中的 key
  type: 'directory' | 'menu' | 'button';
  permissionCode: string;
  sort: number;
  children?: MenuConfig[];
  // 菜单展示控制
  hidden?: boolean;
  keepAlive?: boolean;       // 页签缓存
  affix?: boolean;           // 固定页签
}

interface PermissionState {
  menus: MenuConfig[];
  permissionCodes: Set<string>;
  loaded: boolean;
  loadMenus: () => Promise<void>;
  reset: () => void;
}

export const usePermissionStore = create<PermissionState>((set) => ({
  menus: [],
  permissionCodes: new Set<string>(),
  loaded: false,

  loadMenus: async () => {
    const [menuRes, permRes] = await Promise.all([
      getMenuTree(),
      getPermissionCodes(),
    ]);
    set({
      menus