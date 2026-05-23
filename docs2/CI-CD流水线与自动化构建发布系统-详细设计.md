# CI/CD 流水线与自动化构建发布系统 - 详细设计

## 1. 模块概述

### 1.1 功能定位

本系统为 PrimeTop 项目提供从代码提交到生产发布的全链路自动化能力，覆盖客户端（Android/iOS）和服务端（Docker 容器化服务）的持续集成、自动化测试、构建产物管理、环境部署、灰度发布与回滚。目标是让开发人员提交代码后无需手动干预即可完成构建→测试→部署全流程，同时保证每次发布可追溯、可回滚、可审计。

### 1.2 核心能力

| 能力 | 说明 | 优先级 |
|------|------|--------|
| 代码提交触发 | Push/MR 触发自动构建 | P0 |
| 多端并行构建 | Android APK/AAB + iOS IPA 并行 | P0 |
| 自动化测试门禁 | 单元测试 + 集成测试 + UI 测试 | P0 |
| 构建产物归档 | 版本化存储到制品仓库 | P0 |
| 多环境部署 | dev → staging → production 逐级提升 | P0 |
| 灰度发布 | 按比例/白名单/特性开关灰度 | P1 |
| 一键回滚 | 快速回退到任意历史版本 | P0 |
| 发布审批 | 生产环境部署需审批 | P1 |
| 构建通知 | 企业微信/飞书群通知构建状态 | P1 |
| 安全扫描 | 依赖漏洞扫描 + 代码静态分析 | P2 |

### 1.3 依赖关系

```
Git 代码仓库（GitHub / GitLab）
        │
        ▼
CI/CD 引擎（GitHub Actions / GitLab CI）
        │
        ├──► 客户端构建集群（Android SDK + Xcode）
        ├──► 服务端构建（Docker Build）
        ├──► 测试服务（单元/集成/UI）
        └──► 安全扫描（SAST / 依赖检查）
        │
        ▼
制品仓库（APK/IPA/Docker Image）
        │
        ▼
部署环境（K8s / 应用商店）
        │
        ▼
监控告警（日志 + 指标）
```

### 1.4 技术选型

| 组件 | 推荐方案 | 备选方案 | 选型理由 |
|------|----------|----------|----------|
| CI/CD 引擎 | GitHub Actions | GitLab CI / Jenkins | 原生集成 GitHub，YAML 配置，免费额度充足 |
| 制品仓库 | GitHub Packages + App Center | Nexus / JFrog | 客户端用 App Center，服务端用 GHCR |
| 容器镜像仓库 | GitHub Container Registry (GHCR) | 阿里云 ACR / Harbor | 与 GitHub Actions 深度集成 |
| 客户端分发 | Microsoft App Center + Google Play Console | Firebase App Distribution | 支持 OTA 内测分发 |
| 部署编排 | Kubernetes (kubectl + Helm) | Docker Compose | 生产环境标准编排 |
| 安全扫描 | GitHub Dependabot + CodeQL | Snyk / Trivy | 原生集成，零额外成本 |

---

## 2. Git 分支策略

### 2.1 分支模型

采用 **GitHub Flow** 简化模型，适合小团队快速迭代：

```
main (生产分支，保护分支)
  │
  ├── develop (开发集成分支)
  │     │
  │     ├── feature/AI-tutor-v2      (功能分支)
  │     ├── feature/photo-search     (功能分支)
  │     ├── feature/error-book-ui    (功能分支)
  │     └── fix/crash-on-launch      (修复分支)
  │
  ├── release/1.0.0                  (发布分支)
  ├── release/1.1.0
  │
  └── hotfix/1.0.1                   (紧急修复分支)
```

### 2.2 分支规则

| 分支类型 | 命名规范 | 生命周期 | 合并目标 | CI 触发 |
|----------|----------|----------|----------|---------|
| `main` | `main` | 永久 | — | 自动部署生产 |
| `develop` | `develop` | 永久 | `main` (发布时) | 自动部署 staging |
| `feature/*` | `feature/<ticket>-<desc>` | 开发完成后删除 | `develop` | 构建 + 测试 |
| `fix/*` | `fix/<ticket>-<desc>` | 合并后删除 | `develop` 或 `main` | 构建 + 测试 |
| `release/*` | `release/<version>` | 发布后删除 | `main` + `develop` | 构建 + 测试 + 部署 |
| `hotfix/*` | `hotfix/<version>` | 合并后删除 | `main` + `develop` | 紧急构建 + 部署 |

### 2.3 分支保护规则

```yaml
# main 分支保护
branch_protection:
  main:
    require_pull_request: true
    required_approving_review_count: 2
    require_status_checks: true
    required_status_checks:
      - client-android-build
      - client-ios-build
      - server-build
      - unit-tests
      - integration-tests
    require_conventional_commits: true
    disallow_force_push: true
    disallow_delete: true

  develop:
    require_pull_request: true
    required_approving_review_count: 1
    require_status_checks: true
    required_status_checks:
      - client-android-build
      - client-ios-build
      - server-build
      - unit-tests
```

### 2.4 Commit 规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

类型定义：

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(tutor): 添加多轮追问上下文管理` |
| `fix` | 修复 | `fix(ocr): 修复手写体识别边界截断` |
| `perf` | 性能 | `perf(cache): 优化首页数据预加载` |
| `refactor` | 重构 | `refactor(state): 迁移至 Riverpod 2.x` |
| `test` | 测试 | `test(auth): 补充登录流程集成测试` |
| `docs` | 文档 | `docs(api): 更新题目服务接口文档` |
| `chore` | 构建/工具 | `chore(ci): 升级 Flutter 3.22` |

---

## 3. 客户端 CI/CD 流水线

### 3.1 流水线总览

```
代码 Push / PR
    │
    ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Lint + 静态  │    │  单元测试     │    │  依赖安全检查  │
│  代码分析     │    │  + 覆盖率     │    │             │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └────────┬─────────┘──────────────────┘
                │
                ▼
┌──────────────────────────────────────────────┐
│           Android 构建 + iOS 构建（并行）        │
│  ┌────────────────┐   ┌─────────────────┐     │
│  │  Flutter Build  │   │  Flutter Build   │     │
│  │  APK + AAB      │   │  IPA (无签名)     │     │
│  └────────┬───────┘   └────────┬─────────┘     │
└───────────┼────────────────────┼───────────────┘
            │                    │
            ▼                    ▼
┌───────────────┐    ┌───────────────────┐
│  签名 + 对齐   │    │  签名 + 产物打包    │
│  APK → AAB    │    │  IPA → dSYM       │
└───────┬───────┘    └────────┬──────────┘
        │                     │
        ▼                     ▼
┌─────────────────────────────────────┐
│         UI 自动化测试（可选）          │
│  (integration_test on emulator)     │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│         产物归档 + 分发               │
│  APK → App Center 内测分发          │
│  AAB → Google Play 内部测试轨道      │
│  IPA → App Center / TestFlight      │
└─────────────────────────────────────┘
```

### 3.2 Android 构建流水线

```yaml
# .github/workflows/client-android.yml
name: Client Android CI

on:
  push:
    branches: [main, develop, 'release/*']
    paths:
      - 'client/**'
      - 'shared/**'
      - '.github/workflows/client-android.yml'
  pull_request:
    branches: [main, develop]
    paths:
      - 'client/**'
      - 'shared/**'

env:
  FLUTTER_VERSION: '3.22.0'
  JAVA_VERSION: '17'
  # 通过 GitHub Secrets 注入
  # KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD
  # GOOGLE_PLAY_SERVICE_ACCOUNT_JSON

jobs:
  lint-and-test:
    name: Lint & Unit Test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          cache: true

      - name: Get dependencies
        working-directory: client
        run: flutter pub get

      - name: Analyze code
        working-directory: client
        run: flutter analyze --fatal-infos

      - name: Run unit tests
        working-directory: client
        run: |
          flutter test --coverage --machine > test-results.json
          # 生成覆盖率报告
          lcov --remove coverage/lcov.info 'lib/**/*.g.dart' 'lib/**/*.freezed.dart' -o coverage/lcov.info

      - name: Upload coverage
        if: always()
        uses: codecov/codecov-action@v3
        with:
          files: client/coverage/lcov.info
          flags: android

  build:
    name: Build Android
    needs: lint-and-test
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      matrix:
        flavor: [dev, staging, prod]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          cache: true

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'zulu'
          java-version: ${{ env.JAVA_VERSION }}
          cache: 'gradle'

      - name: Decode keystore
        run: |
          echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 -d > android/app/keystore.jks

      - name: Build APK
        working-directory: client
        run: |
          flutter build apk \
            --flavor ${{ matrix.flavor }} \
            --dart-define=ENV=${{ matrix.flavor }} \
            --dart-define=VERSION_NAME=${{ github.ref_name }} \
            --dart-define=VERSION_CODE=${{ github.run_number }} \
            --release \
            --build-number=${{ github.run_number }}

      - name: Build AAB (prod only)
        if: matrix.flavor == 'prod'
        working-directory: client
        run: |
          flutter build appbundle \
            --flavor prod \
            --dart-define=ENV=prod \
            --release \
            --build-number=${{ github.run_number }}

      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: android-${{ matrix.flavor }}-apk
          path: client/build/app/outputs/flutter-apk/*.apk
          retention-days: 30

      - name: Upload AAB artifact
        if: matrix.flavor == 'prod'
        uses: actions/upload-artifact@v4
        with:
          name: android-prod-aab
          path: client/build/app/outputs/bundle/release/*.aab
          retention-days: 90

  distribute:
    name: Distribute
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop' || startsWith(github.ref, 'refs/heads/release/')
    steps:
      - name: Download APK
        uses: actions/download-artifact@v4
        with:
          name: android-staging-apk
          path: artifacts/

      - name: Distribute to App Center
        uses: microsoft/appcenter-github-action@v1
        with:
          appName: PrimeTop/PrimeTop-Android
          token: ${{ secrets.APPCENTER_TOKEN }}
          group: internal-testers
          file: artifacts/*.apk
          notify: true
          releaseNotes: |
            Build: ${{ github.run_number }}
            Branch: ${{ github.ref_name }}
            Commit: ${{ github.sha }}
```

### 3.3 iOS 构建流水线

```yaml
# .github/workflows/client-ios.yml
name: Client iOS CI

on:
  push:
    branches: [main, develop, 'release/*']
    paths:
      - 'client/**'
      - 'shared/**'
      - '.github/workflows/client-ios.yml'
  pull_request:
    branches: [main, develop]
    paths:
      - 'client/**'
      - 'shared/**'

env:
  FLUTTER_VERSION: '3.22.0'
  XCODE_VERSION: '15.4'

jobs:
  build:
    name: Build iOS
    runs-on: macos-14  # Apple Silicon runner
    timeout-minutes: 60
    strategy:
      matrix:
        flavor: [dev, staging, prod]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          cache: true

      - name: Select Xcode
        run: sudo xcode-select -s /Applications/Xcode_${{ env.XCODE_VERSION }}.app

      - name: Get dependencies
        working-directory: client
        run: flutter pub get

      - name: Install CocoaPods
        working-directory: client/ios
        run: pod install

      - name: Build IPA (no signing for CI)
        working-directory: client
        run: |
          flutter build ipa \
            --flavor ${{ matrix.flavor }} \
            --dart-define=ENV=${{ matrix.flavor }} \
            --export-options-plist=ios/ExportOptions.plist \
            --release \
            --build-number=${{ github.run_number }}

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: ios-${{ matrix.flavor }}-ipa
          path: client/build/ios/ipa/*.ipa
          retention-days: 30

      - name: Upload dSYM
        if: matrix.flavor == 'prod'
        uses: actions/upload-artifact@v4
        with:
          name: ios-prod-dsym
          path: client/build/ios/archive/*.xcarchive/dSYMs/
          retention-days: 90

  distribute-testflight:
    name: Upload to TestFlight
    needs: build
    runs-on: macos-14
    if: startsWith(github.ref, 'refs/heads/release/')
    steps:
      - name: Download IPA
        uses: actions/download-artifact@v4
        with:
          name: ios-prod-ipa
          path: artifacts/

      - name: Upload to TestFlight
        env:
          APP_STORE_CONNECT_API_KEY_ID: ${{ secrets.ASC_KEY_ID }}
          APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
          APP_STORE_CONNECT_PRIVATE_KEY: ${{ secrets.ASC_PRIVATE_KEY }}
        run: |
          xcrun altool --upload-app \
            --type ios \
            --file artifacts/*.ipa \
            --apiKey "$APP_STORE_CONNECT_API_KEY_ID" \
            --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"
```

### 3.4 客户端构建配置管理

```dart
// client/lib/core/build_config.dart

/// 构建时注入的环境配置
/// 通过 --dart-define 注入
class BuildConfig {
  static const String env = String.fromEnvironment('ENV', defaultValue: 'dev');
  static const String versionName = String.fromEnvironment('VERSION_NAME', defaultValue: '0.0.1');
  static const int buildNumber = int.fromEnvironment('VERSION_CODE', defaultValue: 1);

  static bool get isDev => env == 'dev';
  static bool get isStaging => env == 'staging';
  static bool get isProd => env == 'prod';
  static bool get isDebug => bool.fromEnvironment('dart.vm.product') == false;

  /// 根据环境返回 API 基础地址
  static String get apiBaseUrl {
    switch (env) {
      case 'dev':
        return 'http://10.0.2.2:8080/api/v1'; // Android 模拟器访问宿主机
      case 'staging':
        return 'https://staging-api.primetop.cn/api/v1';
      case 'prod':
        return 'https://api.primetop.cn/api/v1';
      default:
        return 'http://10.0.2.2:8080/api/v1';
    }
  }

  /// Sentry DSN
  static String get sentryDsn {
    switch (env) {
      case 'prod':
        return 'https://xxx@sentry.primetop.cn/1';
      default:
        return ''; // dev/staging 不上报
    }
  }
}
```

### 3.5 Flavor 配置矩阵

```kotlin
// client/android/app/build.gradle.kts (节选)

android {
    flavorDimensions += "environment"

    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            resValue("string", "app_name", "启硕(开发)")
            manifestPlaceholders["appIcon"] = "@mipmap/ic_launcher_dev"
        }
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            resValue("string", "app_name", "启硕(测试)")
            manifestPlaceholders["appIcon"] = "@mipmap/ic_launcher_staging"
        }
        create("prod") {
            dimension = "environment"
            // 无后缀
            resValue("string", "app_name", "启硕")
            manifestPlaceholders["appIcon"] = "@mipmap/ic_launcher"
        }
    }
}
```

```ruby
# client/ios/fastlane/Fastfile (节选)

default_platform(:ios)

platform :ios do
  desc "Build dev flavor"
  lane :dev do
    build_app(
      workspace: "Runner.xcworkspace",
      scheme: "dev",
      export_method: "development",
      output_directory: "./build",
      output_name: "PrimeTop-dev.ipa"
    )
  end

  desc "Build staging flavor"
  lane :staging do
    build_app(
      workspace: "Runner.xcworkspace",
      scheme: "staging",
      export_method: "development",
      output_directory: "./build",
      output_name: "PrimeTop-staging.ipa"
    )
  end

  desc "Build prod and upload to TestFlight"
  lane :prod do
    build_app(
      workspace: "Runner.xcworkspace",
      scheme: "prod",
      export_method: "app-store",
      output_directory: "./build",
      output_name: "PrimeTop.ipa"
    )
    upload_to_testflight(
      skip_waiting_for_build_processing: true
    )
  end
end
```

---

## 4. 服务端 CI/CD 流水线

### 4.1 流水线总览

```
代码 Push / PR
    │
    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Lint + 格式 │    │  单元测试      │    │  依赖检查      │
│   检查        │    │  + 覆盖率     │    │  (npm audit)  │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                    │                    │
       └────────┬───────────┘────────────────────┘
                │
                ▼
┌──────────────────────────────┐
│     Docker 镜像构建           │
│  多阶段构建 → 最小镜像        │
│  标签: SHA + 版本号 + latest  │
└─────────────┬────────────────┘
              │
              ▼
┌──────────────────────────────┐
│     容器安全扫描 (Trivy)      │
│  CVE 漏洞检测                │
└─────────────┬────────────────┘
              │
              ▼
┌──────────────────────────────┐
│     推送镜像到 GHCR           │
│  primetop/server:sha-abc123  │
│  primetop/server:v1.0.0      │
└─────────────┬────────────────┘
              │
         ┌────┴────┐
         ▼         ▼
    ┌─────────┐ ┌──────────┐
    │  dev     │ │ staging  │ ← develop 分支自动部署
    │  部署    │ │  部署     │
    └─────────┘ └──────────┘
              │
              ▼  (release/main 分支 + 审批)
    ┌──────────────────┐
    │  production 部署   │
    │  Helm + K8s       │
    └──────────────────┘
```

### 4.2 服务端构建流水线

```yaml
# .github/workflows/server-ci.yml
name: Server CI

on:
  push:
    branches: [main, develop, 'release/*']
    paths:
      - 'server/**'
      - 'proto/**'
      - '.github/workflows/server-ci.yml'
  pull_request:
    branches: [main, develop]
    paths:
      - 'server/**'
      - 'proto/**'

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: primetop/server
  NODE_VERSION: '20'

jobs:
  test:
    name: Lint & Test
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: primetop_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
          cache-dependency-path: server/package-lock.json

      - name: Install dependencies
        working-directory: server
        run: npm ci

      - name: Lint
        working-directory: server
        run: npm run lint

      - name: Unit tests
        working-directory: server
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/primetop_test
          REDIS_URL: redis://localhost:6379
          NODE_ENV: test
        run: npm run test:ci

      - name: Integration tests
        working-directory: server
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/primetop_test
          REDIS_URL: redis://localhost:6379
          NODE_ENV: test
        run: npm run test:integration

      - name: Upload coverage
        if: always()
        uses: codecov/codecov-action@v3
        with:
          files: server/coverage/lcov.info
          flags: server

  security-scan:
    name: Security Scan
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - name: npm audit
        working-directory: server
        run: npm audit --audit-level=high --omit=dev
        continue-on-error: true

      - name: Run CodeQL
        uses: github/codeql-action/analyze@v3
        with:
          languages: javascript

  build-and-push:
    name: Build & Push Docker Image
    needs: [test, security-scan]
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
      packages: write
    outputs:
      image_tag: ${{ steps.meta.outputs.tags }}
      image_digest: ${{ steps.build.outputs.digest }}
    steps:
      - uses: actions/checkout@v4

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            # 分支名标签
            type=ref,event=branch
            type=ref,event=pr
            # SHA 短标签
            type=sha,prefix=sha-
            # 语义版本标签 (release/* 分支)
            type=match,pattern=release/(.*),group=1
            # latest 标签仅限 main
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push
        id: build
        uses: docker/build-push-action@v5
        with:
          context: ./server
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            NODE_ENV=production
            BUILD_SHA=${{ github.sha }}

      - name: Scan image (Trivy)
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}
          severity: 'CRITICAL,HIGH'
          exit-code: '1'
          format: 'sarif'
          output: 'trivy-results.sarif'

  # deploy jobs 见第 6 节
```

### 4.3 Dockerfile 设计

```dockerfile
# server/Dockerfile
# ========================
# Stage 1: 依赖安装
# ========================
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ========================
# Stage 2: 构建
# ========================
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG NODE_ENV=production
ARG BUILD_SHA=unknown
ENV NODE_ENV=${NODE_ENV}

RUN npm run build

# ========================
# Stage 3: 运行时 (最小镜像)
# ========================
FROM node:20-alpine AS runtime
WORKDIR /app

# 安全: 非 root 用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# 仅拷贝必要文件
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

USER appuser

EXPOSE 8080

# 启动
CMD ["node", "--max-old-space-size=512", "dist/main.js"]
```

---

## 5. 环境管理

### 5.1 环境定义

| 环境 | 用途 | 部署方式 | 数据库 | 域名 | 谁可以部署 |
|------|------|----------|--------|------|-----------|
| **dev** | 开发自测 | push to `develop` 自动 | 本地 Docker Compose | `dev-api.primetop.local` | 开发人员 |
| **staging** | 联调测试/QA | push to `develop` 自动 | 独立 RDS | `staging-api.primetop.cn` | 自动 + 手动触发 |
| **production** | 线上 | push to `main` + 审批 | 生产 RDS (主从) | `api.primetop.cn` | 发布经理审批 |

### 5.2 环境配置管理

```yaml
# deploy/environments/staging.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: primetop-config
  namespace: primetop-staging
data:
  NODE_ENV: "staging"
  LOG_LEVEL: "debug"
  API_RATE_LIMIT_PER_MIN: "120"
  AI_MODEL_DEFAULT: "gpt-4o-mini"
  AI_CACHE_TTL_MS: "300000"
  REDIS_MAX_MEMORY: "256mb"
  DB_POOL_MAX: "20"
  CORS_ORIGIN: "https://staging.primetop.cn"

---
# deploy/environments/production.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: primetop-config
  namespace: primetop-production
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  API_RATE_LIMIT_PER_MIN: "60"
  AI_MODEL_DEFAULT: "gpt-4o"
  AI_CACHE_TTL_MS: "600000"
  REDIS_MAX_MEMORY: "1gb"
  DB_POOL_MAX: "50"
  CORS_ORIGIN: "https://app.primetop.cn"
```

### 5.3 Secrets 管理

```
Secret 分层策略:

GitHub Secrets (CI/CD 注入):
├── REGISTRY_TOKEN          # GHCR 访问令牌
├── APPCENTER_TOKEN         # App Center 分发令牌
├── ASC_KEY_ID              # App Store Connect API Key
├── ASC_ISSUER_ID
├── ASC_PRIVATE_KEY
├── KEYSTORE_BASE64         # Android 签名 KeyStore
├── KEYSTORE_PASSWORD
├── KEY_ALIAS
├── KEY_PASSWORD
└── CODECOV_TOKEN           # 覆盖率上报

Kubernetes Secrets (运行时):
├── db-credentials          # 数据库连接串
├── redis-password          # Redis 密码
├── ai-api-keys             # AI 模型 API Keys (加密)
├── jwt-secret              # JWT 签名密钥
├── oss-access-key          # 对象存储 AK/SK
└── sentry-dsn              # Sentry 上报 DSN

规则:
1. CI/CD Secrets 仅用于构建签名，不进入运行时环境
2. 运行时 Secrets 通过 K8s Secrets 管理，配合 External Secrets Operator
3. 生产环境 AI API Keys 使用阿里云 KMS 加密
4. Secret 轮换周期: 90 天
5. Secret 审计: 每次 K8s Secret 访问记录到审计日志
```

---

## 6. 部署流程

### 6.1 自动部署策略

```yaml
# .github/workflows/server-deploy.yml (部署部分)
  deploy-staging:
    name: Deploy to Staging
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    environment:
      name: staging
      url: https://staging-api.primetop.cn/health
    steps:
      - uses: actions/checkout@v4

      - name: Setup kubectl
        uses: azure/setup-kubectl@v3
        with:
          version: 'v1.29.0'

      - name: Configure kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBE_CONFIG_STAGING }}" | base64 -d > $HOME/.kube/config

      - name: Deploy with Helm
        run: |
          helm upgrade primetop ./deploy/helm/primetop \
            --namespace primetop-staging \
            --values ./deploy/environments/staging.yaml \
            --set image.tag=sha-${GITHUB_SHA::7} \
            --set image.digest=@${{ needs.build-and-push.outputs.image_digest }} \
            --wait --timeout 300s \
            --atomic  # 失败自动回滚

      - name: Verify deployment
        run: |
          kubectl -n primetop-staging rollout status deployment/primetop-server --timeout=120s
          # 等待健康检查通过
          sleep 10
          curl -sf https://staging-api.primetop.cn/health | jq .

      - name: Notify deployment
        if: always()
        uses: slackapi/slack-github-action@v1.25.0
        with:
          payload: |
            {
              "text": "🚀 Staging deployed: `${{ github.sha::7 }}` by ${{ github.actor }}"
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}

  deploy-production:
    name: Deploy to Production
    needs: build-and-push
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment:
      name: production
      url: https://api.primetop.cn/health
    steps:
      - uses: actions/checkout@v4

      - name: Setup kubectl
        uses: azure/setup-kubectl@v3

      - name: Configure kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBE_CONFIG_PRODUCTION }}" | base64 -d > $HOME/.kube/config

      - name: Pre-deploy check
        run: |
          # 确认当前没有正在进行的部署
          CURRENT=$(kubectl -n primetop-production get deploy primetop-server -o jsonpath='{.status.unavailableReplicas}')
          if [ "$CURRENT" != "" ] && [ "$CURRENT" != "0" ]; then
            echo "❌ 部署正在进行中，请稍后重试"
            exit 1
          fi

      - name: Canary deployment (20%)
        run: |
          helm upgrade primetop ./deploy/helm/primetop \
            --namespace primetop-production \
            --values ./deploy/environments/production.yaml \
            --set image.tag=sha-${GITHUB_SHA::7} \
            --set canary.enabled=true \
            --set canary.weight=20 \
            --wait --timeout 300s

      - name: Monitor canary (5 min)
        run: |
          sleep 300
          # 检查错误率
          ERROR_RATE=$(curl -sf 'http://prometheus:9090/api/v1/query?query=rate(http_requests_total{status=~"5.."}[5m])/rate(http_requests_total[5m])' | jq -r '.data.result[0].value[1]')
          if (( $(echo "$ERROR_RATE > 0.05" | bc -l) )); then
            echo "❌ Canary 错误率 ${ERROR_RATE} 超过阈值 5%，回滚"
            helm rollback primetop --namespace primetop-production
            exit 1
          fi

      - name: Full rollout
        run: |
          helm upgrade primetop ./deploy/helm/primetop \
            --namespace primetop-production \
            --values ./deploy/environments/production.yaml \
            --set image.tag=sha-${GITHUB_SHA::7} \
            --set canary.enabled=false \
            --wait --timeout 600s \
            --atomic

      - name: Post-deploy verification
        run: |
          kubectl -n primetop-production rollout status deployment/primetop-server --timeout=300s
          sleep 15
          # 全链路冒烟测试
          curl -sf https://api.primetop.cn/health | jq .
          curl -sf https://api.primetop.cn/api/v1/system/info | jq .

      - name: Notify deployment
        if: always()
        run: |
          STATUS="✅ 成功"
          if [ "${{ job.status }}" != "success" ]; then STATUS="❌ 失败"; fi
          # 发送飞书/企业微信通知
          curl -X POST "${{ secrets.DEPLOY_NOTIFY_WEBHOOK }}" \
            -H 'Content-Type: application/json' \
            -d "{
              \"msg_type\": \"interactive\",
              \"card\": {
                \"header\": { \"title\": { \"content\": \"生产部署 $STATUS\" } },
                \"elements\": [{
                  \"text\": {
                    \"content\": \"版本: sha-${GITHUB_SHA::7}\\n操作人: ${{ github.actor }}\\n时间: $(date -u '+%Y-%m-%d %H:%M UTC')\"
                  }
                }]
              }
            }"
```

### 6.2 Helm Chart 结构

```
deploy/helm/primetop/
├── Chart.yaml
├── values.yaml              # 默认值
├── values-staging.yaml      # Staging 覆盖
├── values-production.yaml   # Production 覆盖
├── templates/
│   ├── deployment.yaml      # 主 Deployment (含 readiness/liveness probe)
│   ├── service.yaml         # ClusterIP Service
│   ├── ingress.yaml         # Ingress (TLS)
│   ├── configmap.yaml       # 环境变量 ConfigMap
│   ├── secret.yaml          # Secrets (外部管理引用)
│   ├── hpa.yaml             # Horizontal Pod Autoscaler
│   ├── pdb.yaml             # Pod Disruption Budget
│   ├── canary.yaml          # Canary Deployment (Nginx Ingress Canary)
│   └── _helpers.tpl         # 模板辅助函数
└── .helmignore
```

```yaml
# deploy/helm/primetop/values.yaml (核心配置)

replicaCount: 3

image:
  repository: ghcr.io/primetop/server
  pullPolicy: IfNotPresent
  tag: ""  # CI 注入

resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "1000m"
    memory: "512Mi"

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80

# 滚动更新策略
rollingUpdate:
  maxSurge: 1
  maxUnavailable: 0  # 保证至少 N-1 个 Pod 可用

# 健康检查
readinessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3

livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 15
  failureThreshold: 3

# Pod 反亲和 (跨节点分布)
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          labelSelector:
            matchExpressions:
              - key: app.kubernetes.io/name
                operator: In
                values: ["primetop"]
          topologyKey: kubernetes.io/hostname

canary:
  enabled: false
  weight: 0

pdb:
  enabled: true
  minAvailable: "50%"
```

---

## 7. 版本号管理

### 7.1 语义化版本号规则

```
格式: MAJOR.MINOR.PATCH[-PRERELEASE]+BUILD

示例:
  1.0.0              # 正式发布
  1.1.0-beta.1       # 内测
  1.1.0-rc.1         # 发布候选
  1.0.1              # 热修复

规则:
  MAJOR  - 不兼容的 API 变更
  MINOR  - 向后兼容的新功能
  PATCH  - 向后兼容的 Bug 修复
```

### 7.2 版本号生成与注入

```yaml
# .github/workflows/version.yml
name: Version Management

on:
  push:
    branches: [main]
    paths-ignore:
      - 'docs/**'
      - 'docs2/**'
      - '**.md'

jobs:
  bump-version:
    name: Bump Version
    runs-on: ubuntu-latest
    outputs:
      new_version: ${{ steps.version.outputs.new_version }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 获取完整历史用于 conventional commit 分析

      - name: Determine version bump
        id: version
        run: |
          # 基于 conventional commits 自动判断版本号
          # feat → MINOR, fix → PATCH, feat! → MAJOR
          CURRENT=$(cat version.txt)
          echo "current_version=$CURRENT" >> $GITHUB_OUTPUT

          # 分析自上次 tag 以来的 commits
          LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
          if [ -z "$LAST_TAG" ]; then
            echo "new_version=0.1.0" >> $GITHUB_OUTPUT
            exit 0
          fi

          COMMITS=$(git log ${LAST_TAG}..HEAD --pretty=format:"%s")

          BUMP="patch"
          if echo "$COMMITS" | grep -q "^feat"; then BUMP="minor"; fi
          if echo "$COMMITS" | grep -q "BREAKING CHANGE\|^feat!"; then BUMP="major"; fi

          IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
          case $BUMP in
            major) NEW="$((MAJOR+1)).0.0" ;;
            minor) NEW="$MAJOR.$((MINOR+1)).0" ;;
            patch) NEW="$MAJOR.$MINOR.$((PATCH+1))" ;;
          esac

          echo "new_version=$NEW" >> $GITHUB_OUTPUT
          echo "$NEW" > version.txt

      - name: Push version bump
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add version.txt
          git commit -m "chore(release): bump version to ${{ steps.version.outputs.new_version }}"
          git tag -a "v${{ steps.version.outputs.new_version }}" -m "Release v${{ steps.version.outputs.new_version }}"
          git push --follow-tags
```

### 7.3 客户端版本号映射

```dart
// client/lib/core/version.dart

class AppVersion {
  /// 从 pubspec.yaml 读取
  static String get versionName => BuildConfig.versionName;

  /// 构建号 = CI run number
  static int get buildNumber => BuildConfig.buildNumber;

  /// 完整版本字符串
  static String get fullVersion => '$versionName ($buildNumber)';

  /// 用于 API 请求的 User-Agent
  static String get userAgent =>
      'PrimeTop/$versionName (Build/$buildNumber; Flutter; ${Platform.operatingSystem})';

  /// 用于强制升级比较
  static int get versionCode {
    final parts = versionName.split('.');
    return parts.length >= 3
        ? int.parse(parts[0]) * 10000 + int.parse(parts[1]) * 100 + int.parse(parts[2])
        : 0;
  }
}
```

---

## 8. 回滚策略

### 8.1 服务端回滚

```bash
#!/bin/bash
# scripts/rollback.sh
# 用法: ./rollback.sh <namespace> [revision]

NAMESPACE=${1:?请指定命名空间, 如 primetop-production}
REVISION=${2:-0}  # 0 = 上一个版本

set -e

echo "🔄 回滚 $NAMESPACE ..."

# 查看部署历史
echo "📋 近期部署:"
kubectl -n "$NAMESPACE" rollout history deployment/primetop-server | tail -5

# 执行回滚
if [ "$REVISION" = "0" ]; then
  echo "⏪ 回滚到上一版本..."
  kubectl -n "$NAMESPACE" rollout undo deployment/primetop-server
else
  echo "⏪ 回滚到 revision $REVISION..."
  kubectl -n "$NAMESPACE" rollout undo deployment/primetop-server --to-revision="$REVISION"
fi

# 等待回滚完成
echo "⏳ 等待回滚完成..."
kubectl -n "$NAMESPACE" rollout status deployment/primetop-server --timeout=300s

# 验证
echo "✅ 当前部署版本:"
kubectl -n "$NAMESPACE" get deployment primetop-server -o jsonpath='{.spec.template.spec.containers[0].image}'

echo ""
echo "✅ Pod 状态:"
kubectl -n "$NAMESPACE" get pods -l app=primetop-server
```

### 8.2 客户端回滚

```markdown
Android 回滚:
  1. Google Play Console → 版本管理 → 生产轨道
  2. 选择上一个稳定版本 → "推至生产"
  3. 注意: Google Play 不支持 APK 降级, 只能推送更高版本号的旧代码

iOS 回滚:
  1. App Store Connect → 活动 → 所有构建版本
  2. 如未审核发布: 取消当前提交, 提交上一个 TestFlight 版本
  3. 如已发布: 无法直接回滚, 只能发布热修复版本
  4. 紧急情况: 通过远程配置关闭问题功能 (特性开关)

最佳实践:
  - 客户端无法强制回退, 因此发版前必须充分测试
  - 关键功能使用特性开关控制, 出问题可远程关闭
  - 保持上一个版本的构建产物至少 90 天
```

### 8.3 数据库变更回滚

```typescript
// server/src/migrations/20240101_001_create_users.ts

import { Migration } from '../migrator';

export class Migration20240101001 extends Migration {
  // 正向迁移
  async up(): Promise<void> {
    await this.query(`
      CREATE TABLE users (
        id          BIGSERIAL PRIMARY KEY,
        phone       VARCHAR(20) UNIQUE NOT NULL,
        nickname    VARCHAR(50),
        avatar_url  TEXT,
        grade       VARCHAR(20),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_users_phone ON users(phone);
    `);
  }

  // 回滚迁移
  async down(): Promise<void> {
    await this.query('DROP TABLE IF EXISTS users CASCADE');
  }
}
```

```
迁移策略:
  1. 每个迁移文件必须包含 up() 和 down()
  2. 部署前自动执行迁移, 迁移失败则中止部署
  3. 破坏性变更 (删列/改类型) 分两步:
     Step 1: 新增列/表 (兼容旧代码)
     Step 2: 下一个版本再删除旧列 (确保旧代码已不被使用)
  4. 大表变更使用 pt-online-schema-change 或 gh-ost 避免锁表
  5. 迁移执行前自动备份受影响的表
```

---

## 9. 构建通知与可视化

### 9.1 通知策略

```
通知渠道: 飞书群 / 企业微信群

通知事件:
  ┌─────────────────────┬───────────┬───────────┬───────────┐
  │ 事件                 │ dev       │ staging   │ prod      │
  ├─────────────────────┼───────────┼───────────┼───────────┤
  │ 构建开始             │ ❌        │ ❌        │ ✅         │
  │ 构建成功             │ ❌        │ ✅ (摘要)  │ ✅ (详细)  │
  │ 构建失败             │ ✅ (简略) │ ✅         │ ✅ + @全员 │
  │ 部署开始             │ ❌        │ ✅         │ ✅ + @全员 │
  │ 部署成功             │ ❌        │ ✅         │ ✅ + @全员 │
  │ 部署失败/回滚        │ ✅        │ ✅ + @负责人│ ✅ + @全员 │
  │ 安全扫描发现高危漏洞  │ ❌        │ ✅         │ ✅         │
  │ 覆盖率低于阈值       │ ❌        │ ✅         │ ✅         │
  └─────────────────────┴───────────┴───────────┴───────────┘
```

### 9.2 飞书通知模板

```typescript
// 通知消息体示例
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {
        "tag": "plain_text",
        "content": "🚀 生产部署成功"
      },
      "template": "green"  // green=成功, red=失败, yellow=进行中
    },
    "elements": [
      {
        "tag": "div",
        "text": {
          "tag": "lark_md",
          "content": "**版本:** v1.2.0 (sha-abc1234)\n**操作人:** zhangsan\n**环境:** production\n**时间:** 2024-01-15 14:30 UTC"
        }
      },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": { "content": "查看构建日志" },
            "url": "https://github.com/primetop/app/actions/runs/12345",
            "type": "default"
          },
          {
            "tag": "button",
            "text": { "content": "监控面板" },
            "url": "https://grafana.primetop.cn/d/production",
            "type": "primary"
          }
        ]
      }
    ]
  }
}
```

---

## 10. 安全扫描与质量门禁

### 10.1 质量门禁规则

```yaml
# .github/workflows/quality-gate.yml
# 所有 PR 必须通过的检查

quality-gates:
  # 代码质量
  - name: lint
    command: npm run lint
    fail_on: any_error

  - name: type-check
    command: npm run typecheck
    fail_on: any_error

  # 测试覆盖率
  - name: coverage
    rules:
      - metric: line_coverage
        threshold: 70%
        fail: below
      - metric: branch_coverage
        threshold: 60%
        fail: below

  # 依赖安全
  - name: npm-audit
    command: npm audit --audit-level=high
    fail_on: high_or_critical
    # 允许已知例外
    exceptions:
      - GHSA-xxxx-xxxx-xxxx  # 已评估，暂不修复

  # 客户端额外检查
  - name: flutter-analyze
    command: flutter analyze --fatal-infos
    fail_on: any_error

  - name: android-lint
    command: ./gradlew lint
    fail_on: any_error

  # 镜像安全 (仅服务端)
  - name: trivy-scan
    severity: CRITICAL,HIGH
    ignore_unfixed: true
    fail_on: critical
```

### 10.2 Dependabot 配置

```yaml
# .github/dependabot.yml
version: 2

updates:
  # 服务端 Node.js 依赖
  - package-ecosystem: npm
    directory: /server
    schedule:
      interval: weekly
      day: monday
      time: "02:00"
    open-pull-requests-limit: 5
    reviewers: [backend-team]
    labels: [dependencies, server]

  # 客户端 Flutter 依赖
  - package-ecosystem: pub
    directory: /client
    schedule:
      interval: weekly
      day: monday
      time: "02:00"
    open-pull-requests-limit: 5
    reviewers: [mobile-team]
    labels: [dependencies, client]

  # GitHub Actions 版本
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    labels: [dependencies, ci]

  # Docker 基础镜像
  - package-ecosystem: docker
    directory: /server
    schedule:
      interval: monthly
    labels: [dependencies, docker]
```

---

## 11. 监控与告警集成

### 11.1 部署后自动验证

```yaml
# 部署后自动执行的冒烟测试
post-deploy-smoke-test:
  name: Post-Deploy Smoke Test
  runs-on: ubuntu-latest
  steps:
    - name: Health check
      run: |
        for i in {1..10}; do
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${{ env.API_URL }}/health")
          if [ "$STATUS" = "200" ]; then
            echo "✅ Health check passed"
            break
          fi
          echo "⏳ Waiting... (attempt $i/10, status: $STATUS)"
          sleep 5
        done

    - name: API smoke tests
      run: |
        # 基础功能验证
        curl -sf $API_URL/api/v1/system/info | jq .

        # AI 模型连接验证
        curl -sf -X POST $API_URL/api/v1/ai/test \
          -H "Authorization: Bearer ${{ secrets.SMOKE_TEST_TOKEN }}" \
          -d '{"message":"hello","grade":"小学"}' | jq .

        # 数据库连接验证
        curl -sf $API_URL/api/v1/system/db-health | jq .

    - name: Metric validation
      run: |
        # 检查错误率是否正常
        ERROR_RATE=$(curl -sf "$PROMETHEUS_URL/api/v1/query?query=rate(http_requests_total{status=~\"5..\",namespace=\"$NAMESPACE\"}[5m])/rate(http_requests_total{namespace=\"$NAMESPACE\"}[5m])" | jq -r '.data.result[0].value[1] // "0"')

        if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )); then
          echo "❌ 错误率 ${ERROR_RATE} 超过 1%，可能需要回滚"
          exit 1
        fi
        echo "✅ 错误率正常: ${ERROR_RATE}"
```

### 11.2 关键监控指标

```
部署相关指标 (Grafana Dashboard):

  构建指标:
    - 构建成功率 (按分支/环境)
    - 平均构建耗时
    - 构建排队等待时间

  部署指标:
    - 部署频率 (每日/每周)
    - 部署成功率
    - 部署耗时 (从触发到完成)
    - 回滚次数和回滚率

  质量指标:
    - 测试覆盖率趋势
    - 安全漏洞发现数
    - 平均修复时间 (MTTR)

  生产稳定性:
    - 变更失败率 (导致事故的部署比例)
    - 平均恢复时间 (MTTR)
    - 错误率变化 (部署前后对比)
```

---

## 12. 客户端应用商店发布流程

### 12.1 Google Play 发布流程

```
发布轨道:
  内部测试 (≤100人)
      │
      ▼ 通过内部测试
  封闭测试 (邀请制)
      │
      ▼ QA 验证通过
  开放测试 (公开测试)
      │
      ▼ 稳定运行 + 数据验证
  生产发布 (全量推送)

步骤:
  1. CI 构建 AAB → 自动上传到内部测试轨道
  2. 产品经理 + QA 在内部测试验证
  3. 手动提升到封闭测试 → 分发灰度用户群
  4. 确认无问题后 → 手动提升到生产发布
  5. 设置灰度比例: 10% → 25% → 50% → 100%
  6. 每阶段观察 24h 错误率和用户反馈
```

### 12.2 App Store 发布流程

```
步骤:
  1. CI 构建 IPA → 上传到 TestFlight
  2. 内部测试 (TestFlight 分发)
  3. 提交 App Store 审核
  4. 审核通过后 → 手动发布
  5. 分阶段发布: Day1=1% → Day2=5% → Day3=25% → Day4=100%

注意事项:
  - App Store 审核周期 1-3 天, 紧急修复需走加急审核
  - 首次提审需准备: 隐私政策、用户协议、儿童隐私保护声明
  - 涉及 AI 功能需提供测试账号和功能说明
  - 教育类 APP 注意年龄分级设置
```

### 12.3 发布清单 (Release Checklist)

```markdown
## 发布前检查 (Release Checklist)

### 代码质量
- [ ] 所有 P0 Bug 已修复
- [ ] 代码审查完成 (≥2 人批准)
- [ ] 单元测试覆盖率达标 (≥70%)
- [ ] 集成测试全部通过
- [ ] 无已知安全漏洞 (high/critical)

### 功能验证
- [ ] 核心链路冒烟测试通过 (登录→AI问答→拍题→错题→学情)
- [ ] 新功能在目标学段设备上验证
- [ ] 弱网/离线场景测试通过
- [ ] 会员订阅与支付链路测试
- [ ] 家长控制功能验证
- [ ] 上一版本已知问题确认修复

### 兼容性
- [ ] Android: 最低 8.0 (API 26), 主流机型验证
- [ ] iOS: 最低 14.0, iPhone 8 ~ iPhone 15 Pro
- [ ] 平板适配验证 (iPad / Android Tablet)

### 合规与审核
- [ ] 隐私政策更新 (如有新数据采集)
- [ ] 用户协议更新 (如有新功能条款)
- [ ] AI 内容安全过滤已开启
- [ ] 未成年人保护机制验证
- [ ] 内容审核关键词库已更新

### 运维准备
- [ ] 灰度发布计划已确认
- [ ] 监控告警已配置
- [ ] 客服团队已同步新版本变更
- [ ] 回滚方案已确认
- [ ] 值班人员已排班
- [ ] 数据库迁移脚本已准备并测试

### 发布后
- [ ] 首小时监控: 错误率、崩溃率、API 成功率
- [ ] 用户反馈渠道关注
- [ ] 灰度数据确认无异常
- [ ] 发布日志记录归档
```

---

## 13. 灾备与紧急响应

### 13.1 构建系统故障

```
场景: GitHub Actions 不可用
影响: 无法自动构建和部署

应对:
  1. 本地构建脚本 (开发者本机可执行)
     - scripts/build-android-local.sh
     - scripts/build-ios-local.sh
     - scripts/build-server-local.sh
  2. 手动部署流程
     - scripts/deploy-manual.sh <environment> <image-tag>
  3. 保持最近 3 个版本的可部署产物
```

### 13.2 紧急修复流程

```
紧急修复 (hotfix) 流程:

  1. 从 main 创建 hotfix/ 分支
     git checkout -b hotfix/1.0.1 main

  2. 修复代码 + 补充测试

  3. 推送触发 CI
     git push origin hotfix/1.0.1

  4. CI 自动: 构建 → 测试 → 部署 staging → 验证

  5. 创建 PR → main (1 人审批即可)

  6. 合并后自动: 部署生产 → 冒烟测试 → 通知

  7. 同步回 develop
     git checkout develop
     git merge hotfix/1.0.1

  目标时间: 从发现问题到修复上线 ≤ 2 小时
```

---

## 14. 文件结构总览

```
primetop/
├── .github/
│   ├── workflows/
│   │   ├── client-android.yml       # Android CI/CD
│   │   ├── client-ios.yml           # iOS CI/CD
│   │   ├── server-ci.yml            # 服务端 CI
│   │   ├── server-deploy.yml        # 服务端部署
│   │   ├── quality-gate.yml         # 质量门禁
│   │   └── version.yml              # 版本号管理
│   ├── dependabot.yml               # 依赖自动更新
│   ├── CODEOWNERS                   # 代码所有权
│   └── PULL_REQUEST_TEMPLATE.md     # PR 模板
│
├── client/                          # Flutter 客户端
│   ├── lib/core/build_config.dart   # 构建配置
│   ├── lib/core/version.dart        # 版本管理
│   ├── android/app/build.gradle.kts # Android 构建配置
│   └── ios/fastlane/Fastfile        # iOS 构建脚本
│
├── server/                          # 服务端
│   ├── Dockerfile                   # 多阶段构建
│   ├── src/migrations/              # 数据库迁移
│   └── package.json
│
├── deploy/
│   ├── helm/primetop/               # Helm Chart
│   │   ├── Chart.yaml
│   │   ├── values.yaml
│   │   └── templates/
│   ├── environments/                # 环境配置
│   │   ├── staging.yaml
│   │   └── production.yaml
│   └── scripts/
│       ├── rollback.sh              # 回滚脚本
│       ├── build-android-local.sh   # 本地构建
│       ├── build-server-local.sh
│       └── deploy-manual.sh         # 手动部署
│
├── version.txt                      # 当前版本号
└── scripts/
    └── setup-ci-secrets.sh          # CI Secrets 初始化
```

---

## 15. MVP 阶段实施建议

### 15.1 第一步: 基础 CI (第1周)

```
优先实现:
  ✅ GitHub Actions 基础配置
  ✅ 客户端: lint + 单元测试 + APK 构建
  ✅ 服务端: lint + 单元测试 + Docker 构建
  ✅ PR 状态检查 (必须通过才能合并)
```

### 15.2 第二步: 自动部署 (第2-3周)

```
实现:
  ✅ Staging 环境自动部署
  ✅ Helm Chart 基础配置
  ✅ 构建通知 (飞书/企业微信)
  ✅ 数据库迁移自动化
```

### 15.3 第三步: 完善流程 (第4-6周)

```
实现:
  ✅ Production 部署 + 审批
  ✅ 灰度发布 (Canary)
  ✅ 回滚脚本
  ✅ iOS TestFlight 自动上传
  ✅ 安全扫描 (Dependabot + Trivy)
  ✅ 覆盖率报告
```

### 15.4 第四步: 持续优化 (后续迭代)

```
优化:
  🔧 构建缓存优化 (缩短构建时间)
  🔧 UI 自动化测试 (integration_test)
  🔧 客户端 OTA 热更新
  🔧 多环境数据库隔离
  🔧 构建性能监控面板
```
