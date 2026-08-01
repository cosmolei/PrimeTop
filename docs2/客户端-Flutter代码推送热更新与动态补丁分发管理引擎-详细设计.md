# 客户端-Flutter 代码推送热更新与动态补丁分发管理引擎 - 详细设计

> 模块负责人：客户端工程组  
> 最后更新：2026-08-01  
> 状态：待评审

---

## 目录

1. [概述](#1-概述)
2. [整体架构](#2-整体架构)
3. [补丁生产管线](#3-补丁生产管线)
4. [服务端补丁管理服务](#4-服务端补丁管理服务)
5. [客户端补丁引擎](#5-客户端补丁引擎)
6. [数据结构定义](#6-数据结构定义)
7. [API 接口设计](#7-api-接口设计)
8. [关键代码实现](#8-关键代码实现)
9. [补丁生命周期状态机](#9-补丁生命周期状态机)
10. [安全与完整性校验](#10-安全与完整性校验)
11. [灰度发布策略](#11-灰度发布策略)
12. [回滚与应急处理](#12-回滚与应急处理)
13. [监控与告警](#13-监控与告警)
14. [错误码定义](#14-错误码定义)
15. [性能优化](#15-性能优化)
16. [与现有系统集成](#16-与现有系统集成)

---

## 1. 概述

### 1.1 问题定义

PrimeTop 客户端基于 Flutter 构建，覆盖 Android 与 iOS 双端。常规版本更新依赖应用商店审核流程，存在以下问题：

| 问题 | 影响 |
|------|------|
| **审核周期长** | iOS App Store 审核 1-3 天，Android 各商店 0.5-2 天，紧急修复无法及时触达 |
| **用户更新率低** | 非强制更新的安装率通常仅 30-50%/周，旧版本 bug 长期存在 |
| **全量包体过大** | Flutter release APK/IPA 通常 40-80MB，仅修复一行代码也需用户下载完整包 |
| **A/B 实验受限** | 仅靠服务端配置和 JSON 驱动渲染无法覆盖 Dart 逻辑层面的实验 |
| **教育场景特殊需求** | 考试期间发现 AI 解题逻辑 bug 需要小时内修复，不可能等商店审核 |

### 1.2 目标

1. **绕过商店审核，小时级触达用户**：Dart 代码修改可通过补丁实时下发
2. **补丁体积极小**：仅下发变更的 Dart AOT 指令差量，典型补丁 50KB-2MB
3. **双端一致**：Android 和 iOS 使用统一的补丁格式和下发流程
4. **安全可信**：补丁签名验证 + 完整性校验，防篡改防注入
5. **渐进灰度**：支持按用户分组、比例、平台、版本号灰度推送
6. **秒级回滚**：发现问题一键回滚，用户下次启动恢复基线版本
7. **可观测**：补丁下载率、应用率、崩溃率实时监控

### 1.3 技术选型

| 方案 | 原理 | 优势 | 劣势 | 选型决策 |
|------|------|------|------|----------|
| **Shorebird** | Flutter 官方团队成员创建的 code push 方案，替换 Dart AOT 中的指令段 | 官方血统、Flutter 版本兼容性好、性能无损 | 商业服务、国内网络可能需要代理 | ✅ **主方案** |
| **自研 Dart AOT Patch** | 直接操作 `libapp.so` / `App.framework` 中的 Dart snapshot | 完全自主可控 | 研发成本极高、Flutter 版本升级易断裂 | ❌ 成本过高 |
| **JS Bridge 动态化** | 核心可变逻辑用 JS/TS 编写，通过 Flutter JS 引擎执行 | 灵活、无需编译 Dart 补丁 | 性能有损耗、无法覆盖原生 UI 逻辑、维护两套代码 | ❌ 架构侵入大 |
| **WebView 动态化** | 可变页面用 H5 实现 | 完全动态 | 体验差、无法调用 Flutter 原生组件 | ❌ 体验不可接受 |

**决策：采用 Shorebird 作为主方案，自建补丁管理后台控制灰度策略。**

### 1.4 适用范围

| 场景 | 适用 | 说明 |
|------|------|------|
| Dart 业务逻辑 bug 修复 | ✅ | 最核心场景 |
| AI Prompt 逻辑紧急调整 | ✅ | 通过补丁修改 Prompt 构建逻辑 |
| UI 布局微调 | ✅ | Widget 树结构调整 |
| 新增 Flutter 插件调用 | ⚠️ | 需要插件原生代码预埋 |
| 原生（Android/iOS）代码修改 | ❌ | 需走商店版本更新 |
| Flutter SDK 版本升级 | ❌ | 需走商店版本更新 |
| 新增第三方原生依赖 | ❌ | 需走商店版本更新 |

---

## 2. 整体架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        开发者工作流                                │
│                                                                   │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────────┐       │
│  │ Git 仓库  │───▶│ CI/CD 流水线  │───▶│ 补丁构建服务      │       │
│  │ Flutter   │    │ GitHub Action │    │ shorebird build  │       │
│  │ 项目代码  │    │ / Jenkins     │    │ patch-aab/apk    │       │
│  └──────────┘    └───────────────┘    └────────┬─────────┘       │
│                                                 │                 │
│                                         ┌───────▼────────┐       │
│                                         │ 补丁签名服务    │       │
│                                         │ RSA-2048 签名   │       │
│                                         └───────┬────────┘       │
│                                                 │                 │
└─────────────────────────────────────────────────┼─────────────────┘
                                                  │
┌─────────────────────────────────────────────────┼─────────────────┐
│                  服务端补丁管理平台                 │                 │
│                                                   │                 │
│  ┌────────────────┐  ┌───────────────┐  ┌────────▼─────────┐      │
│  │ 补丁版本管理    │  │ 灰度规则引擎   │  │ 补丁存储(COS/OSS) │      │
│  │ 版本号/变更记录 │  │ 用户分组/比例  │  │ CDN 分发          │      │
│  └────────────────┘  └───────────────┘  └──────────────────┘      │
│                                                                   │
│  ┌────────────────┐  ┌───────────────┐  ┌──────────────────┐      │
│  │ 灰度发布调度    │  │ 回滚管理      │  │ 监控统计          │      │
│  │ 渐进式放量     │  │ 一键回滚      │  │ 下载率/应用率     │      │
│  └────────────────┘  └───────────────┘  └──────────────────┘      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │              补丁查询 API (客户端调用)                      │     │
│  │  GET /api/v1/patch/check  →  返回可用补丁信息              │     │
│  │  GET /api/v1/patch/download/{id}  →  补丁文件              │     │
│  │  POST /api/v1/patch/report  →  上报应用结果               │     │
│  └──────────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────────┘
                                                  │
                               ┌──────────────────┼──────────────────┐
                               │            客户端补丁引擎           │
                               │                  │                  │
                               │  ┌───────────────▼──────────────┐  │
                               │  │    补丁检查器 (PatchChecker)  │  │
                               │  │  App启动时/定时轮询            │  │
                               │  └──────────┬──────────────────┘  │
                               │             │                     │
                               │  ┌──────────▼──────────────────┐  │
                               │  │    补丁下载器 (PatchDownloader)│  │
                               │  │  断点续传/MD5校验             │  │
                               │  └──────────┬──────────────────┘  │
                               │             │                     │
                               │  ┌──────────▼──────────────────┐  │
                               │  │    补丁验证器 (PatchVerifier) │  │
                               │  │  签名验证/完整性校验           │  │
                               │  └──────────┬──────────────────┘  │
                               │             │                     │
                               │  ┌──────────▼──────────────────┐  │
                               │  │   补丁应用器 (PatchApplier)  │  │
                               │  │  Shorebird Engine 应用补丁   │  │
                               │  └──────────┬──────────────────┘  │
                               │             │                     │
                               │  ┌──────────▼──────────────────┐  │
                               │  │   补丁状态管理 (PatchState)   │  │
                               │  │  持久化/回滚/版本追踪         │  │
                               │  └─────────────────────────────┘  │
                               └────────────────────────────────────┘
```

### 2.2 核心流程

```
App 启动
  │
  ├─▶ 1. 读取本地补丁状态 (已安装版本/基线版本)
  │
  ├─▶ 2. 调用 PATCH CHECK API
  │      └─ 传递: app_version, patch_version, platform, user_id
  │
  ├─▶ 3. 服务端灰度规则匹配
  │      └─ 返回: 有新补丁 / 已是最新 / 需回滚
  │
  ├─▶ 4.【有新补丁】下载 → 验证签名 → 应用
  │      └─ 下次 App 重启生效
  │
  ├─▶ 5.【需回滚】清除本地补丁 → 恢复基线
  │
  └─▶ 6. 上报补丁应用结果 (成功/失败/崩溃)
```

---

## 3. 补丁生产管线

### 3.1 Shorebird 补丁构建流程

```yaml
# .github/workflows/patch-build.yml
name: Build Flutter Patch

on:
  workflow_dispatch:
    inputs:
      patch_description:
        description: '补丁描述'
        required: true
      target_version:
        description: '目标基线版本 (如 1.2.0)'
        required: true
      gray_percentage:
        description: '灰度百分比 (1-100)'
        required: true
        default: '5'

jobs:
  build-patch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'
          channel: 'stable'

      - name: Setup Shorebird CLI
        run: |
          curl -fsSL https://cdn.shorebird.dev/install | bash
          echo "$HOME/.shorebird/bin" >> $GITHUB_PATH

      - name: Shorebird Auth
        env:
          SHOREBIRD_TOKEN: ${{ secrets.SHOREBIRD_TOKEN }}
        run: shorebird login --token "$SHOREBIRD_TOKEN"

      - name: Extract Base Patch Version
        id: base
        run: |
          # 从 git tag 中提取当前发布版本的 patch number
          BASE_PATCH=$(git describe --tags --match "v${{ inputs.target_version }}*" \
            --abbrev=0 | sed 's/.*patch\.\([0-9]*\)/\1/')
          echo "base_patch=$BASE_PATCH" >> $GITHUB_OUTPUT

      - name: Build Android Patch
        run: |
          shorebird patch android \
            --release-version "${{ inputs.target_version }}" \
            --base "v${{ inputs.target_version }}+patch.${{ steps.base.outputs.base_patch }}" \
            --output dist/patch-android.diff

      - name: Build iOS Patch
        run: |
          shorebird patch ios \
            --release-version "${{ inputs.target_version }}" \
            --base "v${{ inputs.target_version }}+patch.${{ steps.base.outputs.base_patch }}" \
            --output dist/patch-ios.diff

      - name: Generate Patch Metadata
        run: |
          cat > dist/patch-metadata.json << EOF
          {
            "patch_version": "${{ inputs.target_version }}+patch.$((${{ steps.base.outputs.base_patch }} + 1))",
            "base_version": "${{ inputs.target_version }}",
            "description": "${{ inputs.github_event_inputs.patch_description }}",
            "git_commit": "${{ github.sha }}",
            "build_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "platforms": {
              "android": {
                "diff_file": "patch-android.diff",
                "diff_md5": "$(md5sum dist/patch-android.diff | awk '{print $1}')",
                "diff_size": $(stat -c%s dist/patch-android.diff)
              },
              "ios": {
                "diff_file": "patch-ios.diff",
                "diff_md5": "$(md5sum dist/patch-ios.diff | awk '{print $1}')",
                "diff_size": $(stat -c%s dist/patch-ios.diff)
              }
            }
          }
          EOF

      - name: Sign Patch
        env:
          PATCH_SIGNING_KEY: ${{ secrets.PATCH_SIGNING_PRIVATE_KEY }}
        run: |
          # 对每个 diff 文件生成 RSA 签名
          openssl dgst -sha256 -sign <(echo "$PATCH_SIGNING_KEY" | base64 -d) \
            -out dist/patch-android.diff.sig dist/patch-android.diff
          openssl dgst -sha256 -sign <(echo "$PATCH_SIGNING_KEY" | base64 -d) \
            -out dist/patch-ios.diff.sig dist/patch-ios.diff

      - name: Upload to Patch Management Service
        run: |
          curl -X POST "${{ secrets.PATCH_API_URL }}/api/internal/v1/patches/upload" \
            -H "Authorization: Bearer ${{ secrets.PATCH_API_TOKEN }}" \
            -F "metadata=@dist/patch-metadata.json" \
            -F "android_diff=@dist/patch-android.diff" \
            -F "android_sig=@dist/patch-android.diff.sig" \
            -F "ios_diff=@dist/patch-ios.diff" \
            -F "ios_sig=@dist/patch-ios.diff.sig"
```

### 3.2 补丁版本命名规则

```
格式: {release_version}+patch.{sequential_number}

示例:
  v1.0.0          → 基线版本（无补丁）
  v1.0.0+patch.1  → 第 1 个补丁
  v1.0.0+patch.2  → 第 2 个补丁
  v1.1.0          → 新基线版本（商店发布后重置补丁计数）
  v1.1.0+patch.1  → 新基线的第 1 个补丁
```

### 3.3 补丁大小控制规范

| 补丁类型 | 目标大小 | 最大允许 | 策略 |
|----------|----------|----------|------|
| 紧急 Hotfix | < 200KB | 1MB | 仅修改目标方法/类 |
| 功能补丁 | < 1MB | 5MB | 控制变更范围 |
| 大范围重构 | < 5MB | 10MB | 建议走正式版本更新 |

```dart
// build_patch_analyzer.dart — 补丁大小分析工具
import 'dart:io';

class PatchAnalyzer {
  /// 分析补丁 diff 文件大小，给出优化建议
  static PatchAnalysisResult analyze(String diffPath) {
    final file = File(diffPath);
    final sizeBytes = file.lengthSync();
    final sizeKB = (sizeBytes / 1024).round();

    final result = PatchAnalysisResult()
      ..sizeBytes = sizeBytes
      ..sizeKB = sizeKB;

    if (sizeKB <= 200) {
      result.level = PatchSizeLevel.excellent;
      result.suggestion = '补丁大小优秀，适合全量推送';
    } else if (sizeKB <= 1024) {
      result.level = PatchSizeLevel.acceptable;
      result.suggestion = '补丁大小可接受';
    } else if (sizeKB <= 5120) {
      result.level = PatchSizeLevel.large;
      result.suggestion = '⚠️ 补丁较大，建议检查是否包含不必要的变更';
    } else {
      result.level = PatchSizeLevel.tooLarge;
      result.suggestion = '❌ 补丁过大(>5MB)，建议走正式版本更新';
    }

    return result;
  }
}

enum PatchSizeLevel { excellent, acceptable, large, tooLarge }

class PatchAnalysisResult {
  late int sizeBytes;
  late int sizeKB;
  late PatchSizeLevel level;
  late String suggestion;
}
```

---

## 4. 服务端补丁管理服务

### 4.1 服务架构

```
┌──────────────────────────────────────────────────────┐
│                  Patch Management Service              │
│                                                        │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ PatchRepo   │  │ GrayRuleRepo │  │ PatchStorage │ │
│  │ (MySQL)     │  │ (MySQL)      │  │ (COS/OSS)   │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                │                  │         │
│  ┌──────▼──────────────────▼────────────────▼──────┐ │
│  │              Patch Orchestration Layer            │ │
│  │                                                    │ │
│  │  - 创建补丁版本                                     │ │
│  │  - 配置灰度规则                                     │ │
│  │  - 渐进放量调度                                     │ │
│  │  - 回滚控制                                         │ │
│  │  - 效果统计                                         │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │                 API Layer                          │ │
│  │                                                    │ │
│  │  [Client]  PATCH /check  - 补丁检查                 │ │
│  │  [Client]  GET  /download/:id - 下载补丁            │ │
│  │  [Client]  POST /report - 上报结果                  │ │
│  │  [Admin]   POST /patches - 创建补丁                 │ │
│  │  [Admin]   PUT  /patches/:id/gray - 配置灰度        │ │
│  │  [Admin]   POST /patches/:id/rollback - 回滚        │ │
│  │  [Admin]   GET  /patches/:id/stats - 查看统计       │ │
│  └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 4.2 灰度规则引擎

```java
// PatchGrayRuleEngine.java
@Service
public class PatchGrayRuleEngine {

    @Autowired
    private PatchGrayRuleRepository ruleRepo;

    /**
     * 判断指定用户是否命中灰度规则
     *
     * @param patchId   补丁ID
     * @param userAttrs 用户属性快照
     * @return 匹配结果
     */
    public GrayMatchResult match(Long patchId, UserDeviceSnapshot userAttrs) {
        List<PatchGrayRule> rules = ruleRepo.findActiveRulesByPatchId(patchId);

        if (rules.isEmpty()) {
            return GrayMatchResult.noPatch();
        }

        for (PatchGrayRule rule : rules) {
            if (!matchPlatform(rule, userAttrs)) continue;
            if (!matchAppVersion(rule, userAttrs)) continue;
            if (!matchUserSegment(rule, userAttrs)) continue;
            if (!matchPercentage(rule, userAttrs)) continue;

            return GrayMatchResult.matched(rule);
        }

        return GrayMatchResult.noPatch();
    }

    private boolean matchPlatform(PatchGrayRule rule, UserDeviceSnapshot attrs) {
        if (rule.getPlatforms() == null || rule.getPlatforms().isEmpty()) return true;
        return rule.getPlatforms().contains(attrs.getPlatform());
    }

    private boolean matchAppVersion(PatchGrayRule rule, UserDeviceSnapshot attrs) {
        if (rule.getTargetVersions() == null || rule.getTargetVersions().isEmpty()) return true;
        return rule.getTargetVersions().contains(attrs.getAppVersion());
    }

    private boolean matchUserSegment(PatchGrayRule rule, UserDeviceSnapshot attrs) {
        if (rule.getUserSegmentType() == UserSegmentType.ALL) return true;

        return switch (rule.getUserSegmentType()) {
            case WHITELIST -> rule.getWhitelistUserIds().contains(attrs.getUserId());
            case MEMBERS_ONLY -> attrs.isMember();
            case FREE_USERS_ONLY -> !attrs.isMember();
            case SPECIFIC_GRADES -> rule.getTargetGrades().stream()
                    .anyMatch(g -> g.equals(attrs.getGrade()));
            case NEW_USERS -> attrs.getRegisterDays() <= 7;
            case CUSTOM_TAG -> attrs.getTags().stream()
                    .anyMatch(tag -> rule.getCustomTags().contains(tag));
            default -> true;
        };
    }

    /**
     * 百分比灰度：基于 userId + patchId 的一致性哈希
     * 保证同一用户对同一补丁的判断结果稳定
     */
    private boolean matchPercentage(PatchGrayRule rule, UserDeviceSnapshot attrs) {
        if (rule.getPercentage() >= 100) return true;
        if (rule.getPercentage() <= 0) return false;

        String hashInput = attrs.getUserId() + ":" + rule.getPatchId();
        int hash = Math.abs(hashInput.hashCode()) % 10000;
        return hash < (rule.getPercentage() * 100);
    }
}
```

### 4.3 渐进式灰度调度器

```java
// PatchGrayScheduler.java
@Service
public class PatchGrayScheduler {

    private static final int[] GRADUAL_RAMP = {1, 5, 10, 25, 50, 100};

    @Autowired
    private PatchRepository patchRepo;

    @Autowired
    private PatchGrayRuleEngine grayEngine;

    @Autowired
    private PatchMetricsService metricsService;

    /**
     * 定时任务：自动渐进提升灰度比例
     * 每 30 分钟执行一次，自动评估当前灰度阶段健康度
     */
    @Scheduled(fixedRate = 30 * 60 * 1000)
    public void autoRampUp() {
        List<Patch> activePatches = patchRepo.findByStatus(PatchStatus.GRADUAL_ROLLOUT);

        for (Patch patch : activePatches) {
            PatchMetrics metrics = metricsService.getMetrics(patch.getId());

            // 检查是否可以提升灰度比例
            if (canRampUp(patch, metrics)) {
                int currentIndex = getCurrentRampIndex(patch.getCurrentPercentage());
                if (currentIndex < GRADUAL_RAMP.length - 1) {
                    int nextPercentage = GRADUAL_RAMP[currentIndex + 1];
                    patch.setCurrentPercentage(nextPercentage);
                    patchRepo.save(patch);

                    log.info("Patch {} ramping up: {}% → {}%",
                        patch.getId(), patch.getCurrentPercentage(), nextPercentage);

                    // 记录灰度提升事件
                    eventPublisher.publishEvent(new PatchRampUpEvent(
                        patch.getId(),
                        GRADUAL_RAMP[currentIndex],
                        nextPercentage
                    ));
                } else {
                    // 已达到 100%，切换为全量发布
                    patch.setStatus(PatchStatus.FULL_ROLLOUT);
                    patchRepo.save(patch);
                }
            } else if (shouldRollback(patch, metrics)) {
                // 健康指标不达标，自动回滚
                triggerRollback(patch, "自动回滚：健康指标不达标");
            }
        }
    }

    private boolean canRampUp(Patch patch, PatchMetrics metrics) {
        // 至少观察 30 分钟
        if (Duration.between(patch.getLastRampUpTime(), LocalDateTime.now()).toMinutes() < 30) {
            return false;
        }

        // 崩溃率 < 0.5%
        if (metrics.getCrashRate() > 0.005) {
            log.warn("Patch {} crash rate too high: {}",
                patch.getId(), metrics.getCrashRate());
            return false;
        }

        // 补丁应用成功率 > 99%
        if (metrics.getApplySuccessRate() < 0.99) {
            log.warn("Patch {} apply success rate too low: {}",
                patch.getId(), metrics.getApplySuccessRate());
            return false;
        }

        // 至少有 500 个样本
        if (metrics.getTotalApplied() < 500) {
            return false;
        }

        // 无活跃的回滚标记
        return !patch.hasActiveRollbackFlag();
    }

    private boolean shouldRollback(Patch patch, PatchMetrics metrics) {
        // 崩溃率 > 2%，立即回滚
        if (metrics.getCrashRate() > 0.02) return true;

        // 补丁应用失败率 > 5%
        if (metrics.getApplyFailureRate() > 0.05) return true;

        return false;
    }

    private int getCurrentRampIndex(int percentage) {
        for (int i = 0; i < GRADUAL_RAMP.length; i++) {
            if (GRADUAL_RAMP[i] == percentage) return i;
        }
        return 0;
    }
}
```

---

## 5. 客户端补丁引擎

### 5.1 核心类设计

```dart
// lib/core/patch/patch_engine.dart

import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:crypto/crypto.dart';
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// 补丁引擎主入口
class PatchEngine {
  static PatchEngine? _instance;
  static PatchEngine get instance => _instance ??= PatchEngine._();

  PatchEngine._();

  final PatchChecker _checker = PatchChecker();
  final PatchDownloader _downloader = PatchDownloader();
  final PatchVerifier _verifier = PatchVerifier();
  final PatchApplier _applier = PatchApplier();
  final PatchStateStore _stateStore = PatchStateStore();

  /// App 启动时调用，检查并应用补丁
  Future<PatchCheckResult> checkAndApply({
    bool forceCheck = false,
  }) async {
    try {
      // 1. 读取本地补丁状态
      final localState = await _stateStore.read();
      PatchLogger.info('Current patch state: $localState');

      // 2. 检查远程是否有新补丁
      final remotePatch = await _checker.check(
        appVersion: localState.appVersion,
        currentPatchVersion: localState.patchVersion,
        platform: defaultTargetPlatform.name,
      );

      // 3. 无新补丁
      if (remotePatch == null) {
        PatchLogger.info('No new patch available');
        return PatchCheckResult.noUpdate();
      }

      // 4. 服务端要求回滚
      if (remotePatch.action == PatchAction.rollback) {
        await _applier.rollback();
        await _stateStore.clear();
        PatchLogger.info('Patch rolled back to baseline');
        return PatchCheckResult.rolledBack();
      }

      // 5. 下载补丁
      PatchLogger.info('Downloading patch: ${remotePatch.patchVersion}');
      final patchFile = await _downloader.download(
        url: remotePatch.downloadUrl,
        expectedMd5: remotePatch.md5,
        size: remotePatch.size,
      );

      // 6. 验证签名
      final isValid = await _verifier.verify(
        patchFile: patchFile,
        signature: remotePatch.signature,
        publicKey: await _loadEmbeddedPublicKey(),
      );

      if (!isValid) {
        PatchLogger.error('Patch signature verification failed!');
        await _reporter.reportFailure(
          patchVersion: remotePatch.patchVersion,
          reason: 'signature_verification_failed',
        );
        return PatchCheckResult.failed('Signature verification failed');
      }

      // 7. 应用补丁
      final applyResult = await _applier.apply(patchFile);

      if (applyResult.success) {
        // 8. 更新本地状态
        await _stateStore.write(PatchLocalState(
          appVersion: remotePatch.baseVersion,
          patchVersion: remotePatch.patchVersion,
          appliedAt: DateTime.now(),
          patchFilePath: applyResult.appliedPath,
        ));

        // 9. 上报成功
        await _reporter.reportSuccess(
          patchVersion: remotePatch.patchVersion,
          applyDuration: applyResult.duration,
        );

        PatchLogger.info('Patch applied successfully: ${remotePatch.patchVersion}');
        return PatchCheckResult.applied(remotePatch.patchVersion);
      } else {
        await _reporter.reportFailure(
          patchVersion: remotePatch.patchVersion,
          reason: applyResult.error ?? 'apply_failed',
        );
        return PatchCheckResult.failed(applyResult.error ?? 'Apply failed');
      }
    } catch (e, stack) {
      PatchLogger.error('Patch check failed', e, stack);
      return PatchCheckResult.failed(e.toString());
    }
  }

  /// 获取当前补丁版本信息（供 About 页面显示）
  Future<PatchInfo> getCurrentPatchInfo() async {
    final state = await _stateStore.read();
    return PatchInfo(
      appVersion: state.appVersion,
      patchVersion: state.patchVersion,
      appliedAt: state.appliedAt,
    );
  }

  /// 手动清除补丁（用于设置页"恢复初始版本"）
  Future<void> clearPatch() async {
    await _applier.rollback();
    await _stateStore.clear();
    PatchLogger.info('Patch manually cleared');
  }
}
```

### 5.2 补丁检查器

```dart
// lib/core/patch/patch_checker.dart

class PatchChecker {
  final PatchApiClient _apiClient = PatchApiClient();

  /// 向服务端查询当前设备是否有可用补丁
  Future<RemotePatchInfo?> check({
    required String appVersion,
    required String? currentPatchVersion,
    required String platform,
  }) async {
    final response = await _apiClient.post(
      '/api/v1/patch/check',
      body: {
        'app_version': appVersion,
        'current_patch_version': currentPatchVersion,
        'platform': platform,
        'device_model': await _getDeviceModel(),
        'os_version': await _getOsVersion(),
      },
    );

    if (!response.hasPatch) {
      return null;
    }

    return RemotePatchInfo(
      patchVersion: response.patchVersion!,
      baseVersion: response.baseVersion!,
      action: response.action!,
      downloadUrl: response.downloadUrl!,
      md5: response.md5!,
      signature: response.signature!,
      size: response.size!,
      description: response.description,
      forceApply: response.forceApply ?? false,
    );
  }
}

/// 远端补丁信息
@immutable
class RemotePatchInfo {
  final String patchVersion;    // e.g. "1.2.0+patch.3"
  final String baseVersion;     // e.g. "1.2.0"
  final PatchAction action;     // update / rollback
  final String downloadUrl;
  final String md5;
  final String signature;       // Base64 RSA signature
  final int size;               // bytes
  final String? description;
  final bool forceApply;        // 是否强制应用（下次启动必须生效）

  // ... constructor, etc.
}

enum PatchAction { update, rollback }
```

### 5.3 补丁下载器（支持断点续传）

```dart
// lib/core/patch/patch_downloader.dart

class PatchDownloader {
  static const _maxRetries = 3;
  static const _chunkSize = 64 * 1024; // 64KB

  /// 下载补丁文件，支持断点续传和 MD5 校验
  Future<File> download({
    required String url,
    required String expectedMd5,
    required int size,
  }) async {
    final tempDir = await getTemporaryDirectory();
    final patchFile = File('${tempDir.path}/patches/download.patch');
    final partFile = File('${patchFile.path}.part');

    // 确保目录存在
    await patchFile.parent.create(recursive: true);

    int downloadedBytes = 0;
    int retryCount = 0;

    while (retryCount < _maxRetries) {
      try {
        // 检查断点续传
        if (await partFile.exists()) {
          downloadedBytes = await partFile.length();
          if (downloadedBytes >= size) {
            // 已下载完成，校验并重命名
            break;
          }
        }

        final request = http.Request('GET', Uri.parse(url));

        // 断点续传 Range header
        if (downloadedBytes > 0) {
          request.headers['Range'] = 'bytes=$downloadedBytes-';
        }

        final response = await request.send();

        if (response.statusCode != 200 && response.statusCode != 206) {
          throw PatchDownloadException(
            'HTTP ${response.statusCode}',
            retryable: response.statusCode >= 500,
          );
        }

        // 追加写入
        final sink = await partFile.open(mode: FileMode.writeOnlyAppend);
        await for (final chunk in response.stream) {
          await sink.writeFrom(chunk);
          downloadedBytes += chunk.length;

          // 进度回调
          final progress = downloadedBytes / size;
          PatchEventBus.instance.add(
            PatchDownloadProgressEvent(progress: progress),
          );
        }
        await sink.close();

        // 下载完成
        break;
      } on PatchDownloadException catch (e) {
        retryCount++;
        if (retryCount >= _maxRetries || !e.retryable) {
          // 清理临时文件
          await partFile.deleteIfExists();
          rethrow;
        }
        await Future.delayed(Duration(seconds: 2 * retryCount));
      }
    }

    // MD5 校验
    final actualMd5 = await _computeFileMd5(partFile);
    if (actualMd5 != expectedMd5) {
      await partFile.deleteIfExists();
      throw PatchVerificationException(
        'MD5 mismatch: expected=$expectedMd5, actual=$actualMd5',
      );
    }

    // 重命名为正式文件
    await partFile.rename(patchFile.path);

    return patchFile;
  }

  Future<String> _computeFileMd5(File file) async {
    final digest = await md5.bind(file.openRead()).first;
    return digest.toString();
  }
}
```

### 5.4 补丁验证器

```dart
// lib/core/patch/patch_verifier.dart

class PatchVerifier {
  /// RSA-SHA256 签名验证
  Future<bool> verify({
    required File patchFile,
    required String signature, // Base64
    required String publicKeyPem,
  }) async {
    try {
      // 使用平台原生加密库进行验证
      final result = await PatchCryptoChannel.instance.verifySignature(
        filePath: patchFile.path,
        signatureBase64: signature,
        publicKeyPem: publicKeyPem,
        algorithm: 'RSA-SHA256',
      );
      return result;
    } catch (e) {
      PatchLogger.error('Signature verification error', e);
      return false;
    }
  }
}
```

### 5.5 补丁应用器（Shorebird 集成）

```dart
// lib/core/patch/patch_applier.dart

class PatchApplier {
  /// 通过 Shorebird Engine 应用补丁
  Future<PatchApplyResult> apply(File patchFile) async {
    final stopwatch = Stopwatch()..start();

    try {
      // 调用 Shorebird 平台通道应用补丁
      final result = await ShorebirdEngine.instance.applyPatch(
        patchPath: patchFile.path,
      );

      stopwatch.stop();

      if (result.success) {
        return PatchApplyResult.success(
          appliedPath: result.patchedLibraryPath,
          duration: stopwatch.elapsed,
        );
      } else {
        return PatchApplyResult.failure(
          error: result.errorMessage,
          duration: stopwatch.elapsed,
        );
      }
    } catch (e, stack) {
      stopwatch.stop();
      PatchLogger.error('Patch apply failed', e, stack);

      // 应用失败时，确保恢复基线版本
      await _restoreBaseline();

      return PatchApplyResult.failure(
        error: e.toString(),
        duration: stopwatch.elapsed,
      );
    }
  }

  /// 回滚到基线版本
  Future<void> rollback() async {
    await ShorebirdEngine.instance.revertPatch();
  }

  /// 恢复基线版本（内部方法）
  Future<void> _restoreBaseline() async {
    try {
      await ShorebirdEngine.instance.revertPatch();
    } catch (e) {
      PatchLogger.error('Failed to restore baseline', e);
    }
  }
}

/// Shorebird 引擎封装
class ShorebirdEngine {
  static ShorebirdEngine? _instance;
  static ShorebirdEngine get instance => _instance ??= ShorebirdEngine._();

  ShorebirdEngine._();

  static const _channel = MethodChannel('com.primetop.app/shorebird');

  Future<ShorebirdApplyResult> applyPatch({required String patchPath}) async {
    try {
      final result = await _channel.invokeMethod('applyPatch', {
        'patchPath': patchPath,
      });
      return ShorebirdApplyResult.fromMap(result.cast<String, dynamic>());
    } on PlatformException catch (e) {
      return ShorebirdApplyResult(
        success: false,
        errorMessage: 'PlatformException: ${e.code} - ${e.message}',
      );
    }
  }

  Future<void> revertPatch() async {
    await _channel.invokeMethod('revertPatch');
  }
}
```

### 5.6 补丁状态持久化

```dart
// lib/core/patch/patch_state_store.dart

class PatchStateStore {
  static const _key = 'primetop_patch_state';

  Future<PatchLocalState> read() async {
    final prefs = await SharedPreferences.getInstance();
    final json = prefs.getString(_key);
    if (json == null) {
      // 无补丁状态，返回基线
      return PatchLocalState.baseline(
        appVersion: await PackageInfo.fromPlatform().then((p) => p.version),
      );
    }
    return PatchLocalState.fromJson(jsonDecode(json));
  }

  Future<void> write(PatchLocalState state) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(state.toJson()));
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}

/// 本地补丁状态
@immutable
class PatchLocalState {
  final String appVersion;        // 基线 App 版本
  final String? patchVersion;     // 当前补丁版本 (null 表示无补丁)
  final DateTime? appliedAt;      // 补丁应用时间
  final String? patchFilePath;    // 补丁文件路径

  bool get hasPatch => patchVersion != null;

  PatchLocalState.baseline({required this.appVersion})
      : patchVersion = null,
        appliedAt = null,
        patchFilePath = null;

  PatchLocalState({
    required this.appVersion,
    required this.patchVersion,
    required this.appliedAt,
    required this.patchFilePath,
  });

  Map<String, dynamic> toJson() => {
    'app_version': appVersion,
    'patch_version': patchVersion,
    'applied_at': appliedAt?.toIso8601String(),
    'patch_file_path': patchFilePath,
  };

  factory PatchLocalState.fromJson(Map<String, dynamic> json) => PatchLocalState(
    appVersion: json['app_version'],
    patchVersion: json['patch_version'],
    appliedAt: json['applied_at'] != null
        ? DateTime.parse(json['applied_at'])
        : null,
    patchFilePath: json['patch_file_path'],
  );

  @override
  String toString() =>
      'PatchLocalState(appVersion: $appVersion, patchVersion: $patchVersion, '
      'appliedAt: $appliedAt)';
}
```

### 5.7 集成到 App 启动流程

```dart
// lib/main.dart

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // === 初始化管线 ===
  await _initializeApp();
}

Future<void> _initializeApp() async {
  // 1. 基础初始化（日志、配置、崩溃监控）
  await bootstrapCore();

  // 2. 补丁检查与应用（在 Splash 展示期间完成）
  //    注意：补丁应用后需要重启 App 才能完全生效
  //    但 Shorebird 支持热加载部分代码
  final patchResult = await PatchEngine.instance.checkAndApply();

  if (patchResult.wasApplied) {
    PatchLogger.info('Patch applied, will take effect on next restart');
    // 记录标记，Splash 页面提示用户"新版本已就绪，重启生效"
    _pendingRestartNotice = true;
  }

  // 3. 检查是否需要显示重启提示
  if (patchResult.wasRolledBack) {
    _pendingRestartNotice = true;
  }

  // 4. 运行 App
  runApp(PrimeTopApp(noticePendingRestart: _pendingRestartNotice));
}

/// Splash 页面中调用（带超时保护）
Future<void> checkPatchDuringSplash() async {
  try {
    await PatchEngine.instance.checkAndApply().timeout(
      const Duration(seconds: 5), // Splash 最多等 5 秒
      onTimeout: () {
        PatchLogger.info('Patch check timed out, will retry later');
        return PatchCheckResult.noUpdate();
      },
    );
  } catch (e) {
    // 补丁检查失败不阻塞启动
    PatchLogger.error('Patch check error during splash', e);
  }
}
```

### 5.8 App 内补丁状态展示

```dart
// lib/pages/settings/about_page.dart

class AboutPage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<PatchInfo>(
      future: PatchEngine.instance.getCurrentPatchInfo(),
      builder: (context, snapshot) {
        final info = snapshot.data;
        return SettingsSection(
          title: '版本信息',
          children: [
            SettingsTile(
              title: 'App 版本',
              value: info?.appVersion ?? '加载中...',
            ),
            if (info?.hasPatch ?? false)
              SettingsTile(
                title: '补丁版本',
                value: info!.patchVersion,
                trailing: Icon(Icons.patch_check, size: 18),
              ),
            if (info?.hasPatch ?? false)
              SettingsTile(
                title: '补丁应用时间',
                value: _formatDateTime(info!.appliedAt!),
              ),
            SettingsTile(
              title: '恢复初始版本',
              onTap: () => _showRestoreConfirmDialog(context),
            ),
          ],
        );
      },
    );
  }

  void _showRestoreConfirmDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('恢复初始版本'),
        content: Text('将清除当前补丁，恢复到 App 原始版本。'
            '此操作不会删除你的学习数据。\n\n'
            '恢复后需要重启 App 生效。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text('取消')),
          TextButton(
            onPressed: () async {
              await PatchEngine.instance.clearPatch();
              Navigator.pop(ctx);
              _showRestartDialog(context);
            },
            child: Text('确定恢复'),
          ),
        ],
      ),
    );
  }
}
```

---

## 6. 数据结构定义

### 6.1 服务端数据库表

```sql
-- 补丁版本表
CREATE TABLE patch_versions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    patch_version   VARCHAR(64) NOT NULL UNIQUE COMMENT '补丁版本号, e.g. 1.2.0+patch.3',
    base_version    VARCHAR(32) NOT NULL COMMENT '基线 App 版本, e.g. 1.2.0',
    description     TEXT COMMENT '补丁描述',
    git_commit      VARCHAR(40) COMMENT 'Git commit SHA',
    build_time      DATETIME NOT NULL COMMENT '构建时间',

    -- Android 补丁信息
    android_diff_url    VARCHAR(512) COMMENT 'Android diff 文件 CDN URL',
    android_diff_md5    VARCHAR(32) COMMENT 'Android diff 文件 MD5',
    android_diff_size   INT COMMENT 'Android diff 文件大小(bytes)',
    android_signature   TEXT COMMENT 'Android diff RSA 签名(Base64)',

    -- iOS 补丁信息
    ios_diff_url    VARCHAR(512) COMMENT 'iOS diff 文件 CDN URL',
    ios_diff_md5    VARCHAR(32) COMMENT 'iOS diff 文件 MD5',
    ios_diff_size   INT COMMENT 'iOS diff 文件大小(bytes)',
    ios_signature   TEXT COMMENT 'iOS diff RSA 签名(Base64)',

    -- 状态管理
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
        COMMENT 'draft/reviewing/testing/gradual_rollout/full_rollout/rolled_back/paused',
    current_percentage  INT NOT NULL DEFAULT 0 COMMENT '当前灰度百分比',
    created_by          BIGINT NOT NULL COMMENT '创建人(管理员ID)',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_base_version (base_version),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='补丁版本表';

-- 灰度规则表
CREATE TABLE patch_gray_rules (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    patch_id            BIGINT NOT NULL COMMENT '关联补丁ID',
    rule_name           VARCHAR(128) NOT NULL COMMENT '规则名称',
    priority            INT NOT NULL DEFAULT 0 COMMENT '优先级(数字越大越优先)',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,

    -- 平台过滤
    platforms           JSON COMMENT '["android", "ios"] 或 null=全部',

    -- App 版本过滤
    target_versions     JSON COMMENT '["1.2.0", "1.2.1"] 或 null=全部',

    -- 用户分群
    user_segment_type   VARCHAR(32) NOT NULL DEFAULT 'all'
        COMMENT 'all/whitelist/members_only/free_users_only/specific_grades/new_users/custom_tag',
    whitelist_user_ids  JSON COMMENT '白名单用户ID列表',
    target_grades       JSON COMMENT '目标年级列表',
    custom_tags         JSON COMMENT '自定义标签列表',

    -- 灰度比例
    percentage          INT NOT NULL DEFAULT 100 COMMENT '灰度百分比(0-100)',

    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_patch_id_active (patch_id, is_active),
    INDEX idx_priority (priority DESC),

    FOREIGN KEY (patch_id) REFERENCES patch_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='补丁灰度规则表';

-- 补丁应用记录表 (用于统计)
CREATE TABLE patch_apply_logs (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    patch_id            BIGINT NOT NULL,
    user_id             BIGINT NOT NULL,
    device_id           VARCHAR(64) NOT NULL,
    platform            VARCHAR(10) NOT NULL COMMENT 'android/ios',
    app_version         VARCHAR(32) NOT NULL,
    previous_patch      VARCHAR(64) COMMENT '之前安装的补丁版本',

    -- 应用结果
    result              VARCHAR(20) NOT NULL COMMENT 'success/failed/rollback',
    failure_reason      VARCHAR(256),
    apply_duration_ms   INT COMMENT '应用耗时(毫秒)',

    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_patch_id (patch_id),
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at),
    INDEX idx_patch_result (patch_id, result)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='补丁应用记录表';

-- 补丁回滚记录表
CREATE TABLE patch_rollbacks (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    patch_id            BIGINT NOT NULL,
    rollback_type       VARCHAR(20) NOT NULL COMMENT 'manual/auto_rollback/server_triggered',
    reason              TEXT NOT NULL COMMENT '回滚原因',
    rollback_percentage INT COMMENT '回滚时的灰度百分比',
    triggered_by        VARCHAR(50) COMMENT '触发人(管理员名/系统)',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (patch_id) REFERENCES patch_versions(id),
    INDEX idx_patch_id (patch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='补丁回滚记录表';

-- 补丁健康指标快照表 (每5分钟聚合)
CREATE TABLE patch_health_metrics (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    patch_id            BIGINT NOT NULL,
    snapshot_time       DATETIME NOT NULL,

    -- 下载指标
    total_downloaded    INT NOT NULL DEFAULT 0,
    download_success_rate  DECIMAL(5,4) NOT NULL DEFAULT 0,

    -- 应用指标
    total_applied       INT NOT NULL DEFAULT 0,
    apply_success_rate  DECIMAL(5,4) NOT NULL DEFAULT 0,
    avg_apply_duration_ms INT,

    -- 质量指标
    crash_rate_after    DECIMAL(6,4) NOT NULL DEFAULT 0 COMMENT '应用后崩溃率',
    avg_session_duration_after INT COMMENT '应用后平均会话时长(秒)',

    -- 对比基线
    crash_rate_baseline DECIMAL(6,4) COMMENT '基线崩溃率(用于对比)',
    crash_delta         DECIMAL(6,4) GENERATED ALWAYS AS (crash_rate_after - crash_rate_baseline) STORED,

    UNIQUE KEY uk_patch_time (patch_id, snapshot_time),
    INDEX idx_snapshot_time (snapshot_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='补丁健康指标快照表';
```

### 6.2 核心数据模型

```dart
// ====== 客户端数据模型 ======

/// 补丁检查结果
@immutable
class PatchCheckResult {
  final PatchCheckStatus status;
  final String? patchVersion;
  final String? errorMessage;

  bool get wasApplied => status == PatchCheckStatus.applied;
  bool get wasRolledBack => status == PatchCheckStatus.rolledBack;

  PatchCheckResult.applied(this.patchVersion)
      : status = PatchCheckStatus.applied,
        errorMessage = null;

  PatchCheckResult.rolledBack()
      : status = PatchCheckStatus.rolledBack,
        patchVersion = null,
        errorMessage = null;

  PatchCheckResult.noUpdate()
      : status = PatchCheckStatus.noUpdate,
        patchVersion = null,
        errorMessage = null;

  PatchCheckResult.failed(this.errorMessage)
      : status = PatchCheckStatus.failed,
        patchVersion = null;

  static PatchCheckResult noUpdate() =>
      PatchCheckResult.noUpdate();
  static PatchCheckResult rolledBack() =>
      PatchCheckResult.rolledBack();
}

enum PatchCheckStatus {
  applied,      // 补丁已成功应用
  noUpdate,     // 无可用补丁
  rolledBack,   // 补丁已回滚
  failed,       // 补丁应用失败
}

/// 补丁信息 (展示用)
@immutable
class PatchInfo {
  final String appVersion;
  final String? patchVersion;
  final DateTime? appliedAt;

  bool get hasPatch => patchVersion != null;

  PatchInfo({
    required this.appVersion,
    this.patchVersion,
    this.appliedAt,
  });
}

/// 下载进度事件
class PatchDownloadProgressEvent {
  final double progress; // 0.0 - 1.0
  PatchDownloadProgressEvent({required this.progress});
}
```

---

## 7. API 接口设计

### 7.1 客户端接口

#### 7.1.1 检查补丁

```http
POST /api/v1/patch/check
Content-Type: application/json
Authorization: Bearer {user_token}
```

**请求体：**
```json
{
  "app_version": "1.2.0",
  "current_patch_version": "1.2.0+patch.2",
  "platform": "android",
  "device_model": "Pixel 8 Pro",
  "os_version": "Android 14"
}
```

**响应（有补丁）：**
```json
{
  "code": 0,
  "data": {
    "has_patch": true,
    "action": "update",
    "patch_version": "1.2.0+patch.3",
    "base_version": "1.2.0",
    "description": "修复数学公式渲染崩溃问题",
    "download_url": "https://cdn.primetop.edu/patches/v1.2.0/patch.3/android.diff",
    "md5": "a1b2c3d4e5f6...",
    "size": 156789,
    "signature": "base64_encoded_rsa_signature...",
    "force_apply": false,
    "min_battery_level": 20,
    "wifi_only": true
  }
}
```

**响应（需回滚）：**
```json
{
  "code": 0,
  "data": {
    "has_patch": true,
    "action": "rollback",
    "reason": "patch_quality_issue",
    "force_apply": true
  }
}
```

**响应（无更新）：**
```json
{
  "code": 0,
  "data": {
    "has_patch": false
  }
}
```

#### 7.1.2 上报应用结果

```http
POST /api/v1/patch/report
Content-Type: application/json
Authorization: Bearer {user_token}
```

**请求体：**
```json
{
  "patch_version": "1.2.0+patch.3",
  "result": "success",
  "apply_duration_ms": 1200,
  "device_model": "Pixel 8 Pro",
  "platform": "android",
  "os_version": "Android 14"
}
```

**失败上报：**
```json
{
  "patch_version": "1.2.0+patch.3",
  "result": "failed",
  "failure_reason": "signature_verification_failed",
  "device_model": "iPhone 15 Pro",
  "platform": "ios",
  "os_version": "iOS 17.4"
}
```

### 7.2 管理后台接口

#### 7.2.1 创建补丁版本

```http
POST /api/admin/v1/patches
Content-Type: multipart/form-data
Authorization: Bearer {admin_token}
```

**表单字段：**
| 字段 | 类型 | 说明 |
|------|------|------|
| metadata | JSON | 补丁元数据（版本号、描述、git commit等）|
| android_diff | File | Android diff 文件 |
| android_sig | File | Android 签名文件 |
| ios_diff | File | iOS diff 文件 |
| ios_sig | File | iOS 签名文件 |

#### 7.2.2 配置灰度规则

```http
PUT /api/admin/v1/patches/{patch_id}/gray-rule
Content-Type: application/json
```

```json
{
  "rule_name": "灰度测试-Android优先",
  "platforms": ["android"],
  "target_versions": ["1.2.0"],
  "user_segment_type": "members_only",
  "percentage": 5,
  "auto_ramp_up": true,
  "auto_ramp_interval_minutes": 30,
  "rollback_on_crash_rate": 0.02,
  "rollback_on_failure_rate": 0.05
}
```

#### 7.2.3 执行回滚

```http
POST /api/admin/v1/patches/{patch_id}/rollback
Content-Type: application/json
```

```json
{
  "reason": "收到大量用户反馈 AI 回答异常",
  "rollback_type": "manual"
}
```

#### 7.2.4 查看补丁统计

```http
GET /api/admin/v1/patches/{patch_id}/stats?time_range=24h
```

```json
{
  "code": 0,
  "data": {
    "patch_id": 42,
    "patch_version": "1.2.0+patch.3",
    "status": "gradual_rollout",
    "current_percentage": 25,
    "metrics": {
      "total_downloaded": 12500,
      "total_applied": 12300,
      "total_failed": 200,
      "apply_success_rate": 0.984,
      "avg_apply_duration_ms": 1100,
      "crash_rate_after": 0.003,
      "crash_rate_baseline": 0.002,
      "crash_delta": 0.001,
      "active_users_on_patch": 11800
    },
    "time_series": [
      {
        "timestamp": "2026-08-01T08:00:00Z",
        "applied": 3200,
        "crash_rate": 0.002
      },
      {
        "timestamp": "2026-08-01T08:30:00Z",
        "applied": 5100,
        "crash_rate": 0.003
      }
    ]
  }
}
```

---

## 8. 关键代码实现

### 8.1 平台通道实现（Android 侧）

```kotlin
// android/app/src/main/kotlin/com/primetop/app/ShorebirdPlugin.kt
package com.primetop.app

import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.MethodChannel.MethodCallHandler
import io.flutter.plugin.common.MethodChannel.Result
import io.flutter.plugin.common.MethodCall
import io.flutter.embedding.engine.plugins.FlutterPlugin
import java.io.File

class ShorebirdPlugin : FlutterPlugin, MethodCallHandler {
    private lateinit var channel: MethodChannel

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel = MethodChannel(binding.binaryMessenger, "com.primetop.app/shorebird")
        channel.setMethodCallHandler(this)
    }

    override fun onMethodCall(call: MethodCall, result: Result) {
        when (call.method) {
            "applyPatch" -> {
                val patchPath = call.argument<String>("patchPath")!!
                try {
                    val success = applyShorebirdPatch(patchPath)
                    result.success(mapOf(
                        "success" to success,
                        "patchedLibraryPath" to getpatchedLibraryPath()
                    ))
                } catch (e: Exception) {
                    result.success(mapOf(
                        "success" to false,
                        "errorMessage" to (e.message ?: "Unknown error")
                    ))
                }
            }
            "revertPatch" -> {
                try {
                    revertShorebirdPatch()
                    result.success(null)
                } catch (e: Exception) {
                    result.error("REVERT_FAILED", e.message, null)
                }
            }
            else -> result.notImplemented()
        }
    }

    private fun applyShorebirdPatch(patchPath: String): Boolean {
        // 调用 Shorebird SDK 的补丁应用接口
        // Shorebird 会将 diff 应用到 libapp.so 中对应的 Dart AOT 指令段
        val patchFile = File(patchPath)
        if (!patchFile.exists()) {
            throw IllegalStateException("Patch file not found: $patchPath")
        }

        // Shorebird SDK 调用
        return ShorebirdClient.applyPatch(patchFile)
    }

    private fun revertShorebirdPatch() {
        ShorebirdClient.revertPatch()
    }

    private fun getpatchedLibraryPath(): String {
        return ShorebirdClient.getPatchedLibraryPath()
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
    }
}
```

### 8.2 平台通道实现（iOS 侧）

```swift
// ios/Runner/ShorebirdPlugin.swift
import Flutter
import UIKit

class ShorebirdPlugin: NSObject, FlutterPlugin {
    static func register(with registrar: FlutterPluginRegistrar) {
        let channel = FlutterMethodChannel(
            name: "com.primetop.app/shorebird",
            binaryMessenger: registrar.messenger()
        )
        let instance = ShorebirdPlugin()
        registrar.addMethodCallDelegate(instance, channel: channel)
    }

    func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "applyPatch":
            guard let args = call.arguments as? [String: Any],
                  let patchPath = args["patchPath"] as? String else {
                result([
                    "success": false,
                    "errorMessage": "Missing patchPath argument"
                ])
                return
            }

            do {
                let success = try applyShorebirdPatch(patchPath: patchPath)
                result([
                    "success": success,
                    "patchedLibraryPath": getPatchedLibraryPath()
                ])
            } catch {
                result([
                    "success": false,
                    "errorMessage": error.localizedDescription
                ])
            }

        case "revertPatch":
            do {
                try revertShorebirdPatch()
                result(nil)
            } catch {
                result(FlutterError(
                    code: "REVERT_FAILED",
                    message: error.localizedDescription,
                    details: nil
                ))
            }

        default:
            result(FlutterMethodNotImplemented)
        }
    }

    private func applyShorebirdPatch(patchPath: String) throws -> Bool {
        // Shorebird SDK iOS 端补丁应用
        // 修改 App.framework 中的 Dart AOT 指令
        guard FileManager.default.fileExists(atPath: patchPath) else {
            throw NSError(domain: "Shorebird", code: 1,
                         userInfo: [NSLocalizedDescriptionKey: "Patch file not found"])
        }

        return try ShorebirdClient.applyPatch(atPath: patchPath)
    }

    private func revertShorebirdPatch() throws {
        try ShorebirdClient.revertPatch()
    }

    private func getPatchedLibraryPath() -> String {
        return ShorebirdClient.getPatchedLibraryPath()
    }
}
```

### 8.3 补丁加密通信（签名验证）

```java
// PatchSignatureService.java
@Service
public class PatchSignatureService {

    @Value("${patch.signing.public-key}")
    private String publicKeyPem;

    private PublicKey cachedPublicKey;

    @PostConstruct
    public void init() {
        cachedPublicKey = loadPublicKey(publicKeyPem);
    }

    /**
     * 验证补丁文件的 RSA-SHA256 签名
     */
    public boolean verify(byte[] data, byte[] signature) {
        try {
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(cachedPublicKey);
            sig.update(data);
            return sig.verify(signature);
        } catch (Exception e) {
            log.error("Signature verification failed", e);
            return false;
        }
    }

    /**
     * 生成补丁签名 (CI/CD 中使用)
     */
    public byte[] sign(byte[] data, PrivateKey privateKey) {
        try {
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initSign(privateKey);
            sig.update(data);
            return sig.sign();
        } catch (Exception e) {
            throw new RuntimeException("Signing failed", e);
        }
    }

    private PublicKey loadPublicKey(String pem) {
        String keyContent = pem
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replaceAll("\\s", "");
        byte[] decoded = Base64.getDecoder().decode(keyContent);
        X509EncodedKeySpec spec = new X509EncodedKeySpec(decoded);
        return KeyFactory.getInstance("RSA").generatePublic(spec);
    }
}
```

---

## 9. 补丁生命周期状态机

### 9.1 服务端状态流转

```
                            ┌─────────┐
                            │  draft  │ ← CI/CD 自动创建
                            └────┬────┘
                                 │ 管理员审核
                                 ▼
                          ┌──────────────┐
                          │  reviewing   │
                          └──────┬───────┘
                                 │ 审核通过
                                 ▼
                          ┌──────────────┐
                ┌─────────│  testing     │ ← QA 团队验证
                │         └──────┬───────┘
                │                │ 验证通过
                │                ▼
                │      ┌──────────────────┐
                │      │ gradual_rollout  │ ← 渐进灰度 (1%→5%→10%→25%→50%→100%)
                │      └────────┬─────────┘
                │               │ 达到 100%
                │               ▼
                │      ┌──────────────────┐
                │      │  full_rollout    │ ← 全量发布
                │      └────────┬─────────┘
                │               │ 新版本上线后
                │               ▼
                │      ┌──────────────────┐
                │      │    archived      │ ← 归档
                │      └──────────────────┘
                │
                │ 任何阶段发现严重问题
                ▼
         ┌──────────────────┐
         │   rolled_back    │ ← 已回滚
         └──────────────────┘

         ┌──────────────────┐
         │     paused       │ ← 暂停（可恢复）
         └──────────────────┘
```

### 9.2 状态转换规则

```java
// PatchStatusTransition.java
public enum PatchStatusTransition {
    SUBMIT_FOR_REVIEW(draft, reviewing),
    APPROVE(reviewing, testing),
    REJECT(reviewing, draft),
    START_ROLLOUT(testing, gradual_rollout),
    RAMP_UP(gradual_rollout, gradual_rollout),     // 灰度提升，状态不变
    FULL_RELEASE(gradual_rollout, full_rollout),
    PAUSE(gradual_rollout, paused),
    RESUME(paused, gradual_rollout),
    ROLLBACK_ANY(List.of(testing, gradual_rollout, full_rollout, paused), rolled_back),
    ARCHIVE(full_rollout, archived);

    private final PatchStatus from;
    private final PatchStatus to;
    private final List<PatchStatus> fromList;

    PatchStatusTransition(PatchStatus from, PatchStatus to) {
        this.from = from;
        this.to = to;
        this.fromList = null;
    }

    PatchStatusTransition(List<PatchStatus> fromList, PatchStatus to) {
        this.from = null;
        this.fromList = fromList;
        this.to = to;
    }

    public static boolean canTransit(PatchStatus current, PatchStatus target) {
        return Arrays.stream(values()).anyMatch(t -> {
            boolean fromMatch = t.fromList != null
                ? t.fromList.contains(current)
                : t.from == current;
            return fromMatch && t.to == target;
        });
    }
}
```

### 9.3 客户端补丁状态

```
┌────────────┐     检查到新补丁      ┌──────────────┐
│ baseline   │ ──────────────────▶ │ downloading  │
│ (无补丁)    │                      └──────┬───────┘
└──────┬─────┘                             │ 下载完成
       ▲                                   ▼
       │                            ┌──────────────┐
       │     回滚/清除补丁           │  verifying   │
       │ ◀──────────────────────── │  (签名校验)   │
       │                            └──────┬───────┘
       │                                   │ 验证通过
       │                                   ▼
       │                            ┌──────────────┐
       │                            │   applying   │
       │                            └──────┬───────┘
       │                                   │ 应用成功
       │                                   ▼
       │                            ┌──────────────┐
       └──────────────────────────  │   patched    │
                                    │ (补丁已安装)  │
                                    └──────┬───────┘
                                           │ 收到回滚指令
                                           ▼
                                    ┌──────────────┐
                                    │  reverting   │ ──▶ baseline
                                    └──────────────┘

    任何阶段失败 ──▶ failed (记录日志，不影响 App 正常使用)
```

---

## 10. 安全与完整性校验

### 10.1 威胁模型

| 威胁 | 风险等级 | 防护措施 |
|------|----------|----------|
| 补丁被中间人篡改 | 🔴 高 | RSA-2048 签名 + HTTPS 传输 |
| 伪造补丁下发 | 🔴 高 | 客户端内嵌公钥，签名验证不通过拒绝应用 |
| 补丁文件损坏 | 🟡 中 | MD5 校验 + 下载后自动删除 .part 文件 |
| 补丁被逆向分析 | 🟡 中 | 补丁文件本身就是 Dart AOT diff，不包含源码 |
| 恶意管理员下发后门补丁 | 🟡 中 | 管理后台操作审计 + 审核流程 + 签名密钥分离管理 |
| CDN 被劫持 | 🟢 低 | 客户端验证签名，CDN 劫持无法伪造签名 |

### 10.2 签名密钥管理

```yaml
# 密钥分离策略
signing_keys:
  private_key:
    storage: "GitHub Actions Encrypted Secret"
    access: "仅 CI/CD 流水线可访问"
    rotation: "每 6 个月轮换一次"
    backup: "加密备份到公司内部密钥管理系统"

  public_key:
    distribution: "硬编码在 App 二进制中"
    location: "lib/core/patch/keys/patch_public_key.pem"
    fallback: "多公钥支持（密钥轮换过渡期同时验证新旧签名）"
```

```dart
// lib/core/patch/keys/patch_public_key.dart

class PatchPublicKeyProvider {
  /// 当前生效的公钥
  static const String _currentKey = '''
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxT7BrR8nQ2wF3kJx...
... (RSA-2048 public key) ...
-----END PUBLIC KEY-----
''';

  /// 旧公钥（轮换过渡期，用于验证旧补丁）
  static const String _previousKey = '''
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyU8CsS9oP3xG4lDy...
-----END PUBLIC KEY-----
''';

  /// 获取所有可信公钥（按优先级排序）
  static List<String> get trustedKeys => [_currentKey, _previousKey];

  /// 验证签名时，依次尝试所有公钥
  static Future<bool> verifyWithAnyKey({
    required File patchFile,
    required String signature,
  }) async {
    for (final key in trustedKeys) {
      final isValid = await PatchCryptoChannel.instance.verifySignature(
        filePath: patchFile.path,
        signatureBase64: signature,
        publicKeyPem: key,
        algorithm: 'RSA-SHA256',
      );
      if (isValid) return true;
    }
    return false;
  }
}
```

---

## 11. 灰度发布策略

### 11.1 标准灰度流程

```
阶段 1: 内部测试 (0.1% - 白名单)
  ├── 仅限内部测试账号
  ├── 验证补丁基本功能
  └── 持续: 2-4 小时

阶段 2: 小范围灰度 (1-5%)
  ├── 按用户ID哈希随机选取
  ├── 监控崩溃率、应用成功率
  └── 持续: 4-12 小时

阶段 3: 中范围灰度 (10-25%)
  ├── 覆盖更多设备和用户场景
  ├── 监控用户反馈和性能指标
  └── 持续: 12-24 小时

阶段 4: 大范围灰度 (50%)
  ├── 接近全量验证
  ├── 确认无长尾问题
  └── 持续: 12-24 小时

阶段 5: 全量发布 (100%)
  ├── 所有目标版本用户
  └── 持续到下一版本发布
```

### 11.2 灰度决策矩阵

| 指标 | 绿灯(继续放量) | 黄灯(暂停放量) | 红灯(立即回滚) |
|------|----------------|----------------|----------------|
| 崩溃率 | < 0.5% | 0.5% - 1% | > 1% |
| 应用成功率 | > 99% | 97-99% | < 97% |
| 用户负反馈率 | < 0.1% | 0.1-0.5% | > 0.5% |
| AI 回答质量评分 | ≥ 基线 | 基线-5% | < 基线-5% |

```java
// PatchHealthDecisionEngine.java
@Service
public class PatchHealthDecisionEngine {

    public HealthDecision evaluate(PatchMetrics metrics, PatchMetrics baseline) {
        List<HealthIssue> issues = new ArrayList<>();

        // 崩溃率检查
        double crashDelta = metrics.getCrashRate() - baseline.getCrashRate();
        if (crashDelta > 0.01) {
            issues.add(HealthIssue.critical("崩溃率增加超过1%: +%.2f%%", crashDelta * 100));
        } else if (crashDelta > 0.003) {
            issues.add(HealthIssue.warning("崩溃率轻微增加: +%.2f%%", crashDelta * 100));
        }

        // 补丁应用失败率检查
        if (metrics.getApplyFailureRate() > 0.03) {
            issues.add(HealthIssue.critical("补丁应用失败率过高: %.1f%%",
                metrics.getApplyFailureRate() * 100));
        }

        // 会话时长检查（补丁是否导致体验退化）
        double sessionDelta = (metrics.getAvgSessionDuration() -
            baseline.getAvgSessionDuration()) * 1.0 / baseline.getAvgSessionDuration();
        if (sessionDelta < -0.1) {
            issues.add(HealthIssue.warning("平均会话时长下降: %.1f%%", sessionDelta * 100));
        }

        // 决策
        if (issues.stream().anyMatch(i -> i.getLevel() == IssueLevel.CRITICAL)) {
            return HealthDecision.rollback(issues);
        }
        if (!issues.isEmpty()) {
            return HealthDecision.pause(issues);
        }
        return HealthDecision.proceed();
    }
}
```

---

## 12. 回滚与应急处理

### 12.1 回滚类型

| 类型 | 触发方式 | 响应时间 | 影响范围 |
|------|----------|----------|----------|
| **自动回滚** | 健康指标超标自动触发 | 即时 | 当前灰度用户 |
| **手动回滚** | 管理员在后台操作 | 即时 | 全部补丁用户 |
| **服务端回滚** | 补丁检查 API 返回 rollback | 下次 App 启动 | 逐个用户恢复 |
| **客户端自回滚** | 补丁应用后连续崩溃触发 | App 启动时 | 单设备 |

### 12.2 客户端自动回滚（连续崩溃保护）

```dart
// lib/core/patch/patch_crash_guard.dart

class PatchCrashGuard {
  static const _key = 'primetop_patch_crash_count';
  static const _maxCrashCount = 3; // 连续崩溃 3 次自动回滚

  /// 在 App 启动时检查上次是否崩溃退出
  static Future<void> checkAndGuard() async {
    final prefs = await SharedPreferences.getInstance();
    final lastCrashed = prefs.getBool('last_session_crashed') ?? false;
    final patchState = await PatchStateStore().read();

    if (!patchState.hasPatch) return; // 无补丁，无需保护

    if (lastCrashed) {
      final crashCount = prefs.getInt(_key) ?? 0 + 1;
      await prefs.setInt(_key, crashCount);

      PatchLogger.warning(
        'App crashed with patch, crash count: $crashCount/$_maxCrashCount'
      );

      if (crashCount >= _maxCrashCount) {
        // 连续崩溃超过阈值，自动回滚补丁
        PatchLogger.error(
          'Auto-rollback triggered: $crashCount consecutive crashes with patch'
        );
        await PatchEngine.instance.clearPatch();
        await prefs.setInt(_key, 0);

        // 上报自动回滚事件
        await PatchReporter.reportAutoRollback(
          patchVersion: patchState.patchVersion!,
          crashCount: crashCount,
        );
      }
    } else {
      // 正常启动，重置崩溃计数
      await prefs.setInt(_key, 0);
    }
  }

  /// 在 App 正常退出时标记
  static Future<void> markNormalExit() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('last_session_crashed', false);
  }

  /// 在全局异常处理中标记崩溃
  static Future<void> markCrashed() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('last_session_crashed', true);
  }
}
```

### 12.3 应急回滚流程

```
发现严重问题
  │
  ├─▶ 管理员登录后台
  │
  ├─▶ 点击"紧急回滚"按钮
  │     └─ 选择回滚原因
  │
  ├─▶ 服务端执行：
  │     ├─ 补丁状态 → rolled_back
  │     ├─ 补丁检查 API 立即返回 rollback 指令
  │     └─ 记录回滚日志
  │
  ├─▶ 客户端效果：
  │     ├─ 已打开 App 的用户：下次启动时恢复基线
  │     ├─ 正在下载补丁的用户：下载完成后发现已是 rolled_back，丢弃
  │     └─ 尚未检查的用户：检查时收到 rollback，清除本地补丁
  │
  └─▶ 回滚验证：
        ├─ 监控崩溃率是否回落到基线水平
        └─ 确认所有活跃用户已恢复基线 (通常 24-48 小时内)
```

---

## 13. 监控与告警

### 13.1 关键监控指标

```yaml
metrics:
  # 补丁分发指标
  - name: patch_download_total
    type: counter
    labels: [patch_id, platform, result]
    description: "补丁下载总数"

  - name: patch_apply_total
    type: counter
    labels: [patch_id, platform, result]
    description: "补丁应用总数"

  - name: patch_apply_duration_ms
    type: histogram
    labels: [patch_id, platform]
    buckets: [100, 500, 1000, 2000, 5000, 10000]
    description: "补丁应用耗时分布"

  - name: patch_active_users
    type: gauge
    labels: [patch_id, patch_version]
    description: "当前使用该补丁的活跃用户数"

  # 质量指标
  - name: patch_crash_rate
    type: gauge
    labels: [patch_id]
    description: "应用补丁后的崩溃率"
    alert:
      condition: "patch_crash_rate > 0.02"
      severity: critical
      message: "补丁 {{patch_id}} 崩溃率超过 2%"

  - name: patch_crash_delta
    type: gauge
    labels: [patch_id]
    description: "补丁前后崩溃率差值"
    alert:
      condition: "patch_crash_delta > 0.005"
      severity: warning
      message: "补丁 {{patch_id}} 崩溃率较基线增加 {{value}}"

  # 灰度进度
  - name: patch_gray_percentage
    type: gauge
    labels: [patch_id]
    description: "当前灰度百分比"

  - name: patch_check_api_latency_ms
    type: histogram
    buckets: [50, 100, 200, 500, 1000]
    description: "补丁检查 API 响应延迟"
```

### 13.2 仪表盘配置

```
补丁监控仪表盘:

Row 1: 活跃补丁概览
  ├── [表格] 当前 active 补丁列表 (版本/状态/灰度%/活跃用户/崩溃率)
  └── [数字] 今日总补丁检查次数 / 下载次数 / 应用次数

Row 2: 补丁质量趋势
  ├── [折线图] 崩溃率趋势 (补丁版本 vs 基线)
  ├── [折线图] 应用成功率趋势
  └── [柱状图] 补丁应用耗时 P50/P90/P99

Row 3: 灰度进度
  ├── [面积图] 灰度百分比推进时间线
  └── [饼图] 各补丁版本活跃用户占比

Row 4: 失败分析
  ├── [柱状图] 失败原因分布
  └── [表格] 最近 100 条失败记录
```

---

## 14. 错误码定义

| 错误码 | HTTP 状态 | 说明 | 客户端处理 |
|--------|-----------|------|-----------|
| PATCH_001 | 400 | 请求参数缺失 | 记录日志，下次重试 |
| PATCH_002 | 401 | 用户未登录 | 跳过补丁检查 |
| PATCH_003 | 404 | 指定版本无可用补丁 | 正常，无补丁 |
| PATCH_101 | 500 | 服务端内部错误 | 延迟重试 |
| PATCH_201 | 422 | 补丁 MD5 校验失败 | 删除临时文件，重新下载 |
| PATCH_202 | 422 | 补丁签名验证失败 | 拒绝应用，上报异常 |
| PATCH_203 | 422 | 补丁文件损坏 | 删除文件，重新下载 |
| PATCH_204 | 500 | Shorebird 应用补丁失败 | 自动回滚到基线 |
| PATCH_205 | 500 | 补丁回滚失败 | 标记为严重错误，下次启动强制清理 |
| PATCH_301 | 200 | 收到服务端回滚指令 | 清除本地补丁 |
| PATCH_302 | 200 | 补丁版本与当前 App 版本不匹配 | 忽略该补丁 |

---

## 15. 性能优化

### 15.1 补丁检查优化

```dart
// 避免每次启动都请求服务端，加入本地缓存和轮询间隔控制

class PatchCheckScheduler {
  static const _checkInterval = Duration(hours: 6); // 最多每 6 小时检查一次
  static const _key_last_check = 'primetop_patch_last_check';

  Future<bool> shouldCheck() async {
    final prefs = await SharedPreferences.getInstance();
    final lastCheck = prefs.getInt(_key_last_check) ?? 0;
    final now = DateTime.now().millisecondsSinceEpoch;

    if (now - lastCheck < _checkInterval.inMilliseconds) {
      return false; // 距上次检查不足 6 小时
    }

    // 网络条件检查：仅 WiFi 下检查
    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity != ConnectivityResult.wifi) {
      return false;
    }

    return true;
  }

  Future<void> recordCheck() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(
      _key_last_check,
      DateTime.now().millisecondsSinceEpoch,
    );
  }
}
```

### 15.2 补丁大小优化策略

```yaml
补丁构建优化:
  # 在 CI 中添加 Dart 代码分析，确保补丁最小化
  pre_build:
    - name: Analyze code changes
      command: git diff --stat $BASE_COMMIT..HEAD -- lib/
      rules:
        - max_files_changed: 20  # 单次补丁最多修改 20 个文件
        - max_lines_changed: 2000  # 单次补丁最多修改 2000 行
        - warn_if_native_plugin_changed: true  # 修改原生插件时警告
        - block_if_new_dependency_added: true  # 新增依赖时阻断

  # Shorebird 构建优化
  build:
    - name: Tree-shake icons
      flag: --tree-shake-icons
    - name: Split debug info
      flag: --split-debug-info=build/symbols
    - name: Obfuscate
      flag: --obfuscate
```

### 15.3 CDN 缓存策略

```
补丁文件 CDN 缓存配置:

  /patches/*/*.diff
    ├── Cache-Control: public, max-age=86400 (24小时)
    ├── CDN 节点缓存: 24小时
    └── 回源策略: 仅首次请求回源

  补丁检查 API (/api/v1/patch/check)
    ├── Cache-Control: no-store (不缓存)
    ├── CDN 不缓存此 API
    └── 实时响应灰度规则变更

  补丁统计上报 API (/api/v1/patch/report)
    ├── Cache-Control: no-store
    ├── 异步处理，不阻塞客户端
    └── 批量聚合写入数据库
```

---

## 16. 与现有系统集成

### 16.1 与灰度发布与特性开关系统集成

```
特性开关系统 (Feature Flags)          代码推送系统 (Code Push)
        │                                     │
        │  共享灰度规则引擎                      │  共享灰度规则引擎
        │  共享用户分群                          │  共享用户分群
        │  共享百分比哈希算法                     │  共享百分比哈希算法
        │                                     │
        └─────────────────────────────────────┘
                        │
                统一灰度管理面板
```

**集成规则：**
- 补丁的灰度规则复用特性开关系统的用户分群能力
- 补丁可以作为特性开关的前置条件（先推代码补丁，再开特性开关）
- 管理后台统一展示两者的灰度状态

### 16.2 与崩溃监控系统集成

```dart
// 与客户端异常监控与崩溃上报系统集成

class CrashReportIntegration {
  /// 在崩溃上报中附加补丁信息
  static Future<Map<String, dynamic>> enrichCrashReport() async {
    final patchState = await PatchStateStore().read();

    return {
      'app_version': patchState.appVersion,
      'patch_version': patchState.patchVersion ?? 'baseline',
      'patch_applied_at': patchState.appliedAt?.toIso8601String(),
      'has_patch': patchState.hasPatch,
    };
  }
}

// 在 Sentry/Crashlytics 初始化时注册
void initCrashReporter() {
  SentryFlutter.init(
    (options) {
      options.beforeSend = (event, hint) async {
        final patchInfo = await CrashReportIntegration.enrichCrashReport();
        event.tags['patch_version'] = patchInfo['patch_version'] as String;
        event.extra['patch_info'] = patchInfo;
        return event;
      };
    },
  );
}
```

### 16.3 与版本管理系统集成

```yaml
# 补丁系统与 App 版本管理的协调规则
integration_rules:
  # 新 App 版本发布时
  on_new_version_release:
    - 所有旧版本的 active 补丁自动标记为 archived
    - 客户端升级到新版本后，补丁检查 API 不再返回旧版本补丁
    - 新版本从基线 (patch.0) 开始

  # 补丁灰度期间发布新 App 版本
  on_version_release_during_patch:
    - 暂停所有进行中的灰度补丁
    - 等待新版本用户占比 > 80% 后，归档旧补丁
    - 新版本需要的新补丁重新从 draft 开始

  # 强制更新场景
  on_force_update:
    - 补丁系统暂停
    - 所有用户强制更新到新 App 版本
    - 更新完成后补丁系统恢复正常
```

### 16.4 与 CI/CD 流水线集成

```yaml
# 完整的补丁 CI/CD 集成
ci_cd_pipeline:
  # 1. PR 合并触发自动测试
  on_pr_merge:
    - run: flutter test
    - run: flutter analyze
    - run: shorebird patch --dry-run  # 试构建补丁，检查是否可构建
    - if: failure
      notify: "#mobile-dev"  # Slack/DingTalk 通知

  # 2. 手动触发补丁构建
  on_manual_trigger:
    - validate: target_version_is_active  # 确认目标版本仍在服务中
    - validate: no_conflicting_patches    # 确认无冲突补丁
    - build: shorebird patch android + ios
    - sign: RSA-2048
    - upload: 补丁管理服务
    - auto_create: draft 状态补丁版本

  # 3. 审核流程
  review_flow:
    - auto_assign: 移动端技术负责人
    - require: 代码 diff review
    - require: QA 测试通过
    - on_approve: 进入 gradual_rollout

  # 4. 全量后归档
  on_full_rollout:
    - wait: 7 天稳定运行
    - auto: 切换为 archived
    - git_tag: v{version}+patch.{n}-released
```

---

## 附录 A: Shorebird 实现原理简述

Shorebird 的核心原理是修改 Flutter 编译产物中的 Dart AOT 机器码：

1. **Flutter 编译产物**：`libapp.so` (Android) / `App.framework` (iOS) 包含 Dart AOT 编译后的机器码
2. **Shorebird 的 patch**：生成 Dart 代码变更对应的 AOT 指令 diff
3. **应用方式**：在 App 启动时加载 patch，替换 `libapp.so` 中对应的指令段
4. **效果**：Dart 逻辑代码变更可以绕过商店审核，实时生效

**限制说明：**
- 不能修改原生代码（Java/Kotlin/Swift/Objective-C）
- 不能新增 Flutter 插件（需要预埋）
- 不能修改 Flutter SDK 版本
- iOS 上受系统限制，补丁大小有额外约束

## 附录 B: 测试清单

| 测试项 | 测试场景 | 预期结果 |
|--------|----------|----------|
| 正常补丁流程 | 构建补丁→下发→下载→应用→重启 | 补丁生效，功能正常 |
| 签名篡改 | 修改补丁文件内容 | 客户端验证失败，拒绝应用 |
| 网络中断 | 下载过程中断网 | 断点续传，恢复后继续下载 |
| 磁盘空间不足 | 设备存储不足 | 优雅提示，不影响正常使用 |
| 补丁应用崩溃 | 补丁代码导致崩溃 | 连续崩溃 3 次后自动回滚 |
| 灰度命中 | 同一用户多次检查 | 灰度判断结果一致（哈希稳定） |
| 服务端回滚 | 管理员触发回滚 | 客户端下次启动恢复基线 |
| 并发补丁检查 | 大量用户同时检查 | API 响应时间 < 500ms |
| 补丁版本号比较 | 客户端已是最新补丁 | 服务端返回 has_patch=false |
| 跨版本补丁 | App 升级后检查补丁 | 不返回旧版本补丁 |

---

*本文档由 PrimeTop 客户端工程组编写，旨在为开发团队提供 Flutter 代码推送热更新系统的完整实现指南。*
