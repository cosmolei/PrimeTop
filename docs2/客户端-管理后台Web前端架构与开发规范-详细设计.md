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
      menus: sortMenus(menuRes.data),
      permissionCodes: new Set(permRes.data),
      loaded: true,
    });
  },

  reset: () => {
    set({ menus: [], permissionCodes: new Set(), loaded: false });
  },
}));

/** 菜单按 sort 字段递归排序 */
function sortMenus(menus: MenuConfig[]): MenuConfig[] {
  return menus
    .sort((a, b) => a.sort - b.sort)
    .map(m => ({
      ...m,
      children: m.children?.length ? sortMenus(m.children) : undefined,
    }));
}
```

#### 3.5.1 菜单渲染与页签联动

侧边栏菜单基于 `menus` 渲染；`keepAlive` 菜单对应组件加入页签缓存白名单，`affix` 菜单（如首页看板）不可关闭。

```typescript
// src/layouts/Sider.tsx

import { usePermissionStore } from '@/stores/permissionStore';
import { Menu } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

export function Sider() {
  const { menus } = usePermissionStore();
  const location = useLocation();
  const navigate = useNavigate();

  const items = useMemo(() => convertToMenuItems(menus), [menus]);
  const selectedKey = location.pathname;
  const openKeys = findParentKeys(menus, selectedKey);

  return (
    <Menu
      mode="inline"
      theme="dark"
      items={items}
      selectedKeys={[selectedKey]}
      defaultOpenKeys={openKeys}
      onClick={({ key }) => navigate(key)}
    />
  );
}
```

> **守卫 G1**：菜单数据以服务端返回为唯一来源（SSOT），前端不硬编码任何角色可见菜单；`hidden=true` 的目录仅作为路由容器不在侧边栏渲染，但仍需经 `RequirePermission` 守卫。
> **守卫 G2**：`loaded=false` 时侧边栏渲染骨架屏，禁止闪现完整菜单后回跳（防止权限菜单闪烁泄露模块存在性）。

---

## 4. HTTP 请求层

### 4.1 Axios 实例与拦截器

```typescript
// src/api/client.ts

import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { tokenManager } from '@/utils/auth';

/** 统一响应包装 */
export interface ApiResponse<T> {
  code: number;        // 业务码，0 表示成功
  message: string;
  data: T;
  traceId: string;     // 链路追踪 ID
}

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 30_000,
  headers: { 'X-Client-Channel': 'admin-web' },
});

// ── 请求拦截器：注入 Token ──────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = tokenManager.getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── 响应拦截器：业务码归一 + 401 刷新重试 ─────────────
apiClient.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse<unknown>;
    if (body.code !== 0) {
      // 业务错误统一抛出，由全局错误边界或调用方处理
      return Promise.reject(new BusinessError(body.code, body.message, body.traceId));
    }
    return response;
  },
  async (error: AxiosError) => {
    const { response, config } = error;
    if (response?.status === 401 && config && !(config as any)._retried) {
      (config as any)._retried = true;
      try {
        await tokenManager.refresh();
        return apiClient(config);
      } catch {
        tokenManager.logout();
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  },
);

export class BusinessError extends Error {
  constructor(
    public code: number,
    message: string,
    public traceId: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}
```

> **守卫 G3**：401 刷新重试仅允许一次（`_retried` 标记），防止 refreshToken 失效时形成无限重试环。
> **守卫 G4**：导出/下载类接口超时放宽至 120s（在调用处单独传 `timeout`，不使用全局 30s）。

### 4.2 React Query 服务端状态缓存

```typescript
// src/api/content/question.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

export interface QuestionListParams {
  page: number;
  pageSize: number;
  subject?: string;
  grade?: string;
  keyword?: string;
  status?: 'draft' | 'pending' | 'published' | 'rejected';
}

export function useQuestionList(params: QuestionListParams) {
  return useQuery({
    queryKey: ['questions', params],
    queryFn: async () => {
      const res = await apiClient.get('/admin/questions', { params });
      return res.data.data;
    },
    placeholderData: (prev) => prev,   // 翻页时保持上一页数据，避免闪烁
    staleTime: 30_000,
  });
}

export function useQuestionCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: QuestionCreatePayload) => {
      const res = await apiClient.post('/admin/questions', payload);
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['questions'] });
    },
  });
}
```

---

## 5. 全局状态管理

Zustand 只承载**真正的全局 UI/会话状态**；服务端数据一律走 React Query，禁止双写。

```typescript
// src/stores/authStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AdminUser } from '@/types/permission';

interface AuthState {
  user: AdminUser | null;
  setUser: (user: AdminUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      clear: () => set({ user: null }),
    }),
    {
      name: 'primetop-admin-auth',
      // 仅持久化展示字段；权限码以 permissionStore（服务端拉取）为准
      partialize: (state) => ({ user: state.user }),
    },
  ),
);

// src/stores/appStore.ts —— 折叠态/主题/语言
// src/stores/tagsStore.ts —— 页签页栈（visitedViews + cachedViews，上限 20，超出淘汰最久未访问）
```

---

## 6. WebSocket 实时通知

审核状态变更、工单转派、公告发布等事件通过 WS 推送，避免轮询。

```typescript
// src/hooks/useWebSocket.ts

import { useEffect, useRef, useCallback } from 'react';
import { tokenManager } from '@/utils/auth';
import { notification } from 'antd';

type WsMessage =
  | { type: 'review.task.assigned'; taskId: string; title: string }
  | { type: 'review.status.changed'; taskId: string; status: string }
  | { type: 'announcement'; level: 'info' | 'warning'; content: string }
  | { type: 'ping' };

export function useWebSocket(onMessage?: (msg: WsMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const token = tokenManager.getAccessToken();
    if (!token) return;
    const ws = new WebSocket(
      `${import.meta.env.VITE_WS_BASE_URL}/admin/ws?token=${encodeURIComponent(token)}`,
    );
    wsRef.current = ws;

    ws.onopen = () => { retryRef.current = 0; };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as WsMessage;
      if (msg.type === 'ping') return;
      if (msg.type === 'announcement') {
        notification.open({ message: '平台公告', description: msg.content });
      }
      onMessage?.(msg);
    };
    ws.onclose = () => {
      // 指数退避重连：1s/2s/4s/… 上限 60s
      const delay = Math.min(60_000, 1000 * 2 ** retryRef.current++);
      timerRef.current = setTimeout(connect, delay);
    };
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
```

> **降级 D1**：WS 连接失败不阻断任何功能——通知中心同时提供手动刷新入口，审核工单列表本身走 HTTP 拉取。

---

## 7. 共享业务组件规范

| 组件 | 职责 | 关键约定 |
| --- | --- | --- |
| ProTable | 列表页统一封装 | 内置分页/排序/筛选透传、列设置持久化、导出按钮（权限码 `*:export` 控制） |
| SchemaForm | Schema 驱动表单 | JSON 描述渲染，支持输入/选择/级联/富文本/上传；校验规则走 zod |
| RichEditor | 富文本编辑 | 白名单标签过滤（防 XSS），图片走统一上传接口 |
| PromptEditor | Prompt 模板编辑 | Monaco Editor，支持变量占位符 `{{var}}` 高亮与插入 |
| ChartContainer | 图表容器 | ECharts 封装，内置空态/加载态/失败重试 |
| FileUploader | 文件上传 | 分片直传 + 进度展示；限制类型/大小（图片 5MB、文档 50MB） |
| AuditTrail | 审计轨迹 | 展示操作人/时间/IP/变更 diff（关联服务端审计日志服务） |
| DataDictionarySelect | 字典选择器 | 基于统一枚举服务缓存，30 分钟本地有效 |

ProTable 使用示例：

```typescript
// src/pages/content/question/index.tsx

export default function QuestionListPage() {
  const [params, setParams] = useState<QuestionListParams>({ page: 1, pageSize: 20 });
  const { data, isLoading } = useQuestionList(params);

  return (
    <ProTable
      rowKey="id"
      loading={isLoading}
      dataSource={data?.list ?? []}
      total={data?.total ?? 0}
      params={params}
      onParamsChange={setParams}
      columns={[
        { title: '题号', dataIndex: 'id', width: 100 },
        { title: '题干', dataIndex: 'stem', ellipsis: true },
        { title: '学科', dataIndex: 'subject', width: 90 },
        { title: '状态', dataIndex: 'status', width: 90, render: statusTag },
      ]}
      toolbar={
        <PermissionWrapper code="content:question:create">
          <Button type="primary" onClick={() => navigate('/content/question/create')}>
            新建题目
          </Button>
        </PermissionWrapper>
      }
    />
  );
}
```

---

## 8. 性能优化

| 手段 | 实现 |
| --- | --- |
| 路由级代码分割 | `lazyRoutes` 全部 `React.lazy`，按页面分包 |
| 组件级按需加载 | Monaco Editor、ECharts 独立 chunk，进入对应页面才加载 |
| 表格虚拟滚动 | 行数 > 200 时启用 `react-virtualized` |
| 图片懒加载 | `loading="lazy"` + CDN 缩略图 |
| 请求去重 | React Query 相同 queryKey 自动去重 |
| 构建优化 | Vite manualChunks 拆分 antd/echarts/react 三大 vendor |

```typescript
// vite.config.ts 关键配置

export default defineConfig({
  build: {
    target: 'es2018',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          echarts: ['echarts'],
          editor: ['monaco-editor'],
        },
      },
    },
  },
});
```

---

## 9. 构建与部署

| 环境 | 命令 | 产物 |
| --- | --- | --- |
| 开发 | `pnpm dev` | Vite dev server + 代理至测试网关 |
| 预发 | `pnpm build:staging` | 静态文件上传 OSS + CDN 刷新 |
| 生产 | `pnpm build` | 同上，带 sourcemap 上传 Sentry |

- 环境变量：`.env.development / .env.staging / .env.production` 仅含非敏感配置（API 地址、WS 地址、Sentry DSN），密钥一律不下发前端。
- 版本可见性：登录页右下角展示构建版本号（`import.meta.env.VITE_BUILD_VERSION`），便于问题定位。
- 回滚：CDN 保留最近 10 个版本目录，回滚仅需切换 CDN 回源路径。

---

## 10. 全局错误处理

| 场景 | 处理 |
| --- | --- |
| 路由不存在 | 404 页 + 返回首页入口 |
| 无权限访问 | 403 页 + 展示所需权限码（便于管理员排查） |
| 接口业务错误 | message 提示 + traceId 复制按钮 |
| 未捕获渲染异常 | ErrorBoundary 兜底 + 上报 Sentry |
| 网络断开 | 顶部横幅「网络连接异常，正在重试…」 |

```typescript
// src/components/ErrorBoundary/index.tsx

import { Component, type ReactNode } from 'react';
import { Result, Button } from 'antd';

export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 上报 Sentry（携带当前路由与用户信息）
    window.Sentry?.captureException(error, { contexts: { react: info } });
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="500"
          title="页面出现异常"
          subTitle="已自动上报，请刷新重试或联系平台管理员"
          extra={<Button type="primary" onClick={() => location.reload()}>刷新</Button>}
        />
      );
    }
    return this.props.children;
  }
}
```

---

## 11. 安全规范

| 项 | 规范 |
| --- | --- |
| XSS | React 默认转义；富文本经 DOMPurify 白名单过滤；禁止 `dangerouslySetInnerHTML` 直插接口数据 |
| CSRF | 写操作接口要求 `X-Requested-With` 头；Cookie 全部 `SameSite=Lax` |
| Token | accessToken 仅内存；refreshToken httpOnly Cookie；登录页开启 HttpOnly Session 校验 |
| 越权 | 所有敏感操作前端隐藏按钮仅作体验优化，服务端必须二次校验（前端权限不可作为安全边界） |
| 敏感信息 | 日志、报错信息、URL query 禁止携带 Token/身份证/手机号明文 |
| 依赖安全 | CI 中 `pnpm audit` 阻断 high/critical 漏洞入库 |

---

## 12. 开发规范

- 提交规范：Conventional Commits（`feat: / fix: / refactor: / chore:`）+ Husky pre-commit 运行 ESLint + Prettier。
- 目录规范：新增页面必须同步注册路由配置与权限码，禁止散落的游离页面。
- 命名规范：页面组件 PascalCase；hooks `use` 前缀；API 函数 `use` + 资源名 + 动作。
- 类型规范：接口出入参必须有 TypeScript 类型，禁止 `any` 透传（ESLint `@typescript-eslint/no-explicit-any` 告警）。

---

## 13. 测试策略

| 层级 | 工具 | 覆盖目标 |
| --- | --- | --- |
| 单元测试 | Vitest + Testing Library | 工具函数、Hooks、状态 store |
| 组件测试 | Testing Library | ProTable/SchemaForm 核心交互 |
| E2E | Playwright | 登录 → 权限菜单 → 题目 CRUD 主链路 |

CI 门槛：单元测试覆盖率 ≥ 60%，E2E 主链路用例全绿方可合入 main。

---

## 14. 关联文档

- 权限角色与系统安全配置工作台-详细设计.md（服务端权限/菜单接口契约）
- 服务端统一认证授权与令牌管理体系-详细设计.md（Token 颁发与刷新契约）
- 客户端组件库与设计系统-详细设计.md（设计 Token 一致性）
- 服务端审计日志与操作追溯系统-详细设计.md（AuditTrail 数据源）
- 服务端统一响应封装与分页查询规范-详细设计.md（ApiResponse 包装约定）

---

## 15. 验收场景

1. 无 Token 访问任意后台路由 → 重定向登录页，回跳参数正确。
2. 登录成功后菜单与后端返回一致，无权限菜单不渲染且直输 URL 返回 403。
3. Token 过期前 5 分钟自动刷新，期间并发请求仅触发一次刷新。
4. refreshToken 失效 → 自动登出并回登录页。
5. 超级管理员可见全部菜单；只读访客编辑按钮全部隐藏。
6. 断网时页面提示网络异常横幅，恢复后自动重连 WS。
7. 列表页翻页不闪烁（placeholderData 生效），切换筛选条件 queryKey 隔离。
8. 构建产物 vendor chunk 缓存命中后二次加载首屏 ≤ 3s（内网）。
9. 富文本提交 `<script>alert(1)</script>` 被过滤后入库。
10. 页面抛异常时 ErrorBoundary 兜底并上报，不白屏。
11. 审核任务 WS 推送 3s 内到达，WS 断连期间可手动刷新列表补数。
12. 登出后按浏览器前进键不可回到受保护页面。
---

## 16. 维护记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-06 | 初版：§1 概述至 §3.4 路由守卫。 |
| v1.1 | 2026-09-22 | 补全烂尾文档：原文件 621 行截断于 §3.5 动态菜单加载 `permissionStore.ts` 代码块中段（围栏未闭合，详见 `_rescan_fences_20260921.txt` 记录 ```@L579），§3.5 后半至文末全部缺失。本次补齐：§3.5 收尾（permissionStore 完整实现含 `sortMenus` 递归排序与 reset）与 §3.5.1 菜单渲染与页签联动（Sider.tsx，`keepAlive` 白名单与 `affix` 页签语义）；并续写 §4 HTTP 请求层（Axios 实例与拦截器、React Query 服务端状态缓存）至 §15 验收场景 12 条，覆盖全局状态管理/WS 实时通知/共享业务组件/性能优化/构建部署/全局错误处理/安全规范/开发规范/测试策略/关联文档。核验：CommonMark 围栏 36/36 BALANCED，UTF-8 无 BOM，尾部维护记录完整。 |