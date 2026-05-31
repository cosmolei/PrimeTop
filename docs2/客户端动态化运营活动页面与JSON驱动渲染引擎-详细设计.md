# 客户端动态化运营活动页面与JSON驱动渲染引擎 - 详细设计

## 1. 模块概述

### 1.1 定位

客户端动态化运营活动页面与JSON驱动渲染引擎（以下简称"动态页面引擎"）是 PrimeTop 客户端的运营基础设施。它允许运营团队通过后台配置 JSON 页面描述，在 APP 端实时渲染活动页、促销页、节日专题页、学习挑战页等运营页面，无需客户端发版即可上线新活动。

### 1.2 解决的问题

| 痛点 | 解决方式 |
|------|----------|
| 运营活动上线依赖客户端发版，周期长（1-2周） | JSON 配置驱动，后台发布即时生效 |
| 每次活动都需要前端开发介入 | 可视化页面搭建 + 预置组件库 |
| 不同学段/年级需要差异化活动页面 | 页面支持条件规则，按用户分群投放 |
| 活动效果难以量化 | 内置埋点与转化追踪 |
| 活动页面与功能模块耦合严重 | 统一渲染引擎解耦页面与业务逻辑 |

### 1.3 功能范围

| 功能 | 优先级 | MVP |
|------|--------|-----|
| JSON 页面描述协议定义 | P0 | ✅ |
| 基础组件库（文本、图片、按钮、轮播、列表） | P0 | ✅ |
| 动态页面渲染引擎 | P0 | ✅ |
| 页面配置后台 API | P0 | ✅ |
| 深链接与页面路由集成 | P0 | ✅ |
| 条件化内容展示（按学段/年级/会员） | P1 | ✅ |
| 页面版本管理与灰度发布 | P1 | ✅ |
| 内置埋点与转化追踪 | P1 | ✅ |
| 高级组件（倒计时、进度条、排行榜、抽奖转盘） | P2 | ❌ |
| 可视化页面搭建工具 | P2 | ❌ |
| A/B 测试集成 | P2 | ❌ |
| 离线页面缓存与预加载 | P2 | ❌ |

---

## 2. 整体架构

### 2.1 系统架构图

```
┌──────────────────────────────────────────────────────────┐
│                    运营管理后台 (Web)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ 页面编辑器 │  │ 组件库管理 │  │ 投放规则  │  │ 效果分析  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
└───────┼──────────────┼──────────────┼──────────────┼──────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌──────────────────────────────────────────────────────────┐
│                    动态页面服务端                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ 页面CRUD  │  │ 版本管理  │  │ 投放引擎  │  │ 埋点收集  │ │
│  │   API    │  │  服务    │  │  服务    │  │  服务    │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
│       │              │              │              │       │
│       ▼              ▼              ▼              ▼       │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    MySQL + Redis                      │  │
│  │  pages / page_versions / page_rules / page_metrics   │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
        │                              ▲
        │  HTTP/SSE (JSON Schema)      │  埋点上报
        ▼                              │
┌──────────────────────────────────────────────────────────┐
│                    客户端动态页面引擎                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Schema   │  │ Component│  │ Rule     │  │ Tracker  │ │
│  │ Parser   │  │ Renderer │  │ Evaluator│  │ (埋点)   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ Layout   │  │ Action   │  │ Cache    │               │
│  │ Engine   │  │ Handler  │  │ Manager  │               │
│  └──────────┘  └──────────┘  └──────────┘               │
└──────────────────────────────────────────────────────────┘
```

### 2.2 核心流程

```
运营人员创建活动页面（JSON配置）
        │
        ▼
  保存到服务端 → 版本号递增
        │
        ▼
  配置投放规则（学段、年级、会员、时间）
        │
        ▼
  发布（支持灰度百分比）
        │
        ▼
  客户端请求页面列表/详情
        │
        ▼
  服务端根据用户画像 + 投放规则返回匹配页面
        │
        ▼
  客户端 Schema Parser 解析 JSON
        │
        ▼
  Component Renderer 渲染组件树
        │
        ▼
  用户交互 → Action Handler 处理事件
        │
        ▼
  Tracker 上报行为数据
```

---

## 3. JSON 页面描述协议（Page Schema）

### 3.1 协议顶层结构

```typescript
/**
 * 页面描述协议 v1.0
 */
interface PageSchema {
  /** 协议版本号，用于兼容性判断 */
  schemaVersion: "1.0";
  
  /** 页面唯一标识 */
  pageId: string;
  
  /** 页面版本号，每次编辑自增 */
  version: number;
  
  /** 页面元数据 */
  meta: PageMeta;
  
  /** 页面级样式配置 */
  style: PageStyle;
  
  /** 组件树（核心渲染内容） */
  body: ComponentNode[];
  
  /** 页面级行为配置 */
  actions: PageActionConfig;
  
  /** 条件化内容规则 */
  rules?: DisplayRule[];
}

interface PageMeta {
  /** 页面标题 */
  title: string;
  
  /** 页面描述 */
  description?: string;
  
  /** 页面类型 */
  pageType: "activity" | "promotion" | "festival" | "challenge" | "notice" | "custom";
  
  /** 生效时间 */
  startTime: string;  // ISO 8601
  
  /** 失效时间 */
  endTime: string;    // ISO 8601
  
  /** 标签，用于分类 */
  tags?: string[];
  
  /** 是否需要登录 */
  requireLogin: boolean;
  
  /** 是否需要会员 */
  requireMembership?: boolean;
  
  /** 页面分享配置 */
  share?: {
    title: string;
    description: string;
    imageUrl: string;
  };
}

interface PageStyle {
  /** 背景色（支持渐变） */
  backgroundColor?: string | GradientConfig;
  
  /** 背景图片 */
  backgroundImage?: string;
  
  /** 页面内边距 */
  padding?: EdgeInsets;
  
  /** 是否允许下拉刷新 */
  pullToRefresh?: boolean;
  
  /** 状态栏样式 */
  statusBarStyle?: "light" | "dark";
  
  /** 导航栏配置 */
  navigationBar?: {
    visible: boolean;
    title?: string;
    backgroundColor?: string;
    backButton?: boolean;
  };
}

interface EdgeInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface GradientConfig {
  type: "linear" | "radial";
  colors: string[];
  begin?: Alignment;
  end?: Alignment;
  angle?: number;
}

type Alignment = "topLeft" | "topCenter" | "topRight" | "centerLeft" | "center" | "centerRight" | "bottomLeft" | "bottomCenter" | "bottomRight";
```

### 3.2 组件节点定义

```typescript
/**
 * 统一组件节点
 */
interface ComponentNode {
  /** 组件类型标识 */
  type: ComponentType;
  
  /** 组件唯一ID（页面内唯一，用于埋点和事件绑定） */
  id: string;
  
  /** 组件属性 */
  props: Record<string, any>;
  
  /** 组件样式 */
  style?: ComponentStyle;
  
  /** 子组件 */
  children?: ComponentNode[];
  
  /** 显示条件 */
  visibleWhen?: ConditionExpression;
  
  /** 事件绑定 */
  events?: EventBinding[];
}

/**
 * 支持的组件类型（MVP 阶段）
 */
type ComponentType =
  // 基础组件
  | "text"          // 文本
  | "image"         // 图片
  | "button"        // 按钮
  | "icon"          // 图标
  | "divider"       // 分割线
  | "spacer"        // 弹性间距
  // 布局组件
  | "container"     // 容器（类似 div）
  | "row"           // 水平布局
  | "column"        // 垂直布局
  | "grid"          // 网格布局
  | "scroll"        // 可滚动容器
  | "expanded"      // 弹性填充
  // 内容组件
  | "carousel"      // 轮播图
  | "list"          // 列表
  | "card"          // 卡片
  | "tag"           // 标签
  | "badge"         // 徽标
  | "avatar"        // 头像
  // 业务组件
  | "countdown"     // 倒计时（P2）
  | "progress"      // 进度条
  | "statCard"      // 统计卡片
  | "subjectTag"    // 学科标签
  | "membershipCard"// 会员卡片
  | "taskCard"      // 任务卡片
  | "couponCard";   // 优惠券卡片

/**
 * 组件样式
 */
interface ComponentStyle {
  /** 宽度 */
  width?: number | string;    // 100 | "100%" | "auto"
  
  /** 高度 */
  height?: number | string;
  
  /** 外边距 */
  margin?: EdgeInsets;
  
  /** 内边距 */
  padding?: EdgeInsets;
  
  /** 背景色 */
  backgroundColor?: string;
  
  /** 背景图片 */
  backgroundImage?: string;
  
  /** 圆角 */
  borderRadius?: number | { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
  
  /** 边框 */
  border?: {
    width: number;
    color: string;
    style?: "solid" | "dashed";
  };
  
  /** 阴影 */
  boxShadow?: {
    color: string;
    blur: number;
    spread: number;
    offsetX: number;
    offsetY: number;
  };
  
  /** 透明度 */
  opacity?: number;  // 0.0 - 1.0
  
  /** 文字样式 */
  textStyle?: {
    fontSize?: number;
    fontWeight?: "normal" | "bold" | "w100" | "w200" | "w300" | "w400" | "w500" | "w600" | "w700" | "w800" | "w900";
    color?: string;
    letterSpacing?: number;
    lineHeight?: number;
    textAlign?: "left" | "center" | "right" | "justify";
    decoration?: "none" | "underline" | "lineThrough";
    maxLines?: number;
    overflow?: "clip" | "ellipsis" | "fade";
  };
  
  /** Flexbox 属性（用于 row/column 内子元素） */
  flex?: number;
  alignSelf?: "auto" | "flexStart" | "flexEnd" | "center" | "stretch" | "baseline";
  
  /** 动画 */
  animation?: AnimationConfig;
  
  /** 点击反馈 */
  clickEffect?: "none" | "scale" | "opacity" | "ripple";
  
  /** 溢出处理 */
  overflow?: "visible" | "hidden" | "scroll";
}

interface AnimationConfig {
  type: "fadeIn" | "slideUp" | "slideDown" | "slideLeft" | "slideRight" | "scaleIn" | "bounce";
  duration: number;      // ms
  delay?: number;        // ms
  curve?: "linear" | "easeIn" | "easeOut" | "easeInOut";
}
```

### 3.3 事件与动作

```typescript
/**
 * 事件绑定
 */
interface EventBinding {
  /** 触发事件类型 */
  event: EventType;
  /** 执行的动作 */
  action: Action;
}

type EventType =
  | "tap"           // 单击
  | "doubleTap"     // 双击
  | "longPress"     // 长按
  | "visible"       // 进入可视区域
  | "invisible";    // 离开可视区域

/**
 * 动作定义
 */
type Action =
  | NavigateAction
  | ShowDialogAction
  | CopyTextAction
  | ShareAction
  | TrackAction
  | OpenUrlAction
  | CustomAction;

interface NavigateAction {
  type: "navigate";
  /** 目标路由 */
  route: string;
  /** 路由参数 */
  params?: Record<string, string>;
  /** 导航方式 */
  mode: "push" | "replace" | "popToRoot";
}

interface ShowDialogAction {
  type: "showDialog";
  title: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  /** 确认后动作 */
  onConfirm?: Action;
  /** 取消后动作 */
  onCancel?: Action;
}

interface CopyTextAction {
  type: "copyText";
  text: string;
  toastMessage?: string;
}

interface ShareAction {
  type: "share";
  title: string;
  description: string;
  imageUrl: string;
  url?: string;
}

interface TrackAction {
  type: "track";
  eventName: string;
  eventParams?: Record<string, string>;
}

interface OpenUrlAction {
  type: "openUrl";
  url: string;
  /** 是否在应用内打开 */
  inApp?: boolean;
}

interface CustomAction {
  type: "custom";
  /** 自定义动作标识，由客户端注册处理器 */
  handler: string;
  params?: Record<string, any>;
}
```

### 3.4 条件表达式

```typescript
/**
 * 条件表达式 — 控制组件的条件展示
 */
type ConditionExpression =
  | { op: "and"; conditions: ConditionExpression[] }
  | { op: "or"; conditions: ConditionExpression[] }
  | { op: "not"; condition: ConditionExpression }
  | { op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "notIn" | "contains"; 
      field: string; 
      value: any };

/**
 * 可用的 field 取值：
 * - user.grade        用户年级（如 "grade_3"）
 * - user.stage        用户学段（如 "primary"）
 * - user.memberLevel  会员等级（如 "free" | "monthly" | "annual"）
 * - user.isNewUser    是否新用户（true/false）
 * - user.age          用户年龄
 * - device.platform   设备平台（"ios" | "android"）
 * - device.appVersion 应用版本号
 * - context.time      当前时间（用于时段判断）
 * - context.variable  自定义上下文变量
 */
```

### 3.5 完整页面示例

以下是一个"暑假学习挑战"活动页面的完整 JSON 示例：

```json
{
  "schemaVersion": "1.0",
  "pageId": "summer_challenge_2026",
  "version": 3,
  "meta": {
    "title": "2026暑假学习挑战",
    "description": "暑假学习挑战活动，完成每日任务赢取勋章",
    "pageType": "challenge",
    "startTime": "2026-07-01T00:00:00+08:00",
    "endTime": "2026-08-31T23:59:59+08:00",
    "tags": ["暑假", "挑战", "2026"],
    "requireLogin": true,
    "share": {
      "title": "我在启硕参加暑假学习挑战！",
      "description": "完成每日学习任务，赢取专属勋章和积分奖励",
      "imageUrl": "https://cdn.primetop.app/activities/summer2026/share.png"
    }
  },
  "style": {
    "backgroundColor": {
      "type": "linear",
      "colors": ["#FF6B35", "#FFB347"],
      "begin": "topCenter",
      "end": "bottomCenter"
    },
    "statusBarStyle": "light",
    "navigationBar": {
      "visible": true,
      "title": "暑假挑战",
      "backgroundColor": "#FF6B35",
      "backButton": true
    }
  },
  "body": [
    {
      "type": "image",
      "id": "hero_banner",
      "props": {
        "src": "https://cdn.primetop.app/activities/summer2026/banner.png",
        "fit": "cover",
        "aspectRatio": "16:9"
      },
      "style": {
        "width": "100%",
        "borderRadius": { "topLeft": 0, "topRight": 0, "bottomLeft": 16, "bottomRight": 16 }
      }
    },
    {
      "type": "container",
      "id": "main_content",
      "props": {},
      "style": {
        "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 }
      },
      "children": [
        {
          "type": "text",
          "id": "title_text",
          "props": {
            "text": "🔥 每日学习挑战"
          },
          "style": {
            "textStyle": {
              "fontSize": 22,
              "fontWeight": "bold",
              "color": "#FFFFFF"
            },
            "margin": { "bottom": 12 }
          }
        },
        {
          "type": "text",
          "id": "desc_text",
          "props": {
            "text": "每天完成学习任务，赢取积分和专属勋章！连续打卡7天还有额外奖励。"
          },
          "style": {
            "textStyle": {
              "fontSize": 14,
              "color": "#FFFFFFCC",
              "lineHeight": 1.5
            },
            "margin": { "bottom": 20 }
          }
        },
        {
          "type": "taskCard",
          "id": "task_1",
          "props": {
            "title": "完成今日AI问答",
            "subtitle": "与AI老师对话至少3个问题",
            "icon": "chat_bubble",
            "reward": "+10 积分",
            "status": "incomplete"
          },
          "style": {
            "backgroundColor": "#FFFFFF",
            "borderRadius": 12,
            "margin": { "bottom": 12 },
            "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 }
          },
          "events": [
            {
              "event": "tap",
              "action": {
                "type": "navigate",
                "route": "/ai-chat",
                "mode": "push"
              }
            }
          ]
        },
        {
          "type": "taskCard",
          "id": "task_2",
          "props": {
            "title": "做5道练习题",
            "subtitle": "完成同步课堂练习",
            "icon": "edit_note",
            "reward": "+15 积分",
            "status": "incomplete"
          },
          "style": {
            "backgroundColor": "#FFFFFF",
            "borderRadius": 12,
            "margin": { "bottom": 12 },
            "padding": { "top": 16, "right": 16, "bottom": 16, "left": 16 }
          },
          "events": [
            {
              "event": "tap",
              "action": {
                "type": "navigate",
                "route": "/sync-class/practice",
                "mode": "push"
              }
            }
          ]
        },
        {
          "type": "button",
          "id": "view_ranking",
          "props": {
            "text": "查看排行榜",
            "variant": "outline"
          },
          "style": {
            "width": "100%",
            "height": 48,
            "margin": { "top": 20 },
            "borderRadius": 24,
            "border": { "width": 2, "color": "#FFFFFF" }
          },
          "styleOverrides": {
            "textStyle": {
              "color": "#FFFFFF",
              "fontSize": 16,
              "fontWeight": "bold"
            }
          },
          "events": [
            {
              "event": "tap",
              "action": {
                "type": "navigate",
                "route": "/activity/summer2026/ranking",
                "mode": "push"
              }
            }
          ]
        }
      ]
    }
  ],
  "actions": {
    "onPageEnter": [
      { "type": "track", "eventName": "activity_page_view", "eventParams": { "pageId": "summer_challenge_2026" } }
    ],
    "onPageExit": [
      { "type": "track", "eventName": "activity_page_exit", "eventParams": { "pageId": "summer_challenge_2026" } }
    ]
  },
  "rules": [
    {
      "op": "gte",
      "field": "user.stage",
      "value": "primary"
    }
  ]
}
```

---

## 4. 客户端渲染引擎设计

### 4.1 引擎架构

```
┌─────────────────────────────────────────┐
│           DynamicPageWidget             │
│  (Flutter StatefulWidget, 页面容器)       │
├─────────────────────────────────────────┤
│                                         │
│  ┌───────────┐    ┌──────────────────┐  │
│  │SchemaParser│───▶│ ComponentTree    │  │
│  │           │    │ (AST)            │  │
│  └───────────┘    └───────┬──────────┘  │
│                           │              │
│  ┌───────────┐    ┌──────▼──────────┐  │
│  │RuleEvaluator│──▶│ Filtered Tree  │  │
│  │           │    │ (过滤后组件树)   │  │
│  └───────────┘    └───────┬──────────┘  │
│                           │              │
│  ┌───────────┐    ┌──────▼──────────┐  │
│  │StyleResolver│──▶│ Styled Tree    │  │
│  │           │    │ (样式解析后)     │  │
│  └───────────┘    └───────┬──────────┘  │
│                           │              │
│  ┌───────────┐    ┌──────▼──────────┐  │
│  │ComponentReg│──▶│ Widget Tree    │  │
│  │istry      │    │ (Flutter Widget)│  │
│  └───────────┘    └──────────────────┘  │
│                                         │
│  ┌───────────┐    ┌──────────────────┐  │
│  │ActionHandler│   │ EventTracker   │  │
│  │(事件处理)  │    │ (埋点上报)      │  │
│  └───────────┘    └──────────────────┘  │
└─────────────────────────────────────────┘
```

### 4.2 核心类设计

```dart
/// 页面渲染引擎主入口
class DynamicPageEngine {
  final SchemaParser _parser;
  final ComponentRegistry _registry;
  final RuleEvaluator _ruleEvaluator;
  final StyleResolver _styleResolver;
  final ActionHandler _actionHandler;
  final EventTracker _tracker;
  final CacheManager _cacheManager;

  DynamicPageEngine({
    required SchemaParser parser,
    required ComponentRegistry registry,
    required RuleEvaluator ruleEvaluator,
    required StyleResolver styleResolver,
    required ActionHandler actionHandler,
    required EventTracker tracker,
    required CacheManager cacheManager,
  })  : _parser = parser,
        _registry = registry,
        _ruleEvaluator = ruleEvaluator,
        _styleResolver = styleResolver,
        _actionHandler = actionHandler,
        _tracker = tracker,
        _cacheManager = cacheManager;

  /// 加载并渲染页面
  Future<Widget> buildPage(String pageId, {
    required BuildContext context,
    Map<String, dynamic>? variables,
  })) async {
    // 1. 获取页面 Schema（优先缓存，再网络请求）
    final schema = await _fetchSchema(pageId);

    // 2. 解析 Schema
    final parseResult = _parser.parse(schema);

    // 3. 评估条件规则，过滤组件
    final filteredNodes = _ruleEvaluator.filter(
      parseResult.body,
      context: _buildEvaluationContext(variables),
    );

    // 4. 解析样式
    final styledNodes = _styleResolver.resolve(filteredNodes);

    // 5. 渲染为 Widget 树
    final widget = _renderNode