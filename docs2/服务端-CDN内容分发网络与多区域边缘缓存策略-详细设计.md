# CDN 内容分发网络与多区域边缘缓存策略 - 详细设计

> 模块版本：v1.0 | 最后更新：2026-06-27
> 原始需求来源：`docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md` §8.6, §13.1, §13.2
> 依赖模块：文件与资源存储服务、教育内容多媒体转码、教育资源包管理、教材内容数字化生产线、客户端资源包下载管理器

---

## 1. 概述

### 1.1 模块定位

PrimeTop 作为面向全学段的 AI 辅助学习 APP，承载大量图片（题目配图、教材插图、手写识别）、音频（课文朗读、英语听力、口语示范）、视频（微课讲解、实验演示）和大文件（离线资源包）的分发。中国大陆网络环境存在**南北互通瓶颈、多运营商隔离、各地区网络质量差异大**等特殊性，需要一个专门的 CDN 内容分发层来保障所有用户（尤其是偏远地区和教育资源薄弱区域）的访问体验。

本模块是文件与资源存储服务（FRSS）的下游分发层，负责将存储层产出的内容高效、低成本、安全地交付到客户端。

### 1.2 核心职责

| 职责 | 说明 |
|------|------|
| **多 CDN 智能调度** | 根据用户运营商、地域、网络质量动态选择最优 CDN 节点 |
| **边缘缓存管理** | 管理全量资源的缓存生命周期、预热、刷新 |
| **动态加速** | 对不可缓存的动态 API 响应提供链路加速 |
| **图片优化管线** | 在边缘节点进行图片格式转换、压缩、裁剪、WebP/AVIF 自适应 |
| **流媒体分发** | HLS / DASH 视频流切片分发与码率自适应 |
| **大文件分发** | 离线资源包等大文件的分片分发与断点续传加速 |
| **安全防护** | 防盗链、URL 签名、IP 白名单、流量异常检测 |
| **成本治理** | 缓存命中率监控、冷内容回源控制、带宽预算管理 |

### 1.3 与其他模块的关系

```
┌──────────────────────────────────────────────────────────┐
│                   内容生产 & 存储层                        │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ FRSS     │  │ 多媒体转码    │  │ 教材内容数字化管线  │ │
│  │ (对象存储)│  │ (HLS/转码)   │  │ (PDF→HTML/JSON)    │ │
│  └────┬─────┘  └──────┬───────┘  └─────────┬──────────┘ │
│       └───────────────┼────────────────────┘            │
│                       │ 内容就绪事件                       │
└───────────────────────┼──────────────────────────────────┘
                        │
┌───────────────────────┼──────────────────────────────────┐
│                 CDN 分发层 (本模块)                        │
│                       ▼                                   │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              CDN 调度引擎 (Scheduler)                 │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │ │
│  │  │ 阿里云CDN │  │ 腾讯云CDN │  │ 华为云CDN │  ...     │ │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘          │ │
│  │       └─────────────┴─────────────┘                 │ │
│  │                    │                                 │ │
│  │   ┌────────────────┼────────────────┐               │ │
│  │   ▼                ▼                ▼               │ │
│  │ 图片优化       流媒体分发       大文件分发            │ │
│  │ (边缘处理)     (HLS/DASH)      (分片+断点续传)       │ │
│  └─────────────────────────────────────────────────────┘ │
│                       │                                   │
└───────────────────────┼──────────────────────────────────┘
                        │ HTTPS / HTTP/2 / HTTP/3(QUIC)
┌───────────────────────┼──────────────────────────────────┐
│                   客户端                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 图片加载  │  │ 音频播放  │  │ 视频播放  │              │
│  │ (Cache)  │  │ (Cache)  │  │ (Cache)  │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│  ┌──────────────────────────────────────┐              │
│  │       资源包下载管理器                 │              │
│  └──────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
```

### 1.4 性能目标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| CDN 缓存命中率 | ≥ 95% | 静态资源 30 天维度 |
| 首字节时间 (TTFB) | ≤ 50ms | 边缘节点命中场景 |
| 图片加载完成时间 | ≤ 200ms | 100KB 等效 WebP，4G 网络 |
| 视频 HLS 起播时间 | ≤ 800ms | 首片加载时间 |
| 资源包下载速度 | ≥ 5 MB/s | 平均下载速度，5G/WiFi |
| 回源率 | ≤ 5% | 正常运行期间 |
| 多 CDN 切换时间 | ≤ 30s | 故障切换感知时间 |
| 月度带宽成本 | ≤ 0.12 元/GB | 综合加权成本 |

---

## 2. 数据模型

### 2.1 CDN 域名与加速区域配置

```sql
-- CDN 域名配置表
CREATE TABLE cdn_domain_config (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    domain          VARCHAR(255) NOT NULL UNIQUE,      -- CDN 加速域名，如 img-cdn.primetop.com
    domain_type     VARCHAR(32)  NOT NULL,             -- 域名类型：image/audio/video/package/api
    origin_domain   VARCHAR(255) NOT NULL,             -- 源站域名，如 oss-cn-beijing.aliyuncs.com
    origin_protocol VARCHAR(16)  NOT NULL DEFAULT 'https', -- 回源协议
    https_enabled   TINYINT(1)   NOT NULL DEFAULT 1,   -- 是否启用 HTTPS
    http2_enabled   TINYINT(1)   NOT NULL DEFAULT 1,   -- 是否启用 HTTP/2
    quic_enabled    TINYINT(1)   NOT NULL DEFAULT 0,   -- 是否启用 HTTP/3 (QUIC)
    ip_whitelist    JSON,                               -- IP 白名单（管理后台访问）
    auth_type       VARCHAR(32)  DEFAULT 'typeA',       -- URL 鉴权类型：typeA/typeB/typeC/none
    auth_key        VARCHAR(128),                       -- URL 鉴权密钥
    auth_ttl        INT          DEFAULT 1800,          -- 鉴权 URL 有效期（秒）
    status          VARCHAR(16)  NOT NULL DEFAULT 'active', -- active/inactive/maintaining
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (domain_type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CDN 域名配置';
```

### 2.2 CDN 供应商与线路配置

```sql
-- CDN 供应商配置表
CREATE TABLE cdn_provider (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    provider_code   VARCHAR(32)  NOT NULL UNIQUE,      -- 供应商编码：aliyun/tencent/huawei/wangsu/baidu
    provider_name   VARCHAR(64)  NOT NULL,             -- 供应商名称
    api_endpoint    VARCHAR(255) NOT NULL,             -- API 地址
    api_access_key  VARCHAR(255) NOT NULL,             -- API AccessKey (加密存储)
    api_secret_key  VARCHAR(255) NOT NULL,             -- API SecretKey (加密存储)
    weight          INT          NOT NULL DEFAULT 100, -- 调度权重 (0-100)
    priority        INT          NOT NULL DEFAULT 1,   -- 优先级 (1=主, 2=备)
    max_bandwidth   BIGINT       NOT NULL DEFAULT 0,   -- 最大带宽上限 (bps)，0=不限
    billing_cycle   VARCHAR(16)  NOT NULL DEFAULT 'monthly', -- 计费周期
    billing_mode    VARCHAR(32)  NOT NULL DEFAULT 'traffic', -- traffic=按流量, bandwidth=按带宽峰值, hybrid=混合
    traffic_quota   BIGINT       NOT NULL DEFAULT 0,   -- 月度流量配额 (bytes)，0=不限
    traffic_used    BIGINT       NOT NULL DEFAULT 0,   -- 当月已用流量 (bytes)
    bandwidth_used  BIGINT       NOT NULL DEFAULT 0,   -- 当前带宽使用 (bps)
    health_status   VARCHAR(16)  NOT NULL DEFAULT 'healthy', -- healthy/degraded/down
    last_health_at  DATETIME,                          -- 最后健康检查时间
    config_json     JSON,                               -- 供应商特有配置
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status_priority (status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CDN 供应商配置';

-- CDN 线路与运营商映射表
CREATE TABLE cdn_route_policy (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    route_name      VARCHAR(64)  NOT NULL,             -- 路线名称
    isp_code        VARCHAR(32)  NOT NULL,             -- 运营商：telecom/unicom/mobile/other
    region_code     VARCHAR(32)  NOT NULL DEFAULT '*', -- 地域：north/south/east/west/southwest/northeast/*
    provider_id     BIGINT       NOT NULL,             -- 关联 cdn_provider.id
    weight          INT          NOT NULL DEFAULT 100, -- 该路线下此供应商权重
    fallback_provider_id BIGINT,                       -- 故障兜底供应商
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_isp_region (isp_code, region_code, status),
    INDEX idx_provider (provider_id),
    FOREIGN KEY (provider_id) REFERENCES cdn_provider(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CDN 线路策略';
```

### 2.3 缓存规则配置

```sql
-- 缓存规则表（按域名 + 路径模式匹配）
CREATE TABLE cdn_cache_rule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    domain_id       BIGINT       NOT NULL,             -- 关联 cdn_domain_config.id
    rule_name       VARCHAR(64)  NOT NULL,             -- 规则名称
    path_pattern    VARCHAR(255) NOT NULL,             -- 路径匹配模式（正则），如 /image/.*\.(jpg|png|webp)$
    cache_ttl       INT          NOT NULL,             -- 缓存有效期（秒），-1=不缓存，0=遵循源站
    priority        INT          NOT NULL DEFAULT 0,   -- 优先级，数值越大越先匹配
    ignore_query_string TINYINT(1) NOT NULL DEFAULT 1, -- 是否忽略 URL 查询参数
    ignore_set_cookie   TINYINT(1) NOT NULL DEFAULT 1, -- 是否忽略 Set-Cookie 头
    gzip_enabled    TINYINT(1)   NOT NULL DEFAULT 1,   -- 是否启用 Gzip
    brotli_enabled  TINYINT(1)   NOT NULL DEFAULT 1,   -- 是否启用 Brotli
    webp_enabled    TINYINT(1)   NOT NULL DEFAULT 0,   -- 是否启用边缘 WebP 转换
    avif_enabled    TINYINT(1)   NOT NULL DEFAULT 0,   -- 是否启用边缘 AVIF 转换
    resize_enabled  TINYINT(1)   NOT NULL DEFAULT 0,   -- 是否启用边缘缩放裁剪
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_domain_priority (domain_id, priority DESC),
    FOREIGN KEY (domain_id) REFERENCES cdn_domain_config(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CDN 缓存规则';
```

### 2.4 内容预热任务

```sql
-- 内容预热任务表
CREATE TABLE cdn_warmup_task (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_name       VARCHAR(128) NOT NULL,             -- 任务名称
    domain_id       BIGINT       NOT NULL,             -- 关联域名
    url_list        LONGTEXT     NOT NULL,             -- 预热 URL 列表（JSON 数组）
    url_count       INT          NOT NULL,             -- URL 总数
    warmed_count    INT          NOT NULL DEFAULT 0,   -- 已预热数量
    failed_count    INT          NOT NULL DEFAULT 0,   -- 失败数量
    failed_urls     LONGTEXT,                          -- 失败 URL 详情 (JSON)
    provider_ids    VARCHAR(255),                      -- 指定供应商 ID 列表（逗号分隔），空=全部
    priority        VARCHAR(16)  NOT NULL DEFAULT 'normal', -- low/normal/high/urgent
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending/running/completed/failed/partial
    scheduled_at    DATETIME,                          -- 计划执行时间
    started_at      DATETIME,                          -- 实际开始时间
    completed_at    DATETIME,                          -- 完成时间
    created_by      VARCHAR(64)  NOT NULL,             -- 创建人
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status_scheduled (status, scheduled_at),
    INDEX idx_domain (domain_id),
    FOREIGN KEY (domain_id) REFERENCES cdn_domain_config(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CDN 内容预热任务';

-- 缓存刷新任务表
CREATE TABLE cdn_refresh_task (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_type       VARCHAR(16)  NOT NULL,             -- flush_url=URL刷新, flush_dir=目录刷新, push=预热
    domain_id       BIGINT       NOT NULL,
    target_list     LONGTEXT     NOT NULL,             -- 目标 URL 或目录列表（JSON 数组）
    target_count    INT          NOT NULL,
    provider_ids    VARCHAR(255),                      -- 指定供应商
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending/running/completed/failed/partial
    result_detail   JSON,                               -- 各供应商执行结果
    triggered_by    VARCHAR(64)  NOT NULL,             -- 触发来源：manual/content_update/version_rollback/scheduled
    related_entity  VARCHAR(128),                      -- 关联实体标识（如教材版本ID、资源包ID）
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME,
    INDEX idx_status (status),
    INDEX idx_triggered (triggered_by),
    INDEX idx_domain (domain_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CDN 缓存刷新任务';
```

### 2.5 CDN 监控指标采集

```sql
-- CDN 实时监控指标（按 5 分钟粒度汇总）
CREATE TABLE cdn_metrics_5min (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    provider_id     BIGINT       NOT NULL,
    domain          VARCHAR(255) NOT NULL,
    isp_code        VARCHAR(32)  NOT NULL,             -- 运营商
    region_code     VARCHAR(32)  NOT NULL,             -- 地域
    stat_time       DATETIME     NOT NULL,             -- 统计时间点（5分钟对齐）
    -- 流量指标
    request_count   BIGINT       NOT NULL DEFAULT 0,   -- 请求数
    hit_count       BIGINT       NOT NULL DEFAULT 0,   -- 缓存命中数
    miss_count      BIGINT       NOT NULL DEFAULT 0,   -- 未命中数
    traffic_bytes   BIGINT       NOT NULL DEFAULT 0,   -- 下行流量 (bytes)
    bandwidth_bps   BIGINT       NOT NULL DEFAULT 0,   -- 峰值带宽 (bps)
    back_to_origin  BIGINT       NOT NULL DEFAULT 0,   -- 回源流量 (bytes)
    -- 性能指标
    avg_ttfb_ms     DECIMAL(8,2) NOT NULL DEFAULT 0,   -- 平均首字节时间 (ms)
    p95_ttfb_ms     DECIMAL(8,2) NOT NULL DEFAULT 0,   -- P95 首字节时间
    p99_ttfb_ms     DECIMAL(8,2) NOT NULL DEFAULT 0,   -- P99 首字节时间
    avg_download_speed BIGINT    NOT NULL DEFAULT 0,   -- 平均下载速度 (B/s)
    -- 错误指标
    error_4xx_count BIGINT       NOT NULL DEFAULT 0,
    error_5xx_count BIGINT       NOT NULL DEFAULT 0,
    timeout_count   BIGINT       NOT NULL DEFAULT 0,
    -- 估算成本
    estimated_cost  DECIMAL(10,4) NOT NULL DEFAULT 0,  -- 估算费用 (元)
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_metrics (provider_id, domain, isp_code, region_code, stat_time),
    INDEX idx_stat_time (stat_time),
    INDEX idx_domain_time (domain, stat_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='CDN 5分钟监控指标';

-- 按月分区（自动建表脚本中按月生成分区）
-- ALTER TABLE cdn_metrics_5min PARTITION BY RANGE (TO_DAYS(stat_time)) (...)
```

---

## 3. CDN 调度引擎设计

### 3.1 调度策略概览

```
                    用户请求
                        │
                        ▼
              ┌──────────────────┐
              │  DNS 智能解析     │  ← 根据用户 LocalDNS 判断运营商 & 地域
              │  (HTTPDNS 优先)  │
              └────────┬─────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌─────────┐  ┌─────────┐  ┌─────────┐
    │ 电信用户 │  │ 联通用户 │  │ 移动用户 │
    └────┬────┘  └────┬────┘  └────┬────┘
         │            │            │
         ▼            ▼            ▼
    ┌─────────────────────────────────────┐
    │       CDN 调度决策引擎               │
    │                                     │
    │  Step 1: 运营商 + 地域 → 候选线路     │
    │  Step 2: 健康状态过滤                │
    │  Step 3: 权重 + 优先级 + 成本计算     │
    │  Step 4: 带额配额检查                │
    │  Step 5: 输出最优 CDN CNAME          │
    └─────────────────────────────────────┘
```

### 3.2 DNS 智能解析策略

PrimeTop 采用 **自建 HTTPDNS + DNS提供商智能解析** 双通道方案。

```yaml
# dns 解析配置
dns_strategy:
  # 主通道：HTTPDNS（客户端 SDK 内置）
  httpdns:
    enabled: true
    providers:
      - aliyun_httpdns   # 阿里云 HTTPDNS
      - tencent_httpDNS  # 腾讯云 HttpDNS
    fallback_ttl: 300    # HTTPDNS 不可用时本地 DNS TTL
    cache_ttl: 60        # 客户端缓存 60 秒
    ip_update_interval: 120  # IP 库更新频率（秒）

  # 备通道：DNS 智能解析
  dns:
    enabled: true
    providers:
      - aliyun_dns        # 阿里云解析（电信线路优化）
      - dns_pod           # DNSPod（联通/移动线路优化）
    resolution_rules:
      - isp: telecom
        region: south
        cname: telecom-south.cdn.primetop.com
      - isp: telecom
        region: north
        cname: telecom-north.cdn.primetop.com
      - isp: unicom
        cname: unicom.cdn.primetop.com
      - isp: mobile
        cname: mobile.cdn.primetop.com
      - isp: other
        cname: default.cdn.primetop.com
```

### 3.3 调度决策引擎

```java
/**
 * CDN 调度决策引擎
 * 根据用户运营商、地域、各供应商健康状态、权重和成本计算最优 CDN 线路
 */
@Service
public class CdnScheduleEngine {

    @Autowired
    private CdnProviderRepository providerRepo;
    @Autowired
    private CdnRoutePolicyRepository routeRepo;
    @Autowired
    private CdnHealthMonitor healthMonitor;
    @Autowired
    private CdnMetricsService metricsService;

    // 域名类型 → 默认供应商优先级
    private static final Map<String, List<String>> DOMAIN_TYPE_PREFERENCE = Map.of(
        "image",   List.of("aliyun", "tencent", "huawei"),
        "audio",   List.of("tencent", "aliyun", "wangsu"),
        "video",   List.of("aliyun", "tencent", "huawei"),
        "package", List.of("huawei", "aliyun", "tencent"),  // 大文件华为云性价比好
        "api",     List.of("aliyun", "tencent")             // 动态加速
    );

    /**
     * 核心调度方法
     * @param request 调度请求
     * @return 调度结果
     */
    public ScheduleResult schedule(ScheduleRequest request) {
        String domainType = request.getDomainType();
        String ispCode = request.getIspCode();
        String regionCode = request.getRegionCode();

        // 1. 获取域名类型偏好的供应商列表
        List<String> preferredProviders = DOMAIN_TYPE_PREFERENCE
            .getOrDefault(domainType, List.of("aliyun", "tencent"));

        // 2. 查询该运营商 + 地域下的线路策略
        List<CdnRoutePolicy> routes = routeRepo.findRoutes(ispCode, regionCode);

        // 3. 过滤健康状态异常的供应商
        List<CdnRoutePolicy> healthyRoutes = routes.stream()
            .filter(r -> healthMonitor.isHealthy(r.getProviderId()))
            .filter(r -> {
                CdnProvider p = providerRepo.findById(r.getProviderId());
                // 检查流量配额
                if (p.getTrafficQuota() > 0 && p.getTrafficUsed() >= p.getTrafficQuota()) {
                    return false; // 已超出配额
                }
                return "active".equals(p.getStatus());
            })
            .collect(Collectors.toList());

        if (healthyRoutes.isEmpty()) {
            // 全部不健康，走兜底
            return fallbackSchedule(request);
        }

        // 4. 按域名偏好排序，加权随机
        List<WeightedCandidate> candidates = new ArrayList<>();
        for (CdnRoutePolicy route : healthyRoutes) {
            CdnProvider provider = providerRepo.findById(route.getProviderId());
            int preferenceScore = preferredProviders.indexOf(provider.getProviderCode());
            int weight = route.getWeight();

            // 根据近期性能动态调整权重
            double avgTtfb = metricsService.getRecentAvgTtfb(
                provider.getId(), request.getDomain(), ispCode, regionCode,
                Duration.ofMinutes(30)
            );
            if (avgTtfb > 200) {
                weight = (int)(weight * 0.5); // TTFB > 200ms 降权
            } else if (avgTtfb > 100) {
                weight = (int)(weight * 0.8);
            }

            // 根据当前带宽利用率降权
            double bandwidthUtilization = provider.getBandwidthUsed() * 1.0
                / Math.max(provider.getMaxBandwidth(), 1);
            if (bandwidthUtilization > 0.8) {
                weight = (int)(weight * (1 - bandwidthUtilization));
            }

            candidates.add(new WeightedCandidate(provider, Math.max(weight, 1)));
        }

        // 5. 加权随机选择
        CdnProvider selected = weightedRandom(candidates);

        return ScheduleResult.builder()
            .providerCode(selected.getProviderCode())
            .cname(buildCname(selected, domainType, ispCode))
            .expireAt(LocalDateTime.now().plusSeconds(60))
            .backupProviderCode(candidates.size() > 1
                ? findBackup(candidates, selected).getProviderCode()
                : null)
            .build();
    }

    /**
     * 兜底策略：所有供应商不可用时的降级方案
     */
    private ScheduleResult fallbackSchedule(ScheduleRequest request) {
        // 直接回源
        return ScheduleResult.builder()
            .providerCode("direct_origin")
            .cname(request.getOriginDomain())
            .expireAt(LocalDateTime.now().plusSeconds(30))
            .degraded(true)
            .degradeReason("ALL_CDN_UNHEALTHY")
            .build();
    }

    private String weightedRandom(List<WeightedCandidate> candidates) { /* ... */ }
    private String buildCname(CdnProvider p, String type, String isp) { /* ... */ }
}
```

### 3.4 域名规划

按内容类型和运营商规划独立域名，最大化 CDN 缓存利用率并便于精细管理。

| 域名 | 类型 | 用途 | 示例内容 |
|------|------|------|----------|
| `img-cdn.primetop.com` | image | 图片资源 | 题目配图、教材插图、用户头像、手写图片 |
| `aud-cdn.primetop.com` | audio | 音频资源 | 课文朗读、英语听力、发音示范 |
| `vid-cdn.primetop.com` | video | 视频资源 | 微课视频、实验演示、动画讲解 |
| `pkg-cdn.primetop.com` | package | 大文件资源 | 离线资源包、教材电子版、完整题库包 |
| `static-cdn.primetop.com` | static | 静态资源 | H5 页面、JS、CSS、字体文件、图标 |
| `dyn-cdn.primetop.com` | api | 动态加速 | 不可缓存的 API 响应加速 |

> **域名分片策略**：HTTP/1.1 下浏览器对单域名并发连接数有限制（通常 6 个），通过域名分片提升并行加载数。HTTP/2+ 场景下合并域名以减少连接开销。客户端 SDK 根据协议版本自适应。

---

## 4. 缓存策略设计

### 4.1 缓存层级

```
┌──────────────────────────────────────────────────────────────┐
│                     L1: 客户端本地缓存                         │
│  Flutter cached_network_image + 自定义 LRU 磁盘缓存            │
│  TTL: 图片 7 天 / 音频 30 天 / 视频 7 天 / 资源包 永久           │
│  容量上限: 500 MB (可配置)                                     │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                     L2: CDN 边缘节点缓存                       │
│  按内容类型设置差异化 TTL                                       │
│  LRU 淘汰 + 主动刷新                                           │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│                     L3: 源站 (对象存储 OSS)                     │
│  权威数据源                                                    │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 缓存 TTL 规则

按内容类型设置差异化 TTL：

| 内容类型 | 路径模式 | CDN TTL | 客户端 TTL | 说明 |
|----------|----------|---------|-----------|------|
| 教材版本图片 | `/textbook/v{version}/image/**` | 30 天 | 7 天 | 版本化路径，永不变更 |
| 题目配图 | `/question/**` | 30 天 | 7 天 | 题目图片不变 |
| 用户头像 | `/avatar/**` | 1 小时 | 1 小时 | 可能更换 |
| 用户上传图片 | `/upload/**` | 7 天 | 不缓存 | 隐私数据，不长期缓存 |
| 课文音频 | `/audio/textbook/v{version}/**` | 30 天 | 30 天 | 版本化 |
| 英语听力音频 | `/audio/listening/**` | 30 天 | 30 天 | |
| 微课视频 HLS | `/video/hls/{id}/**` | 7 天 | 不缓存 | 流量大，靠 CDN 缓存 |
| 微课视频 TS 片段 | `/video/hls/{id}/*.ts` | 30 天 | 不缓存 | 切片不变 |
| 离线资源包 | `/pkg/v{version}/**` | 90 天 | 永久 | 版本化大文件 |
| H5 静态资源 | `/static/**` | 7 天 | 1 天 | 带 hash，可长期缓存 |
| 管理后台上传 | `/cms/**` | 1 小时 | 不缓存 | 可能频繁修改 |

### 4.3 缓存 Key 设计

```
Cache-Key = {path}?{sorted_significant_params}

# 忽略不影响的查询参数，只保留与内容相关的参数
# 示例：图片缩放请求
原始 URL: /textbook/v2/image/ch3_p15.jpg?w=750&h=1000&format=webp&q=80&timestamp=1719500000
Cache-Key: /textbook/v2/image/ch3_p15.jpg?format=webp&h=1000&q=80&w=750
# 忽略 timestamp 参数，保留图片处理参数
```

```java
/**
 * 缓存 Key 生成器
 * 根据缓存规则配置忽略无关参数，仅保留内容相关参数
 */
public class CacheKeyGenerator {

    // 各域名类型保留的查询参数
    private static final Map<String, Set<String>> SIGNIFICANT_PARAMS = Map.of(
        "image",   Set.of("w", "h", "format", "q", "x", "y", "mode"),  // 图片处理参数
        "audio",   Set.of("bitrate", "format"),                         // 音频转码参数
        "video",   Set.of("resolution", "bitrate"),                     // 视频清晰度
        "package", Set.of(),                                            // 无参数，纯版本路径
        "static",  Set.of()                                             // hash 在文件名中，无查询参数
    );

    public static String generate(String domainType, String path, Map<String, String> queryParams) {
        Set<String> significant = SIGNIFICANT_PARAMS.getOrDefault(domainType, Set.of());

        if (significant.isEmpty() || queryParams.isEmpty()) {
            return path; // 不含参数
        }

        // 只保留有意义的参数，按字母排序
        String sortedParams = queryParams.entrySet().stream()
            .filter(e -> significant.contains(e.getKey()))
            .sorted(Map.Entry.comparingByKey())
            .map(e -> e.getKey() + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
            .collect(Collectors.joining("&"));

        return sortedParams.isEmpty() ? path : path + "?" + sortedParams;
    }
}
```

### 4.4 缓存预热策略

针对高频访问内容和定时发布内容进行主动预热。

```java
/**
 * 缓存预热服务
 */
@Service
public class CdnWarmupService {

    @Autowired private CdnProviderRepository providerRepo;
    @Autowired private CdnWarmupTaskRepository warmupTaskRepo;
    @Autowired private CdnApiGateway cdnApiGateway;

    /**
     * 教材内容预热（新版本上线前）
     * 在教材新版本发布前 24 小时预热所有图片和音频
     */
    @Scheduled(cron = "0 0 2 * * *")  // 每天凌晨 2 点检查
    public void scheduleTextbookWarmup() {
        List<TextbookVersion> upcoming = textbookVersionService
            .findReleasingIn24Hours();

        for (TextbookVersion version : upcoming) {
            List<String> urls = collectTextbookResourceUrls(version);
            createWarmupTask(
                "教材预热-" + version.getDisplayName(),
                "image", urls, "high",
                "scheduled"
            );
        }
    }

    /**
     * 高频题目图片预热
     * 每天将热门题库 TOP 10000 题的配图推送到边缘
     */
    @Scheduled(cron = "0 30 3 * * *")  // 凌晨 3:30
    public void scheduleHotQuestionWarmup() {
        List<String> hotQuestionImageUrls = questionService
            .getTopHotQuestions(10000)
            .stream()
            .flatMap(q -> q.getImageUrls().stream())
            .distinct()
            .collect(Collectors.toList());

        createWarmupTask(
            "热门题目配图预热-" + LocalDate.now(),
            "image", hotQuestionImageUrls, "normal",
            "scheduled"
        );
    }

    /**
     * 寒暑假专题预热
     * 假期专题页上线前 3 天预热所有多媒体资源
     */
    public void warmupVacationTheme(VacationTheme theme) {
        List<String> allResourceUrls = theme.getResourceUrls();
        // 分批预热，每批 500 个 URL
        Lists.partition(allResourceUrls, 500).forEach(batch -> {
            createWarmupTask(
                "假期专题预热-" + theme.getName(),
                theme.getDomainType(), batch, "urgent",
                "content_update"
            );
        });
    }

    /**
     * 执行预热任务（异步消费）
     */
    @Async("cdnWarmupExecutor")
    public void executeWarmupTask(Long taskId) {
        CdnWarmupTask task = warmupTaskRepo.findById(taskId).orElseThrow();
        task.setStatus("running");
        task.setStartedAt(LocalDateTime.now());
        warmupTaskRepo.save(task);

        List<String> urls = JSON.parseArray(task.getUrlList(), String.class);
        List<Long> providerIds = parseProviderIds(task.getProviderIds());

        int success = 0, failed = 0;
        List<String> failedUrls = new ArrayList<>();

        // 分批提交，每批 100 个，间隔 200ms 避免触发供应商限流
        for (List<String> batch : Lists.partition(urls, 100)) {
            try {
                for (Long providerId : providerIds) {
                    CdnProvider provider = providerRepo.findById(providerId);
                    CdnApiResult result = cdnApiGateway.pushUrls(
                        provider, task.getDomain(), batch
                    );
                    if (result.isSuccess()) {
                        success += batch.size();
                    } else {
                        failed += batch.size();
                        failedUrls.addAll(batch);
                        log.warn("预热失败 provider={} domain={} reason={}",
                            provider.getProviderCode(), task.getDomain(),
                            result.getErrorMessage());
                    }
                }
                Thread.sleep(200); // 限流保护
            } catch (Exception e) {
                log.error("预热异常", e);
                failed += batch.size();
                failedUrls.addAll(batch);
            }
        }

        task.setWarmedCount(success);
        task.setFailedCount(failed);
        task.setFailedUrls(JSON.toJSONString(failedUrls));
        task.setStatus(failed == 0 ? "completed" : (success > 0 ? "partial" : "failed"));
        task.setCompletedAt(LocalDateTime.now());
        warmupTaskRepo.save(task);
    }

    // 线程池配置：预热是低优先级批量任务，限制并发避免影响在线服务
    @Bean("cdnWarmupExecutor")
    public Executor cdnWarmupExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("cdn-warmup-");
        return executor;
    }
}
```

### 4.5 缓存刷新策略

```java
/**
 * 缓存刷新服务
 * 当源站内容更新时，主动刷新 CDN 边缘缓存
 */
@Service
public class CdnRefreshService {

    /**
     * 内容更新触发的自动刷新
     * 监听 FRSS 的 file_updated 事件
     */
    @EventListener
    @Async
    public void onFileUpdated(FileUpdatedEvent event) {
        if (!event.isCacheableContent()) return;

        // 版本化路径不刷新（新版本 = 新 URL）
        if (event.isVersionedPath()) return;

        // 非版本化内容（如 CMS 后台上传的图片）需要刷新
        String url = buildCdnUrl(event.getDomain(), event.getPath());
        refreshUrls(List.of(url), "content_update", event.getEntityId());
    }

    /**
     * 教材版本回滚触发的全量刷新
     */
    public void refreshOnVersionRollback(Long textbookVersionId) {
        TextbookVersion version = textbookVersionService.findById(textbookVersionId);
        String dirPattern = String.format("/textbook/v%d/**", version.getVersionNumber());

        // 按目录刷新
        for (CdnDomainConfig domain : getActiveDomains("image")) {
            refreshDirectory(domain.getDomain(), dirPattern, "version_rollback",
                "textbook-" + textbookVersionId);
        }
    }

    /**
     * 执行 URL 级刷新
     */
    public CdnRefreshResult refreshUrls(List<String> urls, String triggeredBy, String entityId) {
        // 阿里云 CDN：单次最多 1000 个 URL
        // 腾讯云 CDN：单次最多 1000 个 URL
        // 华为云 CDN：单次最多 1000 个 URL
        // 按供应商分别提交
        List<CdnProvider> activeProviders = providerRepo.findActiveProviders();
        Map<String, Object> results = new HashMap<>();

        for (CdnProvider provider : activeProviders) {
            try {
                CdnApiResult result = cdnApiGateway.refreshUrls(provider, urls);
                results.put(provider.getProviderCode(), Map.of(
                    "success", result.isSuccess(),
                    "taskId", result.getTaskId(),
                    "message", result.getErrorMessage()
                ));
            } catch (Exception e) {
                results.put(provider.getProviderCode(), Map.of(
                    "success", false,
                    "message", e.getMessage()
                ));
            }
        }

        // 记录刷新任务
        saveRefreshTask("flush_url", urls, triggeredBy, entityId, results);

        return CdnRefreshResult.builder()
            .totalProviders(activeProviders.size())
            .successProviders((int) results.values().stream()
                .filter(r -> (boolean) ((Map<?,?>) r).get("success")).count())
            .build();
    }
}
```

---

## 5. 图片优化管线

### 5.1 边缘图片处理

利用 CDN 边缘计算能力，在请求时动态进行图片格式转换和压缩。

```
用户请求图片：
GET /textbook/v2/image/ch3_p15.jpg?w=750&format=webp&q=80

边缘节点处理流程：
1. 检查 Cache-Key 是否命中 → 命中则直接返回
2. 未命中 → 回源获取原始图片
3. 边缘处理：
   a. 格式转换：JPEG → WebP (体积减少 25-35%)
   b. 尺寸调整：根据 w/h 参数缩放
   c. 质量压缩：q=80 (可接受质量)
   d. 元数据剥离：移除 EXIF/GPS 信息
4. 缓存处理结果 → 返回给客户端

客户端无需上传多个尺寸，CDN 边缘按需处理
```

### 5.2 客户端自适应请求

```dart
/// lib/core/cdn/image_url_builder.dart

class CdnImageUrlBuilder {
  /// 根据设备能力和网络状况构建最优图片 URL
  static String build(
    String originalPath, {
    double? targetWidth,
    int quality = 80,
  }) {
    final params = <String, String>{};

    // 格式自适应
    if (_supportsAvif()) {
      params['format'] = 'avif';
      params['q'] = quality.toString();  // AVIF 可以更低质量
    } else if (_supportsWebP()) {
      params['format'] = 'webp';
      params['q'] = quality.toString();
    }

    // 尺寸自适应
    if (targetWidth != null) {
      params['w'] = targetWidth.round().toString();
    } else {
      // 根据设备像素密度和屏幕宽度计算
      final screenWidth = MediaQuery.of(context).size.width;
      final dpr = MediaQuery.of(context).devicePixelRatio;
      params['w'] = (screenWidth * dpr).round().toString();
    }

    // 网络质量自适应
    final networkQuality = NetworkMonitor.instance.quality;
    if (networkQuality == NetworkQuality.poor) {
      params['q'] = '60'; // 弱网降低质量
    } else if (networkQuality == NetworkQuality.good) {
      params['q'] = '85'; // 好网络提高质量
    }

    final queryString = params.entries
        .map((e) => '${e.key}=${e.value}')
        .join('&');

    return '${CdnConfig.imageDomain}$originalPath?$queryString';
  }

  static bool _supportsAvif() {
    // Android 12+ / iOS 16+ 支持 AVIF
    return Platform.isAndroid && _androidVersion >= 31 ||
           Platform.isIOS && _iosVersion >= 16;
  }

  static bool _supportsWebP() {
    // Android 4.0+ / 全版本 iOS 14+ 支持 WebP
    return true;
  }
}
```

### 5.3 图片处理参数规范

| 参数 | 说明 | 取值范围 | 默认值 |
|------|------|----------|--------|
| `w` | 目标宽度 (px) | 1-4096 | 原图 |
| `h` | 目标高度 (px) | 1-4096 | 原图 |
| `format` | 输出格式 | jpeg/png/webp/avif | 按客户端自适应 |
| `q` | 质量 (1-100) | 1-100 | 80 |
| `mode` | 裁剪模式 | lfit(长边适应)/mfit(短边适应)/fill(填充)/pad(补白) | lfit |
| `x`, `y` | 裁剪起点 | 像素值 | 0,0 |
| `blur` | 高斯模糊半径 | 0-50 | 0 |
| `interlace` | 交错渲染(渐进JPEG) | 0/1 | 1 |
| `strip` | 移除元数据 | 0/1 | 1 |

---

## 6. 流媒体分发设计

### 6.1 HLS 视频分发架构

```
┌──────────────┐     转码请求      ┌──────────────────┐
│ 内容运营后台上传 │ ──────────────→ │  媒体转码服务      │
│ 原始视频 .mp4  │                  │  (FFmpeg 集群)    │
└──────────────┘                  └────────┬─────────┘
                                           │ 输出
                                           ▼
                              ┌─────────────────────────┐
                              │  HLS 切片产出            │
                              │  - playlist.m3u8        │
                              │  - seg-480p-001.ts      │
                              │  - seg-480p-002.ts      │
                              │  - seg-720p-001.ts      │
                              │  - seg-720p-002.ts      │
                              │  - seg-1080p-001.ts     │
                              │  ...                    │
                              └────────────┬────────────┘
                                           │ 存入 OSS
                                           ▼
                              ┌─────────────────────────┐
                              │  对象存储 (源站)         │
                              └────────────┬────────────┘
                                           │ 预热
                                           ▼
                              ┌─────────────────────────┐
                              │  CDN 边缘节点            │
                              │  缓存 .m3u8 + .ts 切片   │
                              └────────────┬────────────┘
                                           │ HLS
                                           ▼
                              ┌─────────────────────────┐
                              │  客户端播放器            │
                              │  自适应码率切换          │
                              └─────────────────────────┘
```

### 6.2 多码率 Master Playlist

```m3u8
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS

# 低清晰度 - 弱网 / 移动数据
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS="avc1.42c01e,mp4a.40.2",FRAME-RATE=24
480p/playlist.m3u8

# 标准清晰度 - 4G / WiFi
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.42c020,mp4a.40.2",FRAME-RATE=30
720p/playlist.m3u8

# 高清晰度 - WiFi
#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,CODECS="avc1.42c028,mp4a.40.2",FRAME-RATE=30
1080p/playlist.m3u8
```

### 6.3 客户端码率自适应策略

```dart
/// lib/features/video/player/bitrate_adaptive_manager.dart

class BitrateAdaptiveManager {
  /// 教育视频码率自适应策略（优先流畅度 > 清晰度）
  ///
  /// 教育场景特点：
  /// 1. 内容理解 > 视觉体验，流畅播放不卡顿最重要
  /// 2. 很多场景在看文字/公式/图表，需要清晰但不需 1080p
  /// 3. 学生大量使用移动数据，需省流量
  AdaptiveBitrateRule buildRule(BuildContext context) {
    return AdaptiveBitrateRule(
      // 起始码率：4G→480p, WiFi→720p
      startBitrate: _isWifi() ? 2000000 : 800000,

      // 最大码率：WiFi→1080p, 4G→720p, 3G→480p
      maxBitrate: _isWifi()
          ? 4000000
          : _is4G()
              ? 2000000
              : 800000,

      // 切换策略
      switchInterval: Duration(seconds: 10), // 至少 10 秒切换一次，避免频繁切换
      bufferSizeBeforeUpgrade: 30, // 缓冲 30 秒后才考虑升级码率

      // 用户偏好覆盖
      userPreference: _getUserVideoQualityPreference(),
    );
  }
}
```

### 6.4 音频分发策略

教育音频（课文朗读、英语听力）与音乐不同——不需要极高码率，但需要**首播零延迟**。

```
音频分发策略：
1. 原始格式：MP3 128kbps 或 AAC 96kbps
2. CDN 缓存：30 天（版本化路径）
3. 客户端预加载：进入章节时预加载前 3 条音频
4. 范围请求：支持 Range 请求实现拖拽跳转
5. 渐进式加载：先加载前 10 秒（约 120KB），边播边下
```

---

## 7. 大文件分发设计

### 7.1 离线资源包分发

PrimeTop 的离线资源包（单学科单学期）大小通常在 200MB-800MB 之间。

```
分发流程：

1. 客户端检测到 WiFi + 闲时 → 触发资源包下载
2. 请求资源包元数据：
   GET /api/v1/resource-package/{subject}/{grade}
   → 返回：版本号、文件大小、分片列表、MD5、CDN 下载地址

3. 分片下载（每片 4MB）：
   GET /pkg-cdn.primetop.com/v2/math-grade7-v1.3/segment-001
   GET /pkg-cdn.primetop.com/v2/math-grade7-v1.3/segment-002
   ...
   支持并发下载（最多 3 个连接）

4. 分片校验与合并：
   - 每个分片下载完成后校验 MD5
   - 全部分片下载后合并为完整文件
   - 校验整体 SHA-256
   - 存入客户端本地存储

5. 断点续传：
   - 记录已下载的分片索引（持久化到本地数据库）
   - 中断后从断点继续，不重新下载
```

### 7.2 资源包元数据 API

```json
// GET /api/v1/resource-package/math/grade7
{
  "packageId": "pkg_math_g7_2026s_v1",
  "version": "1.3.0",
  "subject": "math",
  "grade": 7,
  "semester": "spring_2026",
  "totalSize": 524288000,
  "totalSegments": 125,
  "segmentSize": 4194304,
  "sha256": "a1b2c3d4e5f6...",
  "cdnBaseUrl": "https://pkg-cdn.primetop.com/v2/math-grade7-v1.3",
  "segments": [
    { "index": 0,   "md5": "d41d8cd98f00b204e9800998ecf8427e", "size": 4194304 },
    { "index": 1,   "md5": "0cc175b9c0f1b6a831c399e269772661", "size": 4194304 },
    { "index": 124, "md5 "f728530e7c6b5a2b1c8d9e0f1a2b3c4d", "size": 2097152 }
  ],
  "releaseNotes": "2026春季人教版数学七年级下册，更新了第5章内容",
  "releasedAt": "2026-02-10T10:00:00+08:00",
  "previousVersion": "1.2.0",
  "deltaUpdateAvailable": true,
  "deltaUpdateInfo": {
    "fromVersion": "1.2.0",
    "deltaSize": 33554432,
    "deltaSegments": [48, 49, 50, 72, 73]
  }
}
```

### 7.3 增量更新策略

对于教材小版本更新（如勘误修订），只下发变更分片，避免重复下载完整包。

```java
/**
 * 资源包差分计算服务
 * 基于分片级 MD5 对比，找出变更分片
 */
@Service
public class PackageDeltaCalculator {

    /**
     * 计算两个版本间的差分
     */
    public DeltaResult calculateDelta(PackageVersion oldVer, PackageVersion newVer) {
        Map<String, Segment> oldSegments = oldVer.getSegmentMap(); // md5 → segment
        Map<String, Segment> newSegments = newVer.getSegmentMap();

        List<Integer> addedSegments = new ArrayList<>();
        List<Integer> unchangedSegments = new ArrayList<>();

        for (Segment seg : newVer.getSegments()) {
            if (oldSegments.containsKey(seg.getMd5())) {
                unchangedSegments.add(seg.getIndex()); // 内容未变
            } else {
                addedSegments.add(seg.getIndex()); // 新增或修改
            }
        }

        double deltaRatio = (double) addedSegments.size() / newVer.getTotalSegments();

        return DeltaResult.builder()
            .fromVersion(oldVer.getVersion())
            .toVersion(newVer.getVersion())
            .changedSegmentIndexes(addedSegments)
            .unchangedCount(unchangedSegments.size())
            .changedCount(addedSegments.size())
            .deltaSize(addedSegments.size() * (long) newVer.getSegmentSize())
            .deltaRatio(deltaRatio)
            .recommendDelta(deltaRatio < 0.3) // 变更 <30% 推荐增量更新
            .build();
    }
}
```

---

## 8. 安全防护设计

### 8.1 URL 签名鉴权

对敏感内容（付费教材、VIP 资源）启用 CDN URL 签名鉴权。

```
TypeA 鉴权 URL 格式（阿里云标准）：
https://img-cdn.primetop.com/textbook/v2/image/ch5_p20.jpg?auth_key=1719500000-0-0-a1b2c3d4e5f6

auth_key = {timestamp}-{rand}-{uid}-{md5}
  timestamp = 过期时间戳（Unix）
  rand      = 随机数
  uid       = 用户标识（0=匿名）
  md5       = MD5(URI + timestamp + rand + uid + secretKey)
```

```java
/**
 * CDN URL 签名生成器
 */
public class CdnUrlSigner {

    @Value("${cdn.auth.secret-key}")
    private String secretKey;

    @Value("${cdn.auth.ttl-seconds}")
    private int ttlSeconds;

    /**
     * 生成带签名的 CDN URL
     */
    public String signUrl(String domain, String path, Long userId) {
        long expireTimestamp = Instant.now().getEpochSecond() + ttlSeconds;
        String rand = RandomStringUtils.randomAlphanumeric(16);
        String uid = userId != null ? String.valueOf(userId) : "0";

        // MD5(path-timestamp-rand-uid-secretKey)
        String toSign = path + "-" + expireTimestamp + "-" + rand + "-" + uid + "-" + secretKey;
        String md5 = DigestUtils.md5Hex(toSign);

        return String.format("https://%s%s?auth_key=%d-%s-%s-%s",
            domain, path, expireTimestamp, rand, uid, md5);
    }

    /**
     * 批量签名（用于播放列表中的多个 TS 片段）
     */
    public List<String> signUrls(String domain, List<String> paths, Long userId) {
        return paths.stream()
            .map(path -> signUrl(domain, path, userId))
            .collect(Collectors.toList());
    }
}
```

### 8.2 防盗链策略

```
防盗链策略层级：
├── Referer 白名单
│   ├── *.primetop.com
│   ├── *.primetop.cn (备域名)
│   └── localhost / 127.0.0.1 (开发环境)
├── IP 黑名单
│   ├── 已知爬虫 IP（安全情报库）
│   └── 超频请求 IP（>100次/秒单IP）
├── User-Agent 过滤
│   ├── 屏蔽已知爬虫 UA (Scrapy, curl, wget 等)
│   └── 要求 PrimeTop 客户端 UA: PrimeTop/{version}
├── 单 IP 频率限制
│   ├── 图片：< 50 req/s
│   ├── 视频：< 10 req/s
│   └── 资源包：< 2 req/s
└── 区域限制（可选）
    └── 仅中国大陆 IP 访问（B端海外客户通过白名单）
```

### 8.3 内容加密（付费资源）

对于付费 VIP 专属的微课视频和高级解析，采用 HLS 加密：

```m3u8
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-KEY:METHOD=AES-128,URI="https://api.primetop.com/v1/drm/hls-key/abc123",
           IV=0x1b3dd8e0c5f1a27b0987c65d4e3f2a18
#EXTINF:10.0,
seg-720p-001.ts
#EXTINF:10.0,
seg-720p-002.ts
...
```

```java
/**
 * HLS 密钥服务
 */
@RestController
@RequestMapping("/v1/drm")
public class HlsKeyController {

    /**
     * 获取 HLS 解密密钥
     * 1. 校验用户会员权益
     * 2. 校验视频访问权限
     * 3. 返回 AES-128 密钥
     */
    @GetMapping("/hls-key/{videoId}")
    public ResponseEntity<byte[]> getHlsKey(
            @PathVariable String videoId,
            @RequestHeader("Authorization") String token) {

        Long userId = jwtUtil.extractUserId(token);

        // 校验会员权益
        if (!membershipService.hasValidMembership(userId)) {
            return ResponseEntity.status(403).build();
        }

        // 校验视频访问权限
        if (!videoAccessService.canAccess(userId, videoId)) {
            return ResponseEntity.status(403).build();
        }

        // 返回密钥（16 bytes AES-128）
        byte[] key = drmService.getAesKey(videoId, userId);

        // 密钥使用次数限制（防止密钥泄露后被滥用）
        drmService.incrementKeyUsage(videoId, userId);

        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header("Cache-Control", "no-store")
            .body(key);
    }
}
```

---

## 9. 成本治理

### 9.1 成本结构

```
CDN 成本 = 流量费 + 请求数费 + 增值服务费

流量费（占比 ~85%）：
  按量计费：0.12-0.24 元/GB（阶梯价，用量越大单价越低）
  按带宽峰值：0.60-1.20 元/Mbps/日（流量稳定时更划算）

请求数费（占比 ~5%）：
  HTTPS 请求：0.01-0.05 元/万次

增值服务费（占比 ~10%）：
  边缘图片处理、日志分析、QUIC 等
```

### 9.2 成本优化策略

| 策略 | 预估节省 | 实施方式 |
|------|----------|----------|
| **图片 WebP 转换** | 减少 30% 图片流量 | 边缘节点自动转换 |
| **客户端缓存优化** | 减少 20-30% CDN 请求 | 提升 L1 缓存命中率 |
| **大文件分片 + 增量更新** | 减少 70-90% 更新流量 | 差分对比，仅下载变更分片 |
| **视频码率自适应** | 减少 20-40% 视频流量 | 教育视频默认 480p/720p |
| **冷内容回源控制** | 减少 5-10% 回源流量 | 长期低频访问内容设置短 TTL 下沉 |
| **按月预付费包** | 减少单价 10-15% | 预测用量购买流量包 |
| **混合计费** | 按场景选择最优计费 | 高峰期按带宽、低谷期按流量 |

### 9.3 成本监控与告警

```java
/**
 * CDN 成本监控服务
 */
@Service
public class CdnCostMonitor {

    @Autowired private CdnMetrics5minRepository metricsRepo;
    @Autowired private AlertService alertService;

    /**
     * 实时成本告警（每 5 分钟检查）
     */
    @Scheduled(fixedRate = 5 * 60 * 1000)
    public void checkCostAlerts() {
        List<CdnProvider> activeProviders = providerRepo.findActiveProviders();

        for (CdnProvider provider : activeProviders) {
            // 检查月度流量配额
            if (provider.getTrafficQuota() > 0) {
                double usage = provider.getTrafficUsed() * 100.0 / provider.getTrafficQuota();
                if (usage >= 90) {
                    alertService.send(AlertLevel.URGENT, String.format(
                        "CDN供应商 %s 月度流量使用率 %.1f%%，已用 %.1f GB / 配额 %.1f GB",
                        provider.getProviderCode(), usage,
                        provider.getTrafficUsed() / 1e9,
                        provider.getTrafficQuota() / 1e9
                    ));
                } else if (usage >= 80) {
                    alertService.send(AlertLevel.WARNING, String.format(
                        "CDN供应商 %s 月度流量使用率 %.1f%%",
                        provider.getProviderCode(), usage
                    ));
                }
            }

            // 检查带宽峰值异常
            long currentBandwidth = provider.getBandwidthUsed();
            long dailyAvgBandwidth = metricsRepo.getDailyAvgBandwidth(provider.getId());
            if (currentBandwidth > dailyAvgBandwidth * 2) {
                alertService.send(AlertLevel.WARNING, String.format(
                    "CDN供应商 %s 当前带宽 %d Mbps 是日均 %d Mbps 的 2 倍以上，疑似异常",
                    provider.getProviderCode(),
                    currentBandwidth / 1_000_000,
                    dailyAvgBandwidth / 1_000_000
                ));
            }
        }
    }

    /**
     * 生成日成本报告
     */
    @Scheduled(cron = "0 0 8 * * *")
    public void dailyCostReport() {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        DailyCostReport report = new DailyCostReport();

        for (CdnProvider provider : providerRepo.findActiveProviders()) {
            ProviderDailyCost cost = calculateDailyCost(provider, yesterday);
            report.addProviderCost(provider.getProviderCode(), cost);
        }

        report.setTotalCost(report.getProviderCosts().values()
            .stream().mapToDouble(ProviderDailyCost::getTotalCost).sum());

        // 发送成本报告到运营群
        notificationService.sendDailyReport("cdn-cost-daily", report);
    }
}
```

---

## 10. 健康检查与故障转移

### 10.1 多维度健康检查

```java
/**
 * CDN 供应商健康检查
 * 每 30 秒从多个维度检查各 CDN 供应商状态
 */
@Service
public class CdnHealthMonitor {

    // 健康检查探测点（分布在各运营商网络）
    private static final List<ProbeNode> PROBE_NODES = List.of(
        new ProbeNode("bj-telecom",  "北京-电信", "123.59.x.x"),
        new ProbeNode("sh-unicom",   "上海-联通", "210.22.x.x"),
        new ProbeNode("gz-mobile",   "广州-移动", "120.197.x.x"),
        new ProbeNode("cd-telecom",  "成都-电信", "118.112.x.x"),
        new ProbeNode("wh-unicom",   "武汉-联通", "58.49.x.x")
    );

    // 健康阈值
    private static final double HEALTHY_TTFB_THRESHOLD = 100;   // ms
    private static final double DEGRADED_TTFB_THRESHOLD = 300;  // ms
    private static final double SUCCESS_RATE_THRESHOLD = 0.95;  // 95%

    @Scheduled(fixedRate = 30_000)
    public void runHealthCheck() {
        List<CdnProvider> providers = providerRepo.findActiveProviders();

        for (CdnProvider provider : providers) {
            HealthResult result = probe(provider);
            updateProviderHealth(provider, result);
        }
    }

    private HealthResult probe(CdnProvider provider) {
        // 从每个探测点发起探测请求
        List<ProbeResult> results = PROBE_NODES.parallelStream()
            .map(node -> probeFromNode(provider, node))
            .collect(Collectors.toList());

        double avgTtfb = results.stream()
            .mapToLong(ProbeResult::getTtfbMs)
            .average().orElse(9999);

        double successRate = (double) results.stream()
            .filter(ProbeResult::isSuccess).count() / results.size();

        // 判定健康状态
        HealthStatus status;
        if (successRate < 0.5 || avgTtfb > 1000) {
            status = HealthStatus.DOWN;
        } else if (successRate < SUCCESS_RATE_THRESHOLD || avgTtfb > DEGRADED_TTFB_THRESHOLD) {
            status = HealthStatus.DEGRADED;
        } else {
            status = HealthStatus.HEALTHY;
        }

        return new HealthResult(provider.getId(), status, avgTtfb, successRate, results);
    }

    private void updateProviderHealth(CdnProvider provider, HealthResult result) {
        provider.setHealthStatus(result.getStatus().name().toLowerCase());
        provider.setLastHealthAt(LocalDateTime.now());
        providerRepo.save(provider);

        // 状态变更告警
        HealthStatus previous = getPreviousStatus(provider.getId());
        if (previous != result.getStatus()) {
            alertService.send(
                result.getStatus() == HealthStatus.DOWN ? AlertLevel.URGENT : AlertLevel.WARNING,
                String.format("CDN供应商 %s 状态变更: %s → %s (TTFB=%.0fms, 成功率=%.1f%%)",
                    provider.getProviderCode(),
                    previous, result.getStatus(),
                    result.getAvgTtfb(), result.getSuccessRate() * 100)
            );
        }
    }
}
```

### 10.2 故障切换流程

```
故障检测（< 30s）
    │
    ├── 健康检查发现供应商 A 状态 → DOWN
    │
    ▼
调度引擎标记 A 为不可用
    │
    ├── 所有后续调度跳过 A
    │   流量自动分配到 B/C
    │
    ▼
触发现有连接迁移
    │
    ├── DNS TTL = 60s → 旧连接在 60s 内逐步迁移
    ├── HTTPDNS 推送更新 → 客户端 60s 内获取新调度
    │
    ▼
验证切换效果
    │
    ├── 检查 B/C 的 TTFB / 成功率是否正常
    ├── 如果 B/C 也异常 → 启用兜底：直连源站
    │   └── 客户端显示 "网络优化中，部分资源加载可能较慢"
    │
    ▼
供应商 A 恢复
    │
    ├── 健康检查连续 3 次通过 (90s)
    ├── 标记 A 为 healthy
    ├── 灰度恢复：先恢复 20% 权重 → 观察 10 分钟 → 全量恢复
    └── 记录故障报告
```

---

## 11. 客户端 SDK 设计

### 11.1 CDN 客户端管理器

```dart
/// lib/core/cdn/cdn_manager.dart

/// CDN 客户端管理器
/// 统一管理所有 CDN 资源的 URL 构建、请求优化、缓存控制
class CdnManager {
  static CdnManager? _instance;
  static CdnManager get instance => _instance!;

  late final CdnConfig _config;
  late final HttpDnsClient _httpDns;
  late final NetworkMonitor _networkMonitor;

  /// 初始化
  Future<void> init() async {
    _config = await _loadCdnConfig();
    _httpDns = HttpDnsClient(
      accountId: _config.httpDnsAccountId,
      secretKey: _config.httpDnsSecretKey,
      cacheTtl: Duration(seconds: 60),
    );
    _networkMonitor = NetworkMonitor();
    _networkMonitor.start();
  }

  /// 构建图片 URL（自适应优化）
  String imageUrl(
    String path, {
    int? width,
    int quality = 80,
    ImageFormat? format,
  }) {
    final params = <String, String>{};

    // 格式自适应
    final fmt = format ?? _bestImageFormat();
    if (fmt != ImageFormat.original) {
      params['format'] = fmt.name;
    }
    params['q'] = quality.toString();

    // 尺寸
    if (width != null) {
      params['w'] = width.toString();
    }

    // 弱网降质量
    if (_networkMonitor.quality == NetworkQuality.poor) {
      params['q'] = '55';
    }

    final query = params.entries.map((e) => '${e.key}=${e.value}').join('&');
    return '${_config.imageDomain}$path?$query';
  }

  /// 构建音频 URL
  String audioUrl(String path) {
    return '${_config.audioDomain}$path';
  }

  /// 构建 HLS 视频 Master Playlist URL
  /// 付费视频自动附加签名
  String videoUrl(String path, {bool requiresAuth = false}) {
    var url = '${_config.videoDomain}$path';
    if (requiresAuth) {
      url = _signUrl(url);
    }
    return url;
  }

  /// 构建资源包分片下载 URL
  String packageUrl(String path) {
    return '${_config.packageDomain}$path';
  }

  /// 获取最优 CDN 域名（通过 HTTPDNS）
  Future<String> resolveDomain(String domain) async {
    // 1. 先查 HTTPDNS
    final ip = await _httpDns.resolve(domain);
    if (ip != null) {
      return ip;
    }
    // 2. 兜底：系统 DNS
    return domain;
  }

  /// 当前设备最佳图片格式
  ImageFormat _bestImageFormat() {
    // AVIF 支持检测
    if (Platform.isAndroid && _androidSdkInt >= 31) {
      return ImageFormat.avif;
    }
    if (Platform.isIOS && _iosVersion >= 16) {
      return ImageFormat.avif;
    }
    // WebP 全平台支持
    return ImageFormat.webp;
  }

  /// URL 签名（需要后端配合，客户端调 API 获取签名 URL）
  String _signUrl(String url) {
    // 客户端不持有密钥，通过 API 获取签名 URL
    // 此处为同步缓存查找（API 调用在更上层异步完成）
    return _signedUrlCache[url] ?? url;
  }

  final Map<String, String> _signedUrlCache = {};

  /// 预签名（异步调用后端获取签名 URL）
  Future<void> preSignUrls(List<String> urls) async {
    final response = await http.post(
      Uri.parse('${ApiConfig.baseUrl}/v1/cdn/sign-urls'),
      headers: {'Authorization': 'Bearer ${AuthService.instance.token}'},
      body: jsonEncode({'urls': urls}),
    );
    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      for (var item in data['signedUrls']) {
        _signedUrlCache[item['original']] = item['signed'];
      }
    }
  }
}

enum ImageFormat { avif, webp, original }
```

### 11.2 客户端缓存配置

```dart
/// lib/core/cdn/cdn_cache_config.dart

class CdnCacheConfig {
  /// 图片缓存配置
  static CacheConfig get image => CacheConfig(
    maxEntries: 5000,
    maxSize: 200 * 1024 * 1024, // 200 MB
    ttl: Duration(days: 7),
    evictionPolicy: EvictionPolicy.lru,
  );

  /// 音频缓存配置
  static CacheConfig get audio => CacheConfig(
    maxEntries: 500,
    maxSize: 300 * 1024 * 1024, // 300 MB
    ttl: Duration(days: 30),
    evictionPolicy: EvictionPolicy.lru,
  );

  /// 视频缓存配置（仅缓存 HLS 索引和首片）
  static CacheConfig get video => CacheConfig(
    maxEntries: 100,
    maxSize: 100 * 1024 * 1024, // 100 MB
    ttl: Duration(days: 7),
    evictionPolicy: EvictionPolicy.lru,
  );

  /// 资源包缓存配置（持久存储，不自动淘汰）
  static CacheConfig get package => CacheConfig(
    maxEntries: 20,
    maxSize: 4 * 1024 * 1024 * 1024, // 4 GB
    ttl: null, // 永不过期
    evictionPolicy: EvictionPolicy.explicitOnly, // 仅用户手动删除
  );

  /// 低存储空间模式（设备空间不足时降级配置）
  static Map<String, CacheConfig> get lowStorageConfigs => {
    'image': image.copyWith(maxSize: 80 * 1024 * 1024),    // 80 MB
    'audio': audio.copyWith(maxSize: 100 * 1024 * 1024),   // 100 MB
    'video': video.copyWith(maxSize: 30 * 1024 * 1024),     // 30 MB
    'package': package, // 资源包不降级
  };
}
```

---

## 12. API 接口设计

### 12.1 管理端 API

#### 获取 CDN 配置概览

```
GET /api/admin/v1/cdn/overview
Authorization: Bearer {admin_token}

Response 200:
{
  "domains": [
    {
      "id": 1,
      "domain": "img-cdn.primetop.com",
      "type": "image",
      "status": "active",
      "cacheHitRate24h": 0.967,
      "traffic24h": 5242880000,
      "bandwidth": 45000000,
      "avgTtfb": 35
    }
  ],
  "providers": [
    {
      "code": "aliyun",
      "name": "阿里云CDN",
      "status": "healthy",
      "weight": 100,
      "trafficUsed": 53687091200,
      "trafficQuota": 107374182400,
      "monthlyCost": 6442.50
    }
  ],
  "totalTraffic30d": 161061273600,
  "totalCost30d": 19327.50,
  "overallCacheHitRate": 0.961
}
```

#### 触发缓存刷新

```
POST /api/admin/v1/cdn/refresh
Authorization: Bearer {admin_token}
Content-Type: application/json

Request:
{
  "type": "flush_url",           // flush_url | flush_dir | push
  "domain": "img-cdn.primetop.com",
  "targets": [
    "/textbook/v2/image/ch5_p20.jpg",
    "/question/12345/figure.png"
  ],
  "providers": ["aliyun", "tencent"]  // 可选，空=全部
}

Response 200:
{
  "taskId": "rft_20260627_001",
  "status": "running",
  "totalTargets": 2,
  "providerResults": {
    "aliyun": { "success": true, "remoteTaskId": "aliyun-xxx" },
    "tencent": { "success": true, "remoteTaskId": "tc-yyy" }
  }
}
```

#### 创建预热任务

```
POST /api/admin/v1/cdn/warmup
Authorization: Bearer {admin_token}
Content-Type: application/json

Request:
{
  "name": "七年级数学春季教材预热",
  "domain": "img-cdn.primetop.com",
  "urls": ["https://...", "https://..."],
  "providers": [],
  "priority": "high",
  "scheduledAt": "2026-02-09T02:00:00+08:00"  // 可选，计划执行时间
}

Response 200:
{
  "taskId": "wm_20260209_001",
  "status": "scheduled",
  "urlCount": 850,
  "estimatedDuration": "PT5M"
}
```

#### 查询监控指标

```
GET /api/admin/v1/cdn/metrics?domain=img-cdn.primetop.com&start=2026-06-27T00:00:00Z&end=2026-06-27T23:59:59Z&granularity=1h
Authorization: Bearer {admin_token}

Response 200:
{
  "domain": "img-cdn.primetop.com",
  "granularity": "1h",
  "dataPoints": [
    {
      "timestamp": "2026-06-27T00:00:00Z",
      "requestCount": 1250000,
      "hitCount": 1212500,
      "hitRate": 0.970,
      "trafficBytes": 5242880000,
      "avgTtfb": 32,
      "p95Ttfb": 58,
      "errorRate": 0.001
    }
  ],
  "summary": {
    "totalRequests": 30000000,
    "totalTraffic": 126000000000,
    "avgHitRate": 0.967,
    "avgTtfb": 35,
    "estimatedCost": 1512.00
  }
}
```

### 12.2 客户端 API

#### 获取 CDN 配置

```
GET /api/v1/cdn/config
Authorization: Bearer {token}

Response 200:
{
  "domains": {
    "image": "img-cdn.primetop.com",
    "audio": "aud-cdn.primetop.com",
    "video": "vid-cdn.primetop.com",
    "package": "pkg-cdn.primetop.com"
  },
  "httpDns": {
    "enabled": true,
    "accountId": "abc123"
  },
  "imageDefaults": {
    "format": "webp",
    "quality": 80,
    "lowQualityOnPoorNetwork": 55
  },
  "cacheConfig": {
    "imageMaxSize": 209715200,
    "audioMaxSize": 314572800,
    "videoMaxSize": 104857600,
    "packageMaxSize": 4294967296
  },
  "configVersion": "2026-06-27-v1",
  "configTtl": 3600
}
```

#### 获取签名 URL（付费资源）

```
POST /api/v1/cdn/sign-urls
Authorization: Bearer {token}
Content-Type: application/json

Request:
{
  "urls": [
    "https://vid-cdn.primetop.com/video/hls/vb_001/playlist.m3u8",
    "https://img-cdn.primetop.com/textbook/v2/premium/ch8_p30.jpg"
  ]
}

Response 200:
{
  "signedUrls": [
    {
      "original": "https://vid-cdn.primetop.com/video/hls/vb_001/playlist.m3u8",
      "signed": "https://vid-cdn.primetop.com/video/hls/vb_001/playlist.m3u8?auth_key=...",
      "expireAt": "2026-06-27T11:36:00Z"
    }
  ]
}

Response 403:
{
  "error": "FORBIDDEN",
  "message": "当前资源需要会员权益",
  "upgradeUrl": "/membership"
}
```

---

## 13. 错误处理

### 13.1 错误码定义

| 错误码 | HTTP状态 | 说明 | 处理策略 |
|--------|----------|------|----------|
| `CDN_DOMAIN_NOT_FOUND` | 404 | 域名配置不存在 | 检查域名配置 |
| `CDN_PROVIDER_UNAVAILABLE` | 503 | 所有 CDN 供应商不可用 | 直连源站降级 |
| `CDN_REFRESH_LIMIT_EXCEEDED` | 429 | 刷新/预热超频 | 排队等待，稍后重试 |
| `CDN_QUOTA_EXCEEDED` | 503 | 流量配额耗尽 | 切换备用供应商 |
| `CDN_AUTH_FAILED` | 403 | URL 签名校验失败 | 重新获取签名 |
| `CDN_RESOURCE_FORBIDDEN` | 403 | 无访问权限（非会员） | 引导升级会员 |
| `CDN_ORIGIN_ERROR` | 502 | 源站不可达 | 告警运维，重试 |
| `CDN_WARMUP_PARTIAL_FAIL` | 200 | 预热部分失败 | 重试失败部分 |

### 13.2 客户端降级策略

```dart
/// lib/core/cdn/cdn_error_handler.dart

class CdnErrorHandler {
  /// 图片加载失败处理链
  Widget handleImageError(
    String originalUrl,
    Object error,
    StackTrace stackTrace, {
    double? width,
    double? height,
  }) {
    // Step 1: 重试（指数退避，最多 3 次）
    if (_retryCount[originalUrl] == null || _retryCount[originalUrl]! < 3) {
      _retryCount[originalUrl] = (_retryCount[originalUrl] ?? 0) + 1;
      return RetryImage(url: originalUrl, delay: _backoff(_retryCount[originalUrl]!));
    }

    // Step 2: 降级到直连源站（绕过 CDN）
    final originUrl = _toOriginUrl(originalUrl);
    if (originUrl != null) {
      return CachedNetworkImage(imageUrl: originUrl, width: width, height: height);
    }

    // Step 3: 使用低质量占位图
    final lowQualityUrl = _toLowQualityUrl(originalUrl);
    if (lowQualityUrl != null) {
      return CachedNetworkImage(
        imageUrl: lowQualityUrl,
        width: width,
        height: height,
        errorWidget: _placeholder(width, height),
      );
    }

    // Step 4: 显示占位图
    return _placeholder(width, height);
  }

  /// 视频播放失败处理
  VideoErrorHandler handleVideoError(String url, Object error) {
    // Step 1: 降低码率重试
    return VideoErrorHandler()
      ..onError = (url, error) {
        final lowerBitrateUrl = _downgradeBitrate(url);
        if (lowerBitrateUrl != null) {
          return RetryConfig(url: lowerBitrateUrl);
        }
        // Step 2: 音频降级（仅音频模式）
        return RetryConfig(audioOnly: true);
      };
  }

  /// 资源包下载失败处理
  Future<void> handlePackageDownloadError(
    String packageId,
    int failedSegmentIndex,
    Object error,
  ) async {
    // 记录失败分片，稍后重试
    await _packageDao.recordFailedSegment(packageId, failedSegmentIndex, error.toString());

    // 如果是网络错误，等待网络恢复后自动续传
    if (error is SocketException) {
      await _networkMonitor.waitForConnection();
      await _packageDownloader.resumeDownload(packageId);
    }
  }

  Duration _backoff(int attempt) {
    return Duration(seconds: math.min(attempt * attempt, 16));
  }
}
```

---

## 14. 配置中心集成

CDN 相关配置通过配置中心动态管理，无需重启服务即可生效。

```yaml
# 配置中心 - cdn.yml
cdn:
  # 全局开关
  enabled: true

  # 域名类型 → 默认域名
  domains:
    image: img-cdn.primetop.com
    audio: aud-cdn.primetop.com
    video: vid-cdn.primetop.com
    package: pkg-cdn.primetop.com
    static: static-cdn.primetop.com

  # 供应商优先级（可动态调整）
  provider-priority:
    image: ["aliyun", "tencent", "huawei"]
    audio: ["tencent", "aliyun"]
    video: ["aliyun", "tencent"]
    package: ["huawei", "aliyun"]

  # 默认缓存 TTL (秒)
  default-ttl:
    image: 2592000    # 30天
    audio: 2592000    # 30天
    video-hls-master: 604800  # 7天
    video-hls-segment: 2592000  # 30天
    package: 7776000  # 90天
    static: 604800    # 7天

  # 预热策略
  warmup:
    # 自动预热热门内容 TOP N
    auto-warmup-enabled: true
    auto-warmup-top-n: 10000
    auto-warmup-cron: "0 30 3 * * *"
    # 每批预热 URL 数量
    batch-size: 100
    # 批次间隔（毫秒）
    batch-interval-ms: 200

  # 成本告警
  cost-alert:
    monthly-quota-threshold: 0.8  # 月度配额 80% 告警
    monthly-quota-urgent: 0.9     # 90% 紧急告警
    daily-anomaly-ratio: 2.0      # 日用量是均值 2 倍告警

  # 健康检查
  health-check:
    interval-seconds: 30
    healthy-ttfb-ms: 100
    degraded-ttfb-ms: 300
    down-success-rate: 0.5
    recovery-consecutive-passes: 3  # 连续通过次数

  # 故障切换
  failover:
    auto-switch: true
    dns-ttl-seconds: 60
    recovery-gray-ratio: 0.2       # 灰度恢复比例
    recovery-wait-minutes: 10      # 灰度观察时长
```

---

## 15. 测试策略

### 15.1 单元测试

```java
class CdnScheduleEngineTest {

    @Test
    void should_select_aliyun_for_telecom_user() {
        // Given: 电信用户请求图片
        ScheduleRequest request = ScheduleRequest.builder()
            .domainType("image")
            .ispCode("telecom")
            .regionCode("south")
            .build();

        // When: 调度
        ScheduleResult result = engine.schedule(request);

        // Then: 阿里云权重最高（电信南////////////////方优化）
        assertThat(result.getProviderCode()).isEqualTo("aliyun");
        assertThat(result.isDegraded()).isFalse();
    }

    @Test
    void should_fallback_when_all_providers_down() {
        // Given: 所有供应商不健康
        when(healthMonitor.isHealthy(anyLong())).thenReturn(false);

        // When: 调度
        ScheduleResult result = engine.schedule(request);

        // Then: 直连源站降级
        assertThat(result.isDegraded()).isTrue();
        assertThat(result.getProviderCode()).isEqualTo("direct_origin");
    }

    @Test
    void should_reduce_weight_for_slow_provider() {
        // Given: 腾讯云近期 TTFB 250ms
        when(metricsService.getRecentAvgTtfb(any(), any(), any(), any(), any()))
            .thenReturn(250.0);

        // When: 调度
        ScheduleResult result = engine.schedule(request);

        // Then: 不选择腾讯云（权重已被降至原来的 50%）
        assertThat(result.getProviderCode()).isNotEqualTo("tencent");
    }
}
```

### 15.2 集成测试

```java
@SpringBootTest
class CdnIntegrationTest {

    @Test
    void full_refresh_workflow() {
        // 1. 创建刷新任务
        RefreshResponse resp = cdnAdminApi.refresh(RefreshRequest.builder()
            .type("flush_url")
            .domain("img-cdn.primetop.com")
            .targets(List.of("/test/image1.jpg"))
            .build());

        // 2. 验证任务创建成功
        assertThat(resp.getStatus()).isEqualTo("running");

        // 3. 等待任务完成
        Awaitility.await().atMost(30, SECONDS).until(() -> {
            RefreshTaskStatus status = cdnAdminApi.getRefreshStatus(resp.getTaskId());
            return "completed".equals(status.getStatus());
        });

        // 4. 验证 CDN 缓存已刷新（请求返回最新内容）
        // ... 使用 HTTP 客户端验证
    }
}
```

### 15.3 压力测试

| 场景 | 目标 | 验证点 |
|------|------|--------|
| 图片高频加载 | 1000 QPS 持续 10 分钟 | CDN 命中率 ≥ 95%，TTFB ≤ 50ms |
| 视频并发起播 | 500 并发首播 | 起播时间 ≤ 800ms，无 5xx |
| 资源包并发下载 | 100 并发下载 500MB 包 | 下载速度 ≥ 5MB/s，无超时 |
| 预热任务批量 | 单任务 5000 URL | 30 分钟内完成，失败率 ≤ 1% |
| 故障切换 | 模拟主供应商宕机 | 30 秒内完成切换，错误率恢复 |

---

## 16. 部署与运维

### 16.1 初始部署 Checklist

```
□ 1. CDN 域名注册与 ICP 备案
□ 2. SSL 证书申请与部署（所有 CDN 域名）
□ 3. CDN 供应商账号开通与 API 密钥配置
□ 4. 源站 (OSS) 配置与 CDN 域名绑定
□ 5. 回源配置（Host、协议、超时）
□ 6. 缓存规则配置（按内容类型 TTL）
□ 7. HTTPS 与 HTTP/2 启用
□ 8. 防盗链配置（Referer 白名单）
□ 9. 域名解析配置（DNS 智能解析 / HTTPDNS）
□ 10. 客户端 SDK 集成与验收
□ 11. 监控告警配置
□ 12. 首次内容预热
□ 13. 全链路验证（不同运营商 + 地域 + 网络环境）
```

### 16.2 日常运维

| 任务 | 频率 | 负责人 |
|------|------|--------|
| 检查缓存命中率 | 每日 | 运维 |
| 检查带宽峰值 | 每日 | 运维 |
| 检查月度成本趋势 | 每周 | 运维 + 财务 |
| CDN 健康状态巡检 | 每日 | 运维 |
| 冷内容分析与归档 | 每月 | 运维 |
| SSL 证书续期检查 | 每月 | 运维 |
| 供应商服务质量评估 | 每季度 | 运维 + 架构 |
| 压测与容量评估 | 每学期开课前 | 运维 + 测试 |

---

## 17. 演进规划

| 阶段 | 时间 | 目标 |
|------|------|------|
| **MVP** | 第 1-3 月 | 单 CDN 供应商（阿里云）+ 基础缓存 + 图片优化 |
| **V1.0** | 第 4-6 月 | 双 CDN 供应商 + HTTPDNS + 预热 + 监控告警 |
| **V1.5** | 第 7-9 月 | 多 CDN 智能调度 + 增量更新 + 成本治理 |
| **V2.0** | 第 10+ 月 | 边缘计算 + 个性化内容推送 + 多区域容灾 |
