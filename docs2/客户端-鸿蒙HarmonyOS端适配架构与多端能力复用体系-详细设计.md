# 客户端-鸿蒙HarmonyOS端适配架构与多端能力复用体系 - 详细设计

> 来源设计：《启硕-PrimeTop-全学段AI辅助学习软件项目设计文档》§8.3 客户端架构、§12.4 产品端迭代、§13 非功能性需求
> 关联细化文档：《客户端架构与前端框架》《客户端Flutter平台通道与原生能力桥接层》《客户端-多渠道打包与国内应用商店上架交付体系》《服务端-多厂商推送通道适配层与国内厂商推送平台集成引擎》《应用内购与商店支付集成层》《服务端-统一认证授权与令牌管理体系》《客户端-远程配置同步与本地配置管理引擎》《Web端与小程序端架构适配设计》

---

## 1. 模块概述

### 1.1 背景

原设计文档将客户端平台定义为 Android / iOS，并在产品端迭代中规划了 Web 与小程序扩展。当前 `docs2` 已完成 Web 端与小程序端架构适配设计、国内安卓多渠道打包上架体系，但 **HarmonyOS NEXT（纯血鸿蒙，下文统称 ohos）作为 2025-2026 年国内增量最大的终端平台尚未有任何细化文档**。教育类应用在华为渠道（含学生平板、学习机、手机）的用户占比持续上升，且华为应用市场对教育类目、未成年人保护、隐私合规有独立审核口径，需要一套完整的端侧适配架构设计来指导开发。

本项目客户端主干为 Flutter。ohos 端不能直接复用官方 Flutter 发行版，需要引入社区维护的 `flutter_flutter`（ohos 分支）+ `flutter_ohos` engine，并将现有 PlatformChannel 原生实现（Android Kotlin / iOS Swift）扩展出 ArkTS 实现。

### 1.2 设计目标

1. **一套 Dart 业务代码**：ohos 端与 Android/iOS 共享 100% 的 Dart 业务层与 95% 以上的 UI 层，平台差异收敛到桥接层与少量条件编译。
2. **能力对齐**：ohos 端 V1 对齐 Android 端 P0/P1 功能（AI 对话、拍照搜题、同步课堂、错题本、练习测评、支付、推送、家长管控）。
3. **通道可探测可降级**：所有原生能力通过能力注册表探测，缺失时走既定降级路径，不阻塞核心学习流程。
4. **上架合规**：满足华为应用市场教育类目上架要求（隐私、未成年人、实名、备案、内容安全）。
5. **工程可持续**：ohos 分支与官方 Flutter 主干的差异可管理、可升级，补丁集中维护。

### 1.3 范围

**包含**：技术路线选型、工程结构、平台通道桥接层、华为账号/IAP/推送/媒体/安全等 Kit 适配、服务端接口扩展、关键流程状态机、错误处理与降级、上架合规、测试与监控、里程碑。

**不包含**：Dart 业务层功能实现（见各功能模块文档）、鸿蒙原生子系统（如车机、手表、智慧屏）、原子化服务/元服务卡片（列入 V2 演进预留）、鸿蒙 PC 端。

### 1.4 与现有文档关系

| 现有文档 | 本文档对其扩展点 |
| --- | --- |
| 客户端Flutter平台通道与原生能力桥接层 | 新增 ohos ArkTS 实现（Implementor 第三实现分支） |
| 多渠道打包与上架交付体系 | 新增华为应用市场（ohos 包 .app）渠道与提审流程 |
| 多厂商推送通道适配层 | 新增 Push Kit 通道实现与 token 生命周期 |
| 应用内购与商店支付集成层 | 新增华为 IAP Kit（In-App Purchases）渠道与服务端验签 |
| 统一认证授权与令牌管理体系 | 新增华为账号（Account Kit）身份源 `huawei_oid` |
| 远程配置同步与本地配置管理引擎 | 新增 ohos 能力开关与灰度维度 |

---

## 2. 技术路线选型

### 2.1 候选方案对比

| 方案 | 描述 | 优势 | 劣势 | 结论 |
| --- | --- | --- | --- | --- |
| A. ArkTS 全原生重写 | 用 ArkUI/ArkTS 重写整个 App | 平台体验最佳、Kit 全量原生 | 双主干维护成本极高（约等于重建客户端团队），功能对齐周期 >12 个月，长周期内功能漂移不可控 | 否决 |
| B. Flutter ohos 分支 | 社区 `flutter_flutter` ohos 分支 + ArkTS 原生壳与能力模块 | 复用全部 Dart 业务代码，通道模型与现有桥接层一致；社区方案已在多个大型 App 验证 | engine 非官方维护，需锁定版本并维护补丁；部分插件需自行适配 | **推荐** |
| C. WebView 套壳 H5 | 复用 Web 端 | 成本最低 | 拍照、语音、支付、推送、性能、审核（应用市场对壳应用限制）均不达标 | 否决 |
| D. 混合（B + 局部原生页） | 主干 Flutter，个别高性能/强 Kit 依赖页面用 ArkTS 原生页 | 灵活 | 初期即引入双 UI 栈复杂度 | 作为 B 的补充手段预留，V1 不启用 |

### 2.2 推荐方案：Flutter 主干 + ohos engine 分支 + ArkTS 能力壳

```
┌─────────────────────────────────────────────────┐
│                Dart 业务层（共享）                 │
│  AI对话/拍题/同步课堂/错题/测评/支付UI/家长中心 ...   │
├─────────────────────────────────────────────────┤
│            平台抽象层 platform_kit（共享）          │
│  AuthService / PayService / PushService /         │
│  MediaService / SecurityService / DeviceService  │
├──────────────┬──────────────┬───────────────────┤
│ android impl │   ios impl   │  ohos impl (本文档) │
│ (Kotlin)     │   (Swift)    │  (ArkTS + HMS Kit) │
├──────────────┴──────────────┴───────────────────┤
│  Flutter Engine: official │ official │ ohos 分支  │
└─────────────────────────────────────────────────┘
```

- Dart 侧通过现有 `platform_kit` 抽象接口调用，ohos 端注册同名 MethodChannel 的 ArkTS 实现。
- 原生侧代码组织为 **HAR（Harmony Archive）模块**：`bridge_ohos`（通道注册与实现）、`pay_hms`、`push_hms`、`auth_hms`、`media_ohos` 等，按 Kit 隔离，禁止互相依赖。
- UI 层仅在「状态栏/导航栏沉浸、返回手势、多窗口」等少量点通过 `Platform.isOhos`（自定义 platform override）分支处理。

### 2.3 分阶段演进策略

| 阶段 | 目标 | 内容 |
| --- | --- | --- |
| 阶段0（2 周） | 工程跑通 | ohos engine 接入、空白壳启动、CI 出包、账号匿名登录 |
| 阶段1（6 周） | 核心闭环 | AI 对话（SSE）、同步课堂、练习测评、错题本、拍照搜题（相机+相册）、华为账号登录 |
| 阶段2（6 周） | 商业化与触达 | 华为 IAP（会员订阅+增值服务）、Push Kit、家长中心、分享深链 |
| 阶段3（持续） | 体验增强 | 折叠屏/平板适配、防截屏、应用锁生物识别、桌面卡片（预留）、性能专项 |

### 2.4 多端功能覆盖矩阵（ohos V1 对齐目标）

| 能力 | Android | iOS | ohos(V1) | 说明 |
| --- | --- | --- | --- | --- |
| AI 对话/SSE 流式 | ✅ | ✅ | ✅ | 纯 Dart，http 客户端走 dio |
| 拍照搜题 OCR | ✅ | ✅ | ✅ | 相机通道 + 服务端 OCR |
| 语音对话（ASR/TTS） | ✅ | ✅ | ✅（云端回退） | 端侧 Kit 仅作 V2 增强，V1 走云端 |
| 华为账号一键登录 | ➖ | ➖ | ✅ | ohos 独有身份源 |
| 微信/QQ 登录 | ✅ | ✅ | ⚠️ 依赖微信 ohos SDK 可用性 | 不可用时降级华为账号+手机号 |
| 支付（会员/增值） | 微信/支付宝/IAP | IAP | **华为 IAP** | 渠道包内禁用微信支付引导 |
| 推送 | 厂商通道 | APNs | **Push Kit** | 统一接入适配层 |
| 应用锁生物识别 | ✅ | ✅ | ✅ | Universal Keystore Kit |
| 防截屏 | ✅ | ✅ | ✅ | 窗口标志位 |
| 桌面小组件 | ✅ | ✅ | V2 预留 | ArkTS 卡片与 Dart 数据桥接 |
| 热更新（代码推送） | ✅ | ⚠️ 受限 | ❌ V1 不做 | 见 §8.5 边界说明 |

---

## 3. 工程结构与构建体系

### 3.1 Monorepo 目录结构

```
primetop-app/
├── lib/                          # Dart 业务代码（共享）
│   ├── platform_kit/             # 平台抽象层
│   │   ├── src/
│   │   │   ├── auth/  pay/  push/  media/  security/  device/
│   │   └── registry.dart         # CapabilityRegistry（含 ohos 探测）
├── android/  ios/                # 既有平台
├── ohos/                         # ★ 新增：HarmonyOS 工程
│   ├── AppScope/
│   │   ├── app.json5             # 应用级配置（bundleName、图标、版本）
│   │   └── resources/
│   ├── entry/                    # 主 HAP
│   │   ├── src/main/ets/
│   │   │   ├── entryability/EntryAbility.ets
│   │   │   ├── flutter/FlutterEntryAbility.ets
│   │   │   └── pages/            # 原生过渡页（隐私弹窗等）
│   │   ├── src/main/resources/
│   │   └── build-profile.json5
│   ├── har/                      # ★ 原生能力 HAR 模块
│   │   ├── bridge_ohos/          # 通道注册中心 + 通用通道
│   │   ├── auth_hms/             # Account Kit
│   │   ├── pay_hms/              # IAP Kit
│   │   ├── push_hms/             # Push Kit
│   │   ├── media_ohos/           # 相机/相册
│   │   └── security_ohos/        # 防截屏/生物识别/OAID
│   ├── build-profile.json5       # 多 product（渠道）签名配置
│   └── hvigorfile.ts
├── tools/ohos/
│   ├── engine-patches/           # ohos engine 补丁集（版本锁定）
│   └── verify_ohos_env.sh
└── pubspec.yaml
```

### 3.2 应用与渠道配置（build-profile.json5 关键片段）

```json5
// ohos/build-profile.json5
{
  "app": {
    "signingConfigs": [
      { "name": "release", "material": { "certpath": "env:OHOS_CERT", "storePassword": "env:OHOS_STORE_PWD" } }
    ],
    "products": [
      {
        "name": "default",                    // 华为应用市场渠道
        "signingConfig": "release",
        "defineParams": { "CHANNEL_ID": "\"huawei_market\"" }
      },
      {
        "name": "internal",                   // 内测分发
        "signingConfig": "release",
        "defineParams": { "CHANNEL_ID": "\"ohos_internal\"", "API_BASE": "\"https://ohos-internal.primetop.cn\"" }
      }
    ],
    "buildModeSet": [ { "name": "debug" }, { "name": "release" } ]
  },
  "modules": [
    { "name": "entry", "srcPath": "./entry", "targets": [ { "name": "default" } ] },
    { "name": "bridge_ohos", "srcPath": "./har/bridge_ohos" },
    { "name": "auth_hms", "srcPath": "./har/auth_hms" },
    { "name": "pay_hms", "srcPath": "./har/pay_hms" },
    { "name": "push_hms", "srcPath": "./har/push_hms" }
  ]
}
```

- `AppScope/app.json5` 中 `bundleName` 固定为 `cn.primetop.harmony`（与安卓包名解耦，便于华为账号 unionId 映射）。
- 版本号 `versionCode/versionName` 与 Android 大版本对齐策略见 §3.3。

### 3.3 ohos engine 分支管理

- 锁定社区 `flutter_flutter` ohos 分支版本（如 `dev-3.7.x-ohos` / `3.22-ohos`，以接入时社区稳定版为准），在 `tools/ohos/ENGINE_VERSION` 文件中记录 commit hash。
- 自有补丁集中存放 `tools/ohos/engine-patches/*.patch`，禁止散落修改；每次升级 engine 版本需回归 §12.4 基线。
- Flutter 插件适配：现有 pub 依赖中涉及原生实现的插件，逐一替换为 ohos 支持版本（社区 `flutter_ohos` 插件仓库）或自写通道；不满足的在 `platform_kit` 层做 Dart 侧替代实现（如 `path_provider` → 自有 `storage_ohos` 通道）。

### 3.4 CI/CD 流水线扩展

在现有 `客户端-多渠道打包` 文档定义的流水线上追加 ohos job：

```yaml
# .github/workflows/ohos-build.yml（要点节选）
jobs:
  build-ohos:
    runs-on: [self-hosted, windows, devkit]        # 需预装 DevEco Studio 命令行工具
    steps:
      - uses: actions/checkout@v4
      - name: Setup Flutter(ohos)
        run: |
          git clone https://gitee.com/openharmony-sig/flutter_flutter.git -b $(type tools\ohos\ENGINE_VERSION)
          set PATH=%CD%\flutter_flutter\bin;%PATH%
          flutter doctor -v
      - name: Build HAP
        run: |
          flutter build hap --release --local-engine-src-path %OHOS_ENGINE_SRC%
          hvigorw assembleHap --mode module -p product=default -p buildMode=release
      - name: Integrity check        # 包完整性/权限/隐私清单静态校验
        run: python tools/ohos/verify_app.py ohos/entry/build/default/outputs/default/
      - uses: actions/upload-artifact@v4
        with: { name: primetop-ohos, path: "**/*.app" }
```

### 3.5 工具链版本策略

| 项 | 策略 |
| --- | --- |
| DevEco Studio | 跟随华为当前稳定版；CI 固定版本号，升级需过回归 |
| HarmonyOS SDK API | 目标 `releaseType: Release`、API 版本以覆盖 90% 存量设备为下限，`compatibleSdkVersion` 不低于上架要求的最低 API |
| hvigor | 与 DevEco 内置版本一致，不单独升级 |
| 最低设备版本 | 上架时按华为应用市场当前准入门槛设定，写入 `app.json5` 并同步 README |

---

## 4. 平台通道桥接层设计

### 4.1 总体分层

沿用《客户端Flutter平台通道与原生能力桥接层》的通道命名规范 `primetop.kit.<domain>`，ohos 端新增实现：

```
Dart: AuthService.loginWithHuawei()
  └→ MethodChannel('primetop.kit.auth').invokeMethod('huaweiLogin', args)
        └→ [ohos] bridge_ohos ChannelRegistry 分发 → auth_hms HuaweiAuthChannel
              └→ Account Kit (authorizationWithHuaweiID)
        └→ [android] ...Existing Kotlin Impl...
```

### 4.2 能力注册与探测机制

ohos 端启动时上报能力清单，Dart 侧据此 + 远程配置共同决定功能可用性：

```dart
// lib/platform_kit/registry.dart（共享代码，ohos 相关分支）
class Capability {
  final String name;        // 'huawei_login' | 'hms_iap' | 'push_kit' | ...
  final bool available;
  final String? reason;     // 不可用原因：NOT_INSTALLED / KIT_ERROR / DISABLED_BY_CONFIG
  const Capability(this.name, this.available, this.reason);
}

class CapabilityRegistry {
  static final _cache = <String, Capability>{};

  static Future<void> init() async {
    final raw = await MethodChannel('primetop.kit.capability')
        .invokeMethod<List<dynamic>>('listCapabilities');
    for (final e in raw ?? const []) {
      final c = Capability(e['name'], e['available'] as bool, e['reason']);
      _cache[c.name] = c;
    }
    // 远程配置覆盖：运营可强制关闭某能力（如 IAP 灰度期）
    final flags = await RemoteConfig.getJson('ohos_capability_overrides');
    flags?.forEach((k, v) {
      if (_cache.containsKey(k)) _cache[k] = Capability(k, v == true, 'REMOTE');
    });
  }

  static bool isAvailable(String name) => _cache[name]?.available ?? false;
}
```

```typescript
// ohos/har/bridge_ohos/src/main/ets/registry/CapabilityChannel.ets
import { AbilityAware, FlutterAbility, MethodCall, MethodResult, MethodChannel } from '@ohos/flutter_ohos';
import { kitAvailability } from '../capability/KitAvailability';

export class CapabilityChannel implements AbilityAware {
  private channelName = 'primetop.kit.capability';

  onAttachToAbility(ability: FlutterAbility): void {
    const channel = new MethodChannel(ability.dartEngine.dartExecutor.binaryMessenger, this.channelName);
    channel.setMethodCallHandler({
      onMethodCall: (call: MethodCall, result: MethodResult) => {
        if (call.method === 'listCapabilities') {
          result.success(kitAvailability.snapshot()); // [{name,available,reason},...]
        } else {
          result.notImplemented();
        }
      }
    });
  }
}
```

### 4.3 核心通道清单（ohos 实现）

| 通道 | 方法 | 方向 | ohos 实现（HAR / Kit） | 缺失时降级 |
| --- | --- | --- | --- | --- |
| primetop.kit.capability | listCapabilities | D→N | bridge_ohos | 返回空清单，全部能力视为不可用 |
| primetop.kit.auth | huaweiLogin / logout | D↔N | auth_hms / Account Kit | 提示改用手机号验证码登录 |
| primetop.kit.pay | queryProducts / purchase / restore | D↔N | pay_hms / IAP Kit | 隐藏订阅入口，引导客服/其他端购买 |
| primetop.kit.push | getToken / setAlias / deleteToken | D↔N | push_hms / Push Kit | 推送不可达，站内信+本地提醒兜底 |
| primetop.kit.media | takePhoto / pickImage / compress | D↔N | media_ohos / Camera Picker | 拍题入口置灰，提示相册导入或换设备 |
| primetop.kit.security | setScreenshotBlock / biometricAuth / getOAID | D↔N | security_ohos | 防截屏跳过；应用锁降级 PIN 码 |
| primetop.kit.device | deviceInfo / networkState / vibrate | D↔N | bridge_ohos 通用 | 使用 Dart 侧默认值 |
| primetop.kit.app | openMarketPage / getAppVersion / setPrivacyConsent | D↔N | bridge_ohos 通用 | 版本检查提示手动更新 |
| primetop.kit.audio | startRecord / stopRecord / playTTS | D↔N | media_ohos | 语音输入禁用，TTS 走服务端音频 URL |

### 4.4 线程与异步模型

- ArkTS 侧所有 Kit 调用在主线程发起；耗时操作（图片压缩、文件 IO）放入 `@ohos.taskpool`，完成后回主线程 `result.success()`。
- MethodChannel 返回必须保证一次性（success/error 恰好一个）；超时由 Dart 侧统一 15s Timeout 兜底并按 §10 分类处理。

---

## 5. 核心原生能力适配详细设计

### 5.1 华为账号认证（Account Kit）

- **模式**：授权码模式。客户端拉起华为账号授权 → 获取 `authorizationCode`（服务端换取 access token）与本地 `unionID/openID` 预览。
- **身份源编码**：`huawei_oid`（服务端 identity_provider 枚举新增）。
- **绑定关系**：`unionID` 为主键映射平台 `user_id`；同一华为账号在华为手机/平板登录自动归并。
- **未成年人约束**：华为账号侧实名年龄 <18 时，登录后强制进入未成年人模式（防沉迷、内容分级），由服务端账号服务下发 `minor_profile`。
- **取消授权**：用户在华为设置中解绑 → 服务端通过 Account Kit 账号注销事件（若配置）或下次登录 401 触发本地登出。

### 5.2 支付（华为 IAP Kit）

对齐《应用内购与商店支付集成层》的商品体系，新增渠道 `hms_iap`：

- **商品映射**：服务端 `sku_mapping` 表扩展 `channel='hms_iap'` 列，商品 ID 规范 `pt_<type>_<plan>_hms`（华为后台要求唯一）。订阅类商品（会员连续包月/季/年）与消耗型（积分包/增值次数包）均接入。
- **购买流程**：queryProducts → 服务端预下单（生成 `orderNo` + `channelOrderId` 预留）→ 拉起 IAP 支付页 → `purchaseResultIntent` 返回 `purchaseToken` + 签名数据 → 客户端上送 → **服务端验签发货**（禁止客户端确认发货逻辑作为发货依据）。
- **服务端验签**：调用 IAP 服务端接口校验 `purchaseToken` 有效性、金额、商品 ID 与订单一致性；详见 §9.5。
- **掉单补偿**：客户端启动与「我的-订单」页触发 `restorePurchases`（已购查询/未完结订单查询），未发货订单进入补偿队列；服务端另有对账任务兜底（每小时拉取渠道账单比对），双重保障。
- **合规约束**：华为渠道包内不展示微信/支付宝支付引导（应用市场审核要求）；价格展示跟随华为 IAP 后台配置币种/地区。

### 5.3 推送（Push Kit）

复用《服务端-多厂商推送通道适配层》抽象，新增 `hms_push` 通道实现：

- 客户端启动（隐私同意后）调用 Push Kit 获取 `pushToken` → 上报 `POST /v1/push/register`（channel=hms_push）。
- 服务端下发时按通道适配层路由；通知点击由 `EntryAbility.onNewWant` 捕获 `uri` 转交 Flutter 路由（深链规范复用《客户端路由与深链接系统》）。
- token 失效（如设备恢复出厂）以 90001 类错误回执，服务端标记失效并等待客户端重注册。

### 5.4 媒体能力（拍照搜题）

- 相机：使用系统 Camera/Launcher 拉起拍照（`startAbilityForResult`），返回沙箱 URI → 通道内复制到应用沙箱 → Dart 读取。V1 不自建取景器（降低审核与成本），拍题页提供「拍摄引导框」为 Dart 层叠加提示。
- 相册：PhotoViewPicker 选图，注意申请 `READ_IMAGEVIDEO` 权限的最小化说明文案。
- 压缩：`@ohos.image` 创建 PixelMap 缩放 + JPEG 编码（质量 80，长边 1600px），taskpool 执行，与 Android 端对齐输出规格。

### 5.5 语音能力（ASR/TTS）

V1 策略：**云端回退优先**。录音用 `@ohos.multimedia.audio` AVRecorder（AAC），上传走现有语音服务（ASR/TTS 服务端）；TTS 播放走服务端合成音频 URL + ohos `AVPlayer`。端侧 SDK（Core Speech Kit）在 V2 评估接入以优化弱网体验。

### 5.6 安全能力

- **防截屏**：进入答案/付费内容页调用 `window.setWindowPrivacyMode(true)`（需 `ohos.permission.PRIVACY_WINDOW`），离开还原；与 Android `FLAG_SECURE` 页面清单共用服务端下发配置。
- **应用锁**：Universal Keystore Kit / 用户认证（PIN/指纹/人脸），校验通过仅解锁本地会话，不存储生物特征。
- **设备标识**：仅使用 `OAID`（广告标识符）替代 Android OAID 字段用于风控/统计，用户关闭个性化广告时尊重并置空；AAID 每次安装重置，仅用于匿名设备指纹辅助。

### 5.7 网络与弱网

- 复用 Dart 侧 dio 拦截器体系（弱网重试、SSE 断线续传）；ohos 原生层仅提供 `networkState`（蜂窝/WiFi/无网）与 HttpDNS 可选开关（V2）。
- 证书校验：系统证书链 + 服务端公钥固定（certificate pinning 列表随远程配置更新，含灰度回滚开关）。

### 5.8 多设备与折叠屏（V2 预留）

- `AppScope` 配置 `deviceTypes: ["phone","tablet","2in1"]` 平板先行。
- 折叠屏展开事件（`foldStatus` 变化）通过 `primetop.kit.device` 通道通知 Dart，触发响应式断点重建（与《横屏模式与大屏设备适配设计》共享断点常量）。

---

## 6. 数据结构定义

### 6.1 客户端侧 DTO（Dart，共享）

```dart
class OhosDeviceInfo {
  final String model;        // 设备型号
  final String osVersion;    // HarmonyOS 版本
  final int apiVersion;      // SDK API 版本
  final String oaid;         // 可为空（用户关闭个性化）
  final String deviceType;   // phone | tablet | 2in1
  final String channel;      // 渠道号，来自 defineParams
}

class ChannelResult<T> {
  final bool ok;
  final int code;            // 见 §10.1 错误分类
  final String message;
  final T? data;
}
```

### 6.2 服务端扩展表

```sql
-- 1) 设备注册表扩展（沿用多端设备管理表，新增平台枚举值 'ohos'，补充字段）
ALTER TABLE user_device ADD COLUMN ohos_oaid VARCHAR(64) NULL COMMENT '华为OAID，用户关闭个性化时为空';
ALTER TABLE user_device ADD COLUMN ohos_api_version INT NULL COMMENT 'HarmonyOS SDK API版本';
-- platform 枚举扩展: android | ios | ohos | web | miniapp

-- 2) 华为账号绑定表
CREATE TABLE user_identity_huawei (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT NOT NULL,
  union_id      VARCHAR(64) NOT NULL COMMENT '华为unionID',
  open_id       VARCHAR(64) NOT NULL COMMENT '应用级openID',
  realname_age  INT NULL COMMENT '华为侧实名年龄，用于未成年人模式判定参考',
  status        TINYINT NOT NULL DEFAULT 1 COMMENT '1绑定 0解绑',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_union (union_id),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='华为账号身份绑定';

-- 3) SKU 映射扩展（应用内购文档的 sku_mapping 新增渠道行）
-- channel 枚举扩展: appstore | googleplay | hms_iap | wechat_pay ...
INSERT INTO sku_mapping (sku_code, channel, channel_product_id, price_local)
VALUES ('vip_monthly', 'hms_iap', 'pt_vip_m_hms', NULL), ...

-- 4) 推送 token 表扩展（channel 枚举新增 'hms_push'，无需 DDL，仅枚举注册）
```

### 6.3 关键 DTO（服务端 ↔ 客户端）

```json
// POST /v1/auth/huawei/login 请求
{ "authorizationCode": "ST-x1y2z3...", "deviceId": "d-8827", "deviceInfo": { "platform": "ohos", "osVersion": "5.0.3", "model": "HUAWEI Mate 70", "oaid": "", "channel": "huawei_market" } }
// 响应（成功）
{ "code": 0, "data": { "userId": 10086, "accessToken": "...", "refreshToken": "...", "isNewUser": true, "minorProfile": { "isMinor": false } } }

// POST /v1/pay/hms/verify 请求
{ "orderNo": "PT2026081510000233", "purchaseToken": "OTk...", "productId": "pt_vip_m_hms", "signature": "..." }
```

---

## 7. API 接口设计（服务端扩展）

统一沿用《服务端统一响应封装与分页查询规范》《服务端统一业务异常码与错误分类体系》。

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/v1/auth/huawei/login` | POST | 授权码换 token，绑定/创建账号 |
| `/v1/auth/huawei/bind` | POST | 已登录用户绑定华为账号 |
| `/v1/auth/huawei/unbind` | POST | 解绑（需保留至少一种登录方式校验） |
| `/v1/pay/hms/products` | GET | 查询 hms_iap 渠道商品（服务端缓存华为后台价格） |
| `/v1/pay/hms/verify` | POST | IAP 订单验签 + 发货（幂等） |
| `/v1/pay/hms/restore` | POST | 已购恢复（未完结订单补偿） |
| `/v1/push/register` | POST | 复用现有接口，channel=hms_push |
| `/v1/app/boot-config` | GET | 启动配置：新增 `ohosCapabilityOverrides`、`upgradePolicy.ohos` |
| `/v1/app/upgrade/check` | GET | 入参 platform=ohos，返回应用市场升级引导 + 强更标记 |

**错误码扩展（新增段位 61xx 华为通道）**

| 错误码 | 场景 | 客户端处理 |
| --- | --- | --- |
| 6101 | 授权码无效/过期 | 重新拉起华为授权 |
| 6102 | 华为账号已被其他用户绑定 | 引导账号申诉/换绑流程 |
| 6103 | IAP 验签失败 | 提示稍后重试，订单进入补偿观察 |
| 6104 | 商品映射缺失 | 上报监控，隐藏该商品 |
| 6105 | pushToken 无效 | 清除本地 token，静默重注册 |
| 6199 | 华为服务未知异常 | 走对应能力降级路径 |

---

## 8. 关键流程与状态流转

### 8.1 ohos 端首次启动引导状态机

```
[冷启动] → NATIVE_SPLASH(原生页, 校验隐私协议版本)
   → PRIVACY_CONSENT(未同意: 原生弹窗, 同意后写 preference 并上报)
   → FLUTTER_BOOT(加载引擎, 拉取 boot-config)
   → MODE_DETECT(未成年人模式判定: 华为实名/家长中心配置)
   → LOGIN(华为一键登录 / 手机号 / 游客)
   → PROFILE_SETUP(学段·年级·教材版本)
   → HOME
```

状态持久化于本地 preference，二次启动直接 `FLUTTER_BOOT → HOME`；`PRIVACY_CONSENT` 版本升级时重新弹出（复用协议版本管理服务）。

### 8.2 华为账号登录状态机

```
IDLE → AUTHORIZING(拉起授权页)
  ├─ 用户取消 → CANCELLED(返回登录页, 不提示错误)
  ├─ 授权成功 → EXCHANGING(code→服务端)
  │     ├─ 6101/网络错误 → RETRY(最多2次, 指数退避) → FAILED(降级手机号登录引导)
  │     ├─ isNewUser → PROFILE_SETUP
  │     └─ 老用户 → token 落地 → HOME
  └─ 设备未登录华为账号 → NO_HUAWEI_ACCOUNT(引导系统登录或手机号登录)
```

### 8.3 IAP 购买-发货-补偿状态机（渠道侧视角）

```
ORDER_CREATED(服务端预下单)
 → PAYING(拉起IAP收银台)
    ├─ 支付成功回调(purchaseToken) → VERIFYING(服务端验签)
    │     ├─ 通过 → DELIVERED(权益发货, 幂等) → 结束
    │     ├─ 验签失败(6103) → PENDING_OBSERVE(补偿观察, 客服介入兜底)
    │     └─ 网络失败 → PENDING_VERIFY(本地持久化, 启动/订单页重试)
    ├─ 用户取消 → CANCELLED(订单关闭)
    └─ 支付失败 → FAILED(可重试)
PENDING_VERIFY/PENDING_OBSERVE 每次启动触发 restore → 服务端对账兜底(每小时)
```

### 8.4 pushToken 生命周期

`UNREGISTERED → REQUESTING(Kit申请) → REGISTERED(服务端确认) → (失效错误) → EXPIRED → REQUESTING`；隐私未同意前禁止申请 token。

### 8.5 热更新边界说明

ohos 端 **V1 不启用** Flutter 代码推送（动态下发代码在华为审核口径下高风险）。版本更新走应用市场整包升级：`upgrade/check` 返回 `forceUpdate` 时原生层拦截并跳转应用市场详情页（`store` 深链）。功能开关差异全部通过远程配置与服务端功能门控消化。

---

## 9. 关键代码示例

### 9.1 ArkTS：Flutter 承载与通道注册总装

```typescript
// ohos/entry/src/main/ets/flutter/FlutterEntryAbility.ets
import { FlutterAbility, FlutterEngine } from '@ohos/flutter_ohos';
import { CapabilityChannel } from 'bridge_ohos';
import { HuaweiAuthChannel } from 'auth_hms';
import { HmsPayChannel } from 'pay_hms';
import { PushChannel } from 'push_hms';

export default class FlutterEntryAbility extends FlutterAbility {
  configureFlutterEngine(engine: FlutterEngine): void {
    const channels = [
      new CapabilityChannel(),
      new HuaweiAuthChannel(this.context),
      new HmsPayChannel(this.context),
      new PushChannel(this.context),
    ];
    channels.forEach(c => c.onAttachToAbility(this));
  }
}
```

### 9.2 ArkTS：华为账号登录通道

```typescript
// ohos/har/auth_hms/src/main/ets/HuaweiAuthChannel.ets（示意，Kit API 以当前 HMS 文档为准）
import { authentication } from '@kit.AccountKit';
import { MethodCall, MethodResult, MethodChannel } from '@ohos/flutter_ohos';

export class HuaweiAuthChannel {
  constructor(private ctx: Context) {}

  onAttachToAbility(ability: FlutterAbility): void {
    new MethodChannel(ability.dartEngine.dartExecutor.binaryMessenger, 'primetop.kit.auth')
      .setMethodCallHandler({ onMethodCall: this.dispatch.bind(this) });
  }

  private async dispatch(call: MethodCall, result: MethodResult): Promise<void> {
    try {
      switch (call.method) {
        case 'huaweiLogin': {
          // 请求华为账号授权（静默+显式组合，scope 以服务端所需为准）
          const auth = await authentication.execute(this.ctx, new authentication.HuaweiIDProvider()
            .addScope(apiConstant.Scope.NOVEL_PROFILE) // 以实际 scope 常量为准
            .setAuthorizationCodeRequestMode());
          result.success({
            authorizationCode: auth.authorizationCode,
            unionIdPreview: auth.unionId ?? ''
          });
          break;
        }
        case 'logout': { /* 本地清理由 Dart 完成，透传成功 */ result.success(true); break; }
        default: result.notImplemented();
      }
    } catch (e) {
      // e.code: 1002=未登录华为账号, 1003=用户取消 ... 映射见 §10.1
      result.error('AUTH_KIT_' + (e.code ?? 'UNKNOWN'), e.message ?? '', null);
    }
  }
}
```

### 9.3 Dart：登录用例与降级

```dart
// lib/platform_kit/src/auth/huawei_auth_service.dart
class HuaweiAuthService {
  static const _ch = MethodChannel('primetop.kit.auth');

  Future<AuthResult> login() async {
    if (!CapabilityRegistry.isAvailable('huawei_login')) {
      return AuthResult.fallback(reason: 'huawei_login unavailable');
    }
    try {
      final raw = await _ch.invokeMapMethod<String, dynamic>('huaweiLogin')
          .timeout(const Duration(seconds: 15));
      final resp = await api.post('/v1/auth/huawei/login', data: {
        'authorizationCode': raw!['authorizationCode'],
        'deviceId': DeviceId.current,
        'deviceInfo': DeviceInfoCollector.collect(),
      });
      return AuthResult.success(TokenPair.fromJson(resp.data['data']));
    } on PlatformException catch (e) {
      if (e.code == 'AUTH_KIT_1003') return AuthResult.cancelled();      // 用户取消：静默
      if (e.code == 'AUTH_KIT_1002') return AuthResult.fallback(reason: 'no_huawei_account');
      Crashlytics.record('huawei_login', e);
      return AuthResult.fallback(reason: e.code);                       // 其余：降级手机号登录
    } on TimeoutException {
      return AuthResult.fallback(reason: 'timeout');
    }
  }
}
```

### 9.4 ArkTS：Push Kit 接入

```typescript
// ohos/har/push_hms/src/main/ets/PushChannel.ets（示意）
import { pushService } from '@kit.PushKit';

async getToken(): Promise<string> {
  // 入参为应用级 appId/ clientId，以 AGC 后台配置为准
  const token = await pushService.getToken();
  return token;
}
// 通知点击：EntryAbility.onNewWant(want) 解析 want.uri → 通道事件流转发 Dart 路由
```

### 9.5 服务端：华为 IAP 验签发货（Go，幂等）

```go
// server/payment/hms/verify.go
func (s *HmsPayService) VerifyAndDeliver(ctx context.Context, req VerifyReq) error {
	order, err := s.orderRepo.GetByNoForUpdate(ctx, req.OrderNo) // 行锁防并发
	if err != nil { return err }
	if order.Status == StatusDelivered { return nil }              // 幂等出口

	// 1) 向华为 IAP 服务端校验 purchaseToken（证书+签名+金额+商品一致性）
	vr, err := s.hmsClient.VerifyPurchase(ctx, req.PurchaseToken, req.ProductId)
	if err != nil { return ErrHmsVerify }                          // -> 6103
	if vr.PurchaseState != Purchased || vr.ProductID != order.ChannelProductId {
		return ErrHmsMismatch                                     // -> 6103，订单转 PENDING_OBSERVE
	}

	// 2) 发货（权益+流水，复用统一计费中心）
	if err := s.billing.Deliver(ctx, order, vr.Receipt); err != nil {
		return fmt.Errorf("deliver: %w", err)                      // 事务回滚，等待补偿重试
	}
	order.Status = StatusDelivered
	return s.orderRepo.Save(ctx, order)
}
```

---

## 10. 错误处理与降级策略

### 10.1 通道调用异常分类

| 类别 | 判定 | 处理 |
| --- | --- | --- |
| 用户取消 | PlatformException code `*_1003` / 业务 cancelled | 静默返回，不弹错、不上报错误级日志 |
| Kit 未安装/未登录 | `*_1002` / NOT_INSTALLED | 能力位标记不可用，本次会话不再尝试，走降级路径 |
| 参数/映射错误 | 6104 / notImplemented | 上报 Error 级监控（多为发版事故），UI 引导反馈 |
| 网络类 | TimeoutException / 6199 | 指数退避重试 ≤2 次，失败后降级 |
| 安全类 | 验签失败/证书固定失败 | 终止请求，提示网络环境异常，上报安全事件 |

### 10.2 能力缺失降级矩阵（摘要）

| 能力缺失 | 用户可见表现 | 核心流程影响 |
| --- | --- | --- |
| 华为登录 | 登录页隐藏该按钮，保留手机号/验证码 | 无 |
| IAP | 订阅页显示「请在手机端购买或联系客服」+ 二维码引导 | 收敛，不阻塞 |
| Push | 无通知，站内信红点 + 打开 App 时本地提醒 | 降级 |
| 相机 | 拍题入口置灰，引导相册/其他端 | 部分降级 |
| 防截屏 | 静默跳过 | 无 |
| 生物识别 | 应用锁退化为 PIN | 无 |

### 10.3 全局兜底

Flutter 引擎启动失败（engine 补丁不兼容等）连续 2 次 → 原生层进入「安全模式页」（展示缓存最后学习内容入口受限 + 反馈渠道），并上报 P0 监控。

---

## 11. 安全与合规

1. **上架资质**：华为应用市场教育类目 → 软著、ICP 备案/许可、未成年人保护说明、内容审核承诺函；上架前按《多渠道打包》文档的提审状态机复用流程，新增华为审核驳回原因库。
2. **权限最小化**：`INTERNET`、`READ_IMAGEVIDEO`（相册导入拍题图）、`PRIVACY_WINDOW`（防截屏）、麦克风（语音问答，运行时申请+用途弹窗）；不申请通讯录/位置/短信。
3. **隐私清单**：`module.json5` 与隐私政策逐条对应；SDK 收集清单包含 ohos engine 与 HMS Kit（Account/IAP/Push），随版本更新同步。
4. **未成年人**：实名年龄 <18 → 强制未成年人模式（时长/内容/消费限制沿用防沉迷与未成年人保护机制文档，不因平台差异放宽）；华为渠道家长可通过系统「数字健康」叠加限制。
5. **数据安全**：本地敏感数据（token、错题草稿）使用 `@ohos.security.asset` 或加密 preference 存储；日志脱敏复用客户端日志规范。

---

## 12. 测试策略

1. **单元/组件测试**：`platform_kit` 抽象层用 Fake 实现覆盖（共享，与端无关）；ohos 降级矩阵逐条写参数化用例。
2. **通道契约测试**：以 §4.3 清单为契约，Dart 侧用 MockChannel 校验参数/返回 schema；ArkTS 侧用 hvigor 单测覆盖分发逻辑。
3. **真机矩阵**：覆盖 手机（直板/折叠）、平板、低内存机型（≥4G）、API 最低版本与最新版本；hdc 自动化冒烟（登录→拍题→练习→支付沙盒）。
4. **多端一致性回归**：以《MVP-P0功能验收标准》场景集为基线，ohos 端全量跑通并比对截图（差异化白名单除外）。
5. **性能基线**：冷启动 ≤2.5s（中端机）、AI 对话首 token ≤1.8s（网络正常）、列表滑动帧率 ≥55fps、崩溃率 <0.05%。

---

## 13. 监控与埋点

- 渠道维度 `platform=ohos` 注入全量埋点（复用埋点事件体系文档，不新增事件模型）。
- 新增看板指标：ohos 启动耗时分布、能力缺失率（按能力分组）、华为登录成功率、IAP 验签失败率、pushToken 注册率、engine 崩溃（native crash 单独归类）。
- 灰度放量：华为应用市场「分阶段发布」+ 服务端功能门控双层控制，观察 48h 无 P0 后递进。

---

## 14. 里程碑与排期

| 里程碑 | 交付物 | 验收 |
| --- | --- | --- |
| M0（W2） | 工程跑通+CI 出包 | 内测包可安装启动、匿名登录可用 |
| M1（W8） | 核心学习闭环 | P0 场景全通过、真机矩阵达标 |
| M2（W14） | 商业化+触达 | IAP 沙盒/正式验签通过、推送到达率 ≥90% |
| M3（W18） | 提审上架 | 华为应用市场过审、灰度 10% 放量 |

---

## 15. 风险与应对

| 风险 | 等级 | 应对 |
| --- | --- | --- |
| ohos engine 社区版本滞后/缺陷 | 高 | 版本锁定+补丁集中；阻塞缺陷走原生通道绕过；评估商业支持 |
| 华为 Kit 审核口径变化 | 中 | 提审前跑合规 checklist；预留 2 周缓冲；驳回原因库沉淀 |
| 插件生态缺口 | 中 | platform_kit 自建通道替代；缺口清单每双周更新 |
| 微信 ohos SDK 可用性不确定 | 低 | 登录/分享走华为账号+手机号降级，矩阵已定义 |
| 双端功能漂移 | 中 | CI 强制多端一致性回归；差异必须走特性开关而非硬编码 |

---

*文档版本：v1.0（2026-08-15）｜作者：PrimeTop 设计文档细化助手 ｜ 关联原始设计：§8.3 / §12.4 / §13*
