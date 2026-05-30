# 客户端 - 底部导航栏与 App 主框架 Shell 架构设计

## 1. 概述

### 1.1 文档定位

本文档详细设计 PrimeTop 客户端的 **主框架 Shell** 与 **底部导航栏** 架构，涵盖 Shell Widget 树、底部导航栏组件、Tab 管理、嵌套导航、Badge 角标、跨 Tab 通信、Deep Link 映射、大屏适配、分龄样式策略及页面转场动画。

主框架 Shell 是整个 App 的"骨架"——所有一级页面、弹窗、浮窗、全局覆盖层均挂载于此。该模块直接影响用户体验的连贯性、导航的清晰度和多端多场景的一致性。

### 1.2 与其他文档的关系

| 关联文档 | 关联点 |
|----------|--------|
| 客户端架构与前端框架 | Flutter 项目结构、Riverpod 状态管理、GoRouter 路由 |
| 客户端路由与深链接系统 | GoRouter 路由树、路由守卫、Deep Link 解析 |
| 首页与学习工作台 | 首页 Tab 内容 |
| 分龄UI适配与交互设计规范 | 分龄 Token、组件适配 |
| 客户端-横屏模式与大屏设备适配设计 | Navigation Rail、双栏布局 |
| 客户端手势交互与动画系统 | 页面转场动画、手势导航 |
| 消息与推送服务 | 未读 Badge 触发源 |
| 通知中心与站内消息系统 | 消息未读数 |

### 1.3 设计原则

1. **Tab 独立性**：各 Tab 拥有独立的导航栈，Tab 切换不影响彼此状态。
2. **状态保持**：Tab 切回时恢复离开时的滚动位置与页面状态。
3. **分龄适配**：底部导航栏图标、标签、样式随学段动态调整。
4. **响应式**：小屏用底部导航，大屏用 Navigation Rail 或 Drawer。
5. **可配置**：Tab 顺序、可见性、Badge 来源均可远程配置下发。

---

## 2. 数据结构定义

### 2.1 Tab 配置模型

```dart
/// 底部导航 Tab 配置
@freezed
class NavTabConfig with _$NavTabConfig {
  const factory NavTabConfig({
    required String tabId,           // 唯一标识，如 'home', 'ai_tutor', 'learn', 'mistakes', 'profile'
    required int sortOrder,          // 排序权重，越小越靠前
    required String iconKey,         // 图标资源 key (见 Icons 注册表)
    required String activeIconKey,   // 选中态图标
    required String labelKey,        // 国际化 label key
    required String initialRoute,    // Tab 根路由路径
    required bool enabled,           // 是否启用
    @Default(false) bool requireAuth, // 是否需要登录
    @Default(false) bool requireMembership, // 是否需要会员
    @Default({}) Map<String, dynamic> ageAdaptOverrides, // 分龄覆盖配置
    String? badgeSourceKey,          // Badge 数据来源 key
    @Default(BadgeStyle.dot) BadgeStyle badgeStyle,
  }) = _NavTabConfig;
}
```

### 2.2 Badge 模型

```dart
/// Badge 角标样式
enum BadgeStyle {
  dot,        // 小圆点
  count,      // 数字角标
  text,       // 文字角标 (如 "NEW")
  hidden,     // 不显示
}

/// Badge 数据
@freezed
class NavBadge with _$NavBadge {
  const factory NavBadge({
    required String tabId,
    required BadgeStyle style,
    int? count,             // 当 style == count
    String? text,           // 当 style == text
    @Default(false) bool animated, // 是否显示动画 (如弹跳)
    @Default(0) int priority,      // 优先级(用于多 Badge 源聚合)
  }) = _NavBadge;
}
```

### 2.3 Shell 状态模型

```dart
/// 主框架 Shell 状态
@freezed
class ShellState with _$ShellState {
  const factory ShellState({
    required String activeTabId,          // 当前激活 Tab
    required List<NavTabConfig> tabs,     // Tab 配置列表 (已排序+过滤)
    required Map<String, NavBadge> badges, // tabId -> Badge
    required NavigationStyle navStyle,    // 导航样式 (bottomBar/rail/drawer)
    required bool navBarVisible,          // NavBar 是否可见
    @Default(false) bool isTabletLayout,  // 是否平板布局
    @Default(AgeGroup.unknown) AgeGroup ageGroup, // 当前学段
  }) = _ShellState;
}

/// 导航样式
enum NavigationStyle {
  bottomBar,    // 手机竖屏：底部导航栏
  rail,         // 平板竖屏 / 手机横屏：侧边 Navigation Rail
  drawer,       // 大屏平板横屏：Navigation Drawer
  adaptive,     // 自动跟随屏幕
}
```

### 2.4 Tab 路由栈条目

```dart
/// 单个 Tab 内部的路由栈快照
@freezed
class TabNavStack with _$TabNavStack {
  const factory TabNavStack({
    required String tabId,
    required List<String> routePath,  // 从根路由开始的完整路由路径列表
    required int currentIndex,        // 当前在栈中的索引
    String? savedScrollOffset,        // 离开时保存的滚动偏移
    @Default({}) Map<String, dynamic> pageState, // 页面恢复用状态
  }) = _TabNavStack;
}
```

---

## 3. Widget 树结构

### 3.1 整体 Widget 树

```
MaterialApp
├── ShellScaffold (主框架 Scaffold)
│   ├── Scaffold.body
│   │   └── Stack
│   │       ├── IndexedStack (Tab 页面容器，保持所有 Tab 状态)
│   │       │   ├── [0] HomeTabPage → Navigator('home')
│   │       │   ├── [1] AiTutorTabPage → Navigator('ai_tutor')
│   │       │   ├── [2] LearnTabPage → Navigator('learn')
│   │       │   ├── [3] MistakesTabPage → Navigator('mistakes')
│   │       │   └── [4] ProfileTabPage → Navigator('profile')
│   │       ├── GlobalFloatingAiAssistant  (全局浮窗 AI 助手)
│   │       ├── GlobalOperationPopupLayer  (运营弹窗层)
│   │       └── NotificationOverlayLayer   (通知浮窗层)
│   │
│   ├── Scaffold.bottomNavigationBar
│   │   └── AdaptiveNavBar (自适应导航栏)
│   │       ├── BottomNavBar (手机竖屏)
│   │       ├── NavigationRail (平板竖屏 / 手机横屏)
│   │       └── NavigationDrawer (大屏横屏)
│   │
│   └── Scaffold.drawer (仅大屏横屏)
│       └── AdaptiveNavDrawer
│
└── Overlay (系统级 Dialog、BottomSheet 等)
```

### 3.2 ShellScaffold 实现

```dart
/// 主框架 Shell Scaffold
class ShellScaffold extends ConsumerStatefulWidget {
  const ShellScaffold({super.key});

  @override
  ConsumerState<ShellScaffold> createState() => _ShellScaffoldState();
}

class _ShellScaffoldState extends ConsumerState<ShellScaffold> {
  @override
  Widget build(BuildContext context) {
    final shellState = ref.watch(shellStateProvider);
    final screenInfo = ref.watch(screenInfoProvider);

    // 是否显示底部导航栏 (某些全屏页面隐藏)
    final showNav = shellState.navBarVisible;

    return Scaffold(
      body: Stack(
        children: [
          // IndexedStack 保持所有 Tab 页面状态
          IndexedStack(
            index: shellState.tabs.indexWhere(
              (t) => t.tabId == shellState.activeTabId,
            ),
            children: shellState.tabs.map((tab) {
              return _buildTabPage(tab);
            }).toList(),
          ),

          // 全局浮窗 AI 助手 (仅登录态 + 非全屏页面)
          if (ref.watch(authProvider).isLoggedIn && showNav)
            const GlobalFloatingAiAssistant(),

          // 运营弹窗调度层
          if (showNav)
            const GlobalOperationPopupLayer(),
        ],
      ),

      // 自适应导航栏
      bottomNavigationBar: showNav
          ? AdaptiveNavBar(
              tabs: shellState.tabs,
              activeTabId: shellState.activeTabId,
              badges: shellState.badges,
              ageGroup: shellState.ageGroup,
              navStyle: shellState.navStyle,
              onTabTap: (tabId) => _onTabTap(tabId),
            )
          : null,

      // 大屏侧边 Drawer
      drawer: shellState.isTabletLayout && shellState.navStyle == NavigationStyle.drawer
          ? AdaptiveNavDrawer(
              tabs: shellState.tabs,
              activeTabId: shellState.activeTabId,
              badges: shellState.badges,
              onTabTap: (tabId) => _onTabTap(tabId),
            )
          : null,
    );
  }

  /// 构建单个 Tab 页面 (内嵌独立 Navigator)
  Widget _buildTabPage(NavTabConfig tab) {
    return Navigator(
      key: _tabNavigatorKeys[tab.tabId],
      initialRoute: tab.initialRoute,
      onGenerateRoute: (settings) {
        return _tabRouteFactory.generateRoute(
          settings,
          tabId: tab.tabId,
        );
      },
    );
  }

  void _onTabTap(String tabId) {
    ref.read(shellStateProvider.notifier).switchTab(tabId);
  }
}
```

### 3.3 Tab Navigator Key 管理

```dart
/// Tab Navigator Key 注册表
class TabNavigatorKeyRegistry {
  static final _keys = <String, GlobalKey<NavigatorState>>{};

  /// 获取或创建 Tab 的 Navigator Key
  static GlobalKey<NavigatorState> getOrCreate(String tabId) {
    return _keys.putIfAbsent(tabId, () => GlobalKey<NavigatorState>());
  }

  /// 获取指定 Tab 的 Navigator State
  static NavigatorState? navigatorOf(String tabId) {
    return _keys[tabId]?.currentState;
  }

  /// 销毁所有 Key (用于退出登录或账号切换时重置)
  static void disposeAll() {
    _keys.clear();
  }
}
```

---

## 4. Tab 配置与动态管理

### 4.1 默认 Tab 配置

```dart
/// 默认 Tab 配置 (按 sortOrder 排列)
const kDefaultTabConfigs = <NavTabConfig>[
  NavTabConfig(
    tabId: 'home',
    sortOrder: 0,
    iconKey: 'nav_home',
    activeIconKey: 'nav_home_active',
    labelKey: 'nav_label_home',       // "首页"
    initialRoute: '/home',
    enabled: true,
    badgeSourceKey: 'home_task',      // 今日任务未完成数
    badgeStyle: BadgeStyle.count,
  ),
  NavTabConfig(
    tabId: 'ai_tutor',
    sortOrder: 1,
    iconKey: 'nav_ai',
    activeIconKey: 'nav_ai_active',
    labelKey: 'nav_label_ai_tutor',   // "AI辅导"
    initialRoute: '/ai-tutor',
    enabled: true,
    badgeSourceKey: 'ai_new_features', // AI 新功能提示
    badgeStyle: BadgeStyle.dot,
  ),
  NavTabConfig(
    tabId: 'learn',
    sortOrder: 2,
    iconKey: 'nav_learn',
    activeIconKey: 'nav_learn_active',
    labelKey: 'nav_label_learn',      // "学习"
    initialRoute: '/learn',
    enabled: true,
  ),
  NavTabConfig(
    tabId: 'mistakes',
    sortOrder: 3,
    iconKey: 'nav_mistakes',
    activeIconKey: 'nav_mistakes_active',
    labelKey: 'nav_label_mistakes',   // "错题"
    initialRoute: '/mistakes',
    enabled: true,
    requireAuth: true,
    badgeSourceKey: 'review_due',     // 待复习错题数
    badgeStyle: BadgeStyle.count,
  ),
  NavTabConfig(
    tabId: 'profile',
    sortOrder: 4,
    iconKey: 'nav_profile',
    activeIconKey: 'nav_profile_active',
    labelKey: 'nav_label_profile',    // "我的"
    initialRoute: '/profile',
    enabled: true,
    badgeSourceKey: 'system_notice',  // 系统通知未读数
    badgeStyle: BadgeStyle.dot,
  ),
];
```

### 4.2 分龄 Tab 差异化

```dart
/// 分龄 Tab 配置覆盖策略
///
/// 不同学段可能隐藏、新增或调整 Tab 的默认配置。
class AgeAdaptiveTabResolver {
  /// 根据学段解析最终 Tab 列表
  static List<NavTabConfig> resolve({
    required AgeGroup ageGroup,
    required List<NavTabConfig> defaultTabs,
    required List<NavTabConfig>? remoteTabs, // 远程下发的覆盖配置
  }) {
    // 1. 以默认配置为基础
    var tabs = defaultTabs.where((t) => t.enabled).toList();

    // 2. 应用分龄覆盖
    tabs = _applyAgeOverrides(tabs, ageGroup);

    // 3. 应用远程配置覆盖 (如有)
    if (remoteTabs != null && remoteTabs.isNotEmpty) {
      tabs = _applyRemoteOverrides(tabs, remoteTabs);
    }

    // 4. 排序
    tabs.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

    return tabs;
  }

  static List<NavTabConfig> _applyAgeOverrides(
    List<NavTabConfig> tabs,
    AgeGroup ageGroup,
  ) {
    switch (ageGroup) {
      case AgeGroup.preschool:
        // 幼儿模式：隐藏"错题"和"AI辅导"，增加"启蒙"
        return tabs.map((t) {
          if (t.tabId == 'mistakes') {
            return t.copyWith(enabled: false);
          }
          if (t.tabId == 'ai_tutor') {
            // 幼儿模式简化 AI 辅导入口
            return t.copyWith(
              labelKey: 'nav_label_enlightenment', // "启蒙"
              iconKey: 'nav_enlightenment',
              activeIconKey: 'nav_enlightenment_active',
              initialRoute: '/enlightenment',
            );
          }
          return t;
        }).toList();

      case AgeGroup.primary:
      case AgeGroup.junior:
      case AgeGroup.senior:
        // 小学/初中/高中：保留全部 Tab
        return tabs;

      case AgeGroup.unknown:
      default:
        return tabs;
    }
  }

  static List<NavTabConfig> _applyRemoteOverrides(
    List<NavTabConfig> tabs,
    List<NavTabConfig> remoteTabs,
  ) {
    final remoteMap = {for (var t in remoteTabs) t.tabId: t};
    return tabs.map((t) {
      final remote = remoteMap[t.tabId];
      if (remote != null) {
        // 合并远程配置：远程的 sortOrder/enabled/badgeSourceKey 覆盖本地
        return t.copyWith(
          sortOrder: remote.sortOrder,
          enabled: remote.enabled,
          badgeSourceKey: remote.badgeSourceKey,
        );
      }
      return t;
    }).toList();
  }
}
```

### 4.3 远程配置下发格式

```json
{
  "navConfigVersion": "2026.05.30.001",
  "tabs": [
    {
      "tabId": "home",
      "sortOrder": 0,
      "enabled": true,
      "badgeSourceKey": "home_task",
      "badgeStyle": "count"
    },
    {
      "tabId": "mistakes",
      "sortOrder": 3,
      "enabled": true,
      "badgeSourceKey": "review_due",
      "badgeStyle": "count"
    }
  ],
  "overrides": {
    "preschool": [
      { "tabId": "mistakes", "enabled": false }
    ],
    "senior": [
      { "tabId": "ai_tutor", "sortOrder": 1, "badgeSourceKey": "ai_exam_tips" }
    ]
  }
}
```

---

## 5. Tab 切换与状态管理

### 5.1 ShellState Provider

```dart
/// Shell 状态 Notifier
@riverpod
class ShellStateNotifier extends _$ShellStateNotifier {
  @override
  ShellState build() {
    // 初始化时加载配置
    final ageGroup = ref.watch(userProfileProvider).ageGroup;
    final remoteTabs = ref.watch(remoteNavConfigProvider).valueOrNull;
    final screenInfo = ref.watch(screenInfoProvider);

    final tabs = AgeAdaptiveTabResolver.resolve(
      ageGroup: ageGroup,
      defaultTabs: kDefaultTabConfigs,
      remoteTabs: remoteTabs,
    );

    final navStyle = _resolveNavStyle(screenInfo);

    return ShellState(
      activeTabId: tabs.first.tabId,
      tabs: tabs,
      badges: {},
      navStyle: navStyle,
      navBarVisible: true,
      isTabletLayout: screenInfo.isTablet,
      ageGroup: ageGroup,
    );
  }

  /// 切换 Tab
  void switchTab(String tabId) {
    if (state.activeTabId == tabId) {
      // 同 Tab 再点击：回到 Tab 根路由
      _popToRoot(tabId);
      return;
    }

    // 保存当前 Tab 的路由栈快照
    _saveCurrentTabStack();

    state = state.copyWith(activeTabId: tabId);

    // 恢复目标 Tab 的滚动偏移 (如有)
    _restoreTabScrollOffset(tabId);

    // 埋点
    _trackTabSwitch(tabId);
  }

  /// 更新 Badge
  void updateBadge(String tabId, NavBadge badge) {
    final newBadges = Map<String, NavBadge>.from(state.badges);
    newBadges[tabId] = badge;
    state = state.copyWith(badges: newBadges);
  }

  /// 清除 Tab Badge
  void clearBadge(String tabId) {
    final newBadges = Map<String, NavBadge>.from(state.badges);
    newBadges.remove(tabId);
    state = state.copyWith(badges: newBadges);
  }

  /// 设置 NavBar 可见性 (全屏页面使用)
  void setNavBarVisible(bool visible) {
    state = state.copyWith(navBarVisible: visible);
  }

  /// Pop 当前 Tab 内页面
  bool popCurrentTab() {
    final navKey = TabNavigatorKeyRegistry.getOrCreate(state.activeTabId);
    final nav = navKey.currentState;
    if (nav != null && nav.canPop()) {
      nav.pop();
      return true;
    }
    return false;
  }

  /// 回到 Tab 根路由
  void _popToRoot(String tabId) {
    final navKey = TabNavigatorKeyRegistry.getOrCreate(tabId);
    navKey.currentState?.popUntil((route) => route.isFirst);
  }

  /// 保存当前 Tab 路由栈
  void _saveCurrentTabStack() {
    // 由 TabNavStackRepository 处理
    ref.read(tabNavStackRepositoryProvider).save(
      state.activeTabId,
      _extractCurrentStack(state.activeTabId),
    );
  }

  /// 恢复滚动偏移
  void _restoreTabScrollOffset(String tabId) {
    final stack = ref.read(tabNavStackRepositoryProvider).load(tabId);
    if (stack != null && stack.savedScrollOffset != null) {
      // 通过 ScrollController 恢复偏移
      ScrollOffsetRestorer.restore(tabId, stack.savedScrollOffset!);
    }
  }

  NavigationStyle _resolveNavStyle(ScreenInfo info) {
    if (info.isTablet && info.isLandscape) {
      return NavigationStyle.drawer;
    } else if (info.isTablet || info.isLandscape) {
      return NavigationStyle.rail;
    } else {
      return NavigationStyle.bottomBar;
    }
  }

  void _trackTabSwitch(String tabId) {
    ref.read(analyticsProvider).logEvent(
      name: 'nav_tab_switch',
      params: {
        'from_tab': state.activeTabId,
        'to_tab': tabId,
        'age_group': state.ageGroup.name,
      },
    );
  }
}
```

### 5.2 Tab 切换流程状态机

```
┌──────────────┐
│  IDLE        │ ← 用户无操作
│  (当前Tab活跃) │
└──────┬───────┘
       │ 用户点击其他 Tab
       ▼
┌──────────────┐
│  PRE_SWITCH  │ ← 保存当前 Tab 路由栈快照、滚动偏移
│  (离开当前Tab) │
└──────┬───────┘
       │ 快照完成
       ▼
┌──────────────┐
│  SWITCHING   │ ← 更新 activeTabId，IndexedStack 切换子页面
│  (切换中)     │
└──────┬───────┘
       │ 目标 Tab 页面可见
       ▼
┌──────────────┐
│  RESTORE     │ ← 恢复目标 Tab 滚动偏移、页面状态
│  (恢复目标Tab) │
└──────┬───────┘
       │ 恢复完成
       ▼
┌──────────────┐
│  IDLE        │ ← 新 Tab 活跃
│  (新Tab活跃)  │
└──────────────┘

特殊情况：
- 同 Tab 再点击 → 直接触发 _popToRoot，不经过切换流程
- Tab 未登录需认证 → 先跳转登录页，登录成功后回到目标 Tab
- Tab 需要会员 → 弹出会员引导弹窗
```

### 5.3 IndexedStack vs PageView 选型

| 维度 | IndexedStack | PageView |
|------|-------------|----------|
| 状态保持 | ✅ 所有 Tab 同时存在 | ✅ 默认保持前后 1 页 |
| 内存占用 | 较高 (全部 Tab 同时渲染) | 较低 (按需渲染) |
| 切换动画 | 无动画 (瞬间切换) | 内置滑动动画 |
| 滑动手势 | 不支持横滑切换 | 支持 |
| 适用场景 | Tab 少 (≤5)、需即时切换 | Tab 多、需滑动 |

**选择：IndexedStack**

理由：
- Tab 数量固定 4~5 个，内存可控。
- 即时切换比滑动动画更符合底部导航交互预期。
- 所有 Tab 状态天然保持，无需额外缓存逻辑。
- 配合 `AutomaticKeepAliveClientMixin` 进一步优化子页面生命周期。

---

## 6. 自适应导航栏组件

### 6.1 AdaptiveNavBar 组件

```dart
/// 自适应导航栏：根据 NavigationStyle 自动选择实现
class AdaptiveNavBar extends ConsumerWidget {
  final List<NavTabConfig> tabs;
  final String activeTabId;
  final Map<String, NavBadge> badges;
  final AgeGroup ageGroup;
  final NavigationStyle navStyle;
  final ValueChanged<String> onTabTap;

  const AdaptiveNavBar({
    super.key,
    required this.tabs,
    required this.activeTabId,
    required this.badges,
    required this.ageGroup,
    required this.navStyle,
    required this.onTabTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    switch (navStyle) {
      case NavigationStyle.bottomBar:
        return _BottomNavBar(
          tabs: tabs,
          activeTabId: activeTabId,
          badges: badges,
          ageGroup: ageGroup,
          onTabTap: onTabTap,
        );
      case NavigationStyle.rail:
        return _NavRail(
          tabs: tabs,
          activeTabId: activeTabId,
          badges: badges,
          ageGroup: ageGroup,
          onTabTap: onTabTap,
        );
      case NavigationStyle.drawer:
        // Drawer 模式下不在 bottomNavigationBar 显示
        return const SizedBox.shrink();
      case NavigationStyle.adaptive:
        // 不应到达这里，由 ShellStateNotifier 预先解析
        return const SizedBox.shrink();
    }
  }
}
```

### 6.2 手机底部导航栏

```dart
class _BottomNavBar extends StatelessWidget {
  // ... (同上参数)

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ageTokens = AgeThemeTokens.of(context);

    return Container(
      decoration: BoxDecoration(
        color: ageTokens.navBarBackground,
        border: Border(
          top: BorderSide(
            color: theme.colorScheme.outlineVariant.withOpacity(0.3),
            width: 0.5,
          ),
        ),
        // 安全区域底部 padding
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: ageTokens.navBarHorizontalPadding,
            vertical: ageTokens.navBarVerticalPadding,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: tabs.where((t) => t.enabled).map((tab) {
              final isActive = tab.tabId == activeTabId;
              final badge = badges[tab.tabId];
              return _NavItem(
                tab: tab,
                isActive: isActive,
                badge: badge,
                ageTokens: ageTokens,
                onTap: () => onTabTap(tab.tabId),
              );
            }).toList(),
          ),
        ),
      ),
    );
  }
}

/// 单个导航项
class _NavItem extends StatelessWidget {
  final NavTabConfig tab;
  final bool isActive;
  final NavBadge? badge;
  final AgeThemeTokens ageTokens;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        customBorder: const StadiumBorder(),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // 图标 + Badge
            SizedBox(
              width: ageTokens.navItemIconSize + 8,
              height: ageTokens.navItemIconSize + 8,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  // 图标
                  Center(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 200),
                      child: Icon(
                        isActive
                            ? _resolveIcon(tab.activeIconKey)
                            : _resolveIcon(tab.iconKey),
                        key: ValueKey('${tab.tabId}_$isActive'),
                        size: ageTokens.navItemIconSize,
                        color: isActive
                            ? ageTokens.navItemActiveColor
                            : ageTokens.navItemInactiveColor,
                      ),
                    ),
                  ),

                  // Badge
                  if (badge != null && badge!.style != BadgeStyle.hidden)
                    Positioned(
                      right: -2,
                      top: -2,
                      child: _BadgeWidget(badge: badge!),
                    ),
                ],
              ),
            ),

            SizedBox(height: ageTokens.navItemLabelGap),

            // 标签文字
            AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 200),
              style: TextStyle(
                fontSize: isActive
                    ? ageTokens.navItemActiveLabelSize
                    : ageTokens.navItemInactiveLabelSize,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                color: isActive
                    ? ageTokens.navItemActiveColor
                    : ageTokens.navItemInactiveColor,
              ),
              child: Text(
                _resolveLabel(tab.labelKey),
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
```

### 6.3 Navigation Rail (平板/横屏)

```dart
class _NavRail extends StatelessWidget {
  // ... (同上参数)

  @override
  Widget build(BuildContext context) {
    final ageTokens = AgeThemeTokens.of(context);

    return NavigationRail(
      selectedIndex: tabs.indexWhere((t) => t.tabId == activeTabId),
      onDestinationSelected: (index) {
        final tab = tabs[index];
        onTabTap(tab.tabId);
      },
      backgroundColor: ageTokens.navRailBackground,
      indicatorColor: ageTokens.navItemActiveColor.withOpacity(0.12),
      selectedIconTheme: IconThemeData(
        color: ageTokens.navItemActiveColor,
        size: ageTokens.navItemIconSize,
      ),
      unselectedIconTheme: IconThemeData(
        color: ageTokens.navItemInactiveColor,
        size: ageTokens.navItemIconSize * 0.9,
      ),
      selectedLabelTextStyle: TextStyle(
        color: ageTokens.navItemActiveColor,
        fontSize: ageTokens.navItemActiveLabelSize,
        fontWeight: FontWeight.w600,
      ),
      unselectedLabelTextStyle: TextStyle(
        color: ageTokens.navItemInactiveColor,
        fontSize: ageTokens.navItemInactiveLabelSize,
      ),
      labelType: NavigationRailLabelType.all,
      leading: _buildRailLeading(context),
      trailing: _buildRailTrailing(context),
      destinations: tabs.where((t) => t.enabled).map((tab) {
        final badge = badges[tab.tabId];
        return NavigationRailDestination(
          icon: _buildIconWithBadge(tab, false, badge),
          selectedIcon: _buildIconWithBadge(tab, true, badge),
          label: Text(_resolveLabel(tab.labelKey)),
        );
      }).toList(),
    );
  }
}
```

---

## 7. 分龄样式策略

### 7.1 分龄导航栏 Token

| Token | 幼儿 (preschool) | 小学 (primary) | 初中 (junior) | 高中 (senior) |
|-------|:---:|:---:|:---:|:---:|
| `navBarBackground` | 暖白 #FFF8F0 | 白色 #FFFFFF | 白色 #FFFFFF | 深灰 #F8F9FA |
| `navItemActiveColor` | 橙色 #FF8C42 | 蓝色 #4A90D9 | 蓝紫 #6366F1 | 深蓝 #1E40AF |
| `navItemInactiveColor` | 浅灰 #C4C4C4 | 灰色 #9E9E9E | 灰色 #9E9E9E | 灰色 #6B7280 |
| `navItemIconSize` | 28dp | 24dp | 24dp | 22dp |
| `navItemActiveLabelSize` | 13sp | 12sp | 12sp | 11sp |
| `navItemInactiveLabelSize` | 11sp | 11sp | 11sp | 10sp |
| `navItemLabelGap` | 6dp | 4dp | 4dp | 3dp |
| `navBarHeight` | 72dp | 64dp | 60dp | 56dp |
| `navBarVerticalPadding` | 10dp | 8dp | 6dp | 4dp |
| 选中态效果 | 弹跳放大 | 颜色渐变 | 指示条 | 下划线 |
| 触摸反馈 | 大涟漪 | 标准涟漪 | 标准涟漪 | 轻涟漪 |

### 7.2 幼儿模式特殊处理

```dart
/// 幼儿模式底部导航栏特殊样式
class _PreschoolNavBarDecorator {
  static Widget wrapItem(Widget child, bool isActive) {
    if (!isActive) return child;

    // 选中态：弹跳放大动画
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.9, end: 1.0),
      duration: const Duration(milliseconds: 300),
      curve: Curves.elasticOut,
      builder: (context, scale, child) {
        return Transform.scale(scale: scale, child: child);
      },
      child: child,
    );
  }

  static Widget wrapBar(Widget child, AgeThemeTokens tokens) {
    // 幼儿模式顶部圆角 + 柔和阴影
    return Container(
      decoration: BoxDecoration(
        color: tokens.navBarBackground,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: child,
    );
  }
}
```

---

## 8. Badge 角标系统

### 8.1 Badge 数据流

```
数据源                     聚合层                      展示层
┌─────────────┐
│ 任务服务     │──→ 待完成任务数  ──→ ┌───────────┐    ┌──────────────┐
└─────────────┘                      │           │    │              │
┌─────────────┐                      │  Badge    │───→│ NavBadge    │
│ 错题服务     │──→ 待复习错题数  ──→ │  Aggregator│   │ Widget      │
└─────────────┘                      │           │    │              │
┌─────────────┐                      │           │    │ (dot/count/ │
│ 通知服务     │──→ 未读消息数    ──→ │           │    │  text)      │
└─────────────┘                      └───────────┘    └──────────────┘
┌─────────────┐                           │
│ 运营配置     │──→ 活动提示 "NEW"  ──→    │
└─────────────┘                           │
┌─────────────┐                           │
│ 会员服务     │──→ 权益到期提醒    ──→    │
└─────────────┘                           │
```

### 8.2 BadgeAggregator 实现

```dart
/// Badge 聚合器：收集各数据源，合并为 Tab Badge
@riverpod
class BadgeAggregator extends _$BadgeAggregator {
  @override
  Map<String, NavBadge> build() {
    // 监听各 Badge 数据源
    final taskBadge = ref.watch(_taskBadgeProvider);
    final mistakeBadge = ref.watch(_mistakeBadgeProvider);
    final noticeBadge = ref.watch(_noticeBadgeProvider);
    final aiBadge = ref.watch(_aiFeatureBadgeProvider);

    final badges = <String, NavBadge>{};

    // 聚合策略：同 Tab 多 Badge 源取最高优先级
    for (final badge in [taskBadge, mistakeBadge, noticeBadge, aiBadge]) {
      if (badge == null) continue;
      final existing = badges[badge.tabId];
      if (existing == null || badge.priority > existing.priority) {
        badges[badge.tabId] = badge;
      } else if (existing.style == BadgeStyle.count &&
                 badge.style == BadgeStyle.count) {
        // 同为 count 类型：合并数量
        badges[badge.tabId] = existing.copyWith(
          count: (existing.count ?? 0) + (badge.count ?? 0),
        );
      }
    }

    return badges;
  }
}

// --- 各数据源 Provider ---

@riverpod
NavBadge? _taskBadge(_TaskBadgeRef ref) {
  final pendingCount = ref.watch(todayTaskProvider).pendingCount;
  if (pendingCount <= 0) return null;
  return NavBadge(
    tabId: 'home',
    style: BadgeStyle.count,
    count: pendingCount.clamp(1, 99), // 最大显示 99+
    animated: true,
    priority: 10,
  );
}

@riverpod
NavBadge? _mistakeBadge(_MistakeBadgeRef ref) {
  final dueCount = ref.watch(mistakeReviewProvider).dueCount;
  if (dueCount <= 0) return null;
  return NavBadge(
    tabId: 'mistakes',
    style: BadgeStyle.count,
    count: dueCount.clamp(1, 99),
    priority: 20,
  );
}

@riverpod
NavBadge? _noticeBadge(_NoticeBadgeRef ref) {
  final unreadCount = ref.watch(notificationProvider).unreadCount;
  if (unreadCount <= 0) return null;
  return NavBadge(
    tabId: 'profile',
    style: BadgeStyle.dot,
    priority: 5,
  );
}
```

### 8.3 Badge Widget

```dart
class _BadgeWidget extends StatelessWidget {
  final NavBadge badge;

  const _BadgeWidget({required this.badge});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    Widget child;
    switch (badge.style) {
      case BadgeStyle.dot:
        child = Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: theme.colorScheme.error,
            shape: BoxShape.circle,
          ),
        );
        break;

      case BadgeStyle.count:
        final count = badge.count ?? 0;
        final display = count > 99 ? '99+' : '$count';
        child = Container(
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
          decoration: BoxDecoration(
            color: theme.colorScheme.error,
            borderRadius: BorderRadius.circular(10),
          ),
          constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
          child: Text(
            display,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 10,
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
        );
        break;

      case BadgeStyle.text:
        child = Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(
            color: theme.colorScheme.tertiary,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            badge.text ?? '',
            style: TextStyle(
              color: theme.colorScheme.onTertiary,
              fontSize: 9,
              fontWeight: FontWeight.bold,
            ),
          ),
        );
        break;

      case BadgeStyle.hidden:
        return const SizedBox.shrink();
    }

    // 弹跳动画
    if (badge.animated) {
      child = TweenAnimationBuilder<double>(
        tween: Tween(begin: 0.0, end: 1.0),
        duration: const Duration(milliseconds: 400),
        curve: Curves.elasticOut,
        builder: (context, value, child) {
          return Transform.scale(scale: value, child: child);
        },
        child: child,
      );
    }

    return child;
  }
}
```

---

## 9. 嵌套导航与路由栈管理

### 9.1 Tab 内嵌 Navigator 方案

每个 Tab 拥有独立的 `Navigator`，与 GoRouter 的 Shell Route 配合工作。

```dart
/// GoRouter Shell Route 配置
final router = GoRouter(
  navigatorKey: rootNavigatorKey,
  initialLocation: '/home',
  routes: [
    ShellRoute(
      builder: (context, state, child) {
        return ShellScaffold(child: child);
      },
      routes: [
        // --- Home Tab ---
        GoRoute(
          path: '/home',
          pageBuilder: (context, state) => const NoTransitionPage(
            child: HomeTabPage(),
          ),
          routes: [
            GoRoute(
              path: 'task/:taskId',
              pageBuilder: (context, state) => _buildSlidePage(
                context,
                state,
                TaskDetailPage(taskId: state.pathParameters['taskId']!),
              ),
            ),
            GoRoute(
              path: 'weak-points',
              pageBuilder: (context, state) => _buildSlidePage(
                context, state, const WeakPointsPage(),
              ),
            ),
          ],
        ),

        // --- AI Tutor Tab ---
        GoRoute(
          path: '/ai-tutor',
          pageBuilder: (context, state) => const NoTransitionPage(
            child: AiTutorTabPage(),
          ),
          routes: [
            GoRoute(
              path: 'conversation/:id',
              pageBuilder: (context, state) => _buildSlidePage(
                context,
                state,
                AiConversationPage(
                  conversationId: state.pathParameters['id']!,
                ),
              ),
            ),
          ],
        ),

        // --- Learn Tab ---
        GoRoute(
          path: '/learn',
          pageBuilder: (context, state) => const NoTransitionPage(
            child: LearnTabPage(),
          ),
          routes: [
            GoRoute(
              path: 'chapter/:chapterId',
              pageBuilder: (context, state) => _buildSlidePage(
                context, state,
                ChapterDetailPage(
                  chapterId: state.pathParameters['chapterId']!,
                ),
              ),
            ),
          ],
        ),

        // --- Mistakes Tab ---
        GoRoute(
          path: '/mistakes',
          pageBuilder: (context, state) => const NoTransitionPage(
            child: MistakesTabPage(),
          ),
          routes: [
            GoRoute(
              path: 'detail/:id',
              pageBuilder: (context, state) => _buildSlidePage(
                context, state,
                MistakeDetailPage(
                  mistakeId: state.pathParameters['id']!,
                ),
              ),
            ),
          ],
        ),

        // --- Profile Tab ---
        GoRoute(
          path: '/profile',
          pageBuilder: (context, state) => const NoTransitionPage(
            child: ProfileTabPage(),
          ),
          routes: [
            GoRoute(
              path: 'settings',
              pageBuilder: (context, state) => _buildSlidePage(
                context, state, const SettingsPage(),
              ),
            ),
            GoRoute(
              path: 'membership',
              pageBuilder: (context, state) => _buildSlidePage(
                context, state, const MembershipPage(),
              ),
            ),
          ],
        ),
      ],
    ),

    // --- 全屏页面 (脱离 Shell，无底部导航) ---
    GoRoute(
      path: '/photo-search',
      parentNavigatorKey: rootNavigatorKey,
      pageBuilder: (context, state) => _buildFullScreenPage(
        context, state, const PhotoSearchPage(),
      ),
    ),
    GoRoute(
      path: '/login',
      parentNavigatorKey: rootNavigatorKey,
      pageBuilder: (context, state) => _buildFullScreenPage(
        context, state, const LoginPage(),
      ),
    ),
  ],
);
```

### 9.2 页面转场动画策略

```dart
/// Tab 内二级页面：从右滑入
CustomTransitionPage _buildSlidePage(
  BuildContext context,
  GoRouterState state,
  Widget child,
) {
  return CustomTransitionPage(
    key: state.pageKey,
    child: child,
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      return SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(1.0, 0.0),
          end: Offset.zero,
        ).animate(CurvedAnimation(
          parent: animation,
          curve: Curves.easeOutCubic,
        )),
        child: child,
      );
    },
  );
}

/// 全屏页面：从底部滑入 (模态)
CustomTransitionPage _buildFullScreenPage(
  BuildContext context,
  GoRouterState state,
  Widget child,
) {
  return CustomTransitionPage(
    key: state.pageKey,
    child: child,
    barrierDismissible: false,
    transitionsBuilder: (context, animation, secondaryAnimation, child) {
      return SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0.0, 1.0),
          end: Offset.zero,
        ).animate(CurvedAnimation(
          parent: animation,
          curve: Curves.easeOutCubic,
        )),
        child: child,
      );
    },
  );
}
```

| 场景 | 转场动画 | 时长 | 曲线 |
|------|---------|------|------|
| Tab 切换 | 无动画 (IndexedStack 即时切换) | 0ms | — |
| Tab 内二级页面 | 从右滑入 | 300ms | easeOutCubic |
| 全屏页面 (拍照/登录) | 从底部滑入 | 350ms | easeOutCubic |
| 返回 (系统 Back) | 反向滑出 | 250ms | easeInCubic |
| 幼儿模式转场 | 缩放 + 淡入 | 400ms | elasticOut |

### 9.3 系统 Back 键处理

```dart
/// Back 键拦截器：先处理 Tab 内 pop，再处理 Tab 切换，最后退出 App
class BackButtonInterceptor extends ConsumerWidget {
  final Widget child;
  const BackButtonInterceptor({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;

        final shellState = ref.read(shellStateProvider);

        // 1. 尝试 pop 当前 Tab 内页面
        if (shellState.navBarVisible) {
          final navKey = TabNavigatorKeyRegistry.getOrCreate(
            shellState.activeTabId,
          );
          final nav = navKey.currentState;
          if (nav != null && nav.canPop()) {
            nav.pop(result);
            return;
          }
        }

        // 2. 如果不在首页 Tab，切回首页
        if (shellState.activeTabId != 'home') {
          ref.read(shellStateProvider.notifier).switchTab('home');
          return;
        }

        // 3. 在首页 Tab + 根路由 → 退出 App
        // Android: moveTaskToBack
        // iOS: 不需要处理 (系统自然退出)
        if (Platform.isAndroid) {
          SystemNavigator.pop();
        }
      },
      child: child,
    );
  }
}
```

---

## 10. Deep Link 到 Tab 映射

### 10.1 URL 到 Tab 路由映射表

| Deep Link 路径 | 目标 Tab | Tab 内路由 |
|---------------|---------|-----------|
| `/home` | home | /home |
| `/home/task/:id` | home | /home/task/:id |
| `/ai-tutor` | ai_tutor | /ai-tutor |
| `/ai-tutor/conv/:id` | ai_tutor | /ai-tutor/conv/:id |
| `/learn` | learn | /learn |
| `/learn/chapter/:id` | learn | /learn/chapter/:id |
| `/mistakes` | mistakes | /mistakes |
| `/mistakes/detail/:id` | mistakes | /mistakes/detail/:id |
| `/profile` | profile | /profile |
| `/photo-search` | (全屏，脱离 Shell) | /photo-search |
| `/notifications` | profile | /profile/notifications |
| `/report/:id` | profile | /profile/report/:id |
| `/membership/pay` | profile | /profile/membership |

### 10.2 Deep Link 处理流程

```
┌───────────────┐
│  Deep Link     │
│  收到 URL      │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  GoRouter      │
│  解析路由      │
└───────┬───────┘
        │
        ▼
┌───────────────┐     否
│  路由是否在    │────────→ 全屏页面 (使用 rootNavigatorKey)
│  Shell 内?     │
└───────┬───────┘
        │ 是
        ▼
┌───────────────┐
│  路由守卫检查  │ ← 登录态、会员权益、版本兼容
└───────┬───────┘
        │ 通过
        ▼
┌───────────────┐
│  解析目标 Tab  │ ← 根据 URL 前缀匹配 tabId
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  switchTab()   │ → 切到目标 Tab
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  Tab 内导航    │ → push 到具体子路由
│  到目标页面    │
└───────────────┘
```

---

## 11. 全屏页面与 NavBar 显隐

### 11.1 NavBar 显隐策略

```dart
/// 需要 NavBar 的页面 (Shell 内路由)
/// 不需要 NavBar 的页面 (全屏路由)
/// 由 ShellRoute 自动管理：
///   - Shell 路由内的页面 → NavBar 可见
///   - 使用 rootNavigatorKey 的路由 → 脱离 Shell，NavBar 不可见

/// 动态控制 (Shell 内页面也需要临时隐藏 NavBar 的场景)
extension NavBarVisibility on BuildContext {
  /// 临时隐藏 NavBar (如视频全屏播放)
  void hideNavBar() {
    // 通过 Provider 通知 Shell 隐藏
    ProviderScope.containerOf(this)
        .read(shellStateProvider.notifier)
        .setNavBarVisible(false);
  }

  /// 恢复 NavBar
  void showNavBar() {
    ProviderScope.containerOf(this)
        .read(shellStateProvider.notifier)
        .setNavBarVisible(true);
  }
}
```

### 11.2 全屏页面场景清单

| 页面 | 进入方式 | NavBar | 返回方式 |
|------|---------|--------|---------|
| 拍照搜题 | 首页快捷入口/Tab AI | ❌ 隐藏 | 手动关闭/返回 |
| 登录注册 | 路由守卫重定向 | ❌ 隐藏 | 登录成功自动跳转 |
| 支付页 | 会员中心 | ❌ 隐藏 | 支付完成/取消 |
| 视频全屏 | 多媒体播放器 | ❌ 隐藏 | 退出全屏 |
| 考试模式 | 考试模拟 | ❌ 隐藏 | 考试结束 |
| 草稿纸全屏 | 答题页面 | ❌ 隐藏 | 收起草稿纸 |

---

## 12. 跨 Tab 通信

### 12.1 跨 Tab 事件总线

```dart
/// 跨 Tab 事件定义
sealed class CrossTabEvent {
  String get targetTabId;
}

/// 跳转到指定 Tab 的指定路由
class NavigateToTabEvent extends CrossTabEvent {
  @override
  final String targetTabId;
  final String routePath;
  final Map<String, String>? queryParams;

  NavigateToTabEvent({
    required this.targetTabId,
    required this.routePath,
    this.queryParams,
  });
}

/// 刷新指定 Tab 的数据
class RefreshTabEvent extends CrossTabEvent {
  @override
  final String targetTabId;
  final String? reason;

  RefreshTabEvent({required this.targetTabId, this.reason});
}

/// 显示 Tab Badge 提示
class ShowTabBadgeEvent extends CrossTabEvent {
  @override
  final String targetTabId;
  final NavBadge badge;

  ShowTabBadgeEvent({required this.targetTabId, required this.badge});
}
```

### 12.2 使用示例

```dart
// 在 AI 辅导页面，用户点击"加入错题本"后跳转到错题 Tab 查看
void onAddToMistakeBook(String mistakeId) {
  ref.read(crossTabEventBusProvider).fire(
    NavigateToTabEvent(
      targetTabId: 'mistakes',
      routePath: '/mistakes/detail/$mistakeId',
    ),
  );
}

// 练习完成后，刷新首页的今日任务状态
void onPracticeComplete() {
  ref.read(crossTabEventBusProvider).fire(
    const RefreshTabEvent(targetTabId: 'home', reason: 'practice_complete'),
  );
}
```

---

## 13. 平板与大屏适配

### 13.1 导航样式自适应规则

```
屏幕宽度 < 600dp (手机竖屏)     → BottomNavBar
600dp ≤ 宽度 < 840dp (平板竖屏) → NavigationRail (紧凑模式)
840dp ≤ 宽度 (平板横屏/大屏)    → NavigationDrawer (展开模式)
```

### 13.2 Navigation Rail 布局

```
┌────┬──────────────────────────────┐
│ Rail│                              │
│ ┌──┐│                              │
│ │🏠││    Tab Content Area          │
│ └──┘│                              │
│ ┌──┐│                              │
│ │🤖││                              │
│ └──┘│                              │
│ ┌──┐│                              │
│ │📚││                              │
│ └──┘│                              │
│ ┌──┐│                              │
│ │❌││                              │
│ └──┘│                              │
│ ┌──┐│                              │
│ │👤││                              │
│ └──┘│                              │
└────┴──────────────────────────────┘
```

### 13.3 Navigation Drawer + 双栏布局

```
┌─────────┬──────────────┬──────────────────┐
│ Drawer  │   List Pane  │   Detail Pane    │
│         │              │                  │
│ 🏠 首页 │  章节列表    │   章节详情       │
│ 🤖 AI   │              │                  │
│ 📚 学习 │              │                  │
│ ❌ 错题 │              │                  │
│ 👤 我的 │              │                  │
│         │              │                  │
│ ─────── │              │                  │
│ ⚙️ 设置 │              │                  │
└─────────┴──────────────┴──────────────────┘
```

```dart
/// 双栏布局检测
class DualPaneBuilder extends ConsumerWidget {
  final WidgetBuilder listPaneBuilder;
  final WidgetBuilder detailPaneBuilder;
  final Widget detailPlaceholder;
  final String? selectedDetailId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final screenInfo = ref.watch(screenInfoProvider);

    if (screenInfo.isTablet && screenInfo.isLandscape && screenInfo.width >= 840) {
      // 双栏模式
      return Row(
        children: [
          SizedBox(
            width: 320,
            child: listPaneBuilder(context),
          ),
          const VerticalDivider(width: 1),
          Expanded(
            child: selectedDetailId != null
                ? detailPaneBuilder(context)
                : detailPlaceholder,
          ),
        ],
      );
    } else {
      // 单栏模式
      if (selectedDetailId != null) {
        return detailPaneBuilder(context);
      } else {
        return listPaneBuilder(context);
      }
    }
  }
}
```

---

## 14. 性能优化

### 14.1 IndexedStack 懒加载

```dart
/// 懒加载 IndexedStack：仅在 Tab 首次被选中时构建
class LazyIndexedStack extends StatefulWidget {
  final int index;
  final List<Widget> children;

  const LazyIndexedStack({
    super.key,
    required this.index,
    required this.children,
  });

  @override
  State<LazyIndexedStack> createState() => _LazyIndexedStackState();
}

class _LazyIndexedStackState extends State<LazyIndexedStack> {
  final _builtIndices = <int>{};

  @override
  void initState() {
    super.initState();
    _builtIndices.add(widget.index); // 构建初始 Tab
  }

  @override
  void didUpdateWidget(LazyIndexedStack oldWidget) {
    super.didUpdateWidget(oldWidget);
    _builtIndices.add(widget.index); // 记录新选中的 Tab
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: List.generate(widget.children.length, (i) {
        final visible = i == widget.index;
        return Visibility(
          visible: visible,
          maintainState: _builtIndices.contains(i),
          child: _builtIndices.contains(i)
              ? widget.children[i]
              : const SizedBox.shrink(),
        );
      }),
    );
  }
}
```

### 14.2 图片资源优化

```dart
/// 导航图标预加载
class NavIconPreloader {
  static Future<void> preload(BuildContext context) async {
    await Future.wait([
      precacheImage(AssetImage('assets/icons/nav_home.webp'), context),
      precacheImage(AssetImage('assets/icons/nav_home_active.webp'), context),
      precacheImage(AssetImage('assets/icons/nav_ai.webp'), context),
      precacheImage(AssetImage('assets/icons/nav_ai_active.webp'), context),
      precacheImage(AssetImage('assets/icons/nav_learn.webp'), context),
      precacheImage(AssetImage('assets/icons/nav_learn_active.webp'), context),
      precacheImage(AssetImage('assets/icons/nav_mistakes.webp'), context),
      precacheImage(AssetImage('assets/icons/nav_mistakes_active.webp'), context),
      precacheImage(AssetImage('assets/icons/nav_profile.webp'), context),
      precacheImage(AssetImage('assets/icons/nav_profile_active.webp'), context),
    ]);
  }
}
```

### 14.3 性能预算

| 指标 | 目标值 |
|------|--------|
| Tab 切换延迟 | < 16ms (1帧) |
| 首次 Tab 构建 | < 100ms |
| Badge 更新 | < 50ms |
| Shell 初始化 | < 200ms |
| IndexedStack 内存增量 (每 Tab) | < 5MB |
| 导航栏渲染帧数 | 稳定 60fps |

---

## 15. 错误处理

### 15.1 Tab 加载失败

```dart
/// Tab 页面加载失败兜底
class TabPageErrorBoundary extends StatelessWidget {
  final String tabId;
  final Widget child;

  const TabPageErrorBoundary({
    super.key,
    required this.tabId,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return ErrorBoundary(
      onError: (error, stackTrace) {
        // 上报错误
        FirebaseCrashlytics.instance.recordError(
          error,
          stackTrace,
          reason: 'Tab page load failed: $tabId',
        );
      },
      fallbackBuilder: (context, error) => _TabErrorPage(
        tabId: tabId,
        error: error,
        onRetry: () {
          // 重建 Tab 页面
          final navKey = TabNavigatorKeyRegistry.getOrCreate(tabId);
          navKey.currentState?.pushReplacementNamed('/');
        },
      ),
      child: child,
    );
  }
}

/// Tab 错误页面
class _TabErrorPage extends StatelessWidget {
  final String tabId;
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.error_outline,
            size: 48,
            color: Theme.of(context).colorScheme.error.withOpacity(0.6),
          ),
          const SizedBox(height: 16),
          Text(
            '页面加载遇到问题',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: 8),
          Text(
            '请检查网络连接后重试',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 24),
          FilledButton.tonal(
            onPressed: onRetry,
            child: const Text('重新加载'),
          ),
        ],
      ),
    );
  }
}
```

### 15.2 远程配置加载失败

```dart
/// 远程导航配置加载失败 → 使用本地默认配置
@riverpod
Future<List<NavTabConfig>?> remoteNavConfig(RemoteNavConfigRef ref) async {
  try {
    final response = await ref.read(apiClientProvider).get(
      '/api/v1/config/nav',
    );
    final configs = (response.data['tabs'] as List)
        .map((e) => NavTabConfig.fromJson(e))
        .toList();
    return configs;
  } catch (e) {
    // 降级：使用本地默认配置
    return null;
  }
}
```

---

## 16. API 接口设计

### 16.1 导航配置获取

```
GET /api/v1/config/nav
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `age_group` | string | 否 | 学段，不传则使用用户当前学段 |
| `app_version` | string | 否 | 客户端版本号 |

**响应：**

```json
{
  "code": 0,
  "data": {
    "version": "2026.05.30.001",
    "tabs": [
      {
        "tabId": "home",
        "sortOrder": 0,
        "enabled": true,
        "badgeSourceKey": "home_task",
        "badgeStyle": "count"
      },
      {
        "tabId": "mistakes",
        "sortOrder": 3,
        "enabled": true,
        "badgeSourceKey": "review_due",
        "badgeStyle": "count"
      }
    ],
    "overrides": {
      "preschool": [
        { "tabId": "mistakes", "enabled": false }
      ]
    },
    "expiredAt": "2026-06-06T00:00:00Z"
  }
}
```

### 16.2 Badge 数据聚合

Badge 数据不通过单独 API 获取，而是由各业务模块的 Provider 分别提供，客户端本地聚合。各模块已有的 API：

| 数据源 | API | 取值 |
|--------|-----|------|
| 今日任务 | `GET /api/v1/tasks/today` | `pending_count` |
| 待复习错题 | `GET /api/v1/mistakes/review/due` | `total` |
| 未读通知 | `GET /api/v1/notifications/unread-count` | `count` |
| AI 新功能 | `GET /api/v1/config/feature-flags` | `ai_new_feature.badge` |

---

## 17. 埋点事件

| 事件名 | 触发时机 | 关键参数 |
|--------|---------|---------|
| `nav_tab_switch` | 切换 Tab | `from_tab`, `to_tab`, `age_group`, `trigger` (tap/deeplink/notification) |
| `nav_tab_double_tap` | 同 Tab 二次点击 (回根) | `tab_id`, `stack_depth` |
| `nav_badge_appear` | Badge 首次出现 | `tab_id`, `badge_style`, `badge_count` |
| `nav_badge_tap` | 点击带 Badge 的 Tab | `tab_id`, `badge_style` |
| `nav_fullscreen_enter` | 进入全屏页面 (隐藏 NavBar) | `page`, `source_tab` |
| `nav_fullscreen_exit` | 退出全屏页面 | `page`, `duration_sec` |
| `nav_back_pressed` | 系统返回键 | `tab_id`, `stack_depth`, `action` (pop/switch_home/exit) |

---

## 18. 测试策略

### 18.1 单元测试

```dart
group('AgeAdaptiveTabResolver', () {
  test('preschool hides mistakes tab', () {
    final tabs = AgeAdaptiveTabResolver.resolve(
      ageGroup: AgeGroup.preschool,
      defaultTabs: kDefaultTabConfigs,
      remoteTabs: null,
    );
    expect(tabs.any((t) => t.tabId == 'mistakes'), isFalse);
  });

  test('senior keeps all tabs', () {
    final tabs = AgeAdaptiveTabResolver.resolve(
      ageGroup: AgeGroup.senior,
      defaultTabs: kDefaultTabConfigs,
      remoteTabs: null,
    );
    expect(tabs.length, equals(kDefaultTabConfigs.where((t) => t.enabled).length));
  });

  test('remote overrides sortOrder', () {
    final remote = [
      NavTabConfig(tabId: 'home', sortOrder: 2, ...),
    ];
    final tabs = AgeAdaptiveTabResolver.resolve(
      ageGroup: AgeGroup.primary,
      defaultTabs: kDefaultTabConfigs,
      remoteTabs: remote,
    );
    expect(tabs.first.tabId, isNot('home'));
  });
});

group('BadgeAggregator', () {
  test('merges count badges for same tab', () {
    // ...
  });

  test('highest priority wins for different styles', () {
    // ...
  });

  test('badge count capped at 99', () {
    // ...
  });
});
```

### 18.2 Widget 测试

```dart
testWidgets('BottomNavBar renders all enabled tabs', (tester) async {
  await tester.pumpWidget(
    testApp(
      ShellScaffold(),
      overrides: [
        shellStateProvider.overrideWith(() => ShellState(
          activeTabId: 'home',
          tabs: kDefaultTabConfigs.where((t) => t.enabled).toList(),
          badges: {},
          navStyle: NavigationStyle.bottomBar,
          navBarVisible: true,
          isTabletLayout: false,
          ageGroup: AgeGroup.primary,
        )),
      ],
    ),
  );

  expect(find.text('首页'), findsOneWidget);
  expect(find.text('AI辅导'), findsOneWidget);
  expect(find.text('学习'), findsOneWidget);
  expect(find.text('错题'), findsOneWidget);
  expect(find.text('我的'), findsOneWidget);
});

testWidgets('tapping tab switches active tab', (tester) async {
  // ...
});

testWidgets('badge count displays correctly', (tester) async {
  // ...
});

testWidgets('double tap on active tab pops to root', (tester) async {
  // ...
});
```

### 18.3 集成测试场景

| 场景 | 验证点 |
|------|--------|
| 冷启动到首页 | 首页 Tab 正确渲染，NavBar 可见，Badge 正确 |
| Tab 依次切换 | 所有 Tab 可正常切换，状态保持 |
| Tab 内导航 → 切 Tab → 回到原 Tab | 原 Tab 路由栈和滚动位置恢复 |
| Deep Link 打开 | 正确跳转到目标 Tab 的子页面 |
| 推送通知点击 | 跳转到对应 Tab |
| 横竖屏切换 | NavBar 在 BottomBar/Rail 间正确切换 |
| 幼儿模式 | 错题 Tab 隐藏，AI 辅导变为启蒙 |
| 全屏页面 (拍照) | NavBar 隐藏，返回后恢复 |
| 同 Tab 二次点击 | pop 到根路由 |
| 系统返回键 | 正确处理 Tab 内 pop / 切回首页 / 退出 |
| 内存压力后恢复 | Tab 状态正确恢复 |
| 低端设备性能 | Tab 切换 < 16ms |

---

## 19. 版本兼容与演进

### 19.1 客户端版本兼容

| 版本 | 变更 | 兼容策略 |
|------|------|---------|
| v1.0 | 4 个 Tab (首页/AI/学习/我的) | 基础版本 |
| v1.1 | 新增错题 Tab | 远程配置启用 `mistakes` Tab |
| v1.5 | 幼儿模式启用启蒙 Tab 替换 AI 辅导 | 客户端硬编码 + 远程覆盖 |
| v2.0 | 教师 Tab (教师角色) | 角色判断动态添加 |
| v2.5 | 可自定义 Tab 顺序 | 远程配置 `sortOrder` |

### 19.2 新增 Tab 接入清单

1. 在 `kDefaultTabConfigs` 中添加 `NavTabConfig`
2. 创建 Tab 根页面 Widget (含独立 Navigator)
3. 在 GoRouter Shell Route 中添加路由定义
4. 注册 Badge 数据源 (如有)
5. 添加分龄覆盖策略 (如需)
6. 添加 Widget 测试和集成测试
7. 更新 Deep Link 映射表
8. 添加埋点事件
9. 通知服务端更新远程配置 Schema
