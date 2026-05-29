# 服务端容器化与 Kubernetes 生产编排设计 - 详细设计文档

## 1. 模块概述

### 1.1 设计目标

本文档定义 PrimeTop 服务端的**生产级容器化构建策略**与 **Kubernetes 编排方案**，覆盖从 Docker 镜像构建、K8s 资源定义、多环境隔离到弹性伸缩的全链路设计。开发人员可基于本文档直接编写 Dockerfile、Helm Chart 和 K8s Manifest，无需再做技术选型决策。

现有《服务端服务架构与部署设计》文档已覆盖 Docker Compose 本地开发环境；本文档聚焦 **Kubernetes 生产环境**。

### 1.2 适用范围

| 范围 | 说明 |
|------|------|
| 镜像构建 | Dockerfile 编写、多阶段构建、镜像安全扫描 |
| K8s 编排 | Namespace、Deployment、StatefulSet、Job/CronJob |
| 配置管理 | ConfigMap、Secret、外部配置中心集成 |
| 流量管理 | Ingress、Service、流量切换策略 |
| 弹性伸缩 | HPA、VPA、Cluster Autoscaler |
| 存储管理 | PV/PVC、StorageClass |
| 发布策略 | 滚动更新、蓝绿发布、金丝雀发布 |
| 可观测集成 | Prometheus Operator、日志采集、链路追踪注入 |

### 1.3 环境规划

| 环境 | Namespace | 集群 | 用途 |
|------|-----------|------|------|
| dev | `primetop-dev` | 开发集群（单节点） | 开发联调 |
| staging | `primetop-staging` | 预发布集群（3节点） | 集成测试、性能验证 |
| production | `primetop-prod` | 生产集群（5+节点） | 线上服务 |
| production-dr | `primetop-dr` | 容灾集群 | 异地灾备（V2.0 阶段） |

---

## 2. Docker 镜像设计

### 2.1 镜像分层策略

```
┌─────────────────────────────────────┐
│  Layer 4: 应用代码（primetop/）       │  ← 变更频率：每次构建
├─────────────────────────────────────┤
│  Layer 3: Python 依赖（pip install） │  ← 变更频率：依赖变更时
├─────────────────────────────────────┤
│  Layer 2: 系统工具（curl, git 等）    │  ← 变更频率：极少
├─────────────────────────────────────┤
│  Layer 1: 基础镜像 python:3.12-slim  │  ← 变更频率：版本升级时
└─────────────────────────────────────┘
```

### 2.2 生产级 Dockerfile

```dockerfile
# ============================================================
# Stage 1: 构建阶段 - 编译依赖
# ============================================================
FROM python:3.12-slim AS builder

WORKDIR /build

# 安装构建工具（不进入最终镜像）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 先复制依赖文件，利用 Docker 缓存层
COPY pyproject.toml poetry.lock ./

# 安装依赖到独立目录
RUN pip install --no-cache-dir poetry==1.8.3 \
    && poetry config virtualenvs.create false \
    && poetry install --no-dev --no-interaction --no-ansi \
       --prefix /install

# ============================================================
# Stage 2: 运行阶段 - 最小化镜像
# ============================================================
FROM python:3.12-slim AS runtime

# 安全：使用非 root 用户
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

# 仅安装运行时必需的系统库
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/grpc/grpc-web/releases/download/v1.4.2/grpcwebproxy-v1.4.2-linux-x86_64 -o /usr/local/bin/grpcwebproxy \
    || true

# 从构建阶段复制 Python 包
COPY --from=builder /install /usr/local

WORKDIR /app

# 先复制非代码文件（配置等），再复制代码（变更最频繁的放最后）
COPY alembic.ini ./
COPY alembic/ ./alembic/
COPY primetop/ ./primetop/
COPY scripts/ ./scripts/

# 设置环境变量
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Shanghai

USER appuser

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health/live || exit 1

# 启动命令（生产使用 gunicorn + uvicorn worker）
CMD ["gunicorn", \
     "primetop.main:app", \
     "--workers", "4", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--max-requests", "5000", \
     "--max-requests-jitter", "500", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
```

### 2.3 数据服务镜像

#### 2.3.1 Celery Worker 镜像

```dockerfile
# 基于 runtime 阶段复用
FROM primetop-server:latest AS celery-worker

USER root
# Worker 额外需要的一些工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*
USER appuser

CMD ["celery", "-A", "primetop.celery_app", "worker", \
     "--loglevel=info", \
     "--concurrency=4", \
     "--max-tasks-per-child=100", \
     "--without-heartbeat", \
     "-Q", "default,ai-tasks,export-tasks"]
```

#### 2.3.2 Celery Beat 镜像

```dockerfile
FROM primetop-server:latest AS celery-beat

CMD ["celery", "-A", "primetop.celery_app", "beat", \
     "--loglevel=info", \
     "--scheduler", "celery.beat.PersistentScheduler"]
```

### 2.4 镜像标签与版本策略

```bash
# 标签格式
# <分支>-<短commit>-<构建号>   → 开发/测试环境
# <semver>                     → 生产环境
# latest                       → 最新开发版（仅 dev 环境）

# 示例
primetop-server:main-a1b2c3d-142          # 开发环境
primetop-server:release-1.2.0-rc1         # 预发布环境
primetop-server:1.2.0                      # 生产环境
primetop-server:1.2.0-hotfix.1            # 热修复版本
```

### 2.5 镜像安全扫描

```yaml
# .github/workflows/image-scan.yml
name: Image Security Scan
on:
  push:
    paths:
      - 'Dockerfile'
      - 'primetop/**'

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build image
        run: docker build -t primetop-server:scan .
      
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'primetop-server:scan'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'  # 发现高危漏洞时构建失败
      
      - name: Upload Trivy scan results
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: 'trivy-results.sarif'
```

---

## 3. Helm Chart 设计

### 3.1 Chart 目录结构

```
helm/primetop/
├── Chart.yaml                    # Chart 元数据
├── values.yaml                   # 默认值
├── values-dev.yaml               # 开发环境覆盖
├── values-staging.yaml           # 预发布环境覆盖
├── values-production.yaml        # 生产环境覆盖
├── .helmignore
├── templates/
│   ├── _helpers.tpl              # 模板辅助函数
│   ├── _pod_spec.yaml            # Pod 规范片段（复用）
│   │
│   ├── server-deployment.yaml    # API 服务 Deployment
│   ├── server-hpa.yaml           # API 服务 HPA
│   ├── server-service.yaml       # API 服务 Service
│   │
│   ├── celery-worker-deployment.yaml
│   ├── celery-beat-deployment.yaml
│   │
│   ├── migration-job.yaml        # 数据库迁移 Job
│   ├── seed-job.yaml             # 数据初始化 Job
│   │
│   ├── configmap.yaml            # 应用配置 ConfigMap
│   ├── secret.yaml               # 敏感配置 Secret
│   │
│   ├── ingress.yaml              # Ingress 规则
│   ├── certificate.yaml          # TLS 证书（cert-manager）
│   │
│   ├── pdb.yaml                  # Pod Disruption Budget
│   ├── networkpolicy.yaml        # 网络策略
│   │
│   ├── prometheusrule.yaml       # Prometheus 告警规则
│   ├── servicemonitor.yaml       # Prometheus 指标采集
│   │
│   └── NOTES.txt                 # 安装后提示
└── files/                        # 需要挂载的配置文件
    └── gunicorn.conf.py
```

### 3.2 Chart.yaml

```yaml
apiVersion: v2
name: primetop
description: PrimeTop 启硕 - 全学段AI辅助学习平台
type: application
version: 1.0.0          # Chart 版本（每次修改递增）
appVersion: "1.0.0"     # 应用版本
maintainers:
  - name: PrimeTop Team
keywords:
  - education
  - ai
  - learning
```

### 3.3 values.yaml（默认值）

```yaml
# ============================================================
# 全局配置
# ============================================================
global:
  imageRegistry: registry.cn-hangzhou.aliyuncs.com/primetop
  imagePullSecrets: []
  storageClass: "alicloud-disk-ssd"
  environment: "development"

# ============================================================
# API 服务配置
# ============================================================
server:
  enabled: true
  replicaCount: 2
  
  image:
    repository: primetop-server
    tag: "latest"
    pullPolicy: IfNotPresent
  
  resources:
    requests:
      cpu: "500m"
      memory: "512Mi"
    limits:
      cpu: "2000m"
      memory: "2048Mi"
  
  # 自动伸缩
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: 80
    # 自定义指标（RPS）
    customMetrics:
      - type: Pods
        pods:
          metric:
            name: http_requests_per_second
          target:
            type: AverageValue
            averageValue: "100"
  
  # 优雅停机
  terminationGracePeriodSeconds: 60
  lifecycle:
    preStop:
      exec:
        command: ["/bin/sh", "-c", "sleep 15"]  # 等待负载均衡器摘除
  
  # 就绪/存活探针
  readinessProbe:
    httpGet:
      path: /health/ready
      port: 8000
    initialDelaySeconds: 10
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 3
  
  livenessProbe:
    httpGet:
      path: /health/live
      port: 8000
    initialDelaySeconds: 30
    periodSeconds: 30
    timeoutSeconds: 5
    failureThreshold: 3
  
  # 启动探针（慢启动保护）
  startupProbe:
    httpGet:
      path: /health/live
      port: 8000
    initialDelaySeconds: 5
    periodSeconds: 5
    failureThreshold: 12  # 最多等待 60 秒
  
  # Pod 拓扑分布（高可用）
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: DoNotSchedule
      labelSelector:
        matchLabels:
          app.kubernetes.io/component: server
  
  # PDB
  podDisruptionBudget:
    minAvailable: 1
  
  service:
    type: ClusterIP
    port: 8000
  
  # 水平拆分策略（滚动更新）
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0     # 确保始终有足够副本可用

# ============================================================
# Celery Worker 配置
# ============================================================
celeryWorker:
  enabled: true
  replicaCount: 2
  
  image:
    repository: primetop-celery-worker
    tag: "latest"
    pullPolicy: IfNotPresent
  
  resources:
    requests:
      cpu: "500m"
      memory: "1Gi"
    limits:
      cpu: "2000m"
      memory: "4Gi"         # AI 任务需要较大内存
  
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 8
    targetCPUUtilizationPercentage: 75
  
  # Worker 队列配置
  queues: "default,ai-tasks,export-tasks"
  concurrency: 4
  maxTasksPerChild: 100     # 定期重启防止内存泄漏

# ============================================================
# Celery Beat 配置（单副本）
# ============================================================
celeryBeat:
  enabled: true
  replicaCount: 1
  
  image:
    repository: primetop-celery-beat
    tag: "latest"
    pullPolicy: IfNotPresent
  
  resources:
    requests:
      cpu: "100m"
      memory: "256Mi"
    limits:
      cpu: "500m"
      memory: "512Mi"

# ============================================================
# 数据库迁移 Job
# ============================================================
migration:
  enabled: true
  backoffLimit: 3
  activeDeadlineSeconds: 300
  resources:
    requests:
      cpu: "200m"
      memory: "256Mi"
    limits:
      cpu: "1000m"
      memory: "512Mi"

# ============================================================
# Ingress 配置
# ============================================================
ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/limit-connections: "20"
    nginx.ingress.kubernetes.io/proxy-body-size: "20m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "120"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "120"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/configuration-snippet: |
      more_set_headers "X-Content-Type-Options: nosniff";
      more_set_headers "X-Frame-Options: DENY";
      more_set_headers "X-XSS-Protection: 1; mode=block";
      more_set_headers "Referrer-Policy: strict-origin-when-cross-origin";
  hosts:
    - host: api.primetop.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: primetop-api-tls
      hosts:
        - api.primetop.com

# ============================================================
# 环境变量（ConfigMap + Secret）
# ============================================================
config:
  # 应用配置（ConfigMap）
  APP_NAME: "PrimeTop"
  APP_ENV: "production"
  LOG_LEVEL: "INFO"
  LOG_FORMAT: "json"
  
  DATABASE_POOL_SIZE: "20"
  DATABASE_MAX_OVERFLOW: "10"
  DATABASE_POOL_RECYCLE: "3600"
  
  REDIS_MAX_CONNECTIONS: "50"
  
  CELERY_BROKER_URL: "redis://redis:6379/1"
  CELERY_RESULT_BACKEND: "redis://redis:6379/2"
  
  # AI 模型配置
  AI_DEFAULT_PROVIDER: "zhipuai"
  AI_REQUEST_TIMEOUT: "120"
  AI_MAX_RETRIES: "3"
  
  # 业务配置
  FREE_USER_DAILY_LIMIT: "10"
  MEMBER_DAILY_LIMIT: "200"
  UPLOAD_MAX_SIZE_MB: "20"

secret:
  # 以下值通过 --set 或外部 secrets manager 注入
  DATABASE_URL: ""           # 必须注入
  REDIS_URL: ""              # 必须注入
  JWT_SECRET_KEY: ""         # 必须注入
  ZHIPUAI_API_KEY: ""        # 必须注入
  DEEPSEEK_API_KEY: ""       # 可选
  QWEN_API_KEY: ""           # 可选
  OSS_ACCESS_KEY: ""         # 必须注入
  OSS_SECRET_KEY: ""         # 必须注入
```

### 3.4 values-production.yaml（生产覆盖）

```yaml
global:
  environment: "production"

server:
  replicaCount: 4
  
  image:
    tag: ""                    # 部署时通过 --set server.image.tag 注入
    pullPolicy: Always
  
  resources:
    requests:
      cpu: "1000m"
      memory: "1Gi"
    limits:
      cpu: "4000m"
      memory: "4Gi"
  
  autoscaling:
    minReplicas: 4
    maxReplicas: 20
    targetCPUUtilizationPercentage: 60
  
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: DoNotSchedule
      labelSelector:
        matchLabels:
          app.kubernetes.io/component: server
    - maxSkew: 1
      topologyKey: kubernetes.io/hostname
      whenUnsatisfiable: ScheduleAnyway
      labelSelector:
        matchLabels:
          app.kubernetes.io/component: server
  
  podDisruptionBudget:
    minAvailable: 2

celeryWorker:
  replicaCount: 4
  resources:
    requests:
      cpu: "1000m"
      memory: "2Gi"
    limits:
      cpu: "4000m"
      memory: "8Gi"
  autoscaling:
    minReplicas: 4
    maxReplicas: 16

config:
  LOG_LEVEL: "WARNING"
  DATABASE_POOL_SIZE: "50"
  DATABASE_MAX_OVERFLOW: "20"
  REDIS_MAX_CONNECTIONS: "100"
  FREE_USER_DAILY_LIMIT: "10"
  MEMBER_DAILY_LIMIT: "500"
```

---

## 4. Kubernetes 资源定义

### 4.1 API 服务 Deployment

```yaml
# templates/server-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "primetop.fullname" . }}-server
  labels:
    {{- include "primetop.labels" . | nindent 4 }}
    app.kubernetes.io/component: server
spec:
  replicas: {{ .Values.server.replicaCount }}
  selector:
    matchLabels:
      {{- include "primetop.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: server
  
  {{- with .Values.server.strategy }}
  strategy:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  
  template:
    metadata:
      labels:
        {{- include "primetop.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: server
      annotations:
        # 配置变更时触发滚动更新
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
        checksum/secret: {{ include (print $.Template.BasePath "/secret.yaml") . | sha256sum }}
        # 链路追踪 sidecar 注入标记（如使用 OpenTelemetry Operator）
        sidecar.opentelemetry.io/inject: "true"
    spec:
      {{- with .Values.global.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      
      serviceAccountName: {{ include "primetop.serviceAccountName" . }}
      
      # 安全上下文
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      
      terminationGracePeriodSeconds: {{ .Values.server.terminationGracePeriodSeconds }}
      
      {{- with .Values.server.topologySpreadConstraints }}
      topologySpreadConstraints:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      
      initContainers:
        # 数据库就绪检查（等待数据库可用）
        - name: wait-for-db
          image: {{ .Values.global.imageRegistry }}/primetop-server:{{ .Values.server.image.tag }}
          command: ['python', '-c']
          args:
            - |
              import time, sys
              from sqlalchemy import create_engine, text
              import os
              db_url = os.environ['DATABASE_URL']
              for i in range(30):
                  try:
                      engine = create_engine(db_url)
                      with engine.connect() as conn:
                          conn.execute(text("SELECT 1"))
                      print("Database is ready!")
                      sys.exit(0)
                  except Exception as e:
                      print(f"Waiting for database... ({i+1}/30): {e}")
                      time.sleep(2)
              print("Database not ready after 60s")
              sys.exit(1)
          envFrom:
            - secretRef:
                name: {{ include "primetop.fullname" . }}-secret
      
      containers:
        - name: server
          image: "{{ .Values.global.imageRegistry }}/{{ .Values.server.image.repository }}:{{ .Values.server.image.tag }}"
          imagePullPolicy: {{ .Values.server.image.pullPolicy }}
          
          ports:
            - name: http
              containerPort: 8000
              protocol: TCP
            - name: metrics
              containerPort: 9090
              protocol: TCP
          
          env:
            # 静态环境变量
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
            - name: POD_IP
              valueFrom:
                fieldRef:
                  fieldPath: status.podIP
          
          envFrom:
            - configMapRef:
                name: {{ include "primetop.fullname" . }}-config
            - secretRef:
                name: {{ include "primetop.fullname" . }}-secret
          
          {{- with .Values.server.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          
          {{- with .Values.server.readinessProbe }}
          readinessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          
          {{- with .Values.server.livenessProbe }}
          livenessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          
          {{- with .Values.server.startupProbe }}
          startupProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          
          {{- with .Values.server.lifecycle }}
          lifecycle:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          
          # 安全上下文（容器级别）
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          
          # 临时目录（readOnlyRootFilesystem 需要挂载可写目录）
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: app-logs
              mountPath: /app/logs
      
      volumes:
        - name: tmp
          emptyDir: {}
        - name: app-logs
          emptyDir: {}
```

### 4.2 Service 定义

```yaml
# templates/server-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: {{ include "primetop.fullname" . }}-server
  labels:
    {{- include "primetop.labels" . | nindent 4 }}
    app.kubernetes.io/component: server
spec:
  type: {{ .Values.server.service.type }}
  ports:
    - name: http
      port: {{ .Values.server.service.port }}
      targetPort: http
      protocol: TCP
    - name: metrics
      port: 9090
      targetPort: metrics
      protocol: TCP
  selector:
    {{- include "primetop.selectorLabels" . | nindent 4 }}
    app.kubernetes.io/component: server
```

### 4.3 HPA 定义

```yaml
# templates/server-hpa.yaml
{{- if .Values.server.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "primetop.fullname" . }}-server
  labels:
    {{- include "primetop.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "primetop.fullname" . }}-server
  minReplicas: {{ .Values.server.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.server.autoscaling.maxReplicas }}
  metrics:
    {{- if .Values.server.autoscaling.targetCPUUtilizationPercentage }}
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.server.autoscaling.targetCPUUtilizationPercentage }}
    {{- end }}
    {{- if .Values.server.autoscaling.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ .Values.server.autoscaling.targetMemoryUtilizationPercentage }}
    {{- end }}
    {{- with .Values.server.autoscaling.customMetrics }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300    # 5 分钟稳定窗口，避免频繁缩容
      policies:
        - type: Percent
          value: 25                       # 每次最多缩容 25%
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100                      # 可以快速翻倍
          periodSeconds: 60
        - type: Pods
          value: 4                        # 或每次最多加 4 个
          periodSeconds: 60
      selectPolicy: Max
{{- end }}
```

### 4.4 数据库迁移 Job

```yaml
# templates/migration-job.yaml
{{- if .Values.migration.enabled }}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "primetop.fullname" . }}-migration-{{ .Release.Revision }}
  labels:
    {{- include "primetop.labels" . | nindent 4 }}
    app.kubernetes.io/component: migration
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  backoffLimit: {{ .Values.migration.backoffLimit }}
  activeDeadlineSeconds: {{ .Values.migration.activeDeadlineSeconds }}
  template:
    metadata:
      labels:
        {{- include "primetop.selectorLabels" . | nindent 8 }}
        app.kubernetes.io/component: migration
    spec:
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: migration
          image: "{{ .Values.global.imageRegistry }}/{{ .Values.server.image.repository }}:{{ .Values.server.image.tag }}"
          command: ["alembic", "upgrade", "head"]
          envFrom:
            - configMapRef:
                name: {{ include "primetop.fullname" . }}-config
            - secretRef:
                name: {{ include "primetop.fullname" . }}-secret
          {{- with .Values.migration.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
{{- end }}
```

### 4.5 Pod Disruption Budget

```yaml
# templates/pdb.yaml
{{- if .Values.server.podDisruptionBudget }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "primetop.fullname" . }}-server
  labels:
    {{- include "primetop.labels" . | nindent 4 }}
spec:
  selector:
    matchLabels:
      {{- include "primetop.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: server
  {{- if .Values.server.podDisruptionBudget.minAvailable }}
  minAvailable: {{ .Values.server.podDisruptionBudget.minAvailable }}
  {{- end }}
  {{- if .Values.server.podDisruptionBudget.maxUnavailable }}
  maxUnavailable: {{ .Values.server.podDisruptionBudget.maxUnavailable }}
  {{- end }}
{{- end }}
```

### 4.6 NetworkPolicy

```yaml
# templates/networkpolicy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "primetop.fullname" . }}-server
  labels:
    {{- include "primetop.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "primetop.selectorLabels" . | nindent 6 }}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # 只允许 Ingress Controller 访问 HTTP 端口
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - port: 8000
          protocol: TCP
    # 允许 Prometheus 抓取指标
    - from:
        - namespaceSelector:
            matchLabels:
              name: monitoring
      ports:
        - port: 9090
          protocol: TCP
  egress:
    # 允许 DNS 解析
    - to: []
      ports:
        - port: 53
          protocol: UDP
        - port: 53
          protocol: TCP
    # 允许访问数据库（同一集群内）
    - to:
        - namespaceSelector:
            matchLabels:
              name: primetop-data
      ports:
        - port: 3306
          protocol: TCP        # MySQL
        - port: 6379
          protocol: TCP        # Redis
    # 允许访问外部 AI API
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
      ports:
        - port: 443
          protocol: TCP
```

---

## 5. 数据服务 StatefulSet

### 5.1 MySQL（如自建）

> 生产环境推荐使用云服务商托管数据库（RDS），以下仅作自建参考。

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
  namespace: primetop-data
spec:
  serviceName: mysql
  replicas: 1                  # 主库单节点，从库通过 RDS 只读节点
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
        - name: mysql
          image: mysql:8.0
          env:
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secret
                  key: root-password
            - name: MYSQL_DATABASE
              value: primetop
          ports:
            - containerPort: 3306
          resources:
            requests:
              cpu: "1000m"
              memory: "2Gi"
            limits:
              cpu: "4000m"
              memory: "8Gi"
          volumeMounts:
            - name: mysql-data
              mountPath: /var/lib/mysql
            - name: mysql-config
              mountPath: /etc/mysql/conf.d
          livenessProbe:
            exec:
              command: ["mysqladmin", "ping", "-h", "localhost"]
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            exec:
              command: ["mysql", "-h", "localhost", "-e", "SELECT 1"]
            initialDelaySeconds: 10
            periodSeconds: 5
      volumes:
        - name: mysql-config
          configMap:
            name: mysql-config
  volumeClaimTemplates:
    - metadata:
        name: mysql-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: alicloud-disk-ssd
        resources:
          requests:
            storage: 200Gi
```

### 5.2 MySQL 配置 ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mysql-config
  namespace: primetop-data
data:
  custom.cnf: |
    [mysqld]
    # 字符集
    character-set-server = utf8mb4
    collation-server = utf8mb4_unicode_ci
    
    # InnoDB 优化
    innodb_buffer_pool_size = 4G
    innodb_log_file_size = 512M
    innodb_flush_method = O_DIRECT
    innodb_flush_log_at_trx_commit = 2
    
    # 连接数
    max_connections = 500
    max_connect_errors = 1000
    
    # 慢查询
    slow_query_log = ON
    long_query_time = 1
    slow_query_log_file = /var/lib/mysql/slow.log
    
    # 二进制日志（备份恢复用）
    log_bin = mysql-bin
    binlog_format = ROW
    binlog_retention_hours = 168
    
    [client]
    default-character-set = utf8mb4
```

---

## 6. 配置与密钥管理

### 6.1 敏感配置策略

```
┌──────────────────────────────────────────────────────────────┐
│                    配置层次架构                                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Level 1: 硬编码默认值（代码内）                               │
│  ↓ 覆盖                                                      │
│  Level 2: ConfigMap（K8s 原生，非敏感配置）                     │
│  ↓ 覆盖                                                      │
│  Level 3: Sealed Secrets / External Secrets（敏感配置）        │
│  ↓ 覆盖                                                      │
│  Level 4: 运行时配置中心（动态配置，无需重启）                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 External Secrets Operator 集成

```yaml
# 从阿里云 KMS / AWS Secrets Manager 同步密钥
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: primetop-secrets
  namespace: primetop-prod
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: alicloud-secret-store
    kind: ClusterSecretStore
  target:
    name: primetop-secret
    creationPolicy: Owner
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: primetop/database-url
    - secretKey: JWT_SECRET_KEY
      remoteRef:
        key: primetop/jwt-secret
    - secretKey: ZHIPUAI_API_KEY
      remoteRef:
        key: primetop/zhipuai-api-key
    - secretKey: OSS_ACCESS_KEY
      remoteRef:
        key: primetop/oss-access-key
    - secretKey: OSS_SECRET_KEY
      remoteRef:
        key: primetop/oss-secret-key
```

### 6.3 ConfigMap 动态热更新

应用代码中监听配置变更事件，结合已有的《配置中心与动态配置管理》模块：

```python
# primetop/core/config_watcher.py

import os
import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


class ConfigWatcher:
    """
    监听 Kubernetes ConfigMap 挂载文件的变更。
    
    K8s 会将 ConfigMap 挂载为符号链接目录，更新时原子性地切换符号链接。
    通过定期 stat 检测文件的修改时间来判断变更。
    """
    
    def __init__(
        self,
        watch_path: str = "/etc/primetop-config",
        poll_interval: float = 5.0,
        on_change: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        self.watch_path = Path(watch_path)
        self.poll_interval = poll_interval
        self.on_change = on_change
        self._mtime_cache: Dict[str, float] = {}
        self._running = False
        self._thread: Optional[threading.Thread] = None
    
    def start(self):
        """启动后台监听线程"""
        self._running = True
        self._thread = threading.Thread(target=self._watch_loop, daemon=True)
        self._thread.start()
        logger.info("ConfigWatcher started, watching %s", self.watch_path)
    
    def stop(self):
        """停止监听"""
        self._running = False
        if self._thread:
            self._thread.join(timeout=10)
    
    def _watch_loop(self):
        while self._running:
            try:
                self._check_changes()
            except Exception as e:
                logger.error("ConfigWatcher error: %s", e)
            time.sleep(self.poll_interval)
    
    def _check_changes(self):
        if not self.watch_path.exists():
            return
        
        changed = False
        current_config = {}
        
        for file_path in self.watch_path.iterdir():
            if file_path.is_file():
                stat = file_path.stat()
                current_mtime = stat.st_mtime
                key = file_path.name
                current_config[key] = file_path.read_text(encoding="utf-8").strip()
                
                if key not in self._mtime_cache or self._mtime_cache[key] != current_mtime:
                    changed = True
                    self._mtime_cache[key] = current_mtime
                    logger.info("Config changed: %s", key)
        
        if changed and self.on_change:
            self.on_change(current_config)


# 使用示例
def handle_config_change(new_config: dict):
    """配置变更回调"""
    # 例如更新日志级别
    if "LOG_LEVEL" in new_config:
        level = getattr(logging, new_config["LOG_LEVEL"].upper(), logging.INFO)
        logging.getLogger("primetop").setLevel(level)
        logger.info("Log level changed to %s", new_config["LOG_LEVEL"])
    
    # 更新业务配置
    if "FREE_USER_DAILY_LIMIT" in new_config:
        from primetop.core.app_config import update_runtime_config
        update_runtime_config("free_daily_limit", int(new_config["FREE_USER_DAILY_LIMIT"]))
```

---

## 7. 发布策略

### 7.1 滚动更新（默认策略）

```bash
# 标准部署
helm upgrade primetop ./helm/primetop \
  --namespace primetop-prod \
  -f values-production.yaml \
  --set server.image.tag=1.2.0 \
  --wait --timeout 5m

# 查看滚动状态
kubectl rollout status deployment/primetop-server -n primetop-prod

# 回滚
kubectl rollout undo deployment/primetop-server -n primetop-prod
kubectl rollout undo deployment/primetop-server -n primetop-prod --to-revision=2
```

### 7.2 金丝雀发布（Canary）

使用 Argo Rollouts 实现金丝雀发布：

```yaml
# 将 Deployment 替换为 Rollout
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: primetop-server
  namespace: primetop-prod
spec:
  replicas: 4
  strategy:
    canary:
      # 金丝雀步骤
      steps:
        - setWeight: 10          # 10% 流量到新版本
        - pause: {duration: 5m}  # 观察 5 分钟
        - setWeight: 30          # 30% 流量
        - pause: {duration: 5m}
        - setWeight: 50          # 50% 流量
        - pause: {duration: 10m}
        # 自动分析：检查错误率
        - analysis:
            templates:
              - templateName: error-rate-check
            args:
              - name: service-name
                value: primetop-server-canary
        - setWeight: 100         # 全量发布
      # 金丝雀服务配置
      canaryService: primetop-server-canary
      stableService: primetop-server-stable
      
      # 流量管理（Nginx Ingress）
      trafficRouting:
        nginx:
          stableIngress: primetop-server-ingress
```

### 7.3 发布分析模板

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: error-rate-check
spec:
  args:
    - name: service-name
  metrics:
    - name: error-rate
      interval: 30s
      count: 10
      successLimit: 8
      failureLimit: 3
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",status=~"5.."}[1m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[1m]))
          # 错误率阈值：5%
          successCondition: "result[0] < 0.05"
          failureCondition: "result[0] >= 0.05"
```

### 7.4 发布流程状态机

```
                    ┌──────────┐
                    │  构建镜像  │
                    └─────┬────┘
                          │ 推送到镜像仓库
                          ▼
                    ┌──────────┐
                    │ 部署staging│
                    └─────┬────┘
                          │ 自动化测试通过
                          ▼
                    ┌──────────┐
                    │ 人工审批   │ ← 产品负责人确认
                    └─────┬────┘
                          │ 审批通过
                          ▼
              ┌───────────────────────┐
              │ 金丝雀发布 (10% 流量)   │
              └───────────┬───────────┘
                          │ 监控 5 分钟，无异常
                          ▼
              ┌───────────────────────┐
              │ 扩大灰度 (50% 流量)    │
              └───────────┬───────────┘
                          │ 监控 10 分钟 + 自动分析
                          ▼
                    ┌─────────────┐
                    │ 全量发布 100% │
                    └──────┬──────┘
                           │ 异常？
                    ┌──────┴──────┐
                    │             │
               ┌────▼───┐   ┌────▼────┐
               │ 完成 ✅ │   │ 自动回滚 │
               └────────┘   └─────────┘
```

---

## 8. 可观测性集成

### 8.1 Prometheus ServiceMonitor

```yaml
# templates/servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "primetop.fullname" . }}-server
  labels:
    {{- include "primetop.labels" . | nindent 4 }}
    release: prometheus        # 匹配 Prometheus Operator 的 serviceMonitorSelector
spec:
  selector:
    matchLabels:
      {{- include "primetop.selectorLabels" . | nindent 6 }}
      app.kubernetes.io/component: server
  endpoints:
    - port: metrics
      path: /metrics
      interval: 15s
      scrapeTimeout: 10s
      honorLabels: true
```

### 8.2 Prometheus 告警规则

```yaml
# templates/prometheusrule.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: {{ include "primetop.fullname" . }}-alerts
  labels:
    {{- include "primetop.labels" . | nindent 4 }}
spec:
  groups:
    - name: primetop-server
      rules:
        # 5xx 错误率告警
        - alert: PrimeTopHighErrorRate
          expr: |
            sum(rate(http_requests_total{job="primetop-server",status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total{job="primetop-server"}[5m]))
            > 0.05
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "PrimeTop API 5xx 错误率超过 5%"
            description: "过去 5 分钟 5xx 错误率为 {{ $value | humanizePercentage }}"
        
        # P99 延迟告警
        - alert: PrimeTopHighLatency
          expr: |
            histogram_quantile(0.99, 
              sum(rate(http_request_duration_seconds_bucket{job="primetop-server"}[5m])) 
              by (le)
            ) > 5
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "PrimeTop API P99 延迟超过 5 秒"
        
        # Pod 重启告警
        - alert: PrimeTopPodRestarts
          expr: increase(kube_pod_container_status_restarts_total{namespace="primetop-prod"}[1h]) > 3
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.pod }} 在过去 1 小时内重启超过 3 次"
        
        # AI 模型调用超时
        - alert: PrimeTopAIModelTimeout
          expr: |
            sum(rate(ai_model_request_timeout_total[5m])) 
            / 
            sum(rate(ai_model_request_total[5m])) 
            > 0.1
          for: 3m
          labels:
            severity: critical
          annotations:
            summary: "AI 模型调用超时率超过 10%"
        
        # 数据库连接池耗尽
        - alert: PrimeTopDBPoolExhaustion
          expr: db_pool_usage_ratio > 0.9
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "数据库连接池使用率超过 90%"
        
        # HPA 达到上限
        - alert: PrimeTopHPAMaxedOut
          expr: kube_hpa_status_current_replicas == kube_hpa_spec_max_replicas
          for: 10m
          labels:
            severity: warning
          annotations:
            summary: "HPA 已达到最大副本数 {{ $value }}"
```

### 8.3 应用指标暴露

```python
# primetop/core/metrics.py

from prometheus_client import Counter, Histogram, Gauge, generate_latest
from fastapi import Response
from functools import wraps
import time


# ============================================================
# HTTP 指标
# ============================================================
HTTP_REQUEST_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"]
)

HTTP_REQUEST_DURATION = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration",
    ["method", "endpoint"],
    buckets=[0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0]
)

HTTP_REQUESTS_IN_PROGRESS = Gauge(
    "http_requests_in_progress",
    "HTTP requests currently in progress",
    ["method", "endpoint"]
)


# ============================================================
# 业务指标
# ============================================================
AI_MODEL_REQUEST_TOTAL = Counter(
    "ai_model_request_total",
    "Total AI model API requests",
    ["provider", "model", "status"]      # status: success, timeout, error
)

AI_MODEL_REQUEST_DURATION = Histogram(
    "ai_model_request_duration_seconds",
    "AI model request duration",
    ["provider", "model"],
    buckets=[1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0]
)

AI_MODEL_TOKEN_USAGE = Counter(
    "ai_model_token_usage_total",
    "Total tokens used",
    ["provider", "model", "type"]        # type: prompt, completion
)

OCR_REQUEST_TOTAL = Counter(
    "ocr_request_total",
    "Total OCR requests",
    ["status"]
)

QUESTION_PARSE_TOTAL = Counter(
    "question_parse_total",
    "Total question parsing attempts",
    ["subject", "status"]
)

ACTIVE_USERS_GAUGE = Gauge(
    "active_users",
    "Currently active users (5-min window)"
)

DB_POOL_USAGE = Gauge(
    "db_pool_usage_ratio",
    "Database connection pool usage ratio (0-1)",
    ["pool"]
)


# ============================================================
# FastAPI 中间件
# ============================================================
async def metrics_middleware(request, call_next):
    """Prometheus 指标采集中间件"""
    method = request.method
    # 简化 endpoint 路径，避免高基数标签
    path = request.url.path
    # 将动态路径参数归一化
    if path.startswith("/api/v1/users/") and len(path.split("/")) > 4:
        path = "/api/v1/users/{id}"
    elif path.startswith("/api/v1/questions/") and len(path.split("/")) > 4:
        path = "/api/v1/questions/{id}"
    
    HTTP_REQUESTS_IN_PROGRESS.labels(method=method, endpoint=path).inc()
    start_time = time.time()
    
    try:
        response = await call_next(request)
        duration = time.time() - start_time
        
        HTTP_REQUEST_TOTAL.labels(
            method=method, endpoint=path, status=response.status_code
        ).inc()
        HTTP_REQUEST_DURATION.labels(
            method=method, endpoint=path
        ).observe(duration)
        
        return response
    except Exception as e:
        HTTP_REQUEST_TOTAL.labels(
            method=method, endpoint=path, status=500
        ).inc()
        raise
    finally:
        HTTP_REQUESTS_IN_PROGRESS.labels(method=method, endpoint=path).dec()


def metrics_endpoint():
    """Prometheus 指标端点"""
    return Response(
        content=generate_latest(),
        media_type="text/plain; version=0.0.4; charset=utf-8"
    )
```

---

## 9. 资源配额与限制

### 9.1 Namespace ResourceQuota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: primetop-prod-quota
  namespace: primetop-prod
spec:
  hard:
    requests.cpu: "32"           # 总 CPU 请求上限
    requests.memory: 64Gi        # 总内存请求上限
    limits.cpu: "64"             # 总 CPU 限制上限
    limits.memory: 128Gi         # 总内存限制上限
    persistentvolumeclaims: "20" # PVC 数量上限
    pods: "100"                  # Pod 数量上限
    services: "20"               # Service 数量上限
    secrets: "50"                # Secret 数量上限
    configmaps: "50"             # ConfigMap 数量上限
```

### 9.2 LimitRange（默认资源限制）

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: primetop-default-limits
  namespace: primetop-prod
spec:
  limits:
    - type: Container
      default:
        cpu: "1000m"
        memory: "1Gi"
      defaultRequest:
        cpu: "100m"
        memory: "128Mi"
      max:
        cpu: "8000m"
        memory: "16Gi"
      min:
        cpu: "50m"
        memory: "64Mi"
    - type: Pod
      max:
        cpu: "16000m"
        memory: "32Gi"
```

### 9.3 各服务资源规划（生产环境）

| 服务 | 副本数 | CPU Request | CPU Limit | 内存 Request | 内存 Limit | 说明 |
|------|--------|-------------|-----------|-------------|-----------|------|
| API Server | 4-20 | 1C | 4C | 1Gi | 4Gi | HPA 弹性伸缩 |
| Celery Worker | 4-16 | 1C | 4C | 2Gi | 8Gi | AI 任务内存密集 |
| Celery Beat | 1 | 0.1C | 0.5C | 256Mi | 512Mi | 单副本定时调度 |
| MySQL（RDS） | 2 | - | 8C | - | 32Gi | 云托管，主从 |
| Redis（RDS） | 2 | - | 4C | - | 16Gi | 云托管，主从 |
| Milvus | 3 | 2C | 4C | 4Gi | 8Gi | 向量检索集群 |
| Elasticsearch | 3 | 2C | 4C | 4Gi | 8Gi | 全文检索集群 |
| RabbitMQ | 3 | 1C | 2C | 2Gi | 4Gi | 消息队列集群 |

---

## 10. 灾备与高可用

### 10.1 多可用区分布

```yaml
# 确保 Pod 分布在不同可用区
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app.kubernetes.io/component: server
```

### 10.2 备份策略

| 数据类型 | 备份方式 | 频率 | 保留周期 |
|----------|----------|------|----------|
| MySQL | 云 RDS 自动备份 + mysqldump 到 OSS | 每日全量 + 实时 binlog | 30 天 |
| Redis | RDB 快照 + AOF | 每 15 分钟 | 7 天 |
| Milvus | minio bucket 备份 | 每日 | 14 天 |
| Elasticsearch | Snapshot 到 OSS | 每日 | 14 天 |
| 对象存储 | 跨区域复制 | 实时 | 永久 |

### 10.3 数据库备份 CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mysql-backup
  namespace: primetop-data
spec:
  schedule: "0 3 * * *"          # 每天凌晨 3 点
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 7
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: mysql:8.0
              command:
                - /bin/bash
                - -c
                - |
                  DATE=$(date +%Y%m%d_%H%M%S)
                  DUMP_FILE="/tmp/primetop_${DATE}.sql.gz"
                  
                  # 执行备份
                  mysqldump \
                    -h ${MYSQL_HOST} \
                    -u ${MYSQL_USER} \
                    -p${MYSQL_PASSWORD} \
                    --single-transaction \
                    --routines \
                    --triggers \
                    --all-databases \
                    | gzip > ${DUMP_FILE}
                  
                  # 上传到 OSS
                  # 使用 ossutil 或 mc client
                  mc alias set minio ${OSS_ENDPOINT} ${OSS_ACCESS_KEY} ${OSS_SECRET_KEY}
                  mc cp ${DUMP_FILE} minio/primetop-backups/mysql/${DATE}.sql.gz
                  
                  # 清理本地临时文件
                  rm -f ${DUMP_FILE}
                  
                  echo "Backup completed: primetop_${DATE}.sql.gz"
              env:
                - name: MYSQL_HOST
                  valueFrom:
                    secretKeyRef:
                      name: mysql-secret
                      key: host
                - name: MYSQL_USER
                  valueFrom:
                    secretKeyRef:
                      name: mysql-secret
                      key: username
                - name: MYSQL_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: mysql-secret
                      key: password
                - name: OSS_ENDPOINT
                  valueFrom:
                    secretKeyRef:
                      name: oss-secret
                      key: endpoint
                - name: OSS_ACCESS_KEY
                  valueFrom:
                    secretKeyRef:
                      name: oss-secret
                      key: access-key
                - name: OSS_SECRET_KEY
                  valueFrom:
                    secretKeyRef:
                      name: oss-secret
                      key: secret-key
              resources:
                requests:
                  cpu: "200m"
                  memory: "512Mi"
                limits:
                  cpu: "1000m"
                  memory: "2Gi"
```

---

## 11. 部署操作手册

### 11.1 首次部署

```bash
# 1. 创建 Namespace
kubectl create namespace primetop-prod
kubectl label namespace primetop-prod name=primetop-prod

# 2. 创建镜像拉取密钥
kubectl create secret docker-registry aliyun-registry \
  --namespace=primetop-prod \
  --docker-server=registry.cn-hangzhou.aliyuncs.com \
  --docker-username="${DOCKER_USER}" \
  --docker-password="${DOCKER_PASS}"

# 3. 安装 External Secrets（如果使用）
kubectl apply -f infra/external-secrets/store.yaml
kubectl apply -f infra/external-secrets/externalsecret.yaml

# 4. 部署应用（含数据库迁移）
helm install primetop ./helm/primetop \
  --namespace primetop-prod \
  -f values-production.yaml \
  --set server.image.tag=1.0.0 \
  --wait --timeout 10m

# 5. 验证部署
kubectl get pods -n primetop-prod
kubectl get ingress -n primetop-prod
curl -f https://api.primetop.com/health/live
```

### 11.2 日常升级

```bash
# 标准升级
helm upgrade primetop ./helm/primetop \
  --namespace primetop-prod \
  -f values-production.yaml \
  --set server.image.tag=1.2.1 \
  --wait --timeout 5m

# 仅更新配置（不改镜像）
helm upgrade primetop ./helm/primetop \
  --namespace primetop-prod \
  -f values-production.yaml \
  --reuse-values

# 紧急回滚
helm rollback primetop 0          # 回到上一个版本
helm rollback primetop 2          # 回到指定版本
```

### 11.3 紧急操作

```bash
# 紧急扩容
kubectl scale deployment primetop-server --replicas=10 -n primetop-prod

# 紧急排空某个节点
kubectl drain node-worker-01 --ignore-daemonsets --delete-emptydir-data

# 查看最近的部署事件
kubectl get events -n primetop-prod --sort-by='.lastTimestamp' | tail -20

# 进入容器排查
kubectl exec -it deployment/primetop-server -n primetop-prod -- /bin/bash

# 查看 Pod 日志
kubectl logs -f deployment/primetop-server -n primetop-prod --tail=100

# 临时调整资源限制
kubectl patch deployment primetop-server -n primetop-prod \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"server","resources":{"limits":{"memory":"8Gi"}}}]}}}}'
```

---

## 12. CI/CD 集成

### 12.1 GitHub Actions 部署流水线

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    tags:
      - 'v*'

env:
  REGISTRY: registry.cn-hangzhou.aliyuncs.com
  IMAGE_NAME: primetop/primetop-server

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production    # 需要 GitHub Environment 审批
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.REGISTRY_USERNAME }}
          password: ${{ secrets.REGISTRY_PASSWORD }}
      
      - name: Extract version
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha
      
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      
      - name: Setup kubectl
        uses: azure/setup-kubectl@v3
        with:
          version: 'v1.29.0'
      
      - name: Configure kubeconfig
        run: |
          mkdir -p $HOME/.kube
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > $HOME/.kube/config
          chmod 600 $HOME/.kube/config
      
      - name: Deploy with Helm
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          helm upgrade primetop ./helm/primetop \
            --namespace primetop-prod \
            -f values-production.yaml \
            --set server.image.tag=${VERSION} \
            --set celeryWorker.image.tag=${VERSION} \
            --set celeryBeat.image.tag=${VERSION} \
            --wait \
            --timeout 5m
      
      - name: Verify deployment
        run: |
          sleep 10
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://api.primetop.com/health/live)
          if [ "$STATUS" != "200" ]; then
            echo "Health check failed! Status: $STATUS"
            kubectl logs -l app.kubernetes.io/component=server -n primetop-prod --tail=50
            exit 1
          fi
          echo "Deployment verified successfully!"
      
      - name: Notify on failure
        if: failure()
        run: |
          # 发送到飞书/钉钉/企业微信
          curl -X POST "${{ secrets.ALERT_WEBHOOK }}" \
            -H "Content-Type: application/json" \
            -d '{
              "msgtype": "text",
              "text": {
                "content": "⚠️ PrimeTop 生产部署失败！版本: ${GITHUB_REF#refs/tags/v}\n请立即检查: https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}"
              }
            }'
```

---

## 13. 安全加固

### 13.1 Pod 安全标准

```yaml
# 在 Namespace 级别强制安全策略
apiVersion: v1
kind: Namespace
metadata:
  name: primetop-prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

### 13.2 安全上下文清单

| 配置项 | 值 | 说明 |
|--------|------|------|
| `runAsNonRoot` | `true` | 禁止 root 运行 |
| `runAsUser` | `1000` | 使用非特权用户 |
| `readOnlyRootFilesystem` | `true` | 只读文件系统 |
| `allowPrivilegeEscalation` | `false` | 禁止提权 |
| `capabilities.drop` | `["ALL"]` | 丢弃所有 Linux 能力 |
| `seccompProfile` | `RuntimeDefault` | 使用默认 seccomp 配置 |

### 13.3 Secret 轮转

```bash
# 定期轮转 JWT 密钥（建议每 90 天）
# 1. 在 Secrets Manager 中更新密钥
# 2. External Secrets Operator 自动同步到 K8s Secret
# 3. 触发 Deployment 滚动更新
kubectl rollout restart deployment primetop-server -n primetop-prod
```

---

## 14. 成本优化

### 14.1 资源右调优策略

```bash
# 使用 kubectl resource-capacity 插件分析资源利用率
kubectl resource-capacity --sort cpu.request -n primetop-prod

# 使用 vertical-pod-autoscaler 推荐资源请求
kubectl apply -f https://github.com/kubernetes/autoscaler/releases/latest/download/vpa.yaml
# 创建 VPA 推荐（不自动应用）
```

### 14.2 VPA 推荐（仅建议模式）

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: primetop-server-vpa
  namespace: primetop-prod
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: primetop-server
  updatePolicy:
    updateMode: "Off"            # 仅推荐，不自动更新
  resourcePolicy:
    containerPolicies:
      - containerName: server
        minAllowed:
          cpu: 100m
          memory: 256Mi
        maxAllowed:
          cpu: "4"
          memory: 8Gi
```

### 14.3 Spot/抢占式实例策略

```yaml
# 对于 Celery Worker（无状态、可中断），使用抢占式实例
# 在 node 上打标签
# kubectl label nodes <spot-node> node-type=spot

# 在 Deployment 中添加节点亲和性
affinity:
  nodeAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        preference:
          matchExpressions:
            - key: node-type
              operator: In
              values:
                - spot
```

---

## 15. 迁移路径

### 15.1 从 Docker Compose 迁移到 K8s

```
Phase 1（MVP 阶段）:
  Docker Compose (单机部署)
    ↓
Phase 2（用户增长）:
  Docker Compose → K8s 单节点集群
  - 数据库先迁移到云 RDS
  - 应用服务容器化部署到 K8s
    ↓
Phase 3（规模扩展）:
  K8s 多节点集群 + 云服务
  - MySQL → 云 RDS
  - Redis → 云 Redis
  - OSS 替代本地文件存储
  - HPA 弹性伸缩
    ↓
Phase 4（高可用）:
  多可用区 + 灾备
  - 跨 AZ 部署
  - 异地灾备集群
  - 金丝雀发布
```

### 15.2 数据迁移检查清单

| 步骤 | 命令/操作 | 验证 |
|------|-----------|------|
| 1. 备份数据 | `mysqldump --single-transaction` | 检查备份文件完整性 |
| 2. 创建 K8s 集群 | 云控制台或 terraform | `kubectl get nodes` |
| 3. 部署数据服务 | RDS 创建 + 数据导入 | 应用连接测试 |
| 4. 部署应用服务 | `helm install` | 健康检查通过 |
| 5. 配置 DNS | 将域名指向 K8s Ingress | `curl https://api.primetop.com/health` |
| 6. 灰度切流 | 先 10% 流量到新集群 | 监控错误率和延迟 |
| 7. 全量切流 | 100% 流量切到 K8s | 监控 24 小时无异常 |
| 8. 下线旧环境 | 停止 Docker Compose 服务 | 保留 7 天可回退 |

---

## 16. 故障排查手册

### 16.1 常见问题与排查命令

| 现象 | 可能原因 | 排查命令 |
|------|----------|----------|
| Pod CrashLoopBackOff | 启动失败、OOM、配置错误 | `kubectl describe pod <pod> -n primetop-prod`<br>`kubectl logs <pod> -n primetop-prod --previous` |
| 5xx 错误增多 | 下游服务不可用、超时 | 查看 Prometheus 告警<br>`kubectl logs -l app=primetop-server --tail=100` |
| HPA 无法扩容 | 资源配额不足、集群节点满 | `kubectl describe hpa`<br>`kubectl get resourcequota -n primetop-prod` |
| 数据库连接超时 | 连接池耗尽、网络问题 | 检查 DB_POOL_USAGE 指标<br>`kubectl exec -it <pod> -- python -c "from primetop.core.database import engine; engine.connect()"` |
| 镜像拉取失败 | 镜像不存在、认证失败 | `kubectl describe pod <pod>` 查看事件<br>`kubectl get secret aliyun-registry -o yaml` |
| PVC 挂载失败 | 存储类不存在、配额不足 | `kubectl get sc`<br>`kubectl describe pvc <pvc>` |
| Ingress 502/503 | 后端 Pod 不健康、Service 选择器错误 | `kubectl get endpoints`<br>`kubectl describe ingress` |
| 金丝雀发布卡住 | 分析模板失败、指标异常 | `kubectl argo rollouts get rollout primetop-server` |

### 16.2 应急联系人模板

```
P0 级别（服务不可用）:
  - 值班工程师: [飞书/电话]
  - SRE 负责人: [飞书/电话]
  - 产品负责人: [飞书/电话]
  
响应时间: 5 分钟内响应，30 分钟内恢复或制定方案

P1 级别（功能降级）:
  - 值班工程师: [飞书/电话]
  
响应时间: 15 分钟内响应，2 小时内恢复
```

---

## 17. 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-29 | 初始版本：容器化构建、K8s 编排、Helm Chart、发布策略、可观测性、灾备 |
