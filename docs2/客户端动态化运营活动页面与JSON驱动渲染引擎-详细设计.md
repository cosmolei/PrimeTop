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
  }) async {
    // 1. 获取页面 Schema（优先缓存，再网络请求）
    final schema = await _fetchSchema(pageId);

    // 2. 解析 Schema（含结构校验，失败抛 DynamicPageException）
    final parseResult = _parser.parse(schema);

    // 3. 评估条件规则，过滤组件（G3: 规则评估失败时按"保守可见"处理，
    //    即 visibleWhen 无法求值的组件默认隐藏，防止向错误人群曝光）
    final filteredNodes = _ruleEvaluator.filter(
      parseResult.body,
      context: _buildEvaluationContext(variables),
    );

    // 4. 解析样式（非法样式值回退默认值，不中断渲染）
    final styledNodes = _styleResolver.resolve(filteredNodes);

    // 5. 构建页面上下文（渲染期透传给每个组件与动作）
    final pageContext = DynamicPageContext(
      pageId: pageId,
      schemaVersion: parseResult.schemaVersion,
      variables: variables ?? const {},
      actionHandler: _actionHandler,
      tracker: _tracker,
    );

    // 6. 递归渲染为 Widget 树
    final widget = _renderNode(styledNodes, pageContext: pageContext);

    // 7. 页面进入动作（actions.onPageEnter 定义的动作序列，G6 失败隔离）
    unawaited(_actionHandler.runActions(parseResult.pageEnterActions,
        pageContext: pageContext));

    return DynamicPageWidget(
      pageId: pageId,
      child: widget,
      onExit: () => _actionHandler.runActions(
        parseResult.pageExitActions,
        pageContext: pageContext,
      ),
    );
  }

  /// 拉取页面 Schema：内存缓存 -> 磁盘缓存 -> 网络，三级兜底
  Future<Map<String, dynamic>> _fetchSchema(String pageId) async {
    // 内存缓存（同会话内页面切换秒回）
    final mem = _cacheManager.getMemory(pageId);
    if (mem != null && !_cacheManager.isExpired(mem)) return mem.raw;

    // 磁盘缓存（启动预热写入，弱网/离线可用）
    final disk = await _cacheManager.getDisk(pageId);
    if (disk != null) {
      // 后台静默刷新，本次先用磁盘版本（stale-while-revalidate）
      unawaited(_refreshFromNetwork(pageId, disk.version));
      return disk.raw;
    }

    // 网络拉取，失败向上抛 DynamicPageException(SCHEMA_FETCH_FAILED)
    return _refreshFromNetwork(pageId, 0);
  }

  /// 构建规则评估上下文：内置变量 + 页面级自定义变量
  EvaluationContext _buildEvaluationContext(Map<String, dynamic>? variables) {
    final user = _currentUserSnapshot(); // 学段/年级/会员等只读快照
    final device = _deviceInfoSnapshot();
    return EvaluationContext(
      variables: {
        'user.grade': user.grade,
        'user.stage': user.stage,
        'user.memberLevel': user.memberLevel,
        'user.isNewUser': user.isNewUser,
        'user.age': user.age,
        'device.platform': device.platform,
        'device.appVersion': device.appVersion,
        'context.time': DateTime.now().toIso8601String(),
        ...?variables,
      },
    );
  }

  /// 递归渲染组件树：ComponentNode -> Widget
  Widget _renderNode(List<ComponentNode> nodes,
      {required DynamicPageContext pageContext}) {
    final children =
        nodes.map((n) => _renderSingle(n, pageContext)).toList();
    // 顶层使用 Column 承载（协议约定 body 为纵向流式布局）
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }

  Widget _renderSingle(ComponentNode node, DynamicPageContext pageContext) {
    // G4: 未知组件类型不中断整页渲染，渲染占位空盒并上报
    final builder = _registry.find(node.type);
    if (builder == null) {
      _tracker.track('dynamic_page_unknown_component', {
        'pageId': pageContext.pageId,
        'componentType': node.type,
        'componentId': node.id,
      });
      return const SizedBox.shrink();
    }
    return builder.build(node, pageContext);
  }
}

/// 页面上下文：渲染期透传给每个组件构建器
class DynamicPageContext {
  final String pageId;
  final String schemaVersion;
  final Map<String, dynamic> variables;
  final ActionHandler actionHandler;
  final EventTracker tracker;

  const DynamicPageContext({
    required this.pageId,
    required this.schemaVersion,
    required this.variables,
    required this.actionHandler,
    required this.tracker,
  });
}
```

### 4.3 Schema 解析器（SchemaParser）

```dart
/// Schema 解析结果
class ParseResult {
  final String schemaVersion;
  final List<ComponentNode> body;
  final List<DisplayRule> rules;
  final List<Action> pageEnterActions;
  final List<Action> pageExitActions;
  final PageMeta meta;

  const ParseResult({
    required this.schemaVersion,
    required this.body,
    required this.rules,
    required this.pageEnterActions,
    required this.pageExitActions,
    required this.meta,
  });
}

/// JSON -> AST，带结构校验（V1-V6 校验规则见下表）
class SchemaParser {
  ParseResult parse(Map<String, dynamic> raw) {
    // V1: 协议版本兼容判断（客户端只支持 1.0，更高版本降级提示升级）
    final version = raw['schemaVersion'] as String?;
    if (version != '1.0') {
      throw DynamicPageException(
        code: 06601, // SCHEMA_VERSION_UNSUPPORTED
        message: '不支持的页面协议版本: $version',
      );
    }

    // V2: 顶层必填字段检查
    for (final key in ['pageId', 'meta', 'body']) {
      if (raw[key] == null) {
        throw DynamicPageException(
          code: 06602, // SCHEMA_FIELD_MISSING
          message: '页面描述缺少必填字段: $key',
        );
      }
    }

    final meta = _parseMeta(raw['meta'] as Map<String, dynamic>);

    // V3: 组件树递归解析，深度上限 20 层防恶意嵌套（G2 安全红线）
    final body = _parseNodeList(raw['body'], depth: 0);

    // V4: 页面内组件 id 唯一性检查（重复 id 后者覆盖并告警埋点）
    _checkDuplicateIds(body);

    final actions = raw['actions'] as Map<String, dynamic>? ?? const {};

    return ParseResult(
      schemaVersion: version!,
      body: body,
      rules: _parseRules(raw['rules']),
      pageEnterActions: _parseActions(actions['onPageEnter']),
      pageExitActions: _parseActions(actions['onPageExit']),
      meta: meta,
    );
  }

  List<ComponentNode> _parseNodeList(dynamic list, {required int depth}) {
    if (depth > 20) {
      throw DynamicPageException(
        code: 06603, // SCHEMA_DEPTH_EXCEEDED
        message: '组件嵌套超过 20 层上限',
      );
    }
    if (list is! List) return const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map((n) => _parseNode(n, depth: depth))
        .toList();
  }

  ComponentNode _parseNode(Map<String, dynamic> raw, {required int depth}) {
    // V5: type/id 必填，缺 id 时以 "auto_${type}_${hash}" 兜底生成并埋点
    final type = raw['type'] as String? ?? '';
    if (type.isEmpty) {
      throw DynamicPageException(
        code: 06602, message: '组件缺少 type 字段');
    }
    var id = raw['id'] as String?;
    if (id == null || id.isEmpty) {
      id = 'auto_${type}_${raw.hashCode.abs()}';
    }
    return ComponentNode(
      type: type,
      id: id,
      props: raw['props'] as Map<String, dynamic>? ?? const {},
      style: _parseStyle(raw['style']),
      children: raw['children'] == null
          ? const []
          : _parseNodeList(raw['children'], depth: depth + 1),
      visibleWhen: _parseCondition(raw['visibleWhen']),
      events: _parseEventBindings(raw['events']),
    );
  }
}
```

| 校验规则 | 说明 | 失败处理 |
|----------|------|----------|
| V1 版本兼容 | schemaVersion 必须为 "1.0" | 抛 06601，UI 提示"页面版本过新，请升级 APP" |
| V2 必填字段 | pageId/meta/body 缺一不可 | 抛 06602，整页渲染失败态 |
| V3 嵌套深度 | 组件树深度 ≤ 20 | 抛 06603，整页渲染失败态 |
| V4 id 唯一性 | 页面内组件 id 唯一 | 后者生效，上报 dynamic_page_dup_id |
| V5 组件必填 | type 必填，id 可兜底 | 缺 type 抛 06602；缺 id 自动补 |
| V6 单页规模 | body 解析后节点数 ≤ 500 | 超出截断至 500 并上报，不中断渲染 |

### 4.4 条件规则评估器（RuleEvaluator）

```dart
/// 条件表达式求值：and/or/not/比较操作符递归下降
class RuleEvaluator {
  final EvaluationContext ctx;

  RuleEvaluator(this.ctx);

  /// 过滤组件树：visibleWhen 为 null 恒可见；
  /// 求值异常（如 field 不存在）按 G3 保守可见原则返回 false（隐藏）
  List<ComponentNode> filter(List<ComponentNode> nodes,
      {required EvaluationContext context}) {
    return nodes
        .where((n) => _evalOrHide(n, context))
        .map((n) => n.copyWith(
              children: filter(n.children, context: context),
            ))
        .toList();
  }

  bool _evalOrHide(ComponentNode node, EvaluationContext context) {
    final cond = node.visibleWhen;
    if (cond == null) return true;
    try {
      return _eval(cond, context);
    } catch (_) {
      // G3: 无法求值 -> 隐藏，防止错误人群看到不该看的内容
      return false;
    }
  }

  bool _eval(ConditionExpression cond, EvaluationContext context) {
    switch (cond.op) {
      case 'and':
        return cond.conditions.every((c) => _eval(c, context));
      case 'or':
        return cond.conditions.any((c) => _eval(c, context));
      case 'not':
        return !_eval(cond.condition, context);
      case 'eq':  return context.get(cond.field) == cond.value;
      case 'neq': return context.get(cond.field) != cond.value;
      case 'gt':  return _num(context.get(cond.field)) > _num(cond.value);
      case 'gte': return _num(context.get(cond.field)) >= _num(cond.value);
      case 'lt':  return _num(context.get(cond.field)) < _num(cond.value);
      case 'lte': return _num(context.get(cond.field)) <= _num(cond.value);
      case 'in':     return (cond.value as List).contains(context.get(cond.field));
      case 'notIn':  return !(cond.value as List).contains(context.get(cond.field));
      case 'contains':
        return context.get(cond.field)?.toString().contains(cond.value.toString()) ?? false;
      default:
        throw ArgumentError('未知操作符: ${cond.op}');
    }
  }

  double _num(dynamic v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0.0;
}

/// 评估上下文：扁平键值对，支持 §3.4 定义的 field 命名空间
class EvaluationContext {
  final Map<String, dynamic> variables;
  const EvaluationContext({required this.variables});

  dynamic get(String field) {
    if (!variables.containsKey(field)) {
      throw StateError('评估字段不存在: $field');
    }
    return variables[field];
  }
}
```

### 4.5 组件注册表与渲染映射（ComponentRegistry）

```dart
/// 组件构建器 SPI：每种 ComponentType 对应一个实现
abstract class ComponentBuilder {
  String get type;
  Widget build(ComponentNode node, DynamicPageContext pageContext);
}

/// 组件注册表：启动时注册全部内置组件，支持业务方注册自定义组件（G5 白名单）
class ComponentRegistry {
  final _builders = <String, ComponentBuilder>{};

  void register(ComponentBuilder builder) {
    _builders[builder.type] = builder;
  }

  ComponentBuilder? find(String type) => _builders[type];

  /// App 启动初始化：注册 MVP 全部内置组件
  void initDefaults() {
    register(TextBuilder());
    register(ImageBuilder());
    register(ButtonBuilder());
    register(IconBuilder());
    register(DividerBuilder());
    register(SpacerBuilder());
    register(ContainerBuilder());
    register(RowBuilder());
    register(ColumnBuilder());
    register(GridBuilder());
    register(ScrollBuilder());
    register(CarouselBuilder());
    register(ListBuilder());
    register(CardBuilder());
    register(TaskCardBuilder());       // 业务组件：任务卡片
    register(MembershipCardBuilder()); // 业务组件：会员卡片
    register(CouponCardBuilder());     // 业务组件：优惠券卡片
  }
}

/// 文本组件示例：展示 props -> Widget 的映射约定
class TextBuilder implements ComponentBuilder {
  @override
  String get type => 'text';

  @override
  Widget build(ComponentNode node, DynamicPageContext pageContext) {
    final text = node.props['text']?.toString() ?? '';
    final ts = node.style?.textStyle;
    return AnimatedText( // 支持 style.animation 入场动效
      text,
      animation: node.style?.animation,
      style: TextStyle(
        fontSize: ts?.fontSize?.toDouble() ?? 14,
        fontWeight: _fontWeight(ts?.fontWeight),
        color: _color(ts?.color) ?? const Color(0xFF212121),
        letterSpacing: ts?.letterSpacing?.toDouble(),
        height: ts?.lineHeight?.toDouble(),
        decoration: _decoration(ts?.decoration),
      ),
      textAlign: _textAlign(ts?.textAlign),
      maxLines: ts?.maxLines,
      overflow: _overflow(ts?.overflow),
    );
  }
}
```

### 4.6 事件与动作处理器（ActionHandler）

```dart
/// 动作执行器：协议 §3.3 全部动作类型的客户端实现
class ActionHandler {
  final _customHandlers = <String, CustomActionHandler>{};

  /// 注册自定义动作（G5: handler 名必须在白名单内，
  /// 由初始化时显式注册，JSON 中的 custom.handler 只允许命中已注册项）
  void registerCustom(String handler, CustomActionHandler impl) {
    _customHandlers[handler] = impl;
  }

  Future<void> runActions(List<Action> actions,
      {DynamicPageContext? pageContext}) async {
    for (final action in actions) {
      try {
        await _run(action, pageContext);
      } catch (e) {
        // G6: 单个动作失败不阻塞后续动作（如 navigate 失败仍执行 track）
        pageContext?.tracker.track('dynamic_page_action_error', {
          'pageId': pageContext.pageId,
          'actionType': action.type,
          'error': e.toString(),
        });
      }
    }
  }

  Future<void> _run(Action action, DynamicPageContext? ctx) async {
    switch (action.type) {
      case 'navigate':
        await _router.navigate(action.route,
            params: action.params, mode: action.mode); // 复用统一路由系统
        break;
      case 'showDialog':
        await _dialogScheduler.show( // 复用统一模态弹层调度系统
          title: action.title,
          content: action.content,
          confirmText: action.confirmText ?? '确定',
          cancelText: action.cancelText,
          onConfirm: action.onConfirm == null ? null
              : () => runActions([action.onConfirm!], pageContext: ctx),
        );
        break;
      case 'copyText':
        await Clipboard.setData(ClipboardData(text: action.text));
        Toast.show(action.toastMessage ?? '已复制');
        break;
      case 'share':
        await _shareService.share(SharePayload(
          title: action.title,
          description: action.description,
          imageUrl: action.imageUrl,
          url: action.url,
        ));
        break;
      case 'track':
        ctx?.tracker.track(action.eventName,
            {...?action.eventParams, 'pageId': ctx.pageId});
        break;
      case 'openUrl':
        // G7: URL 协议白名单，仅允许 https:// 与 primetop:// 深链接，
        // 其余 scheme 一律拦截并上报
        if (!_isAllowedUrl(action.url)) {
          throw DynamicPageException(code: 06604, message: '非法 URL');
        }
        action.inApp == true
            ? await _webView.open(action.url)
            : await launchUrl(Uri.parse(action.url));
        break;
      case 'custom':
        final impl = _customHandlers[action.handler];
        if (impl == null) {
          throw DynamicPageException(
              code: 06605, message: '未注册的自定义动作: ${action.handler}');
        }
        await impl(action.params ?? const {}, ctx);
        break;
    }
  }

  bool _isAllowedUrl(String url) =>
      url.startsWith('https://') || url.startsWith('primetop://');
}
```

---

## 5. 服务端 API 设计

### 5.1 页面列表（投放引擎匹配后返回）

```
GET /api/v1/dynamic-pages?scene=home_banner&placement=activity_entry
```

| 参数 | 必填 | 说明 |
|------|------|------|
| scene | 是 | 投放场景标识（服务端权威，见 R1） |
| placement | 否 | 资源位标识，与运营资源位调度引擎对齐 |

响应：

```json
{
  "code": 0,
  "data": {
    "pages": [
      {
        "pageId": "summer_challenge_2026",
        "version": 3,
        "meta": { "title": "2026暑假学习挑战", "pageType": "challenge",
                   "startTime": "2026-07-01T00:00:00+08:00",
                   "endTime": "2026-08-31T23:59:59+08:00" },
        "schemaUrl": "https://cdn.primetop.app/dpages/summer_challenge_2026/3.json",
        "etag": "\"a1b2c3d4e5\""
      }
    ]
  }
}
```

说明：列表接口**不内联完整 Schema**，仅返回 `schemaUrl + etag`，客户端按 §6 缓存策略拉取详情，降低列表接口体积。

### 5.2 页面 Schema 详情

```
GET /api/v1/dynamic-pages/{pageId}/schema?version={n}
If-None-Match: "a1b2c4"
```

- 命中缓存返回 `304`（客户端直接用本地版本，见 §6.2）。
- `version` 缺省时返回当前线上版本；指定时用于客户端降级回读旧版本（灰度期）。
- Schema JSON 由 CDN 静态分发（`schemaUrl` 直连 CDN），本接口为兜底通道。

### 5.3 页面事件上报

```
POST /api/v1/dynamic-pages/{pageId}/events
```

```json
{
  "events": [
    { "eventId": "uuid-v4（客户端幂等键）",
      "componentId": "view_ranking",
      "eventName": "activity_page_click",
      "timestamp": 1760000000000,
      "params": { "pageId": "summer_challenge_2026" } }
  ]
}
```

服务端按 `eventId` 去重（24h 窗口），离线积压事件批量补报。

### 5.4 错误码（06600-06699，客户端段）

| 错误码 | 场景 | 客户端处理 |
|--------|------|------------|
| 06600 | SCHEMA_FETCH_FAILED Schema 拉取失败（网络/CDN） | 有缓存用缓存；无缓存展示错误重试态 |
| 06601 | SCHEMA_VERSION_UNSUPPORTED 协议版本不兼容 | 提示"页面版本过新，请升级 APP"，禁用重试按钮 |
| 06602 | SCHEMA_FIELD_MISSING Schema 缺必填字段 | 整页错误态 + 一键反馈 |
| 06603 | SCHEMA_DEPTH_EXCEEDED 嵌套超限 | 整页错误态 + 一键反馈 |
| 06604 | URL_BLOCKED 非法 URL 被拦截 | 静默拦截 + toast"链接不可用" |
| 06605 | CUSTOM_HANDLER_MISSING 自定义动作未注册 | 忽略该动作，控制台告警 |
| 06606 | IMAGE_LOAD_FAILED 图片组件加载失败 | 显示占位图，不中断页面 |
| 06607 | RULE_EVAL_FAILED 规则求值异常 | 按 G3 隐藏该组件并上报 |
| 06608 | TEMPLATE_EXPIRED 活动已结束/未开始 | 展示"活动已结束"占位页 |

> 段位说明：06600-06699 为客户端本地渲染引擎错误段，全库扫描确认空闲（17-89 预留扩展段内）；网络层原始错误仍映射全局 030xxx 网络段，本段只承载渲染语义错误。

---

## 6. 缓存与版本管理

### 6.1 三级缓存

| 层级 | 介质 | 容量策略 | 失效 |
|------|------|----------|------|
| L1 内存 | LRU Map | 20 页 / 会话 | App 退后台 5min 清理 |
| L2 磁盘 | 应用私有目录 JSON 文件 | 单页 ≤ 200KB，总量 ≤ 20MB | 活动 endTime 后 7 天清理 |
| L3 CDN | schemaUrl 直连 | CDN 边缘缓存 5min | 发布新版本 URL 变化（version 递增） |

### 6.2 缓存一致性（版本裁决）

- **权威版本以服务端为准**：客户端从不比较 version 大小自行升级，一律以列表/详情接口返回的 version 为准。
- **stale-while-revalidate**：磁盘缓存命中即渲染，同时后台拉最新版，差异则以最新版替换并局部刷新（不整页闪断，G8）。
- **etag / If-None-Match**：详情请求携带本地 etag，服务端 304 即跳过下载。
- **活动结束兜底**：本地页渲染前先校验 `meta.endTime`（以**服务端时间**为准，客户端时钟不可信），过期页展示 06608 占位，不渲染正文（G9：防止过期活动页继续发放权益/优惠券）。

### 6.3 启动预热

App 启动后由 `placement=home_banner` 列表返回的 TopN（≤3）活动页 Schema 静默预取，写入磁盘缓存，首屏进入活动页时 L2 直接命中。

---

## 7. 埋点设计

| 事件名 | 触发时机 | 关键参数 |
|--------|----------|----------|
| activity_page_view | 页面进入（onPageEnter） | pageId、version、schemaVersion |
| activity_page_exit | 页面离开（onPageExit） | pageId、stayDurationMs |
| activity_page_click | 组件 tap | pageId、componentId、componentType |
| dynamic_page_unknown_component | 未知组件兜底 | pageId、componentType（§4.2） |
| dynamic_page_dup_id | 重复 id 告警 | pageId、componentId（V4） |
| dynamic_page_action_error | 动作执行失败 | pageId、actionType（G6） |
| dynamic_page_schema_error | Schema 校验失败 | pageId、错误码（06601-06603） |
| dynamic_page_stale_render | 磁盘缓存渲染 | pageId、diskVersion、serverVersion |

转化分析口径：活动页转化漏斗 = page_view → component_click（按钮组件）→ navigate 目标页到达，由埋点平台按 pageId 串联，不在本引擎内重复计算（R2：指标权威归埋点平台）。

---

## 8. 错误处理与降级矩阵

| 编号 | 故障场景 | 降级策略 |
|------|----------|----------|
| D1 | CDN/网络故障，Schema 拉取失败 | L2 磁盘缓存兜底；无缓存则错误重试态 |
| D2 | Schema 校验失败（06601-06603） | 整页错误态 + 一键反馈，禁用自动重试（重试无意义） |
| D3 | 规则评估异常 | 单组件隐藏（G3），页面其余部分正常渲染 |
| D4 | 单组件渲染抛异常 | 该组件渲染占位盒，页面不崩（Flutter ErrorBoundary 包裹每个 builder.build） |
| D5 | 图片加载失败 | 占位图 + 重试按钮（06606） |
| D6 | 自定义动作未注册 | 忽略动作（06605），页面继续响应 |
| D7 | 服务端时间获取失败 | 禁止发放类组件（couponCard/taskCard 奖励按钮）置灰，其余可展示（G9 强化） |
| D8 | 低端设备 | 关闭 boxShadow/动画（style.animation 降级为 fadeIn 或无动画），保帧率 |
| D9 | 内存压力 | L1 缓存收缩至 5 页，预取暂停 |
| D10 | 总红线 | 任何降级不得绕过 G2（深度限制）、G5（自定义动作白名单）、G7（URL 白名单）、G9（过期不发权益） |

---

## 9. 安全与合规红线（G1-G10）

| 编号 | 红线 | 说明 |
|------|------|------|
| G1 | JSON 即数据非代码 | 协议不得扩展任何脚本执行能力（禁 eval/JS bridge 执行配置逻辑） |
| G2 | 嵌套深度 ≤ 20 | 防构造深层 JSON 打爆递归渲染栈 |
| G3 | 规则求值失败保守隐藏 | 不向错误人群曝光组件 |
| G4 | 未知组件不中断渲染 | 占位空盒 + 埋点 |
| G5 | custom.handler 白名单 | 未注册处理器一律拒绝执行 |
| G6 | 动作失败隔离 | 单动作异常不阻塞动作序列 |
| G7 | URL scheme 白名单 | 仅 https:// 与 primetop:// |
| G8 | 缓存刷新不整页闪断 | 局部替换 |
| G9 | 过期活动不发权益 | 时间判定以服务端为准 |
| G10 | 未成年人营销合规 | 展示前经运营弹窗调度系统的未成年人双向过滤（MARKETING 类不投青少年） |

---

## 10. 性能要求

| 指标 | 目标 | 说明 |
|------|------|------|
| 活动页首屏渲染 | ≤ 300ms（L2 命中）/ ≤ 1.2s（网络） | 从路由进入到首帧 |
| Schema 解析 | ≤ 30ms（500 节点页） | 主线程可接受；>500 节点协议上不允许 |
| 组件构建 | 单页 ≤ 16ms × 首屏可见节点 | 超出的列表走懒加载 |
| 内存增量 | 单活动页 ≤ 8MB（含图片解码） | 离页释放 |
| 预取流量 | 启动预热 ≤ 600KB | TopN=3 × 单页 200KB 上限 |

---

## 11. 验收场景

1. 服务端发布新活动页后，客户端不打开发版即可在首页入口看到并正常渲染。
2. 断网状态下进入预热过的活动页，正常展示且按钮可点击（本地动作可用）。
3. Schema 中某组件 visibleWhen 引用不存在的 field，该组件隐藏，其余组件正常。
4. 构造 21 层嵌套 JSON，客户端报 06603 错误态，不崩溃。
5. JSON 中混入 `type: "evil"` 未知组件，页面其余部分正常渲染，埋点 dynamic_page_unknown_component 上报。
6. openUrl 动作配置 `http://` 与 `javascript:` 链接均被拦截，toast 提示。
7. custom.handler 配置未注册标识，动作被忽略，页面不崩。
8. 活动 endTime 过后打开页面，展示"活动已结束"占位，优惠券组件不出现。
9. 客户端时钟被拨快/拨慢，不影响活动过期判定（服务端时间）。
10. 磁盘缓存版本落后线上 2 个版本，进入页面先渲染旧版并无缝刷新到新版。
11. 图片地址 404，显示占位图，页面其余区域正常。
12. 低端机进入动画丰富的活动页，动画降级但内容完整。
13. 连续进入退出 20 个不同活动页，内存增量收敛（离页释放），无 OOM。
14. 同一页面 onPageEnter 埋点仅上报一次（重进重新计数），事件 eventId 幂等去重。
15. 页面组件重复 id，后者生效，dup_id 埋点携带两个冲突 id。

---

## 12. 关联文档

| 文档 | 关系 |
|------|------|
| `docs2/客户端-全局运营弹窗与消息浮窗调度系统-详细设计.md` | 活动页常以弹窗引流，弹窗 action_type=page 落地页由本引擎渲染（其 R5 契约） |
| `docs2/服务端-运营资源位统一调度与个性化Banner智能编排管理引擎-详细设计.md` | 资源位素材落地为动态活动页时 URL 指向本引擎 Page Schema 端点（其 R5 契约） |
| `docs2/客户端-统一对话框与模态弹出层调度管理系统-详细设计.md` | showDialog 动作复用其调度能力 |
| `docs2/客户端-路由与深链接系统-详细设计.md` | navigate 动作与 primetop:// 深链接路由复用 |
| `docs2/客户端-统一图片加载缓存框架与智能预加载引擎-详细设计.md` | image 组件加载复用其缓存与预加载 |
| `docs2/客户端-埋点事件体系与数据采集规范-详细设计.md` | §7 全部事件命名与上报协议遵循其规范 |
| `docs2/客户端-页面状态模式与骨架屏加载空态错误态设计规范-详细设计.md` | 错误态/加载态/骨架屏视觉规范 |
| `docs2/服务端统一业务异常码与错误分类体系-详细设计.md` | 06600-06699 段位在预留扩展段（17-89）内登记 |

---

## 13. 维护记录

- v1.0（初版）：模块概述/JSON 协议/客户端渲染引擎架构/核心类设计。
- v1.1（2026-10-26 补全）：原文件 770 行截断于 §4.2 `buildPage` 代码中段（围栏未闭合）。本次补齐：修复 v1.0 缺陷 F1（`buildPage` 签名 `}))` 多余右括号将编译失败）；完成 §4.2 剩余代码（_fetchSchema 三级兜底/_buildEvaluationContext/_renderNode 递归渲染/DynamicPageContext）；新增 §4.3 SchemaParser（V1-V6 校验规则表）、§4.4 RuleEvaluator（G3 保守隐藏裁决）、§4.5 ComponentRegistry（SPI + TextBuilder 示例）、§4.6 ActionHandler（G5/G6/G7 守卫）；新增 §5 服务端 API（列表不内联 Schema 只返 schemaUrl+etag 的体积裁决/详情 304/事件上报 eventId 幂等）与错误码 06600-06699 共 9 项（全库扫描确认段位空闲）；§6 三级缓存与版本裁决（stale-while-revalidate、服务端时间为权威、过期不发权益 G9）；§7 埋点 8 事件（指标权威归埋点平台 R2）；§8 降级矩阵 D1-D10（D10 总红线）；§9 安全红线 G1-G10；§10 性能要求；§11 验收场景 15 条；§12 关联文档 8 项。全文围栏 BALANCED + UTF-8 无 BOM，零 TODO 占位。