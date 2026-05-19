# 分龄 UI 适配与交互设计规范 - 详细设计文档

> 模块版本：v1.0 | 最后更新：2026-05-19
> 原始需求来源：`docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md` §9.1-9.6, §5.1-5.4

---

## 1. 模块概述

### 1.1 功能定位

分龄 UI 适配与交互设计规范是 PrimeTop 全平台 UI 层的核心规范。由于产品覆盖 3-18 岁全学段用户，不同年龄段认知能力、操作习惯、信息处理能力差异巨大，本模块定义**如何根据用户学段动态调整界面风格、信息密度、交互方式、文案表达和反馈机制**，确保各年龄段用户都能获得最佳使用体验。

### 1.2 核心目标

| 目标 | 衡量指标 |
|------|----------|
| 降低低龄用户操作门槛 | 幼儿/小学低年级用户独立完成核心操作率 ≥ 70% |
| 提升高龄用户信息效率 | 高中生完成单次提问到获取解答平均 ≤ 45 秒 |
| 统一品牌感知 | 不同学段视觉系统 NPS ≥ 4.0/5.0 |
| 无障碍合规 | 通过 WCAG 2.1 AA 级关键项检查 |

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| 学习优先 | 界面围绕学习任务展开，减少干扰性内容 |
| 分龄适配 | 不同学段采用不同信息密度、视觉语言和交互复杂度 |
| 轻量高效 | 拍题、提问、错题收录等高频操作应一步触达 |
| 引导理解 | AI 回答采用"提示→思路→步骤→总结→练习"结构 |
| 数据可见 | 学习进度、薄弱点、计划完成情况清晰可见 |
| 家长可控 | 低龄用户提供家长监督和时长管理入口 |

### 1.4 与其他模块的关系

```
                    ┌──────────────────────┐
                    │  分龄UI适配与交互规范  │ ← 本模块
                    │  (DesignToken系统)    │
                    └──────────┬───────────┘
                               │ 提供 Theme / AgeMode / Component 规范
          ┌────────────────────┼────────────────────────┐
          │                    │                        │
          ↓                    ↓                        ↓
   ┌─────────────┐    ┌──────────────┐         ┌─────────────┐
   │  客户端框架   │    │   各业务模块   │         │  运营活动    │
   │  Theme引擎   │    │  按规范组装UI  │         │  成长激励    │
   └─────────────┘    └──────────────┘         └─────────────┘
```

---

## 2. 学段分级体系

### 2.1 AgeMode 定义

系统定义 4 个 `AgeMode`，作为全局 UI 适配的核心维度：

```typescript
// libs/ui-core/src/types/age-mode.ts

export enum AgeMode {
  /** 幼儿启蒙：3-6岁 */
  KINDERGARTEN = 'kindergarten',
  /** 小学：6-12岁 */
  PRIMARY = 'primary',
  /** 初中：12-15岁 */
  JUNIOR = 'junior',
  /** 高中：15-18岁 */
  SENIOR = 'senior',
}

/** 学段→AgeMode 映射 */
export const GRADE_TO_AGE_MODE: Record<string, AgeMode> = {
  // 幼儿
  'k1': AgeMode.KINDERGARTEN,
  'k2': AgeMode.KINDERGARTEN,
  'k3': AgeMode.KINDERGARTEN,
  // 小学
  'g1': AgeMode.PRIMARY,
  'g2': AgeMode.PRIMARY,
  'g3': AgeMode.PRIMARY,
  'g4': AgeMode.PRIMARY,
  'g5': AgeMode.PRIMARY,
  'g6': AgeMode.PRIMARY,
  // 初中
  'g7': AgeMode.JUNIOR,
  'g8': AgeMode.JUNIOR,
  'g9': AgeMode.JUNIOR,
  // 高中
  'g10': AgeMode.SENIOR,
  'g11': AgeMode.SENIOR,
  'g12': AgeMode.SENIOR,
};
```

### 2.2 AgeMode 属性矩阵

```typescript
// libs/ui-core/src/types/age-mode-config.ts

export interface AgeModeConfig {
  /** AgeMode 枚举值 */
  mode: AgeMode;
  /** 显示名称 */
  label: string;
  /** 目标年龄段 */
  ageRange: [number, number];
  /** 主题标识 */
  themeId: ThemeId;
  /** 最大信息密度层级 (1-5) */
  maxInfoDensity: number;
  /** 默认字体缩放 */
  fontScale: number;
  /** 按钮最小触控区域 (dp) */
  minTouchTarget: number;
  /** 是否启用语音优先交互 */
  voiceFirst: boolean;
  /** 是否显示文字标签（否则仅图标） */
  showTextLabel: boolean;
  /** AI回答默认展开模式 */
  answerDisplayMode: 'progressive' | 'full';
  /** 动画速度 (ms 基准) */
  animationBaseline: number;
  /** 激励反馈强度 (1-5) */
  rewardFeedbackLevel: number;
  /** 是否需要家长验证进入 */
  requireParentGuard: boolean;
}

export const AGE_MODE_CONFIGS: Record<AgeMode, AgeModeConfig> = {
  [AgeMode.KINDERGARTEN]: {
    mode: AgeMode.KINDERGARTEN,
    label: '幼儿模式',
    ageRange: [3, 6],
    themeId: 'candy',
    maxInfoDensity: 2,
    fontScale: 1.35,
    minTouchTarget: 56,
    voiceFirst: true,
    showTextLabel: true,
    answerDisplayMode: 'progressive',
    animationBaseline: 600,
    rewardFeedbackLevel: 5,
    requireParentGuard: true,
  },
  [AgeMode.PRIMARY]: {
    mode: AgeMode.PRIMARY,
    label: '小学模式',
    ageRange: [6, 12],
    themeId: 'fresh',
    maxInfoDensity: 3,
    fontScale: 1.15,
    minTouchTarget: 48,
    voiceFirst: false,
    showTextLabel: true,
    answerDisplayMode: 'progressive',
    animationBaseline: 400,
    rewardFeedbackLevel: 4,
    requireParentGuard: false,
  },
  [AgeMode.JUNIOR]: {
    mode: AgeMode.JUNIOR,
    label: '初中模式',
    ageRange: [12, 15],
    themeId: 'standard',
    maxInfoDensity: 4,
    fontScale: 1.0,
    minTouchTarget: 44,
    voiceFirst: false,
    showTextLabel: false,
    answerDisplayMode: 'full',
    animationBaseline: 250,
    rewardFeedbackLevel: 2,
    requireParentGuard: false,
  },
  [AgeMode.SENIOR]: {
    mode: AgeMode.SENIOR,
    label: '高中模式',
    ageRange: [15, 18],
    themeId: 'pro',
    maxInfoDensity: 5,
    fontScale: 1.0,
    minTouchTarget: 44,
    voiceFirst: false,
    showTextLabel: false,
    answerDisplayMode: 'full',
    animationBaseline: 150,
    rewardFeedbackLevel: 1,
    requireParentGuard: false,
  },
};
```

---

## 3. Design Token 系统

### 3.1 主题定义

每个 AgeMode 对应一套完整的 Design Token 主题：

```typescript
// libs/ui-core/src/theme/tokens.ts

export interface DesignTokens {
  /** 主题唯一标识 */
  id: ThemeId;
  /** 对应 AgeMode */
  ageMode: AgeMode;
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radius: RadiusTokens;
  icon: IconTokens;
  animation: AnimationTokens;
  illustration: IllustrationTokens;
}

export type ThemeId = 'candy' | 'fresh' | 'standard' | 'pro';
```

### 3.2 Color Tokens

```typescript
// libs/ui-core/src/theme/color-tokens.ts

export interface ColorTokens {
  // === 品牌色 ===
  primary: string;           // 主色
  primaryLight: string;      // 主色浅色
  primaryDark: string;       // 主色深色
  secondary: string;         // 辅色
  
  // === 语义色 ===
  success: string;           // 成功/正确
  warning: string;           // 警告
  error: string;             // 错误
  info: string;              // 提示
  
  // === 背景与表面 ===
  background: string;        // 页面底色
  surface: string;           // 卡片/容器底色
  surfaceVariant: string;    // 区分层级的变体表面
  overlay: string;           // 遮罩层
  
  // === 文字 ===
  textPrimary: string;       // 主要文字
  textSecondary: string;     // 次要文字
  textTertiary: string;      // 辅助文字
  textOnPrimary: string;     // 在主色上的文字
  textInverse: string;       // 反色文字
  
  // === 功能色 ===
  divider: string;           // 分割线
  disabled: string;          // 禁用态
  ripple: string;            // 水波纹
  
  // === 学科色 ===
  subjectMath: string;
  subjectChinese: string;
  subjectEnglish: string;
  subjectPhysics: string;
  subjectChemistry: string;
  subjectBiology: string;
  subjectHistory: string;
  subjectGeography: string;
  subjectPolitics: string;
}

/** 各主题色板定义 */
export const THEME_COLORS: Record<ThemeId, ColorTokens> = {
  candy: {
    primary: '#FF6B6B',
    primaryLight: '#FFE0E0',
    primaryDark: '#E04545',
    secondary: '#4ECDC4',
    success: '#51CF66',
    warning: '#FFD43B',
    error: '#FF6B6B',
    info: '#74C0FC',
    background: '#FFF9F0',
    surface: '#FFFFFF',
    surfaceVariant: '#FFF0E6',
    overlay: 'rgba(0,0,0,0.35)',
    textPrimary: '#2D2D2D',
    textSecondary: '#6B6B6B',
    textTertiary: '#999999',
    textOnPrimary: '#FFFFFF',
    textInverse: '#FFFFFF',
    divider: '#F0E6DC',
    disabled: '#D4D4D4',
    ripple: 'rgba(255,107,107,0.12)',
    subjectMath: '#FF922B',
    subjectChinese: '#F06595',
    subjectEnglish: '#20C997',
    subjectPhysics: '#748FFC',
    subjectChemistry: '#845EF7',
    subjectBiology: '#51CF66',
    subjectHistory: '#FCC419',
    subjectGeography: '#22B8CF',
    subjectPolitics: '#E64980',
  },
  fresh: {
    primary: '#339AF0',
    primaryLight: '#D0EBFF',
    primaryDark: '#1971C2',
    secondary: '#51CF66',
    success: '#51CF66',
    warning: '#FCC419',
    error: '#FF6B6B',
    info: '#74C0FC',
    background: '#F8F9FA',
    surface: '#FFFFFF',
    surfaceVariant: '#F1F3F5',
    overlay: 'rgba(0,0,0,0.4)',
    textPrimary: '#212529',
    textSecondary: '#495057',
    textTertiary: '#868E96',
    textOnPrimary: '#FFFFFF',
    textInverse: '#FFFFFF',
    divider: '#E9ECEF',
    disabled: '#CED4DA',
    ripple: 'rgba(51,154,240,0.12)',
    subjectMath: '#FF922B',
    subjectChinese: '#E64980',
    subjectEnglish: '#20C997',
    subjectPhysics: '#748FFC',
    subjectChemistry: '#845EF7',
    subjectBiology: '#51CF66',
    subjectHistory: '#F59F00',
    subjectGeography: '#22B8CF',
    subjectPolitics: '#F06595',
  },
  standard: {
    primary: '#4C6EF5',
    primaryLight: '#DBE4FF',
    primaryDark: '#364FC7',
    secondary: '#7950F2',
    success: '#40C057',
    warning: '#FAB005',
    error: '#FA5252',
    info: '#339AF0',
    background: '#FFFFFF',
    surface: '#F8F9FA',
    surfaceVariant: '#F1F3F5',
    overlay: 'rgba(0,0,0,0.45)',
    textPrimary: '#212529',
    textSecondary: '#495057',
    textTertiary: '#868E96',
    textOnPrimary: '#FFFFFF',
    textInverse: '#FFFFFF',
    divider: '#DEE2E6',
    disabled: '#CED4DA',
    ripple: 'rgba(76,110,245,0.10)',
    subjectMath: '#FD7E14',
    subjectChinese: '#E64980',
    subjectEnglish: '#12B886',
    subjectPhysics: '#4C6EF5',
    subjectChemistry: '#7950F2',
    subjectBiology: '#40C057',
    subjectHistory: '#F59F00',
    subjectGeography: '#15AABF',
    subjectPolitics: '#E64980',
  },
  pro: {
    primary: '#3B5BDB',
    primaryLight: '#EDF2FF',
    primaryDark: '#364FC7',
    secondary: '#5C7CFA',
    success: '#40C057',
    warning: '#FAB005',
    error: '#FA5252',
    info: '#339AF0',
    background: '#FFFFFF',
    surface: '#F8F9FA',
    surfaceVariant: '#F1F3F5',
    overlay: 'rgba(0,0,0,0.5)',
    textPrimary: '#1A1A2E',
    textSecondary: '#4A4A6A',
    textTertiary: '#7A7A9A',
    textOnPrimary: '#FFFFFF',
    textInverse: '#FFFFFF',
    divider: '#E5E5E5',
    disabled: '#C5C5C5',
    ripple: 'rgba(59,91,219,0.08)',
    subjectMath: '#FD7E14',
    subjectChinese: '#E64980',
    subjectEnglish: '#12B886',
    subjectPhysics: '#4C6EF5',
    subjectChemistry: '#7950F2',
    subjectBiology: '#40C057',
    subjectHistory: '#F59F00',
    subjectGeography: '#15AABF',
    subjectPolitics: '#E64980',
  },
};
```

### 3.3 Typography Tokens

```typescript
// libs/ui-core/src/theme/typography-tokens.ts

export interface TypographyTokens {
  /** 基准字体族 */
  fontFamily: string;
  /** 标题字号映射 (h1-h6) */
  headingSizes: Record<string, number>;
  /** 正文字号 */
  bodySize: number;
  /** 小字号 */
  captionSize: number;
  /** 行高系数 */
  lineHeightMultiplier: number;
  /** 段落间距 (dp) */
  paragraphSpacing: number;
}

export const THEME_TYPOGRAPHY: Record<ThemeId, TypographyTokens> = {
  candy: {
    fontFamily: 'NotoSansSC-Rounded, PingFangSC-Rounded, sans-serif',
    headingSizes: {
      h1: 28,
      h2: 24,
      h3: 20,
      h4: 18,
      h5: 16,
      h6: 14,
    },
    bodySize: 18,
    captionSize: 14,
    lineHeightMultiplier: 1.7,
    paragraphSpacing: 12,
  },
  fresh: {
    fontFamily: 'NotoSansSC, PingFangSC, sans-serif',
    headingSizes: {
      h1: 24,
      h2: 20,
      h3: 18,
      h4: 16,
      h5: 15,
      h6: 14,
    },
    bodySize: 16,
    captionSize: 13,
    lineHeightMultiplier: 1.6,
    paragraphSpacing: 10,
  },
  standard: {
    fontFamily: 'NotoSansSC, PingFangSC, sans-serif',
    headingSizes: {
      h1: 22,
      h2: 18,
      h3: 16,
      h4: 15,
      h5: 14,
      h6: 13,
    },
    bodySize: 15,
    captionSize: 12,
    lineHeightMultiplier: 1.5,
    paragraphSpacing: 8,
  },
  pro: {
    fontFamily: 'NotoSansSC, PingFangSC, sans-serif',
    headingSizes: {
      h1: 20,
      h2: 17,
      h3: 15,
      h4: 14,
      h5: 13,
      h6: 12,
    },
    bodySize: 14,
    captionSize: 12,
    lineHeightMultiplier: 1.5,
    paragraphSpacing: 6,
  },
};
```

### 3.4 Spacing & Radius Tokens

```typescript
// libs/ui-core/src/theme/layout-tokens.ts

export interface SpacingTokens {
  xs: number;  // 4dp
  sm: number;  // 8dp
  md: number;  // 12dp
  lg: number;  // 16dp
  xl: number;  // 20dp
  xxl: number; // 24dp
}

export interface RadiusTokens {
  none: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

export const THEME_SPACING: Record<ThemeId, SpacingTokens> = {
  candy:   { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 30 },
  fresh:   { xs: 5, sm: 8,  md: 12, lg: 16, xl: 20, xxl: 26 },
  standard:{ xs: 4, sm: 8,  md: 12, lg: 16, xl: 20, xxl: 24 },
  pro:     { xs: 4, sm: 8,  md: 12, lg: 16, xl: 20, xxl: 24 },
};

/** 圆角随学段降低：幼儿大圆角 → 高中小圆角 */
export const THEME_RADIUS: Record<ThemeId, RadiusTokens> = {
  candy:    { none: 0, sm: 12, md: 18, lg: 24, xl: 32, full: 9999 },
  fresh:    { none: 0, sm: 8,  md: 12, lg: 16, xl: 24, full: 9999 },
  standard: { none: 0, sm: 6,  md: 8,  lg: 12, xl: 16, full: 9999 },
  pro:      { none: 0, sm: 4,  md: 6,  lg: 8,  xl: 12, full: 9999 },
};
```

### 3.5 Icon & Illustration Tokens

```typescript
// libs/ui-core/src/theme/asset-tokens.ts

export interface IconTokens {
  /** 标准图标尺寸 */
  sizeSm: number;
  sizeMd: number;
  sizeLg: number;
  /** 图标风格 */
  style: 'filled' | 'outlined' | 'duotone';
  /** 线宽 */
  strokeWidth: number;
}

export interface IllustrationTokens {
  /** 插画风格 */
  style: 'cartoon' | 'flat' | 'minimal' | 'abstract';
  /** 是否在空状态页显示插画 */
  emptyStateEnabled: boolean;
  /** 引导页插画数 */
  onboardingCount: number;
}

export const THEME_ICONS: Record<ThemeId, IconTokens> = {
  candy:   { sizeSm: 24, sizeMd: 32, sizeLg: 48, style: 'filled', strokeWidth: 2.0 },
  fresh:   { sizeSm: 22, sizeMd: 28, sizeLg: 40, style: 'duotone', strokeWidth: 1.8 },
  standard:{ sizeSm: 20, sizeMd: 24, sizeLg: 32, style: 'outlined', strokeWidth: 1.5 },
  pro:     { sizeSm: 18, sizeMd: 22, sizeLg: 28, style: 'outlined', strokeWidth: 1.5 },
};

export const THEME_ILLUSTRATIONS: Record<ThemeId, IllustrationTokens> = {
  candy:   { style: 'cartoon',  emptyStateEnabled: true,  onboardingCount: 6 },
  fresh:   { style: 'flat',     emptyStateEnabled: true,  onboardingCount: 5 },
  standard:{ style: 'minimal',  emptyStateEnabled: true,  onboardingCount: 4 },
  pro:     { style: 'abstract', emptyStateEnabled: false, onboardingCount: 3 },
};
```

---

## 4. 核心 UI 规范

### 4.1 底部导航栏

底部导航是全 APP 的信息架构骨架，需根据 AgeMode 调整：

```typescript
// libs/ui-core/src/components/navigation/bottom-nav.ts

export interface NavItem {
  id: string;
  /** 默认图标资源名 */
  icon: string;
  /** 选中图标资源名 */
  iconActive: string;
  /** 文字标签（仅 showTextLabel=true 时显示） */
  label: string;
  /** 路由路径 */
  route: string;
  /** 角标配置（可选） */
  badge?: { type: 'dot' | 'count'; value?: number };
}

/** 各 AgeMode 的导航项配置 */
export const NAV_CONFIGS: Record<AgeMode, NavItem[]> = {
  [AgeMode.KINDERGARTEN]: [
    { id: 'home',    icon: 'ic_home',    iconActive: 'ic_home_filled',    label: '学习',  route: '/home' },
    { id: 'explore', icon: 'ic_explore', iconActive: 'ic_explore_filled', label: '探索',  route: '/explore' },
    { id: 'me',      icon: 'ic_me',      iconActive: 'ic_me_filled',      label: '我的',  route: '/me' },
  ],
  [AgeMode.PRIMARY]: [
    { id: 'home',     icon: 'ic_home',     iconActive: 'ic_home_filled',     label: '首页',  route: '/home' },
    { id: 'ai',       icon: 'ic_ai',       iconActive: 'ic_ai_filled',       label: '问AI',  route: '/ai' },
    { id: 'camera',   icon: 'ic_camera',   iconActive: 'ic_camera',          label: '拍题',  route: '/camera' },
    { id: 'learn',    icon: 'ic_book',     iconActive: 'ic_book_filled',     label: '同步',  route: '/learn' },
    { id: 'me',       icon: 'ic_me',       iconActive: 'ic_me_filled',       label: '我的',  route: '/me' },
  ],
  [AgeMode.JUNIOR]: [
    { id: 'home',     icon: 'ic_home',     iconActive: 'ic_home_filled',     label: '首页',  route: '/home' },
    { id: 'ai',       icon: 'ic_ai',       iconActive: 'ic_ai_filled',       label: '',      route: '/ai' },
    { id: 'camera',   icon: 'ic_camera',   iconActive: 'ic_camera',          label: '',      route: '/camera' },
    { id: 'mistakes', icon: 'ic_mistake',  iconActive: 'ic_mistake_filled',  label: '',      route: '/mistakes' },
    { id: 'me',       icon: 'ic_me',       iconActive: 'ic_me_filled',       label: '',      route: '/me' },
  ],
  [AgeMode.SENIOR]: [
    { id: 'home',     icon: 'ic_home',     iconActive: 'ic_home_filled',     label: '首页',  route: '/home' },
    { id: 'ai',       icon: 'ic_ai',       iconActive: 'ic_ai_filled',       label: '',      route: '/ai' },
    { id: 'camera',   icon: 'ic_camera',   iconActive: 'ic_camera',          label: '',      route: '/camera' },
    { id: 'mistakes', icon: 'ic_mistake',  iconActive: 'ic_mistake_filled',  label: '',      route: '/mistakes' },
    { id: 'me',       icon: 'ic_me',       iconActive: 'ic_me_filled',       label: '',      route: '/me' },
  ],
};

/**
 * 导航栏视觉参数
 */
export interface NavBarStyle {
  height: number;             // 导航栏高度 dp
  iconSize: number;           // 图标尺寸 dp
  fontSize: number;           // 标签字号 sp
  activeIndicator: 'pill' | 'underline' | 'dot';  // 选中态指示器
  activeColor: string;        // 选中色
  inactiveColor: string;      // 未选中色
}

export const NAV_BAR_STYLES: Record<AgeMode, NavBarStyle> = {
  [AgeMode.KINDERGARTEN]: {
    height: 72, iconSize: 28, fontSize: 14,
    activeIndicator: 'pill',
    activeColor: '#FF6B6B', inactiveColor: '#999999',
  },
  [AgeMode.PRIMARY]: {
    height: 60, iconSize: 24, fontSize: 12,
    activeIndicator: 'pill',
    activeColor: '#339AF0', inactiveColor: '#868E96',
  },
  [AgeMode.JUNIOR]: {
    height: 56, iconSize: 22, fontSize: 0,
    activeIndicator: 'dot',
    activeColor: '#4C6EF5', inactiveColor: '#868E96',
  },
  [AgeMode.SENIOR]: {
    height: 52, iconSize: 22, fontSize: 0,
    activeIndicator: 'underline',
    activeColor: '#3B5BDB', inactiveColor: '#7A7A9A',
  },
};
```

### 4.2 首页工作台布局

```typescript
// features/home/src/types/home-layout.ts

/**
 * 首页卡片组件类型
 * 每种卡片根据 AgeMode 可显示/隐藏或调整展示内容
 */
export enum HomeCardType {
  /** 用户信息头部 */
  USER_HEADER = 'user_header',
  /** 快捷操作区 */
  QUICK_ACTIONS = 'quick_actions',
  /** 今日任务 */
  TODAY_TASKS = 'today_tasks',
  /** 薄弱点提醒 */
  WEAK_POINTS = 'weak_points',
  /** 继续学习 */
  CONTINUE_LEARNING = 'continue_learning',
  /** 学习打卡入口 */
  CHECK_IN = 'check_in',
  /** AI推荐 */
  AI_RECOMMEND = 'ai_recommend',
  /** 学习数据概览 */
  LEARNING_STATS = 'learning_stats',
  /** 运营活动Banner */
  ACTIVITY_BANNER = 'activity_banner',
}

/** 各 AgeMode 首页卡片排列 */
export const HOME_LAYOUTS: Record<AgeMode, HomeCardType[]> = {
  [AgeMode.KINDERGARTEN]: [
    HomeCardType.USER_HEADER,
    HomeCardType.CHECK_IN,
    HomeCardType.QUICK_ACTIONS,
    HomeCardType.CONTINUE_LEARNING,
    HomeCardType.ACTIVITY_BANNER,
  ],
  [AgeMode.PRIMARY]: [
    HomeCardType.USER_HEADER,
    HomeCardType.CHECK_IN,
    HomeCardType.QUICK_ACTIONS,
    HomeCardType.TODAY_TASKS,
    HomeCardType.CONTINUE_LEARNING,
    HomeCardType.AI_RECOMMEND,
    HomeCardType.ACTIVITY_BANNER,
  ],
  [AgeMode.JUNIOR]: [
    HomeCardType.USER_HEADER,
    HomeCardType.LEARNING_STATS,
    HomeCardType.QUICK_ACTIONS,
    HomeCardType.TODAY_TASKS,
    HomeCardType.WEAK_POINTS,
    HomeCardType.CONTINUE_LEARNING,
  ],
  [AgeMode.SENIOR]: [
    HomeCardType.USER_HEADER,
    HomeCardType.LEARNING_STATS,
    HomeCardType.TODAY_TASKS,
    HomeCardType.WEAK_POINTS,
    HomeCardType.QUICK_ACTIONS,
    HomeCardType.CONTINUE_LEARNING,
  ],
};
```

### 4.3 AI 对话页交互规范

#### 4.3.1 对话页面布局

```
┌─────────────────────────────────────────┐
│  ← AI辅导    [学段:初中] [学科:数学▼]     │  ← 标题栏：按AgeMode显示学科选择器
├─────────────────────────────────────────┤
│                                         │
│  📚 AI 助手                             │
│  ┌───────────────────────────────┐      │  ← AI消息气泡
│  │  我来帮你分析这道题。           │      │
│  │                               │      │
│  │  💡 思路提示                   │      │  ← 思路卡片 (progressive模式默认收起)
│  │  这道题考察的是二次函数...      │      │
│  │                               │      │
│  │  📝 详细步骤                   │      │  ← 步骤卡片 (progressive模式需展开)
│  │  Step 1: 设函数为...           │      │
│  │  Step 2: 代入条件...           │      │
│  │  Step 3: 求解...              │      │
│  │                               │      │
│  │  🎯 总结                      │      │
│  │  本题关键在于...               │      │
│  └───────────────────────────────┘      │
│                                         │
│  ┌───────────────────────────────┐      │  ← 快捷操作栏
│  │ 🔄 再讲简单点  📋 同类题       │      │
│  │ 📌 加入错题本  💬 继续追问     │      │
│  └───────────────────────────────┘      │
│                                         │
├─────────────────────────────────────────┤
│  📷 [          输入问题...          ] 🎤 │  ← 输入区：拍照+语音+文字
└─────────────────────────────────────────┘
```

#### 4.3.2 AI 回答分段卡片规范

```typescript
// features/ai-chat/src/types/answer-card.ts

/**
 * AI 回答结构化输出分段类型
 */
export enum AnswerBlockType {
  /** 问题理解复述 */
  UNDERSTANDING = 'understanding',
  /** 思路提示 */
  HINT = 'hint',
  /** 详细步骤 */
  STEPS = 'steps',
  /** 关键公式（数学/物理/化学） */
  FORMULA = 'formula',
  /** 知识点关联 */
  KNOWLEDGE_LINK = 'knowledge_link',
  /** 总结 */
  SUMMARY = 'summary',
  /** 拓展内容 */
  EXTENSION = 'extension',
  /** 警告/易错点 */
  WARNING = 'warning',
  /** 练习题 */
  EXERCISE = 'exercise',
}

export interface AnswerBlock {
  type: AnswerBlockType;
  /** 块内容（支持 Markdown） */
  content: string;
  /** 是否可折叠 */
  collapsible: boolean;
  /** 默认折叠状态 */
  defaultCollapsed: boolean;
  /** 图表附件 */
  attachments?: Array<{
    type: 'image' | 'latex' | 'chart';
    url: string;
    alt: string;
  }>;
}

/**
 * 根据 AgeMode 决定回答展示策略
 */
export function getAnswerDisplayStrategy(
  mode: AgeMode
): Record<AnswerBlockType, { visible: boolean; defaultCollapsed: boolean }> {
  const strategies: Record<AgeMode, Record<AnswerBlockType, { visible: boolean; defaultCollapsed: boolean }>> = {
    [AgeMode.KINDERGARTEN]: {
      [AnswerBlockType.UNDERSTANDING]:  { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.HINT]:           { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.STEPS]:          { visible: true,  defaultCollapsed: true },  // 需点击展开
      [AnswerBlockType.FORMULA]:        { visible: false, defaultCollapsed: true },  // 幼儿不显示公式
      [AnswerBlockType.KNOWLEDGE_LINK]: { visible: false, defaultCollapsed: true },
      [AnswerBlockType.SUMMARY]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.EXTENSION]:      { visible: false, defaultCollapsed: true },
      [AnswerBlockType.WARNING]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.EXERCISE]:       { visible: true,  defaultCollapsed: true },
    },
    [AgeMode.PRIMARY]: {
      [AnswerBlockType.UNDERSTANDING]:  { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.HINT]:           { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.STEPS]:          { visible: true,  defaultCollapsed: true },
      [AnswerBlockType.FORMULA]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.KNOWLEDGE_LINK]: { visible: true,  defaultCollapsed: true },
      [AnswerBlockType.SUMMARY]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.EXTENSION]:      { visible: true,  defaultCollapsed: true },
      [AnswerBlockType.WARNING]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.EXERCISE]:       { visible: true,  defaultCollapsed: false },
    },
    [AgeMode.JUNIOR]: {
      [AnswerBlockType.UNDERSTANDING]:  { visible: true,  defaultCollapsed: true },
      [AnswerBlockType.HINT]:           { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.STEPS]:          { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.FORMULA]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.KNOWLEDGE_LINK]: { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.SUMMARY]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.EXTENSION]:      { visible: true,  defaultCollapsed: true },
      [AnswerBlockType.WARNING]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.EXERCISE]:       { visible: true,  defaultCollapsed: false },
    },
    [AgeMode.SENIOR]: {
      [AnswerBlockType.UNDERSTANDING]:  { visible: false, defaultCollapsed: true },  // 高中不需要复述
      [AnswerBlockType.HINT]:           { visible: true,  defaultCollapsed: true },
      [AnswerBlockType.STEPS]:          { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.FORMULA]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.KNOWLEDGE_LINK]: { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.SUMMARY]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.EXTENSION]:      { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.WARNING]:        { visible: true,  defaultCollapsed: false },
      [AnswerBlockType.EXERCISE]:       { visible: true,  defaultCollapsed: false },
    },
  };
  return strategies[mode];
}
```

#### 4.3.3 快捷操作按钮

```typescript
// features/ai-chat/src/types/quick-actions.ts

export interface QuickAction {
  id: string;
  icon: string;
  label: string;
  /** 触发的 Prompt 模板 ID */
  promptTemplateId: string;
  /** 需要的最低 AgeMode */
  minAgeMode: AgeMode;
}

/**
 * AI 回答后展示的快捷操作
 * 各 AgeMode 显示的操作集不同
 */
export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'simpler',
    icon: 'ic_simpler',
    label: '再讲简单点',
    promptTemplateId: 'simplify_explanation',
    minAgeMode: AgeMode.KINDERGARTEN,
  },
  {
    id: 'similar',
    icon: 'ic_similar',
    label: '生成同类题',
    promptTemplateId: 'generate_similar',
    minAgeMode: AgeMode.PRIMARY,
  },
  {
    id: 'add_mistake',
    icon: 'ic_add_mistake',
    label: '加入错题本',
    promptTemplateId: '',  // 客户端本地操作，不触发 AI
    minAgeMode: AgeMode.PRIMARY,
  },
  {
    id: 'continue',
    icon: 'ic_continue',
    label: '继续追问',
    promptTemplateId: '',  // 打开输入框
    minAgeMode: AgeMode.PRIMARY,
  },
  {
    id: 'another_way',
    icon: 'ic_another_way',
    label: '换一种讲法',
    promptTemplateId: 'alternative_explanation',
    minAgeMode: AgeMode.PRIMARY,
  },
  {
    id: 'detail',
    icon: 'ic_detail',
    label: '详细推导',
    promptTemplateId: 'detailed_derivation',
    minAgeMode: AgeMode.JUNIOR,
  },
  {
    id: 'knowledge_map',
    icon: 'ic_knowledge_map',
    label: '知识点图谱',
    promptTemplateId: 'knowledge_graph_view',
    minAgeMode: AgeMode.JUNIOR,
  },
  {
    id: 'exam_focus',
    icon: 'ic_exam_focus',
    label: '考点分析',
    promptTemplateId: 'exam_point_analysis',
    minAgeMode: AgeMode.JUNIOR,
  },
];

/** 获取当前 AgeMode 可用的快捷操作 */
export function getAvailableQuickActions(mode: AgeMode): QuickAction[] {
  const order: AgeMode[] = [AgeMode.KINDERGARTEN, AgeMode.PRIMARY, AgeMode.JUNIOR, AgeMode.SENIOR];
  const idx = order.indexOf(mode);
  return QUICK_ACTIONS.filter(a => order.indexOf(a.minAgeMode) <= idx);
}
```

### 4.4 拍题答疑页交互规范

#### 4.4.1 拍照流程状态机

```
    ┌──────────┐
    │  IDLE    │ ← 初始态，展示拍照按钮
    └────┬─────┘
         │ 点击拍照/选择图片
         ↓
    ┌──────────┐
    │ CAPTURING│ ← 相机取景/图片选择中
    └────┬─────┘
         │ 获得图片
         ↓
    ┌──────────┐
    │ CROPPING │ ← 裁剪/旋转/区域选择
    └────┬─────┘
         │ 确认裁剪
         ↓
    ┌──────────┐
    │ RECOGNIZING│ ← OCR 识别中，展示加载动画
    └────┬─────┘
         │ 识别完成
         ↓
    ┌──────────┐
    │ REVIEWING│ ← 预览识别结果，允许修正
    └────┬─────┘
    │          │
    │ 确认     │ 重新拍照
    ↓          ↓
┌──────────┐  → IDLE
│ RESOLVING│ ← AI 解题中
└────┬─────┘
     │ 解析完成
     ↓
┌──────────┐
│ RESULT   │ ← 展示解析结果
└──────────┘
```

#### 4.4.2 分龄拍照体验差异

```typescript
// features/camera/src/types/photo-experience.ts

export interface PhotoExperienceConfig {
  /** 拍照后是否自动裁剪 */
  autoCrop: boolean;
  /** 是否展示裁剪引导线 */
  showCropGuide: boolean;
  /** 多题识别时是否自动选择第一题 */
  autoSelectFirst: boolean;
  /** 解析等待时展示内容 */
  waitingContent: 'animation' | 'tip' | 'minigame';
  /** 结果默认展示模式 */
  resultDefaultMode: 'hint_first' | 'steps_first' | 'answer_first';
}

export const PHOTO_EXPERIENCE: Record<AgeMode, PhotoExperienceConfig> = {
  [AgeMode.KINDERGARTEN]: {
    autoCrop: true,
    showCropGuide: true,
    autoSelectFirst: true,
    waitingContent: 'animation',
    resultDefaultMode: 'hint_first',
  },
  [AgeMode.PRIMARY]: {
    autoCrop: true,
    showCropGuide: true,
    autoSelectFirst: false,
    waitingContent: 'tip',
    resultDefaultMode: 'hint_first',
  },
  [AgeMode.JUNIOR]: {
    autoCrop: false,
    showCropGuide: false,
    autoSelectFirst: false,
    waitingContent: 'tip',
    resultDefaultMode: 'steps_first',
  },
  [AgeMode.SENIOR]: {
    autoCrop: false,
    showCropGuide: false,
    autoSelectFirst: false,
    waitingContent: 'tip',
    resultDefaultMode: 'steps_first',
  },
};
```

---

## 5. 分龄组件库

### 5.1 按钮 Button

```typescript
// libs/ui-core/src/components/button/types.ts

export enum ButtonVariant {
  PRIMARY = 'primary',
  SECONDARY = 'secondary',
  OUTLINED = 'outlined',
  TEXT = 'text',
  DANGER = 'danger',
}

export interface ButtonConfig {
  /** 高度 dp */
  height: number;
  /** 水平内边距 dp */
  paddingHorizontal: number;
  /** 圆角 dp */
  borderRadius: number;
  /** 文字大小 sp */
  fontSize: number;
  /** 图标大小 dp */
  iconSize: number;
  /** 点击反馈 */
  feedback: 'ripple' | 'scale' | 'bounce';
  /** 加载指示器 */
  loaderStyle: 'spinner' | 'dots' | 'bar';
}

export const BUTTON_CONFIGS: Record<AgeMode, ButtonConfig> = {
  [AgeMode.KINDERGARTEN]: {
    height: 52, paddingHorizontal: 28, borderRadius: 26,
    fontSize: 18, iconSize: 24, feedback: 'bounce', loaderStyle: 'dots',
  },
  [AgeMode.PRIMARY]: {
    height: 46, paddingHorizontal: 24, borderRadius: 23,
    fontSize: 16, iconSize: 22, feedback: 'scale', loaderStyle: 'dots',
  },
  [AgeMode.JUNIOR]: {
    height: 42, paddingHorizontal: 20, borderRadius: 21,
    fontSize: 15, iconSize: 20, feedback: 'ripple', loaderStyle: 'spinner',
  },
  [AgeMode.SENIOR]: {
    height: 40, paddingHorizontal: 18, borderRadius: 20,
    fontSize: 14, iconSize: 18, feedback: 'ripple', loaderStyle: 'spinner',
  },
};
```

### 5.2 卡片 Card

```typescript
// libs/ui-core/src/components/card/types.ts

export interface CardConfig {
  /** 内边距 dp */
  padding: number;
  /** 圆角 dp */
  borderRadius: number;
  /** 阴影 elevation (0-5) */
  elevation: number;
  /** 间距 dp */
  gap: number;
  /** 是否有呼吸边框动画 */
  breathingBorder: boolean;
}

export const CARD_CONFIGS: Record<AgeMode, CardConfig> = {
  [AgeMode.KINDERGARTEN]: {
    padding: 20, borderRadius: 20, elevation: 2, gap: 16, breathingBorder: true,
  },
  [AgeMode.PRIMARY]: {
    padding: 16, borderRadius: 16, elevation: 1, gap: 12, breathingBorder: false,
  },
  [AgeMode.JUNIOR]: {
    padding: 14, borderRadius: 12, elevation: 1, gap: 10, breathingBorder: false,
  },
  [AgeMode.SENIOR]: {
    padding: 12, borderRadius: 8, elevation: 0, gap: 8, breathingBorder: false,
  },
};
```

### 5.3 输入框 Input

```typescript
// libs/ui-core/src/components/input/types.ts

export interface InputConfig {
  /** 高度 dp */
  height: number;
  /** 水平内边距 dp */
  paddingHorizontal: number;
  /** 圆角 dp */
  borderRadius: number;
  /** 字号 sp */
  fontSize: number;
  /** 提示文字样式 */
  placeholderStyle: 'inside' | 'label_float' | 'top_label';
  /** 清除按钮 */
  clearButton: boolean;
  /** 最大行数 */
  maxLines: number;
}

export const INPUT_CONFIGS: Record<AgeMode, InputConfig> = {
  [AgeMode.KINDERGARTEN]: {
    height: 52, paddingHorizontal: 18, borderRadius: 26,
    fontSize: 18, placeholderStyle: 'inside', clearButton: true, maxLines: 1,
  },
  [AgeMode.PRIMARY]: {
    height: 46, paddingHorizontal: 14, borderRadius: 12,
    fontSize: 16, placeholderStyle: 'label_float', clearButton: true, maxLines: 2,
  },
  [AgeMode.JUNIOR]: {
    height: 42, paddingHorizontal: 12, borderRadius: 8,
    fontSize: 15, placeholderStyle: 'label_float', clearButton: true, maxLines: 4,
  },
  [AgeMode.SENIOR]: {
    height: 40, paddingHorizontal: 12, borderRadius: 6,
    fontSize: 14, placeholderStyle: 'top_label', clearButton: true, maxLines: 6,
  },
};
```

### 5.4 对话气泡 MessageBubble

```typescript
// libs/ui-core/src/components/message-bubble/types.ts

export interface MessageBubbleConfig {
  /** 最大宽度百分比 */
  maxWidthPercent: number;
  /** 圆角 (左上, 右上, 右下, 左下) */
  radiusUser: [number, number, number, number];
  radiusAI: [number, number, number, number];
  /** 内边距 dp */
  padding: number;
  /** 字号 sp */
  fontSize: number;
  /** 行高系数 */
  lineHeight: number;
  /** AI 气泡背景色 token */
  aiBubbleBgToken: string;
  /** 用户气泡背景色 token */
  userBubbleBgToken: string;
  /** 头像尺寸 dp */
  avatarSize: number;
  /** 是否显示头像 */
  showAvatar: boolean;
}

export const BUBBLE_CONFIGS: Record<AgeMode, MessageBubbleConfig> = {
  [AgeMode.KINDERGARTEN]: {
    maxWidthPercent: 0.82,
    radiusUser: [18, 18, 4, 18],
    radiusAI: [18, 18, 18, 4],
    padding: 16,
    fontSize: 18,
    lineHeight: 1.7,
    aiBubbleBgToken: 'surface',
    userBubbleBgToken: 'primary',
    avatarSize: 40,
    showAvatar: true,
  },
  [AgeMode.PRIMARY]: {
    maxWidthPercent: 0.80,
    radiusUser: [16, 16, 4, 16],
    radiusAI: [16, 16, 16, 4],
    padding: 14,
    fontSize: 16,
    lineHeight: 1.6,
    aiBubbleBgToken: 'surface',
    userBubbleBgToken: 'primary',
    avatarSize: 36,
    showAvatar: true,
  },
  [AgeMode.JUNIOR]: {
    maxWidthPercent: 0.78,
    radiusUser: [12, 12, 2, 12],
    radiusAI: [12, 12, 12, 2],
    padding: 12,
    fontSize: 15,
    lineHeight: 1.55,
    aiBubbleBgToken: 'surface',
    userBubbleBgToken: 'primary',
    avatarSize: 32,
    showAvatar: true,
  },
  [AgeMode.SENIOR]: {
    maxWidthPercent: 0.75,
    radiusUser: [8, 8, 2, 8],
    radiusAI: [8, 8, 8, 2],
    padding: 12,
    fontSize: 14,
    lineHeight: 1.5,
    aiBubbleBgToken: 'surface',
    userBubbleBgToken: 'primary',
    avatarSize: 28,
    showAvatar: false,
  },
};
```

---

## 6. 文案与表达适配

### 6.1 文案分级策略

```typescript
// libs/ui-core/src/i18n/age-copy.ts

/**
 * 同一语义在不同 AgeMode 下的表达方式
 * 开发通过 ageCopy() 函数获取适龄文案
 */
export const AGE_COPY: Record<string, Record<AgeMode, string>> = {
  // === 通用交互文案 ===
  'common.loading': {
    [AgeMode.KINDERGARTEN]: '小助手正在努力想...',
    [AgeMode.PRIMARY]:      'AI 正在思考...',
    [AgeMode.JUNIOR]:       '思考中...',
    [AgeMode.SENIOR]:       '分析中...',
  },
  'common.error': {
    [AgeMode.KINDERGARTEN]: '哎呀，出了点小问题，再试一次吧！',
    [AgeMode.PRIMARY]:      '出了点问题，请稍后重试',
    [AgeMode.JUNIOR]:       '请求失败，请重试',
    [AgeMode.SENIOR]:       '请求失败 (错误码: {code})',
  },
  'common.empty': {
    [AgeMode.KINDERGARTEN]: '这里还空空的，一起来学习吧！',
    [AgeMode.PRIMARY]:      '还没有内容哦，快去学习吧',
    [AgeMode.JUNIOR]:       '暂无内容',
    [AgeMode.SENIOR]:       '暂无数据',
  },
  'common.confirm_delete': {
    [AgeMode.KINDERGARTEN]: '真的要丢掉吗？🤔',
    [AgeMode.PRIMARY]:      '确定要删除吗？',
    [AgeMode.JUNIOR]:       '确认删除？',
    [AgeMode.SENIOR]:       '删除',
  },
  
  // === AI 辅导相关 ===
  'ai.hint': {
    [AgeMode.KINDERGARTEN]: '💡 小提示',
    [AgeMode.PRIMARY]:      '💡 思路提示',
    [AgeMode.JUNIOR]:       '思路分析',
    [AgeMode.SENIOR]:       '解题思路',
  },
  'ai.step': {
    [AgeMode.KINDERGARTEN]: '👉 第{num}步',
    [AgeMode.PRIMARY]:      '第{num}步',
    [AgeMode.JUNIOR]:       'Step {num}',
    [AgeMode.SENIOR]:       '{num}.',
  },
  'ai.summary': {
    [AgeMode.KINDERGARTEN]: '🌟 你学会了吗？',
    [AgeMode.PRIMARY]:      '📝 总结一下',
    [AgeMode.JUNIOR]:       '总结',
    [AgeMode.SENIOR]:       '结论',
  },
  'ai.correct': {
    [AgeMode.KINDERGARTEN]: '🎉 太棒了！你答对了！',
    [AgeMode.PRIMARY]:      '👍 回答正确！',
    [AgeMode.JUNIOR]:       '✓ 正确',
    [AgeMode.SENIOR]:       '正确',
  },
  'ai.wrong': {
    [AgeMode.KINDERGARTEN]: '没关系，我们再想想看！',
    [AgeMode.PRIMARY]:      '不太对哦，看看正确解法吧',
    [AgeMode.JUNIOR]:       '答案有误，参考以下解析',
    [AgeMode.SENIOR]:       '错误，参考解析',
  },
  
  // === 学科相关 ===
  'subject.math': {
    [AgeMode.KINDERGARTEN]: '🔢 数学',
    [AgeMode.PRIMARY]:      '📐 数学',
    [AgeMode.JUNIOR]:       '数学',
    [AgeMode.SENIOR]:       '数学',
  },
  'subject.chinese': {
    [AgeMode.KINDERGARTEN]: '📖 语文',
    [AgeMode.PRIMARY]:      '📝 语文',
    [AgeMode.JUNIOR]:       '语文',
    [AgeMode.SENIOR]:       '语文',
  },
  'subject.english': {
    [AgeMode.KINDERGARTEN]: '🔤 英语',
    [AgeMode.PRIMARY]:      '🅰️ 英语',
    [AgeMode.JUNIOR]:       '英语',
    [AgeMode.SENIOR]:       '英语',
  },

  // === 错题本 ===
  'mistake.added': {
    [AgeMode.KINDERGARTEN]: '已经帮你收好啦！📌',
    [AgeMode.PRIMARY]:      '已加入错题本 📌',
    [AgeMode.JUNIOR]:       '已收录至错题本',
    [AgeMode.SENIOR]:       '已添加到错题本',
  },
  'mistake.review': {
    [AgeMode.KINDERGARTEN]: '来复习一下以前的错题吧！',
    [AgeMode.PRIMARY]:      '错题复习时间到！',
    [AgeMode.JUNIOR]:       '今日错题复习',
    [AgeMode.SENIOR]:       '错题复习',
  },

  // === 学习计划 ===
  'plan.today': {
    [AgeMode.KINDERGARTEN]: '今天要学什么？',
    [AgeMode.PRIMARY]:      '今日学习任务',
    [AgeMode.JUNIOR]:       '今日任务',
    [AgeMode.SENIOR]:       '日程',
  },
  'plan.complete': {
    [AgeMode.KINDERGARTEN]: '🎉 全部完成啦！你是最棒的！',
    [AgeMode.PRIMARY]:      '🎊 今日任务全部完成！',
    [AgeMode.JUNIOR]:       '今日任务已完成',
    [AgeMode.SENIOR]:       '已完成',
  },
};

/**
 * 获取适龄文案
 * @param key 文案 key
 * @param mode 当前 AgeMode
 * @param params 模板参数（可选）
 */
export function ageCopy(key: string, mode: AgeMode, params?: Record<string, string|number>): string {
  const entry = AGE_COPY[key];
  if (!entry) return key;
  
  let text = entry[mode] ?? entry[AgeMode.SENIOR] ?? key;
  
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v));
    });
  }
  
  return text;
}
```

### 6.2 AI 输出 Prompt 引导的适龄化指令

AI 回答的适龄化由后端 Prompt 模板控制，以下是对各 AgeMode 的 Prompt 附加指令：

```
AgeMode.KINDERGARTEN:
"""
你必须使用最简单的语言回答，就像在和5岁的小朋友说话。
- 用生活中常见的事物做比喻
- 每段不超过2句话
- 不使用任何数学公式或专业术语
- 多用emoji让回答更生动
- 遇到数字用中文数字（一、二、三）
- 结尾一定要鼓励孩子
"""

AgeMode.PRIMARY:
"""
你正在和小学{grade}年级学生对话，请用他们能理解的方式回答。
- 语言简明，使用生活化例子
- 避免跳步，每一步都要讲清楚
- 适度使用emoji
- 可以使用简单的数学公式，但必须配合文字说明
- 答案不要直接给出，先引导思路
"""

AgeMode.JUNIOR:
"""
回答对象是初中{grade}年级学生。
- 可以使用学科标准术语
- 解题时先分析条件，再分步推导，最后总结方法
- 数学公式使用 LaTeX 格式
- 需要标注易错点和常见误区
"""

AgeMode.SENIOR:
"""
回答对象是高中{grade}年级学生。
- 默认使用学科专业语言
- 强调模型、公式、关键步骤
- 数学公式使用 LaTeX 格式
- 需要关联考点和高考出题方式
- 提供方法总结和同类题策略
- 信息密度高，结构清晰
"""
```

---

## 7. 动画与反馈规范

### 7.1 动画时长基准

```typescript
// libs/ui-core/src/animation/timing.ts

export interface AnimationTiming {
  /** 基础过渡时长 (ms) */
  durationBase: number;
  /** 页面切换时长 (ms) */
  pageTransition: number;
  /** 元素入场时长 (ms) */
  enterDuration: number;
  /** 元素退场时长 (ms) */
  exitDuration: number;
  /** 缓动曲线 */
  easingStandard: string;
  easingDecelerate: string;
  easingAccelerate: string;
}

export const ANIMATION_TIMING: Record<AgeMode, AnimationTiming> = {
  [AgeMode.KINDERGARTEN]: {
    durationBase: 600,
    pageTransition: 500,
    enterDuration: 450,
    exitDuration: 350,
    easingStandard: 'cubic-bezier(0.34, 1.56, 0.64, 1)',    // overshoot
    easingDecelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
    easingAccelerate: 'cubic-bezier(0.4, 0.0, 1, 1)',
  },
  [AgeMode.PRIMARY]: {
    durationBase: 400,
    pageTransition: 400,
    enterDuration: 350,
    exitDuration: 280,
    easingStandard: 'cubic-bezier(0.25, 0.1, 0.25, 1)',     // standard
    easingDecelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
    easingAccelerate: 'cubic-bezier(0.4, 0.0, 1, 1)',
  },
  [AgeMode.JUNIOR]: {
    durationBase: 250,
    pageTransition: 300,
    enterDuration: 250,
    exitDuration: 200,
    easingStandard: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    easingDecelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
    easingAccelerate: 'cubic-bezier(0.4, 0.0, 1, 1)',
  },
  [AgeMode.SENIOR]: {
    durationBase: 150,
    pageTransition: 250,
    enterDuration: 180,
    exitDuration: 120,
    easingStandard: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
    easingDecelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1)',
    easingAccelerate: 'cubic-bezier(0.4, 0.0, 1, 1)',
  },
};
```

### 7.2 奖励反馈动画

```typescript
// libs/ui-core/src/animation/reward-feedback.ts

export enum RewardFeedbackType {
  /** 答对题目 */
  CORRECT_ANSWER = 'correct_answer',
  /** 完成每日任务 */
  DAILY_TASK_COMPLETE = 'daily_task_complete',
  /** 连续打卡 */
  STREAK_CHECKIN = 'streak_checkin',
  /** 升级 */
  LEVEL_UP = 'level_up',
  /** 获得徽章 */
  BADGE_EARNED = 'badge_earned',
  /** 完成章节学习 */
  CHAPTER_COMPLETE = 'chapter_complete',
}

export interface RewardFeedbackConfig {
  /** 动画类型 */
  animationType: 'confetti' | 'starburst' | 'bounce' | 'glow' | 'badge_reveal' | 'none';
  /** 持续时长 (ms) */
  duration: number;
  /** 音效 */
  soundEffect: string;
  /** 触觉反馈 */
  haptic: 'none' | 'light' | 'medium' | 'heavy';
}

export const REWARD_FEEDBACK: Record<RewardFeedbackType, Record<AgeMode, RewardFeedbackConfig>> = {
  [RewardFeedbackType.CORRECT_ANSWER]: {
    [AgeMode.KINDERGARTEN]: { animationType: 'starburst', duration: 1500, soundEffect: 'correct_cheer', haptic: 'medium' },
    [AgeMode.PRIMARY]:      { animationType: 'starburst', duration: 1000, soundEffect: 'correct_ding', haptic: 'light' },
    [AgeMode.JUNIOR]:       { animationType: 'glow',      duration: 500,  soundEffect: 'correct_ding', haptic: 'light' },
    [AgeMode.SENIOR]:       { animationType: 'none',      duration: 0,    soundEffect: '',             haptic: 'light' },
  },
  [RewardFeedbackType.DAILY_TASK_COMPLETE]: {
    [AgeMode.KINDERGARTEN]: { animationType: 'confetti', duration: 2000, soundEffect: 'celebration', haptic: 'heavy' },
    [AgeMode.PRIMARY]:      { animationType: 'confetti', duration: 1500, soundEffect: 'celebration', haptic: 'medium' },
    [AgeMode.JUNIOR]:       { animationType: 'glow',     duration: 800,  soundEffect: 'success',     haptic: 'light' },
    [AgeMode.SENIOR]:       { animationType: 'glow',     duration: 400,  soundEffect: '',            haptic: 'none' },
  },
  [RewardFeedbackType.STREAK_CHECKIN]: {
    [AgeMode.KINDERGARTEN]: { animationType: 'bounce', duration: 1800, soundEffect: 'streak', haptic: 'medium' },
    [AgeMode.PRIMARY]:      { animationType: 'bounce', duration: 1200, soundEffect: 'streak', haptic: 'light' },
    [AgeMode.JUNIOR]:       { animationType: 'glow',   duration: 600,  soundEffect: 'streak', haptic: 'light' },
    [AgeMode.SENIOR]:       { animationType: 'none',   duration: 0,    soundEffect: '',        haptic: 'none' },
  },
  [RewardFeedbackType.LEVEL_UP]: {
    [AgeMode.KINDERGARTEN]: { animationType: 'confetti',      duration: 3000, soundEffect: 'level_up_fanfare', haptic: 'heavy' },
    [AgeMode.PRIMARY]:      { animationType: 'confetti',      duration: 2000, soundEffect: 'level_up',         haptic: 'medium' },
    [AgeMode.JUNIOR]:       { animationType: 'badge_reveal',  duration: 1200, soundEffect: 'level_up',         haptic: 'light' },
    [AgeMode.SENIOR]:       { animationType: 'badge_reveal',  duration: 600,  soundEffect: '',                 haptic: 'none' },
  },
  [RewardFeedbackType.BADGE_EARNED]: {
    [AgeMode.KINDERGARTEN]: { animationType: 'badge_reveal', duration: 2500, soundEffect: 'badge', haptic: 'heavy' },
    [AgeMode.PRIMARY]:      { animationType: 'badge_reveal', duration: 1800, soundEffect: 'badge', haptic: 'medium' },
    [AgeMode.JUNIOR]:       { animationType: 'badge_reveal', duration: 1000, soundEffect: 'badge', haptic: 'light' },
    [AgeMode.SENIOR]:       { animationType: 'none',         duration: 0,    soundEffect: '',       haptic: 'none' },
  },
  [RewardFeedbackType.CHAPTER_COMPLETE]: {
    [AgeMode.KINDERGARTEN]: { animationType: 'confetti', duration: 2500, soundEffect: 'chapter_done', haptic: 'heavy' },
    [AgeMode.PRIMARY]:      { animationType: 'confetti', duration: 1500, soundEffect: 'chapter_done', haptic: 'medium' },
    [AgeMode.JUNIOR]:       { animationType: 'glow',     duration: 800,  soundEffect: 'chapter_done', haptic: 'light' },
    [AgeMode.SENIOR]:       { animationType: 'glow',     duration: 400,  soundEffect: '',              haptic: 'none' },
  },
};
```

---

## 8. 主题切换引擎

### 8.1 运行时主题管理

```typescript
// libs/ui-core/src/theme/theme-provider.ts

import { createContext, useContext } from 'react'; // 或对应框架的状态管理

export interface ThemeContextValue {
  /** 当前 AgeMode */
  ageMode: AgeMode;
  /** 当前主题 ID */
  themeId: ThemeId;
  /** 完整 Design Tokens */
  tokens: DesignTokens;
  /** AgeMode 配置 */
  ageConfig: AgeModeConfig;
  /** 切换 AgeMode */
  setAgeMode: (mode: AgeMode) => void;
}

/**
 * ThemeProvider 初始化流程
 */
export class ThemeManager {
  private currentMode: AgeMode;
  private tokens: DesignTokens;
  private listeners: Set<() => void> = new Set();

  constructor(initialMode: AgeMode) {
    this.currentMode = initialMode;
    this.tokens = this.buildTokens(initialMode);
  }

  /** 根据 AgeMode 组装完整 Design Tokens */
  private buildTokens(mode: AgeMode): DesignTokens {
    const config = AGE_MODE_CONFIGS[mode];
    const themeId = config.themeId;
    return {
      id: themeId,
      ageMode: mode,
      colors: THEME_COLORS[themeId],
      typography: THEME_TYPOGRAPHY[themeId],
      spacing: THEME_SPACING[themeId],
      radius: THEME_RADIUS[themeId],
      icon: THEME_ICONS[themeId],
      animation: {
        ...(ANIMATION_TIMING[mode]),
      },
      illustration: THEME_ILLUSTRATIONS[themeId],
    };
  }

  /** 切换 AgeMode（通常在用户修改年级时触发） */
  setAgeMode(newMode: AgeMode): void {
    if (this.currentMode === newMode) return;
    this.currentMode = newMode;
    this.tokens = this.buildTokens(newMode);
    // 通知所有监听者
    this.listeners.forEach(fn => fn());
  }

  /** 订阅主题变化 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getAgeMode(): AgeMode { return this.currentMode; }
  getTokens(): DesignTokens { return this.tokens; }
  getAgeConfig(): AgeModeConfig { return AGE_MODE_CONFIGS[this.currentMode]; }
}
```

### 8.2 CSS Variable 注入（Web/小程序端）

```css
/* libs/ui-core/src/theme/css-variables.css */
/* 由 ThemeManager 运行时动态注入到 :root */

:root {
  /* === Colors === */
  --color-primary: var(--pt-color-primary);
  --color-primary-light: var(--pt-color-primary-light);
  --color-primary-dark: var(--pt-color-primary-dark);
  --color-secondary: var(--pt-color-secondary);
  --color-success: var(--pt-color-success);
  --color-warning: var(--pt-color-warning);
  --color-error: var(--pt-color-error);
  --color-info: var(--pt-color-info);
  --color-bg: var(--pt-color-background);
  --color-surface: var(--pt-color-surface);
  --color-surface-variant: var(--pt-color-surface-variant);
  --color-text-primary: var(--pt-color-text-primary);
  --color-text-secondary: var(--pt-color-text-secondary);
  --color-text-tertiary: var(--pt-color-text-tertiary);
  --color-divider: var(--pt-color-divider);
  
  /* === Spacing === */
  --spacing-xs: var(--pt-spacing-xs);
  --spacing-sm: var(--pt-spacing-sm);
  --spacing-md: var(--pt-spacing-md);
  --spacing-lg: var(--pt-spacing-lg);
  --spacing-xl: var(--pt-spacing-xl);
  --spacing-xxl: var(--pt-spacing-xxl);
  
  /* === Radius === */
  --radius-sm: var(--pt-radius-sm);
  --radius-md: var(--pt-radius-md);
  --radius-lg: var(--pt-radius-lg);
  --radius-xl: var(--pt-radius-xl);
  
  /* === Typography === */
  --font-family: var(--pt-font-family);
  --font-size-body: var(--pt-body-size);
  --font-size-caption: var(--pt-caption-size);
  --line-height: var(--pt-line-height);
}

/* Theme: candy (幼儿) */
[data-theme="candy"] {
  --pt-color-primary: #FF6B6B;
  --pt-spacing-xs: 6px;
  --pt-spacing-sm: 10px;
  --pt-spacing-md: 14px;
  --pt-spacing-lg: 18px;
  --pt-spacing-xl: 24px;
  --pt-spacing-xxl: 30px;
  --pt-radius-sm: 12px;
  --pt-radius-md: 18px;
  --pt-radius-lg: 24px;
  --pt-radius-xl: 32px;
  --pt-font-family: 'NotoSansSC-Rounded', 'PingFangSC-Rounded', sans-serif;
  --pt-body-size: 18px;
  --pt-caption-size: 14px;
  --pt-line-height: 1.7;
}

/* Theme: fresh (小学) */
[data-theme="fresh"] {
  --pt-color-primary: #339AF0;
  --pt-spacing-xs: 5px;
  --pt-spacing-sm: 8px;
  --pt-spacing-md: 12px;
  --pt-spacing-lg: 16px;
  --pt-spacing-xl: 20px;
  --pt-spacing-xxl: 26px;
  --pt-radius-sm: 8px;
  --pt-radius-md: 12px;
  --pt-radius-lg: 16px;
  --pt-radius-xl: 24px;
  --pt-font-family: 'NotoSansSC', 'PingFangSC', sans-serif;
  --pt-body-size: 16px;
  --pt-caption-size: 13px;
  --pt-line-height: 1.6;
}

/* Theme: standard (初中) */
[data-theme="standard"] {
  --pt-color-primary: #4C6EF5;
  --pt-spacing-xs: 4px;
  --pt-spacing-sm: 8px;
  --pt-spacing-md: 12px;
  --pt-spacing-lg: 16px;
  --pt-spacing-xl: 20px;
  --pt-spacing-xxl: 24px;
  --pt-radius-sm: 6px;
  --pt-radius-md: 8px;
  --pt-radius-lg: 12px;
  --pt-radius-xl: 16px;
  --pt-font-family: 'NotoSansSC', 'PingFangSC', sans-serif;
  --pt-body-size: 15px;
  --pt-caption-size: 12px;
  --pt-line-height: 1.5;
}

/* Theme: pro (高中) */
[data-theme="pro"] {
  --pt-color-primary: #3B5BDB;
  --pt-spacing-xs: 4px;
  --pt-spacing-sm: 8px;
  --pt-spacing-md: 12px;
  --pt-spacing-lg: 16px;
  --pt-spacing-xl: 20px;
  --pt-spacing-xxl: 24px;
  --pt-radius-sm: 4px;
  --pt-radius-md: 6px;
  --pt-radius-lg: 8px;
  --pt-radius-xl: 12px;
  --pt-font-family: 'NotoSansSC', 'PingFangSC', sans-serif;
  --pt-body-size: 14px;
  --pt-caption-size: 12px;
  --pt-line-height: 1.5;
}
```

### 8.3 Flutter 端 Theme 注入

```dart
// lib/ui/core/theme/age_theme.dart

import 'package:flutter/material.dart';

class AgeTheme {
  final AgeMode ageMode;
  final ThemeId themeId;
  
  // 从 ThemeManager 构建 Flutter ThemeData
  ThemeData toFlutterThemeData() {
    final tokens = ThemeManager.instance.currentTokens;
    final ageConfig = ThemeManager.instance.currentAgeConfig;
    
    return ThemeData(
      useMaterial3: true,
      
      // Color Scheme
      colorScheme: ColorScheme.light(
        primary: _hexToColor(tokens.colors.primary),
        secondary: _hexToColor(tokens.colors.secondary),
        surface: _hexToColor(tokens.colors.surface),
        error: _hexToColor(tokens.colors.error),
        onPrimary: _hexToColor(tokens.colors.textOnPrimary),
        onSurface: _hexToColor(tokens.colors.textPrimary),
      ),
      
      // Text Theme
      textTheme: TextTheme(
        headlineLarge: TextStyle(fontSize: tokens.typography.headingSizes['h1']?.toDouble()),
        headlineMedium: TextStyle(fontSize: tokens.typography.headingSizes['h2']?.toDouble()),
        headlineSmall: TextStyle(fontSize: tokens.typography.headingSizes['h3']?.toDouble()),
        bodyLarge: TextStyle(fontSize: tokens.typography.bodySize.toDouble()),
        bodyMedium: TextStyle(fontSize: (tokens.typography.bodySize - 1).toDouble()),
        bodySmall: TextStyle(fontSize: tokens.typography.captionSize.toDouble()),
      ),
      
      // Card Theme
      cardTheme: CardThemeData(
        elevation: ageMode == AgeMode.senior ? 0 : 1,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(tokens.radius.md.toDouble()),
        ),
        margin: EdgeInsets.all(tokens.spacing.sm.toDouble()),
      ),
      
      // ElevatedButton Theme
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: Size(double.infinity, ageConfig.minTouchTarget.toDouble()),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(tokens.radius.lg.toDouble()),
          ),
          textStyle: TextStyle(fontSize: tokens.typography.bodySize.toDouble()),
        ),
      ),
      
      // Input Decoration
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(tokens.radius.md.toDouble()),
        ),
        contentPadding: EdgeInsets.symmetric(
          horizontal: tokens.spacing.md.toDouble(),
          vertical: tokens.spacing.sm.toDouble(),
        ),
      ),
    );
  }
  
  static Color _hexToColor(String hex) {
    return Color(int.parse(hex.replaceFirst('#', 'FF'), radix: 16));
  }
}
```

---

## 9. 响应式与多设备适配

### 9.1 断点定义

```typescript
// libs/ui-core/src/responsive/breakpoints.ts

export enum DeviceType {
  PHONE = 'phone',        // < 600dp
  TABLET = 'tablet',      // 600-840dp
  DESKTOP = 'desktop',    // > 840dp (Web端)
}

export const BREAKPOINTS = {
  tablet: 600,
  desktop: 840,
};

export interface ResponsiveConfig {
  /** 内容最大宽度 dp (Web端居中) */
  maxContentWidth: number;
  /** 是否使用双栏布局 */
  dualPane: boolean;
  /** 侧边栏模式 */
  sidebarMode: 'none' | 'temporary' | 'permanent';
  /** 卡片列数 */
  gridColumns: number;
}

export const RESPONSIVE_CONFIGS: Record<DeviceType, ResponsiveConfig> = {
  [DeviceType.PHONE]: {
    maxContentWidth: Infinity,
    dualPane: false,
    sidebarMode: 'none',
    gridColumns: 1,
  },
  [DeviceType.TABLET]: {
    maxContentWidth: 840,
    dualPane: true,
    sidebarMode: 'temporary',
    gridColumns: 2,
  },
  [DeviceType.DESKTOP]: {
    maxContentWidth: 960,
    dualPane: true,
    sidebarMode: 'permanent',
    gridColumns: 3,
  },
};
```

### 9.2 双栏布局（平板/Web端）

在平板和桌面端，使用 Master-Detail 双栏布局：

```
┌────────────────┬─────────────────────────────┐
│                │                             │
│  章节列表/      │    详情内容区                 │
│  题目列表/      │    (知识点讲解 / 题目解析 /    │
│  对话列表       │     AI对话等)               │
│                │                             │
│  Master Pane   │    Detail Pane              │
│  (宽度 35%)    │    (宽度 65%)               │
│                │                             │
└────────────────┴─────────────────────────────┘
```

适用场景：
- 同步课堂：左侧章节目录 → 右侧知识点详情
- 错题本：左侧错题列表 → 右侧错题详情
- AI 对话：左侧历史会话列表 → 右侧对话详情

---

## 10. 暗色模式支持

### 10.1 暗色主题映射

```typescript
// libs/ui-core/src/theme/dark-tokens.ts

export const DARK_THEME_COLORS: Record<ThemeId, ColorTokens> = {
  candy: {
    ...THEME_COLORS.candy,
    primary: '#FF8A8A',
    primaryLight: '#3D2020',
    primaryDark: '#FF6B6B',
    background: '#1A1215',
    surface: '#251C1F',
    surfaceVariant: '#302528',
    overlay: 'rgba(0,0,0,0.6)',
    textPrimary: '#F5F0EE',
    textSecondary: '#B8A8A5',
    textTertiary: '#7A6E6C',
    textOnPrimary: '#FFFFFF',
    textInverse: '#1A1215',
    divider: '#3A2E30',
    disabled: '#5A4E50',
    ripple: 'rgba(255,138,138,0.15)',
  },
  fresh: {
    ...THEME_COLORS.fresh,
    primary: '#5BB8FF',
    primaryLight: '#1A2D40',
    primaryDark: '#339AF0',
    background: '#121820',
    surface: '#1C2430',
    surfaceVariant: '#263040',
    overlay: 'rgba(0,0,0,0.6)',
    textPrimary: '#F0F4F8',
    textSecondary: '#A0B0C0',
    textTertiary: '#707E8E',
    textOnPrimary: '#FFFFFF',
    textInverse: '#121820',
    divider: '#2A3545',
    disabled: '#4A5565',
    ripple: 'rgba(91,184,255,0.12)',
  },
  standard: {
    ...THEME_COLORS.standard,
    primary: '#6B8FFF',
    primaryLight: '#1A2040',
    primaryDark: '#4C6EF5',
    background: '#0F1120',
    surface: '#181B30',
    surfaceVariant: '#222540',
    overlay: 'rgba(0,0,0,0.6)',
    textPrimary: '#E8ECF4',
    textSecondary: '#9AA0B0',
    textTertiary: '#686E80',
    textOnPrimary: '#FFFFFF',
    textInverse: '#0F1120',
    divider: '#282C45',
    disabled: '#404560',
    ripple: 'rgba(107,143,255,0.10)',
  },
  pro: {
    ...THEME_COLORS.pro,
    primary: '#5B7BF0',
    primaryLight: '#151830',
    primaryDark: '#3B5BDB',
    background: '#0A0D1A',
    surface: '#141825',
    surfaceVariant: '#1E2235',
    overlay: 'rgba(0,0,0,0.65)',
    textPrimary: '#E0E4F0',
    textSecondary: '#888EB0',
    textTertiary: '#5A6080',
    textOnPrimary: '#FFFFFF',
    textInverse: '#0A0D1A',
    divider: '#242840',
    disabled: '#383D55',
    ripple: 'rgba(91,123,240,0.08)',
  },
};
```

### 10.2 暗色模式切换策略

- **幼儿模式 (kindergarten)**：不支持暗色模式，强制使用亮色主题（保护视力，避免幼儿在暗环境使用）
- **小学模式 (primary)**：不主动提供切换入口，跟随系统设置
- **初中模式 (junior)**：提供手动切换入口，默认跟随系统
- **高中模式 (senior)**：提供手动切换入口，默认跟随系统

---

## 11. 无障碍 (Accessibility) 规范

### 11.1 基础要求

```typescript
// libs/ui-core/src/a11y/a11y-config.ts

export interface A11yConfig {
  /** 最小对比度 (WCAG AA: 4.5:1) */
  minContrastRatio: number;
  /** 触控目标最小尺寸 dp */
  minTouchTarget: number;
  /** 语义化标签 */
  semanticLabels: boolean;
  /** 屏幕阅读器支持 */
  screenReader: boolean;
  /** 缩放支持 */
  allowTextScaling: boolean;
  /** 减少动画（尊重系统设置） */
  respectReduceMotion: boolean;
}

export const A11Y_DEFAULTS: A11yConfig = {
  minContrastRatio: 4.5,
  minTouchTarget: 44,
  semanticLabels: true,
  screenReader: true,
  allowTextScaling: true,
  respectReduceMotion: true,
};
```

### 11.2 关键无障碍规则

| 规则 | 说明 | 优先级 |
|------|------|--------|
| 所有图片有 alt 文本 | AI 解答中的图片、图标、插画需提供描述性文本 | P0 |
| 触控目标 ≥ 44dp | 所有可点击元素满足最小触控尺寸 | P0 |
| 文字对比度 ≥ 4.5:1 | 正文、标签、按钮文字与背景对比度达标 | P0 |
| 焦点顺序合理 | 键盘/屏幕阅读器导航顺序符合视觉布局 | P1 |
| 实时区域标记 | AI 流式回答使用 `aria-live="polite"` | P1 |
| 公式可读 | LaTeX 公式提供 alt 文本表示 | P1 |
| 减少动画 | 系统开启"减少动画"时禁用非必要动画 | P1 |

---

## 12. 开发接入指南

### 12.1 新页面开发流程

```
1. 确定页面的 AgeMode 适配需求
   → 查阅 §4 对应模块的布局差异
   → 查阅 §5 组件配置表

2. 引入 ThemeProvider
   → 使用 useTheme() 获取 tokens 和 ageConfig

3. 使用 Design Token 而非硬编码值
   → ❌ fontSize: 16
   → ✅ fontSize: tokens.typography.bodySize

4. 使用 ageCopy() 获取适龄文案
   → ❌ "加载中..."
   → ✅ ageCopy('common.loading', ageMode)

5. 测试所有 AgeMode
   → 使用开发者工具切换 AgeMode 预览
   → 检查各模式下的布局、字体、间距、动画
```

### 12.2 目录结构建议

```
libs/ui-core/
├── src/
│   ├── types/
│   │   ├── age-mode.ts           # AgeMode 枚举与映射
│   │   └── age-mode-config.ts    # AgeMode 配置矩阵
│   ├── theme/
│   │   ├── tokens.ts             # Design Token 接口
│   │   ├── color-tokens.ts       # 各主题色板
│   │   ├── typography-tokens.ts  # 字体排版
│   │   ├── layout-tokens.ts      # 间距与圆角
│   │   ├── asset-tokens.ts       # 图标与插画
│   │   ├── dark-tokens.ts        # 暗色主题
│   │   └── theme-provider.ts     # 主题管理引擎
│   ├── components/
│   │   ├── button/               # 按钮（分龄配置）
│   │   ├── card/                 # 卡片
│   │   ├── input/                # 输入框
│   │   ├── message-bubble/       # 对话气泡
│   │   └── navigation/           # 底部导航
│   ├── animation/
│   │   ├── timing.ts             # 动画时长
│   │   └── reward-feedback.ts    # 奖励反馈
│   ├── i18n/
│   │   └── age-copy.ts           # 适龄文案系统
│   ├── responsive/
│   │   └── breakpoints.ts        # 响应式断点
│   └── a11y/
│       └── a11y-config.ts        # 无障碍配置
```

### 12.3 开发检查清单

在提交 PR 前，开发者需确认：

- [ ] 未使用硬编码颜色值（使用 `tokens.colors.*`）
- [ ] 未使用硬编码字号（使用 `tokens.typography.*`）
- [ ] 未使用硬编码间距（使用 `tokens.spacing.*`）
- [ ] 文案使用 `ageCopy()` 获取
- [ ] 按钮触控区域 ≥ `ageConfig.minTouchTarget`
- [ ] 在全部 4 个 AgeMode 下视觉验证通过
- [ ] 暗色模式下验证通过（高中模式）
- [ ] 无障碍标签已添加

---

## 13. 附录：分龄 UI 速查对照表

| 维度 | 幼儿 (candy) | 小学 (fresh) | 初中 (standard) | 高中 (pro) |
|------|-------------|-------------|----------------|-----------|
| 主色 | #FF6B6B | #339AF0 | #4C6EF5 | #3B5BDB |
| 字体 | NotoSansSC-Rounded | NotoSansSC | NotoSansSC | NotoSansSC |
| 正文字号 | 18sp | 16sp | 15sp | 14sp |
| 字体缩放 | 1.35x | 1.15x | 1.0x | 1.0x |
| 行高 | 1.7 | 1.6 | 1.5 | 1.5 |
| 按钮高度 | 52dp | 46dp | 42dp | 40dp |
| 最小触控 | 56dp | 48dp | 44dp | 44dp |
| 卡片圆角 | 20dp | 16dp | 12dp | 8dp |
| 按钮圆角 | 26dp | 23dp | 21dp | 20dp |
| 导航栏高 | 72dp | 60dp | 56dp | 52dp |
| 底部导航项 | 3 | 5 | 5(无文字) | 5(无文字) |
| AI回答模式 | 渐进式 | 渐进式 | 完整展示 | 完整展示 |
| 动画基准 | 600ms | 400ms | 250ms | 150ms |
| 图标风格 | filled | duotone | outlined | outlined |
| 插画风格 | 卡通 | 扁平 | 简约 | 抽象 |
| 奖励反馈 | 5级(最丰富) | 4级 | 2级 | 1级(最简) |
| 暗色模式 | ❌ 不支持 | 跟随系统 | 手动+系统 | 手动+系统 |
| 语音优先 | ✅ 是 | ❌ 否 | ❌ 否 | ❌ 否 |
| 家长验证 | ✅ 需要 | ❌ | ❌ | ❌ |
| 消息气泡宽度 | 82% | 80% | 78% | 75% |
