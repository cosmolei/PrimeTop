# 服务端 BFF 数据聚合层与多端接口适配设计

> **模块版本**: v1.0 | **日期**: 2026-05-25 | **状态**: 初稿
> **原始需求来源**: `docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md` §8.2, §8.3, §8.4, §9
> **依赖文档**: API网关与通用接口规范、首页与学习工作台、服务端服务架构与部署设计、客户端架构与前端框架

---

## 1. 模块概述

### 1.1 定位

BFF（Backend for Frontend）数据聚合层是 PrimeTop 服务端面向客户端的"门面层"，位于 API 网关与业务服务层之间，负责：

1. **数据聚合**：将多个下游服务的独立 API 结果组装成页面级聚合响应，减少客户端请求次数
2. **接口适配**：根据客户端类型（APP / Web / 小程序）和版本，裁剪/转换响应字段
3. **编排优化**：并行调用无依赖的下游服务，串行调用有依赖的服务，控制全局超时
4. **降级兜底**：下游服务不可用时返回精简数据或缓存数据，保证页面基本可用
5. **协议转换**：将内部服务响应格式转换为各端最优传输格式

### 1.2 为什么需要 BFF 层

| 痛点 | 场景 | BFF 解决方案 |
|------|------|-------------|
| 首页需要 9+ 个服务的数据 | 客户端发起 9 次 HTTP 请求，延迟叠加 | 单次聚合 API，服务端并行调用 |
| 不同客户端数据需求不同 | Web 需要更多数据，小程序需要精简 | 按客户端类型裁剪响应 |
| 页面加载慢（P0 性能指标） | 串行请求导致首屏 > 2s | 并行编排 + 增量返回 |
| 服务降级时体验差 | 单个服务挂了整个页面白屏 | 按区降级，部分数据用缓存 |
| APP 版本迭代需要不同字段 | v1.0 和 v2.0 首页结构不同 | 版本化响应适配 |
| 后续多端扩展 | Web / 小程序的数据需求差异 | 独立 BFF 适配层 |

### 1.3 设计原则

1. **瘦 BFF**：仅做聚合、裁剪、降级编排，不包含业务逻辑
2. **并行优先**：无依赖的下游调用必须并行，总延迟取最大值而非累加
3. **按区降级**：每个聚合区域独立降级，互不影响
4. **缓存分层**：热点数据使用本地缓存 + Redis 二级缓存
5. **可观测**：每次聚合记录各区域耗时和降级状态
6. **渐进演进**：MVP 阶段 BFF 与单体同进程部署，后续可独立拆分

### 1.4 术语定义

| 术语 | 含义 |
|------|------|
| Aggregate API | 聚合 API，面向页面的单次请求返回多区数据 |
| Zone | 聚合响应中的独立数据区，如 `userInfo`、`todayTasks`、`weakPoints` |
| Downstream | 下游业务服务，如用户服务、学习服务、AI 服务等 |
| Adapter | 适配器，按客户端类型/版本转换响应 |
| Fallback | 降级策略，下游不可用时的备选数据来源 |
| Aggregator | 聚合器，编排多个下游调用的执行单元 |

---

## 2. 架构设计

### 2.1 整体架构位置

```
┌──────────────────────────────────────────────────────────┐
│              客户端 (APP / Web / 小程序)                    │
└─────────────────────────┬────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼────────────────────────────────┐
│                     API 网关                               │
│              (鉴权 / 限流 / 路由 / 日志)                    │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│                   BFF 聚合层 ★ 本模块                      │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Aggregate   │  │ Response     │  │ Degradation     │  │
│  │ Orchestrator│  │ Adapter      │  │ Manager         │  │
│  └─────────────┘  └──────────────┘  └─────────────────┘  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Cache       │  │ Version      │  │ Metrics         │  │
│  │ Manager     │  │ Router       │  │ Collector       │  │
│  └─────────────┘  └──────────────┘  └─────────────────┘  │
└─────────────────────────┬────────────────────────────────┘
                          │ 内部调用 (同进程 / RPC)
┌─────────────────────────▼────────────────────────────────┐
│                    业务服务层                               │
│  用户服务  学习服务  题目服务  错题服务  规划服务  支付服务    │
│  AI服务   内容服务  消息服务  搜索服务  分析服务  ...        │
└──────────────────────────────────────────────────────────┘
```

### 2.2 MVP 部署策略

MVP 阶段 BFF 层作为单体应用的 `bff/` 包（Python module）部署，与业务服务同进程：

```
primetop/
├── bff/                          # BFF 聚合层
│   ├── __init__.py
│   ├── orchestrator.py           # 聚合编排引擎
│   ├── adapters/                 # 响应适配器
│   │   ├── base.py
│   │   ├── mobile_adapter.py
│   │   ├── web_adapter.py
│   │   └── miniapp_adapter.py
│   ├── aggregators/              # 页面聚合器
│   │   ├── home.py               # 首页聚合
│   │   ├── ai_tutor.py           # AI 辅导页聚合
│   │   ├── mistake_review.py     # 错题复习页聚合
│   │   ├── learning_report.py    # 学习报告页聚合
│   │   ├── parent_dashboard.py   # 家长仪表盘聚合
│   │   └── teacher_class.py      # 教师班级页聚合
│   ├── zones/                    # 可复用数据区
│   │   ├── user_profile.py
│   │   ├── today_tasks.py
│   │   ├── weak_points.py
│   │   ├── recent_learning.py
│   │   ├── study_stats.py
│   │   └── notifications.py
│   ├── cache.py                  # 聚合缓存管理
│   ├── degradation.py            # 降级策略管理
│   ├── metrics.py                # 聚合指标采集
│   └── routes.py                 # BFF 路由注册
├── modules/                      # 业务模块（已有）
│   ├── user/
│   ├── learning/
│   ├── question/
│   └── ...
└── main.py
```

### 2.3 微服务拆分后的演进

当单体演进为微服务后，BFF 层独立部署：

```
客户端 → API 网关 → BFF Service (独立进程) → 下游微服务 (通过 gRPC/HTTP)
```

MVP 阶段的所有 BFF 代码只需修改导入路径，核心逻辑不变。

---

## 3. 核心组件设计

### 3.1 聚合编排引擎 (Orchestrator)

#### 3.1.1 数据模型

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional
import asyncio


class ZoneStatus(str, Enum):
    SUCCESS = "success"
    FALLBACK = "fallback"
    TIMEOUT = "timeout"
    ERROR = "error"
    SKIPPED = "skipped"


@dataclass
class ZoneResult:
    """单个数据区的聚合结果"""
    zone_name: str
    status: ZoneStatus
    data: Any = None
    error: Optional[str] = None
    latency_ms: int = 0
    from_cache: bool = False


@dataclass
class AggregateRequest:
    """聚合请求上下文"""
    user_id: int
    client_type: str          # "mobile" | "web" | "miniapp"
    client_version: str       # 语义化版本，如 "1.2.0"
    platform: str             # "android" | "ios" | "web" | "wechat"
    grade_code: str           # 用户当前年级
    stage: str                # 学段
    requested_zones: list[str] = field(default_factory=list)  # 客户端可选请求指定区
    options: dict = field(default_factory=dict)               # 扩展参数


@dataclass
class AggregateResponse:
    """聚合响应"""
    zones: dict[str, ZoneResult]
    total_latency_ms: int = 0
    server_timestamp: str = ""
    degraded_zones: list[str] = field(default_factory=list)
```

#### 3.1.2 聚合编排器核心实现

```python
import time
import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class ZoneFetcher(ABC):
    """数据区获取器基类"""

    @property
    @abstractmethod
    def zone_name(self) -> str:
        """数据区名称"""
        ...

    @property
    def dependencies(self) -> list[str]:
        """依赖的其他数据区（空列表表示可并行）"""
        return []

    @property
    def timeout_ms(self) -> int:
        """本区超时时间"""
        return 3000

    @property
    def cache_ttl(self) -> int:
        """缓存 TTL（秒），0 表示不缓存"""
        return 0

    @abstractmethod
    async def fetch(self, req: AggregateRequest, 
                    deps: dict[str, ZoneResult]) -> Any:
        """获取数据，deps 包含已完成依赖区的结果"""
        ...

    async def fallback(self, req: AggregateRequest) -> Any:
        """降级数据（默认返回空）"""
        return None


class Orchestrator:
    """聚合编排引擎"""

    def __init__(self):
        self._fetchers: dict[str, ZoneFetcher] = {}
        self._cache: AggregateCache  # 注入
        self._metrics: MetricsCollector  # 注入

    def register(self, fetcher: ZoneFetcher):
        self._fetchers[fetcher.zone_name] = fetcher

    async def aggregate(
        self, 
        req: AggregateRequest, 
        zone_names: list[str]
    ) -> AggregateResponse:
        """
        编排多区数据聚合。
        
        策略：
        1. 构建依赖图，拓扑排序
        2. 同层无依赖的区并行执行
        3. 每区独立超时、独立降级
        4. 收集所有结果组装响应
        """
        start = time.monotonic()
        results: dict[str, ZoneResult] = {}

        # 筛选需要获取的区
        target_zones = [z for z in zone_names if z in self._fetchers]
        
        # 拓扑分层
        layers = self._topological_layers(target_zones)

        for layer in layers:
            # 本层所有区并行执行
            tasks = []
            for zone_name in layer:
                fetcher = self._fetchers[zone_name]
                tasks.append(
                    self._fetch_zone(fetcher, req, results)
                )
            layer_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for result in layer_results:
                if isinstance(result, ZoneResult):
                    results[result.zone_name] = result
                elif isinstance(result, Exception):
                    logger.error(f"Zone fetch unexpected error: {result}")

        total_ms = int((time.monotonic() - start) * 1000)
        degraded = [z for z, r in results.items() 
                     if r.status in (ZoneStatus.FALLBACK, ZoneStatus.TIMEOUT)]

        return AggregateResponse(
            zones=results,
            total_latency_ms=total_ms,
            server_timestamp=time.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
            degraded_zones=degraded,
        )

    async def _fetch_zone(
        self, 
        fetcher: ZoneFetcher, 
        req: AggregateRequest,
        completed: dict[str, ZoneResult]
    ) -> ZoneResult:
        """获取单个数据区，含缓存、超时、降级逻辑"""
        zone_name = fetcher.zone_name
        start = time.monotonic()

        # 1. 检查缓存
        if fetcher.cache_ttl > 0:
            cached = await self._cache.get(req.user_id, zone_name)
            if cached is not None:
                return ZoneResult(
                    zone_name=zone_name,
                    status=ZoneStatus.SUCCESS,
                    data=cached,
                    latency_ms=int((time.monotonic() - start) * 1000),
                    from_cache=True,
                )

        # 2. 构建依赖数据
        deps = {z: completed[z] for z in fetcher.dependencies 
                if z in completed}

        # 3. 带超时执行
        try:
            data = await asyncio.wait_for(
                fetcher.fetch(req, deps),
                timeout=fetcher.timeout_ms / 1000.0,
            )
            latency = int((time.monotonic() - start) * 1000)

            # 4. 写入缓存
            if fetcher.cache_ttl > 0 and data is not None:
                await self._cache.set(
                    req.user_id, zone_name, data, fetcher.cache_ttl
                )

            return ZoneResult(
                zone_name=zone_name,
                status=ZoneStatus.SUCCESS,
                data=data,
                latency_ms=latency,
            )

        except asyncio.TimeoutError:
            latency = int((time.monotonic() - start) * 1000)
            logger.warning(f"Zone {zone_name} timeout ({latency}ms)")
            
            # 5. 降级处理
            fallback_data = await self._try_fallback(fetcher, req)
            return ZoneResult(
                zone_name=zone_name,
                status=ZoneStatus.FALLBACK if fallback_data is not None 
                        else ZoneStatus.TIMEOUT,
                data=fallback_data,
                error="timeout",
                latency_ms=latency,
            )

        except Exception as e:
            latency = int((time.monotonic() - start) * 1000)
            logger.error(f"Zone {zone_name} error: {e}")
            
            fallback_data = await self._try_fallback(fetcher, req)
            return ZoneResult(
                zone_name=zone_name,
                status=ZoneStatus.FALLBACK if fallback_data is not None 
                        else ZoneStatus.ERROR,
                data=fallback_data,
                error=str(e),
                latency_ms=latency,
            )

    async def _try_fallback(
        self, fetcher: ZoneFetcher, req: AggregateRequest
    ) -> Any:
        """尝试降级获取数据"""
        # 优先从缓存获取（忽略 TTL）
        cached = await self._cache.get(req.user_id, fetcher.zone_name)
        if cached is not None:
            return cached
        
        # 调用 fetcher 自定义降级
        try:
            return await fetcher.fallback(req)
        except Exception:
            return None

    def _topological_layers(self, zones: list[str]) -> list[list[str]]:
        """将数据区按依赖关系拓扑排序，返回分层列表"""
        remaining = set(zones)
        layers = []

        while remaining:
            # 找出所有依赖已满足的区
            layer = [
                z for z in remaining
                if all(dep not in remaining for dep in self._fetchers[z].dependencies)
            ]
            if not layer:
                # 存在循环依赖，强制打断
                logger.warning(f"Circular dependency detected in zones: {remaining}")
                layer = list(remaining)
            layers.append(layer)
            remaining -= set(layer)

        return layers
```

### 3.2 响应适配器 (Response Adapter)

#### 3.2.1 适配器基类

```python
from abc import ABC, abstractmethod
from typing import Any


class ResponseAdapter(ABC):
    """响应适配器基类，按客户端类型裁剪/转换响应"""

    @property
    @abstractmethod
    def client_type(self) -> str:
        """支持的客户端类型"""
        ...

    @abstractmethod
    def adapt_zone(self, zone_name: str, data: Any) -> Any:
        """适配单个数据区"""
        ...

    def adapt_response(self, response: AggregateResponse) -> dict:
        """适配完整聚合响应"""
        result = {
            "timestamp": response.server_timestamp,
            "degraded_zones": response.degraded_zones,
        }
        for zone_name, zone_result in response.zones.items():
            adapted = self.adapt_zone(zone_name, zone_result.data)
            result[zone_name] = adapted
        return result


class MobileAdapter(ResponseAdapter):
    """移动端适配器：完整数据，含图片 URL 适配"""

    client_type = "mobile"

    def adapt_zone(self, zone_name: str, data: Any) -> Any:
        if data is None:
            return None
        # 移动端使用原图 CDN 域名
        return self._rewrite_image_urls(data, "cdn.primetop.com")

    def _rewrite_image_urls(self, data: Any, cdn_domain: str) -> Any:
        """递归替换图片 URL"""
        if isinstance(data, dict):
            return {
                k: self._rewrite_image_urls(v, cdn_domain) 
                if k.endswith(("_url", "_image", "_avatar", "_cover")) else
                self._rewrite_image_urls(v, cdn_domain)
                for k, v in data.items()
            }
        elif isinstance(data, list):
            return [self._rewrite_image_urls(item, cdn_domain) for item in data]
        elif isinstance(data, str) and data.startswith("img://"):
            return data.replace("img://", f"https://{cdn_domain}/")
        return data


class WebAdapter(ResponseAdapter):
    """Web 端适配器：额外 SEO 字段，支持 SSR 预渲染数据"""

    client_type = "web"

    def adapt_zone(self, zone_name: str, data: Any) -> Any:
        if data is None:
            return None
        adapted = self._add_seo_fields(zone_name, data)
        return self._rewrite_image_urls(adapted, "web-cdn.primetop.com")

    def _add_seo_fields(self, zone_name: str, data: Any) -> Any:
        """为 Web 端添加 SEO 相关字段"""
        if zone_name == "userProfile" and isinstance(data, dict):
            data["schema_markup"] = {
                "@type": "EducationalOrganization",
                "name": "PrimeTop",
            }
        return data

    def _rewrite_image_urls(self, data: Any, cdn_domain: str) -> Any:
        # 同 MobileAdapter 逻辑
        if isinstance(data, dict):
            return {k: self._rewrite_image_urls(v, cdn_domain) 
                    for k, v in data.items()}
        elif isinstance(data, list):
            return [self._rewrite_image_urls(item, cdn_domain) for item in data]
        elif isinstance(data, str) and data.startswith("img://"):
            return data.replace("img://", f"https://{cdn_domain}/")
        return data


class MiniAppAdapter(ResponseAdapter):
    """小程序适配器：精简字段，减少包体积"""

    client_type = "miniapp"

    # 小程序不需要的字段列表
    STRIP_FIELDS = {
        "userProfile": {"device_id", "last_login_ip", "login_history"},
        "studyStats": {"raw_events", "detail_logs"},
    }

    # 小程序图片使用 WebP + 压缩
    def adapt_zone(self, zone_name: str, data: Any) -> Any:
        if data is None:
            return None
        data = self._strip_fields(zone_name, data)
        return self._rewrite_image_urls(data, "mini-cdn.primetop.com")

    def _strip_fields(self, zone_name: str, data: Any) -> Any:
        strip = self.STRIP_FIELDS.get(zone_name, set())
        if isinstance(data, dict) and strip:
            return {k: v for k, v in data.items() if k not in strip}
        return data

    def _rewrite_image_urls(self, data: Any, cdn_domain: str) -> Any:
        if isinstance(data, dict):
            return {k: self._rewrite_image_urls(v, cdn_domain) 
                    for k, v in data.items()}
        elif isinstance(data, list):
            return [self._rewrite_image_urls(item, cdn_domain) for item in data]
        elif isinstance(data, str) and data.startswith("img://"):
            # 小程序使用 WebP 格式
            url = data.replace("img://", f"https://{cdn_domain}/")
            return f"{url}?format=webp&q=80"
        return data


class AdapterFactory:
    """适配器工厂"""

    _adapters: dict[str, ResponseAdapter] = {}

    @classmethod
    def register(cls, adapter: ResponseAdapter):
        cls._adapters[adapter.client_type] = adapter

    @classmethod
    def get(cls, client_type: str) -> ResponseAdapter:
        adapter = cls._adapters.get(client_type)
        if adapter is None:
            raise ValueError(f"Unknown client_type: {client_type}")
        return adapter


# 注册适配器
AdapterFactory.register(MobileAdapter())
AdapterFactory.register(WebAdapter())
AdapterFactory.register(MiniAppAdapter())
```

### 3.3 版本路由器 (Version Router)

```python
from dataclasses import dataclass
from typing import Callable, Any
from packaging.version import Version


@dataclass
class VersionRule:
    """版本适配规则"""
    min_version: str       # 最低版本
    max_version: str       # 最高版本（不包含）
    zone_filter: dict[str, list[str]]  # zone_name -> 保留的字段列表
    extra_transform: Callable[[dict], dict] | None = None


class VersionRouter:
    """
    处理不同客户端版本的响应差异。
    
    典型场景：
    - v1.0 首页没有"学习打卡"区，v1.2 新增
    - v1.5 新增"AI 对话推荐"区
    - v2.0 首页结构完全改版
    """

    def __init__(self):
        self._rules: list[VersionRule] = []

    def register(self, rule: VersionRule):
        self._rules.append(rule)

    def apply(self, client_version: str, zones: dict) -> dict:
        """根据客户端版本裁剪数据区"""
        version = Version(client_version)
        
        for rule in self._rules:
            if Version(rule.min_version) <= version < Version(rule.max_version):
                zones = self._apply_rule(rule, zones)
        
        return zones

    def _apply_rule(self, rule: VersionRule, zones: dict) -> dict:
        result = {}
        for zone_name, zone_data in zones.items():
            if zone_name in rule.zone_filter:
                filter_fields = rule.zone_filter[zone_name]
                if isinstance(zone_data, dict):
                    result[zone_name] = {
                        k: v for k, v in zone_data.items() 
                        if k in filter_fields
                    }
                else:
                    result[zone_name] = zone_data
            else:
                result[zone_name] = zone_data
        
        if rule.extra_transform:
            result = rule.extra_transform(result)
        
        return result


# 版本规则注册示例
version_router = VersionRouter()
version_router.register(VersionRule(
    min_version="1.0.0",
    max_version="1.2.0",
    zone_filter={
        # v1.0 首页不需要打卡区
        "dailyCheckin": [],  # 空列表 = 移除整个区
    }
))
version_router.register(VersionRule(
    min_version="1.0.0",
    max_version="1.5.0",
    zone_filter={
        # v1.5 之前没有 AI 推荐区
        "aiRecommendations": [],
    }
))
```

### 3.4 聚合缓存管理

```python
import json
import hashlib
from typing import Any, Optional


class AggregateCache:
    """
    聚合层二级缓存：L1 本地内存 + L2 Redis
    
    缓存 key 设计：bff:{user_id}:{zone_name}:{version_hash}
    """

    def __init__(self, redis_client, local_cache_max=500):
        self._redis = redis_client
        self._local: dict[str, tuple[Any, float]] = {}
        self._local_max = local_cache_max

    def _make_key(self, user_id: int, zone_name: str) -> str:
        return f"bff:{user_id}:{zone_name}"

    async def get(self, user_id: int, zone_name: str) -> Optional[Any]:
        """读取缓存（L1 → L2）"""
        key = self._make_key(user_id, zone_name)

        # L1 本地缓存
        if key in self._local:
            data, expire_at = self._local[key]
            if time.time() < expire_at:
                return data
            del self._local[key]

        # L2 Redis
        raw = await self._redis.get(key)
        if raw is not None:
            data = json.loads(raw)
            # 回填 L1
            self._local[key] = (data, time.time() + 60)  # L1 TTL 60s
            return data

        return None

    async def set(self, user_id: int, zone_name: str, 
                  data: Any, ttl: int) -> None:
        """写入缓存（L1 + L2）"""
        key = self._make_key(user_id, zone_name)

        # L1 淘汰
        if len(self._local) >= self._local_max:
            oldest_key = min(self._local, key=lambda k: self._local[k][1])
            del self._local[oldest_key]

        self._local[key] = (data, time.time() + min(ttl, 60))
        
        # L2 Redis
        await self._redis.setex(key, ttl, json.dumps(data, ensure_ascii=False))

    async def invalidate(self, user_id: int, zone_name: str = None) -> None:
        """失效缓存"""
        if zone_name:
            key = self._make_key(user_id, zone_name)
            self._local.pop(key, None)
            await self._redis.delete(key)
        else:
            # 失效用户所有 BFF 缓存
            pattern = f"bff:{user_id}:*"
            keys = await self._redis.keys(pattern)
            if keys:
                await self._redis.delete(*keys)
            self._local = {
                k: v for k, v in self._local.items() 
                if not k.startswith(f"bff:{user_id}:")
            }

    async def invalidate_zone_multi(self, user_ids: list[int], 
                                      zone_name: str) -> None:
        """批量失效某数据区（如全局配置变更时）"""
        pipe = self._redis.pipeline()
        for uid in user_ids:
            key = self._make_key(uid, zone_name)
            pipe.delete(key)
            self._local.pop(key, None)
        await pipe.execute()
```

---

## 4. 页面聚合器详细设计

### 4.1 首页聚合器 (Home Aggregator)

首页是聚合最复杂的页面，需要 9+ 个服务的数据。

#### 4.1.1 数据区定义

| 数据区 | 下游服务 | 超时 | 缓存 TTL | 依赖 | 说明 |
|--------|----------|------|----------|------|------|
| `userProfile` | 用户服务 | 1s | 300s | 无 | 用户基础信息+会员状态 |
| `todayTasks` | 规划服务 | 2s | 60s | 无 | 今日学习任务 |
| `weakPoints` | 分析服务 | 2s | 300s | 无 | 薄弱知识点（Top 5） |
| `recentLearning` | 学习服务 | 2s | 60s | 无 | 最近学习章节/对话 |
| `studyStats` | 分析服务 | 2s | 120s | 无 | 今日学习统计 |
| `unreadNotifications` | 消息服务 | 1s | 30s | 无 | 未读消息数 |
| `dailyCheckin` | 运营服务 | 1s | 300s | 无 | 打卡状态（v1.2+） |
| `quickActions` | 配置服务 | 1s | 600s | 无 | 快捷操作配置 |
| `recommendedContent` | 推荐服务 | 2s | 300s | userProfile | 个性化推荐内容 |

#### 4.1.2 数据区获取器实现

```python
class UserProfileFetcher(ZoneFetcher):
    """用户档案数据区"""

    zone_name = "userProfile"
    timeout_ms = 1000
    cache_ttl = 300  # 5 分钟

    def __init__(self, user_service: UserService):
        self._user_service = user_service

    async def fetch(self, req: AggregateRequest, 
                    deps: dict[str, ZoneResult]) -> dict:
        profile = await self._user_service.get_profile(req.user_id)
        membership = await self._user_service.get_membership(req.user_id)
        return {
            "nickname": profile.nickname,
            "avatar_url": profile.avatar_url,
            "grade_code": profile.grade_code,
            "stage": profile.stage,
            "textbook_versions": profile.textbook_versions,
            "membership": {
                "level": membership.level,
                "expire_date": membership.expire_date,
                "is_active": membership.is_active,
            },
        }

    async def fallback(self, req: AggregateRequest) -> dict:
        """降级：返回最基础信息"""
        return {
            "nickname": "同学",
            "avatar_url": None,
            "grade_code": req.grade_code,
            "stage": req.stage,
            "membership": {"level": "free", "is_active": True},
        }


class TodayTasksFetcher(ZoneFetcher):
    """今日学习任务数据区"""

    zone_name = "todayTasks"
    timeout_ms = 2000
    cache_ttl = 60  # 1 分钟

    def __init__(self, plan_service: PlanService):
        self._plan_service = plan_service

    async def fetch(self, req: AggregateRequest,
                    deps: dict[str, ZoneResult]) -> dict:
        tasks = await self._plan_service.get_today_tasks(req.user_id)
        return {
            "date": tasks.date,
            "total_count": len(tasks.items),
            "completed_count": sum(1 for t in tasks.items if t.is_completed),
            "estimated_minutes": tasks.estimated_minutes,
            "items": [
                {
                    "id": t.id,
                    "type": t.task_type,        # "chapter" | "exercise" | "review" | "mistake_review"
                    "title": t.title,
                    "subject_code": t.subject_code,
                    "is_completed": t.is_completed,
                    "progress": t.progress,      # 0.0 ~ 1.0
                    "deep_link": t.deep_link,    # 客户端跳转链接
                }
                for t in tasks.items[:10]         # 首页最多展示 10 条
            ],
        }

    async def fallback(self, req: AggregateRequest) -> dict:
        return {"date": "", "total_count": 0, "completed_count": 0, 
                "estimated_minutes": 0, "items": []}


class WeakPointsFetcher(ZoneFetcher):
    """薄弱知识点数据区"""

    zone_name = "weakPoints"
    timeout_ms = 2000
    cache_ttl = 300  # 5 分钟（变化频率低）

    def __init__(self, analysis_service: AnalysisService):
        self._analysis = analysis_service

    async def fetch(self, req: AggregateRequest,
                    deps: dict[str, ZoneResult]) -> dict:
        weak = await self._analysis.get_weak_knowledge_points(
            req.user_id, limit=5
        )
        return {
            "total_weak_count": weak.total_count,
            "items": [
                {
                    "kp_id": w.kp_id,
                    "kp_name": w.kp_name,
                    "subject_code": w.subject_code,
                    "mastery": w.mastery,       # 0.0 ~ 1.0
                    "trend": w.trend,            # "improving" | "stable" | "declining"
                    "deep_link": f"primetop://knowledge/{w.kp_id}",
                }
                for w in weak.items
            ],
        }

    async def fallback(self, req: AggregateRequest) -> dict:
        return {"total_weak_count": 0, "items": []}


class RecommendedContentFetcher(ZoneFetcher):
    """个性化推荐内容数据区 — 依赖 userProfile 获取年级/兴趣"""

    zone_name = "recommendedContent"
    timeout_ms = 2000
    cache_ttl = 300
    dependencies = ["userProfile"]  # 依赖用户档案区

    def __init__(self, recommend_service: RecommendService):
        self._rec = recommend_service

    async def fetch(self, req: AggregateRequest,
                    deps: dict[str, ZoneResult]) -> dict:
        # 从依赖区获取用户信息
        profile_data = deps["userProfile"].data
        
        recommendations = await self._rec.get_home_recommendations(
            user_id=req.user_id,
            stage=profile_data["stage"],
            grade_code=profile_data["grade_code"],
            limit=6,
        )
        return {
            "items": [
                {
                    "id": r.id,
                    "type": r.content_type,     # "chapter" | "exercise_set" | "article" | "video"
                    "title": r.title,
                    "subject_code": r.subject_code,
                    "cover_url": r.cover_url,
                    "deep_link": r.deep_link,
                    "reason": r.reason,         # "基于您的薄弱点" | "本周热门" 等
                }
                for r in recommendations
            ],
        }

    async def fallback(self, req: AggregateRequest) -> dict:
        return {"items": []}
```

#### 4.1.3 首页聚合 API

```
GET /api/v1/bff/home
```

**请求头**：

| Header | 必填 | 说明 |
|--------|------|------|
| Authorization | 是 | Bearer {token} |
| X-Client-Type | 是 | `mobile` / `web` / `miniapp` |
| X-Client-Version | 是 | 语义化版本号，如 `1.2.0` |
| X-Platform | 是 | `android` / `ios` / `web` / `wechat` |

**查询参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| zones | string | 否 | 指定请求的数据区，逗号分隔。不传则返回全部 |
| refresh | boolean | 否 | 是否强制刷新（跳过缓存），默认 false |

**响应示例（移动端 v1.2.0）**：

```json
{
  "code": 0,
  "data": {
    "timestamp": "2026-05-25T07:00:00+08:00",
    "degraded_zones": [],
    "userProfile": {
      "nickname": "小明",
      "avatar_url": "https://cdn.primetop.com/avatar/123.jpg",
      "grade_code": "G07",
      "stage": "junior",
      "textbook_versions": {
        "MATH": "PEP",
        "CHINESE": "PEP",
        "ENGLISH": "PEP"
      },
      "membership": {
        "level": "monthly",
        "expire_date": "2026-06-25",
        "is_active": true
      }
    },
    "todayTasks": {
      "date": "2026-05-25",
      "total_count": 5,
      "completed_count": 2,
      "estimated_minutes": 45,
      "items": [
        {
          "id": "task_001",
          "type": "chapter",
          "title": "一元二次方程 - 基础概念",
          "subject_code": "MATH",
          "is_completed": true,
          "progress": 1.0,
          "deep_link": "primetop://chapter/math-07-ch03-s01"
        }
      ]
    },
    "weakPoints": {
      "total_weak_count": 8,
      "items": [
        {
          "kp_id": 1024,
          "kp_name": "因式分解",
          "subject_code": "MATH",
          "mastery": 0.35,
          "trend": "declining",
          "deep_link": "primetop://knowledge/1024"
        }
      ]
    },
    "recentLearning": {
      "chapter": {
        "title": "二次根式",
        "subject_code": "MATH",
        "progress": 0.6,
        "deep_link": "primetop://chapter/math-07-ch02-s03"
      },
      "ai_conversation": {
        "title": "关于勾股定理的讨论",
        "last_message_at": "2026-05-24T22:30:00+08:00",
        "deep_link": "primetop://ai/conversation/conv_456"
      }
    },
    "studyStats": {
      "today_minutes": 35,
      "streak_days": 12,
      "weekly_goal_minutes": 210,
      "weekly_actual_minutes": 145
    },
    "unreadNotifications": {
      "count": 3
    },
    "dailyCheckin": {
      "is_checked_in": false,
      "streak_days": 12,
      "reward_preview": "+10积分"
    },
    "quickActions": [
      {
        "id": "photo_search",
        "icon": "camera",
        "label": "拍题答疑",
        "deep_link": "primetop://photo-search"
      },
      {
        "id": "ai_tutor",
        "icon": "chat",
        "label": "问AI",
        "deep_link": "primetop://ai-tutor"
      },
      {
        "id": "sync_class",
        "icon": "book",
        "label": "同步课堂",
        "deep_link": "primetop://sync-class"
      },
      {
        "id": "mistake_review",
        "icon": "error",
        "label": "错题复习",
        "deep_link": "primetop://mistake-review"
      }
    ],
    "recommendedContent": {
      "items": [
        {
          "id": "rec_001",
          "type": "exercise_set",
          "title": "因式分解专项训练",
          "subject_code": "MATH",
          "cover_url": "https://cdn.primetop.com/cover/rec001.jpg",
          "deep_link": "primetop://exercise/rec001",
          "reason": "针对您的薄弱知识点"
        }
      ]
    }
  }
}
```

**降级响应示例（学习分析服务超时）**：

```json
{
  "code": 0,
  "data": {
    "timestamp": "2026-05-25T07:00:00+08:00",
    "degraded_zones": ["weakPoints", "studyStats"],
    "userProfile": { "..." : "正常数据" },
    "todayTasks": { "..." : "正常数据" },
    "weakPoints": null,
    "studyStats": null,
    "recentLearning": { "..." : "正常数据" },
    "unreadNotifications": { "count": 3 },
    "quickActions": [ "..." ],
    "recommendedContent": { "items": [] }
  }
}
```

#### 4.1.4 编排流程图

```
客户端请求 GET /api/v1/bff/home
          │
          ▼
    ┌─────────────┐
    │  API 网关    │  鉴权、限流、路由
    └──────┬──────┘
           │
           ▼
    ┌─────────────────────────────────────────────────┐
    │              HomeAggregator                      │
    │                                                  │
    │  Layer 0（并行，无依赖）：                        │
    │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │
    │  │ user   │ │today   │ │weak    │ │recent  │    │
    │  │Profile │ │Tasks   │ │Points  │ │Learning│    │
    │  │ 1s     │ │ 2s     │ │ 2s     │ │ 2s     │    │
    │  └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘    │
    │      │          │          │          │          │
    │  ┌───┴────┐ ┌───┴────┐ ┌──┴─────┐ ┌──┴─────┐   │
    │  │study   │ │unread  │ │daily   │ │quick   │   │
    │  │Stats   │ │Notifs  │ │Checkin │ │Actions │   │
    │  │ 2s     │ │ 1s     │ │ 1s     │ │ 1s     │   │
    │  └────────┘ └────────┘ └────────┘ └────────┘   │
    │      │          │          │          │          │
    │  Layer 1（依赖 userProfile）：                    │
    │  ┌──────────────────────┐                        │
    │  │ recommendedContent   │                        │
    │  │ 2s                   │                        │
    │  └──────────────────────┘                        │
    │                                                  │
    └──────────────────┬──────────────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ ResponseAdapter │  按客户端类型裁剪
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ VersionRouter   │  按版本号裁剪
              └────────┬────────┘
                       │
                       ▼
                 JSON 响应返回
```

### 4.2 AI 辅导页聚合器

```
GET /api/v1/bff/ai-tutor
```

| 数据区 | 下游服务 | 超时 | 缓存 | 说明 |
|--------|----------|------|------|------|
| `userContext` | 用户服务 | 1s | 300s | 年级、学段、教材版本、会员额度 |
| `recentConversations` | AI 服务 | 2s | 60s | 最近对话列表 |
| `suggestedQuestions` | 推荐服务 | 2s | 300s | 智能推荐问题 |
| `inputTools` | 配置服务 | 1s | 600s | 可用输入方式（语音/拍照/手写） |
| `aiQuota` | 额度服务 | 1s | 30s | 今日 AI 额度剩余 |

**响应示例**：

```json
{
  "code": 0,
  "data": {
    "timestamp": "2026-05-25T07:00:00+08:00",
    "degraded_zones": [],
    "userContext": {
      "grade_code": "G07",
      "stage": "junior",
      "active_subjects": ["MATH", "CHINESE", "ENGLISH", "PHYSICS"],
      "default_subject": "MATH"
    },
    "recentConversations": {
      "items": [
        {
          "id": "conv_456",
          "title": "关于勾股定理的讨论",
          "subject_code": "MATH",
          "last_message_at": "2026-05-24T22:30:00+08:00",
          "message_count": 8,
          "deep_link": "primetop://ai/conversation/conv_456"
        }
      ]
    },
    "suggestedQuestions": {
      "items": [
        {
          "question": "如何判断一个三角形是直角三角形？",
          "subject_code": "MATH",
          "source": "weak_point"
        },
        {
          "question": "背诵《岳阳楼记》第二段",
          "subject_code": "CHINESE",
          "source": "today_task"
        }
      ]
    },
    "inputTools": {
      "available": ["text", "voice", "photo", "handwriting"],
      "disabled": [],
      "voice_tip": "长按说话，松手发送"
    },
    "aiQuota": {
      "daily_limit": 50,
      "daily_used": 12,
      "remaining": 38,
      "membership_bonus": 0
    }
  }
}
```

### 4.3 错题复习页聚合器

```
GET /api/v1/bff/mistake-review
```

| 数据区 | 下游服务 | 超时 | 缓存 | 说明 |
|--------|----------|------|------|------|
| `mistakeStats` | 错题服务 | 2s | 120s | 各科错题统计 |
| `dueReviews` | 错题服务 | 2s | 60s | 待复习错题（按遗忘曲线） |
| `subjectBreakdown` | 分析服务 | 2s | 300s | 各科错题分布 |
| `recentMistakes` | 错题服务 | 2s | 60s | 最近新增错题 |

### 4.4 家长仪表盘聚合器

```
GET /api/v1/bff/parent-dashboard
```

| 数据区 | 下游服务 | 超时 | 缓存 | 说明 |
|--------|----------|------|------|------|
| `childrenList` | 用户服务 | 1s | 300s | 绑定的孩子列表 |
| `childSummaries` | 分析服务 | 3s | 120s | 每个孩子学习摘要 |
| `weeklyReports` | 报告服务 | 2s | 600s | 最新周报 |
| `parentalControls` | 家长服务 | 1s | 300s | 时长管控配置 |
| `notifications` | 消息服务 | 1s | 30s | 家长通知 |

### 4.5 教师班级页聚合器

```
GET /api/v1/bff/teacher-class
```

| 数据区 | 下游服务 | 超时 | 缓存 | 说明 |
|--------|----------|------|------|------|
| `classList` | 教师服务 | 2s | 300s | 班级列表 |
| `classStats` | 分析服务 | 3s | 120s | 班级整体数据 |
| `recentAssignments` | 教师服务 | 2s | 60s | 最近作业 |
| `alerts` | 分析服务 | 2s | 300s | 需关注的学生 |

---

## 5. API 接口规范

### 5.1 通用聚合 API 模式

所有 BFF 聚合 API 遵循统一模式：

```
GET /api/v1/bff/{page_name}[?zones=zone1,zone2&refresh=true]
```

| 参数 | 说明 |
|------|------|
| `page_name` | 页面标识：`home` / `ai-tutor` / `mistake-review` / `parent-dashboard` / `teacher-class` |
| `zones` | 可选，指定需要的数据区（逗号分隔），减少不必要的数据传输 |
| `refresh` | 可选，`true` 跳过缓存强制刷新 |

### 5.2 增量刷新 API

客户端在页面内执行操作后（如完成任务），需要刷新部分数据区：

```
PATCH /api/v1/bff/{page_name}/zones/{zone_name}
```

**请求体**：

```json
{
  "action": "refresh",
  "context": {
    "task_id": "task_001"
  }
}
```

**响应**：仅返回指定数据区的最新数据：

```json
{
  "code": 0,
  "data": {
    "todayTasks": {
      "date": "2026-05-25",
      "total_count": 5,
      "completed_count": 3,
      "estimated_minutes": 45,
      "items": ["..."]
    }
  }
}
```

### 5.3 预加载 API

客户端可在用户进入页面前预加载下一页数据：

```
POST /api/v1/bff/preload
```

**请求体**：

```json
{
  "pages": ["ai-tutor", "mistake-review"],
  "priority": "low"
}
```

**响应**：接受预加载任务，通过 SSE 推送结果：

```json
{
  "code": 0,
  "data": {
    "preload_id": "pl_abc123",
    "status": "accepted"
  }
}
```

### 5.4 多孩子数据批量聚合（家长端）

家长仪表盘需要同时获取多个孩子的数据：

```
POST /api/v1/bff/parent-dashboard/batch
```

**请求体**：

```json
{
  "child_ids": [101, 102, 103],
  "zones": ["childSummaries", "weeklyReports"]
}
```

**响应**：按孩子 ID 分组返回：

```json
{
  "code": 0,
  "data": {
    "children": {
      "101": {
        "childSummaries": {"..."},
        "weeklyReports": {"..."}
      },
      "102": {
        "childSummaries": {"..."},
        "weeklyReports": {"..."}
      }
    },
    "degraded_children": []
  }
}
```

---

## 6. 降级策略矩阵

### 6.1 降级级别定义

| 级别 | 触发条件 | 行为 |
|------|----------|------|
| L0 正常 | 所有下游正常 | 完整数据 |
| L1 缓存降级 | 下游超时/错误 | 使用缓存数据（忽略 TTL） |
| L2 精简降级 | 下游不可用 + 无缓存 | 返回自定义 fallback 最小数据 |
| L3 区级屏蔽 | 连续失败 3 次以上 | 该区从响应中移除，客户端显示占位 |
| L4 全局降级 | 聚合层整体不可用 | 返回静态兜底页面配置 |

### 6.2 首页各数据区降级策略

| 数据区 | L2 Fallback | L3 展示策略 | 影响等级 |
|--------|-------------|------------|----------|
| `userProfile` | 匿名用户档案 | 显示默认头像+昵称 | 🔴 致命 |
| `todayTasks` | 空任务列表 | 显示"暂无任务"占位 | 🟡 中等 |
| `weakPoints` | null | 隐藏薄弱点区域 | 🟢 低 |
| `recentLearning` | null | 隐藏继续学习区域 | 🟡 中等 |
| `studyStats` | null | 隐藏学习数据区域 | 🟢 低 |
| `unreadNotifications` | `{count: 0}` | 不显示消息角标 | 🟢 低 |
| `dailyCheckin` | null | 隐藏打卡入口 | 🟢 低 |
| `quickActions` | 硬编码默认操作 | 显示默认4个快捷按钮 | 🟡 中等 |
| `recommendedContent` | null | 隐藏推荐区域 | 🟢 低 |

### 6.3 熔断器集成

```python
from circuitbreaker import circuit


class ResilientZoneFetcher(ZoneFetcher):
    """带熔断器的数据区获取器包装"""

    def __init__(self, inner: ZoneFetcher):
        self._inner = inner
        self._circuit = circuit(
            failure_threshold=3,       # 连续 3 次失败后熔断
            recovery_timeout=30,       # 30 秒后尝试恢复
            expected_exception=Exception,
        )

    @property
    def zone_name(self) -> str:
        return self._inner.zone_name

    @property
    def dependencies(self) -> list[str]:
        return self._inner.dependencies

    @property
    def timeout_ms(self) -> int:
        return self._inner.timeout_ms

    @property
    def cache_ttl(self) -> int:
        return self._inner.cache_ttl

    async def fetch(self, req: AggregateRequest, 
                    deps: dict[str, ZoneResult]) -> Any:
        return await self._circuit(
            self._inner.fetch
        )(req, deps)

    async def fallback(self, req: AggregateRequest) -> Any:
        return await self._inner.fallback(req)
```

---

## 7. 缓存策略

### 7.1 缓存层级

```
┌──────────────────────────────────────────────┐
│ L0：客户端内存缓存（客户端管理）               │  TTL：30-60s
├──────────────────────────────────────────────┤
│ L1：BFF 本地进程缓存（Python dict/LRU）        │  TTL：≤60s
├──────────────────────────────────────────────┤
│ L2：BFF Redis 缓存                            │  TTL：60-600s
├──────────────────────────────────────────────┤
│ L3：下游服务自身缓存                           │  由各服务管理
└──────────────────────────────────────────────┘
```

### 7.2 缓存失效触发

| 事件 | 失效范围 | 触发来源 |
|------|----------|----------|
| 用户登录 | 用户所有 BFF 缓存 | 用户服务事件 |
| 年级/教材版本变更 | 用户所有 BFF 缓存 | 用户服务事件 |
| 任务完成 | `todayTasks`, `studyStats` | 学习服务事件 |
| 新增错题 | `weakPoints`, `mistakeStats` | 错题服务事件 |
| 会员状态变更 | `userProfile`, `aiQuota` | 支付服务事件 |
| 内容配置变更 | `quickActions`, `inputTools` 全量 | 配置服务事件 |
| 打卡完成 | `dailyCheckin` | 运营服务事件 |

### 7.3 事件驱动失效实现

```python
# 通过进程内 EventBus 监听业务事件
from modules.event_bus import EventBus


class BFFCacheInvalidator:
    """监听业务事件，自动失效 BFF 缓存"""

    EVENT_ZONE_MAP = {
        "user.profile_updated": None,           # None = 失效所有区
        "user.membership_changed": ["userProfile", "aiQuota"],
        "user.grade_changed": None,
        "task.completed": ["todayTasks", "studyStats"],
        "task.created": ["todayTasks"],
        "mistake.added": ["weakPoints"],
        "mistake.reviewed": ["weakPoints"],
        "checkin.completed": ["dailyCheckin"],
        "notification.unread_changed": ["unreadNotifications"],
        "config.quick_actions_updated": ["quickActions"],
    }

    def __init__(self, cache: AggregateCache, event_bus: EventBus):
        self._cache = cache
        self._register_listeners(event_bus)

    def _register_listeners(self, event_bus: EventBus):
        for event_name, zones in self.EVENT_ZONE_MAP.items():
            event_bus.subscribe(event_name, self._make_handler(zones))

    def _make_handler(self, zones):
        async def handler(event):
            user_id = event.get("user_id")
            if user_id is None:
                return
            if zones is None:
                await self._cache.invalidate(user_id)
            else:
                for zone in zones:
                    await self._cache.invalidate(user_id, zone)
        return handler
```

---

## 8. 监控与可观测性

### 8.1 指标定义

| 指标名 | 类型 | 标签 | 说明 |
|--------|------|------|------|
| `bff_request_total` | Counter | page, client_type, status | 聚合请求总数 |
| `bff_request_duration_ms` | Histogram | page, client_type | 聚合总延迟 |
| `bff_zone_duration_ms` | Histogram | page, zone, status | 单区获取延迟 |
| `bff_zone_fallback_total` | Counter | page, zone, reason | 降级次数 |
| `bff_cache_hit_total` | Counter | zone | 缓存命中次数 |
| `bff_cache_miss_total` | Counter | zone | 缓存未命中次数 |
| `bff_degraded_response_total` | Counter | page, degraded_zones_count | 含降级区的响应数 |
| `bff_parallel_efficiency` | Gauge | page | 并行效率 = max_zone_time / total_time |

### 8.2 指标采集器实现

```python
import prometheus_client as prom


class BFFMetrics:
    """BFF 聚合指标采集器"""

    request_total = prom.Counter(
        "bff_request_total",
        "Total BFF aggregate requests",
        ["page", "client_type", "status"],
    )
    request_duration = prom.Histogram(
        "bff_request_duration_ms",
        "BFF request total duration",
        ["page", "client_type"],
        buckets=[50, 100, 200, 500, 1000, 2000, 5000],
    )
    zone_duration = prom.Histogram(
        "bff_zone_duration_ms",
        "BFF zone fetch duration",
        ["page", "zone", "status"],
        buckets=[10, 25, 50, 100, 250, 500, 1000, 3000],
    )
    zone_fallback = prom.Counter(
        "bff_zone_fallback_total",
        "BFF zone fallback count",
        ["page", "zone", "reason"],
    )
    cache_operations = prom.Counter(
        "bff_cache_operations_total",
        "BFF cache operations",
        ["zone", "result"],  # result: hit | miss
    )

    @classmethod
    def record_aggregate(
        cls, page: str, client_type: str, 
        response: AggregateResponse
    ):
        status = "degraded" if response.degraded_zones else "ok"
        cls.request_total.labels(page, client_type, status).inc()
        cls.request_duration.labels(page, client_type).observe(
            response.total_latency_ms
        )

        max_zone_time = 0
        for zone_name, zone_result in response.zones.items():
            cls.zone_duration.labels(
                page, zone_name, zone_result.status.value
            ).observe(zone_result.latency_ms)
            
            if zone_result.status in (ZoneStatus.FALLBACK, ZoneStatus.TIMEOUT):
                cls.zone_fallback.labels(
                    page, zone_name, zone_result.error or "unknown"
                ).inc()
            
            if not zone_result.from_cache:
                max_zone_time = max(max_zone_time, zone_result.latency_ms)
        
        # 并行效率指标
        if response.total_latency_ms > 0 and max_zone_time > 0:
            efficiency = max_zone_time / response.total_latency_ms
            prom.Gauge(
                "bff_parallel_efficiency", "Parallel efficiency", ["page"]
            ).labels(page).set(efficiency)
```

### 8.3 告警规则

| 告警 | 条件 | 级别 | 处理 |
|------|------|------|------|
| 聚合超时率高 | P99 > 3s 持续 5 分钟 | P1 | 检查慢区、扩容 |
| 降级率突增 | 降级率 > 10% 持续 3 分钟 | P1 | 检查下游服务状态 |
| 缓存命中率低 | 命中率 < 50% 持续 10 分钟 | P2 | 检查缓存配置和失效逻辑 |
| 首页聚合 P99 > 2s | 超过 SLA 基线 | P1 | 优化慢区、增加缓存 |
| 单区连续失败 | 单区连续 fallback > 10 次 | P2 | 检查对应下游服务 |

### 8.4 链路追踪集成

```python
from opentelemetry import trace

tracer = trace.get_tracer("bff")


class TracedOrchestrator(Orchestrator):
    """带链路追踪的编排器"""

    async def aggregate(self, req: AggregateRequest, 
                        zone_names: list[str]) -> AggregateResponse:
        with tracer.start_as_current_span(
            "bff.aggregate",
            attributes={
                "bff.page": req.options.get("page", "unknown"),
                "bff.client_type": req.client_type,
                "bff.client_version": req.client_version,
                "bff.zones": ",".join(zone_names),
            },
        ) as span:
            response = await super().aggregate(req, zone_names)
            span.set_attributes({
                "bff.total_latency_ms": response.total_latency_ms,
                "bff.degraded_zones": ",".join(response.degraded_zones),
                "bff.zone_count": len(response.zones),
            })
            return response

    async def _fetch_zone(self, fetcher, req, completed):
        with tracer.start_as_current_span(
            f"bff.zone.{fetcher.zone_name}",
            attributes={"bff.zone_name": fetcher.zone_name},
        ) as span:
            result = await super()._fetch_zone(fetcher, req, completed)
            span.set_attributes({
                "bff.zone.status": result.status.value,
                "bff.zone.latency_ms": result.latency_ms,
                "bff.zone.from_cache": result.from_cache,
            })
            return result
```

---

## 9. FastAPI 路由集成

### 9.1 路由注册

```python
from fastapi import APIRouter, Depends, Header, Query
from typing import Optional

bff_router = APIRouter(prefix="/api/v1/bff", tags=["BFF"])


@bff_router.get("/home")
async def get_home_aggregate(
    zones: Optional[str] = Query(None, description="逗号分隔的数据区"),
    refresh: bool = Query(False, description="是否强制刷新"),
    x_client_type: str = Header(..., alias="X-Client-Type"),
    x_client_version: str = Header(..., alias="X-Client-Version"),
    x_platform: str = Header(..., alias="X-Platform"),
    current_user=Depends(get_current_user),
    orchestrator=Depends(get_home_orchestrator),
    cache=Depends(get_bff_cache),
    metrics=Depends(get_bff_metrics),
):
    """首页聚合 API"""
    req = AggregateRequest(
        user_id=current_user.id,
        client_type=x_client_type,
        client_version=x_client_version,
        platform=x_platform,
        grade_code=current_user.grade_code,
        stage=current_user.stage,
    )

    # 确定请求的数据区
    all_zones = [
        "userProfile", "todayTasks", "weakPoints", "recentLearning",
        "studyStats", "unreadNotifications", "dailyCheckin", 
        "quickActions", "recommendedContent",
    ]
    target_zones = zones.split(",") if zones else all_zones

    # 强制刷新时清缓存
    if refresh:
        for zone in target_zones:
            await cache.invalidate(req.user_id, zone)

    # 执行聚合
    response = await orchestrator.aggregate(req, target_zones)

    # 适配响应
    adapter = AdapterFactory.get(x_client_type)
    result = adapter.adapt_response(response)

    # 版本适配
    result = version_router.apply(x_client_version, result)

    # 记录指标
    metrics.record_aggregate("home", x_client_type, response)

    return {"code": 0, "data": result}


@bff_router.patch("/home/zones/{zone_name}")
async def refresh_home_zone(
    zone_name: str,
    body: dict,
    current_user=Depends(get_current_user),
    fetcher=Depends(get_zone_fetcher),
):
    """增量刷新单个数据区"""
    req = AggregateRequest(
        user_id=current_user.id,
        client_type="mobile",  # 从请求头获取
        client_version="1.0.0",
        platform="android",
        grade_code=current_user.grade_code,
        stage=current_user.stage,
    )
    data = await fetcher.fetch(req, {})
    return {"code": 0, "data": {zone_name: data}}


@bff_router.get("/ai-tutor")
async def get_ai_tutor_aggregate(
    zones: Optional[str] = Query(None),
    refresh: bool = Query(False),
    x_client_type: str = Header(..., alias="X-Client-Type"),
    x_client_version: str = Header(..., alias="X-Client-Version"),
    x_platform: str = Header(..., alias="X-Platform"),
    current_user=Depends(get_current_user),
    orchestrator=Depends(get_ai_tutor_orchestrator),
):
    """AI 辅导页聚合 API"""
    req = AggregateRequest(
        user_id=current_user.id,
        client_type=x_client_type,
        client_version=x_client_version,
        platform=x_platform,
        grade_code=current_user.grade_code,
        stage=current_user.stage,
    )
    all_zones = [
        "userContext", "recentConversations", "suggestedQuestions",
        "inputTools", "aiQuota",
    ]
    target_zones = zones.split(",") if zones else all_zones
    response = await orchestrator.aggregate(req, target_zones)
    
    adapter = AdapterFactory.get(x_client_type)
    result = adapter.adapt_response(response)
    return {"code": 0, "data": result}


@bff_router.get("/mistake-review")
async def get_mistake_review_aggregate(
    zones: Optional[str] = Query(None),
    refresh: bool = Query(False),
    subject: Optional[str] = Query(None, description="筛选学科"),
    x_client_type: str = Header(..., alias="X-Client-Type"),
    x_client_version: str = Header(..., alias="X-Client-Version"),
    current_user=Depends(get_current_user),
    orchestrator=Depends(get_mistake_orchestrator),
):
    """错题复习页聚合 API"""
    req = AggregateRequest(
        user_id=current_user.id,
        client_type=x_client_type,
        client_version=x_client_version,
        platform="android",
        grade_code=current_user.grade_code,
        stage=current_user.stage,
        options={"subject": subject},
    )
    all_zones = ["mistakeStats", "dueReviews", "subjectBreakdown", "recentMistakes"]
    target_zones = zones.split(",") if zones else all_zones
    response = await orchestrator.aggregate(req, target_zones)
    
    adapter = AdapterFactory.get(x_client_type)
    result = adapter.adapt_response(response)
    return {"code": 0, "data": result}


@bff_router.get("/parent-dashboard")
async def get_parent_dashboard(
    child_id: Optional[int] = Query(None, description="指定孩子ID"),
    zones: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
    orchestrator=Depends(get_parent_orchestrator),
):
    """家长仪表盘聚合 API"""
    req = AggregateRequest(
        user_id=current_user.id,
        client_type="mobile",
        client_version="1.0.0",
        platform="android",
        grade_code="",
        stage="",
        options={"child_id": child_id},
    )
    all_zones = [
        "childrenList", "childSummaries", 
        "weeklyReports", "parentalControls", "notifications"
    ]
    target_zones = zones.split(",") if zones else all_zones
    response = await orchestrator.aggregate(req, target_zones)
    return {"code": 0, "data": response.zones}


@bff_router.post("/parent-dashboard/batch")
async def get_parent_dashboard_batch(
    body: dict,
    current_user=Depends(get_current_user),
):
    """家长端多孩子批量聚合"""
    child_ids = body.get("child_ids", [])
    zones = body.get("zones", [])
    # 并行获取每个孩子的数据
    results = {}
    degraded = []
    
    tasks = [
        _fetch_child_data(current_user.id, child_id, zones)
        for child_id in child_ids
    ]
    responses = await asyncio.gather(*tasks, return_exceptions=True)
    
    for child_id, resp in zip(child_ids, responses):
        if isinstance(resp, Exception):
            degraded.append(child_id)
            results[str(child_id)] = None
        else:
            results[str(child_id)] = resp
    
    return {"code": 0, "data": {
        "children": results, 
        "degraded_children": degraded
    }}


@bff_router.post("/preload")
async def preload_pages(
    body: dict,
    current_user=Depends(get_current_user),
):
    """预加载页面数据"""
    pages = body.get("pages", [])
    preload_id = f"pl_{uuid4().hex[:8]}"
    # 后台异步预加载（通过 Celery 任务）
    preload_task.delay(current_user.id, preload_id, pages)
    return {"code": 0, "data": {
        "preload_id": preload_id, "status": "accepted"
    }}
```

### 9.2 依赖注入配置

```python
# bff/dependencies.py

from functools import lru_cache


@lru_cache()
def get_home_orchestrator() -> Orchestrator:
    """首页聚合编排器"""
    orch = Orchestrator(
        cache=get_bff_cache(),
        metrics=BFFMetrics(),
    )
    orch.register(UserProfileFetcher(user_service))
    orch.register(TodayTasksFetcher(plan_service))
    orch.register(WeakPointsFetcher(analysis_service))
    orch.register(RecentLearningFetcher(learning_service))
    orch.register(StudyStatsFetcher(analysis_service))
    orch.register(UnreadNotificationsFetcher(message_service))
    orch.register(DailyCheckinFetcher(operation_service))
    orch.register(QuickActionsFetcher(config_service))
    orch.register(RecommendedContentFetcher(recommend_service))
    return orch


@lru_cache()
def get_ai_tutor_orchestrator() -> Orchestrator:
    """AI辅导页聚合编排器"""
    orch = Orchestrator(
        cache=get_bff_cache(),
        metrics=BFFMetrics(),
    )
    orch.register(AIUserContextFetcher(user_service))
    orch.register(RecentConversationsFetcher(ai_service))
    orch.register(SuggestedQuestionsFetcher(recommend_service))
    orch.register(InputToolsFetcher(config_service))
    orch.register(AIQuotaFetcher(quota_service))
    return orch
```

---

## 10. 性能预算

### 10.1 首页聚合性能目标

| 指标 | 目标 | 说明 |
|------|------|------|
| P50 总延迟 | ≤ 300ms | 一半请求在 300ms 内完成 |
| P95 总延迟 | ≤ 800ms | 95% 请求在 800ms 内 |
| P99 总延迟 | ≤ 2000ms | 99% 请求在 2s 内 |
| 缓存命中时 P99 | ≤ 100ms | 缓存命中的请求极快 |
| 降级率 | ≤ 5% | 日常降级率低于 5% |
| 降级响应 P99 | ≤ 1500ms | 降级时延迟增加不超过 50% |

### 10.2 并行效率优化

首页 9 个数据区并行执行的理论最短时间：

```
无缓存场景：max(userProfile:100ms, todayTasks:200ms, weakPoints:200ms, 
                 recentLearning:150ms, studyStats:180ms, unreadNotifs:80ms, 
                 dailyCheckin:80ms, quickActions:60ms)
            + recommendedContent:200ms（依赖 userProfile）
          ≈ 200ms + 200ms = 400ms 理论最短

实际目标：≤ 600ms（含框架开销）
```

### 10.3 容量估算

| 指标 | 值 | 说明 |
|------|-----|------|
| DAU | 100,000 | MVP 阶段 |
| 首页 QPS 峰值 | ~500 QPS | 用户打开APP + 下拉刷新 |
| AI辅导页 QPS | ~300 QPS | |
| 其他聚合页 QPS | ~200 QPS | |
| 总 BFF QPS | ~1000 QPS | |
| 单实例吞吐 | ~500 QPS | 4核8G Python worker |
| 实例数 | 2~4 | 含冗余 |

---

## 11. 错误处理

### 11.1 错误码体系

BFF 层使用统一的错误码体系（与 `API网关与通用接口规范` 一致），并新增 BFF 专属错误码：

| 错误码 | HTTP 状态码 | 说明 | 客户端处理 |
|--------|------------|------|------------|
| 500100 | 200 | 聚合成功但部分区降级 | 检查 `degraded_zones` 正常渲染 |
| 500101 | 200 | 全部使用缓存降级 | 提示"数据可能不是最新" |
| 500200 | 503 | 聚合层整体不可用 | 显示兜底页面 |
| 500201 | 400 | 无效的 page_name | 客户端 bug |
| 500202 | 400 | 无效的 zone_name | 客户端 bug |
| 500203 | 429 | 聚合请求频率超限 | 限流，提示稍后 |
| 500204 | 401 | 未登录 | 跳转登录页 |
| 500205 | 400 | 不支持的 client_type | 客户端更新 |

### 11.2 客户端错误处理策略

```dart
// Flutter 客户端 BFF 响应处理
class BFFResponseHandler {
  
  /// 处理聚合响应
  static HomeData? handleHomeResponse(Response response) {
    if (response.statusCode != 200) {
      // HTTP 错误：使用本地缓存兜底
      return _loadLocalCache('home');
    }
    
    final json = response.data;
    final code = json['code'] as int;
    
    if (code == 0) {
      final data = json['data'] as Map<String, dynamic>;
      final degraded = (data['degraded_zones'] as List).cast<String>();
      
      if (degraded.isNotEmpty) {
        // 部分区降级：正常渲染可用数据，降级区显示占位
        _reportDegraded(degraded);
      }
      
      // 保存到本地缓存
      _saveLocalCache('home', data);
      
      return HomeData.fromJson(data);
    }
    
    if (code == 500200) {
      // 整体不可用：显示兜底 UI
      return _getStaticFallback();
    }
    
    if (code == 500204) {
      // 未登录：跳转登录
      _navigateToLogin();
      return null;
    }
    
    // 其他错误
    return _loadLocalCache('home');
  }
  
  /// 渲染降级区的占位 UI
  static Widget buildZonePlaceholder(String zoneName) {
    return switch (zoneName) {
      'todayTasks' => const _EmptyTasksPlaceholder(),
      'weakPoints' => const SizedBox.shrink(),
      'studyStats' => const SizedBox.shrink(),
      'recommendedContent' => const SizedBox.shrink(),
      _ => const SizedBox.shrink(),
    };
  }
}
```

---

## 12. 跨模块集成规范

### 12.1 下游服务集成规范

BFF 层调用下游服务时遵循以下规范：

1. **通过 Service 接口调用**：不直接访问下游数据库，通过模块的 Service 层方法调用
2. **超时传递**：BFF 层设定全局超时，每个 Zone 有独立超时
3. **错误隔离**：单个 Zone 失败不影响其他 Zone
4. **数据最小化**：只请求需要的字段，避免全量查询

```python
# BFF 调用下游服务的规范示例
class UserProfileFetcher(ZoneFetcher):
    async def fetch(self, req, deps):
        # ✅ 正确：调用 Service 方法，只请求需要的字段
        profile = await self._user_service.get_profile_brief(req.user_id)
        
        # ❌ 错误：直接查询数据库
        # profile = await User.query.filter_by(id=req.user_id).first()
        
        # ❌ 错误：请求全量字段
        # profile = await self._user_service.get_profile_full(req.user_id)
        
        return profile
```

### 12.2 新增聚合页面 Checklist

开发新的聚合页面时，按以下步骤操作：

```
1. 在 bff/aggregators/ 下创建新聚合器文件
2. 在 bff/zones/ 下创建所需的数据区 Fetcher
3. 定义 Zone 的依赖关系、超时、缓存 TTL
4. 实现降级 fallback 方法
5. 在 bff/routes.py 注册路由
6. 在 bff/dependencies.py 配置编排器
7. 添加 Prometheus 指标标签
8. 在 BFFCacheInvalidator 注册事件失效规则
9. 编写集成测试
10. 更新客户端 BFF SDK
```

### 12.3 BFF 层禁止事项

| 禁止 | 原因 | 正确做法 |
|------|------|----------|
| 包含业务逻辑 | BFF 只做聚合裁剪 | 业务逻辑在下游服务 |
| 直接操作数据库 | 破坏服务边界 | 调用下游 Service 方法 |
| 写操作（非增量刷新） | BFF 是只读聚合层 | 写操作走各模块独立 API |
| 聚合超过 15 个 Zone | 延迟和复杂度过高 | 拆分为多个聚合 API |
| Zone 间超过 2 层依赖 | 编排过于复杂 | 重新设计数据区边界 |

---

## 13. 测试策略

### 13.1 单元测试

```python
import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_user_service():
    service = AsyncMock()
    service.get_profile_brief.return_value = {
        "nickname": "测试用户",
        "avatar_url": "img://avatar/test.jpg",
        "grade_code": "G07",
        "stage": "junior",
    }
    return service


@pytest.mark.asyncio
async def test_user_profile_fetcher_normal(mock_user_service):
    fetcher = UserProfileFetcher(mock_user_service)
    req = AggregateRequest(
        user_id=1, client_type="mobile", client_version="1.2.0",
        platform="android", grade_code="G07", stage="junior",
    )
    result = await fetcher.fetch(req, {})
    
    assert result["nickname"] == "测试用户"
    assert result["grade_code"] == "G07"
    mock_user_service.get_profile_brief.assert_called_once_with(1)


@pytest.mark.asyncio
async def test_user_profile_fetcher_fallback():
    service = AsyncMock()
    service.get_profile_brief.side_effect = Exception("DB Error")
    
    fetcher = UserProfileFetcher(service)
    req = AggregateRequest(
        user_id=1, client_type="mobile", client_version="1.2.0",
        platform="android", grade_code="G07", stage="junior",
    )
    result = await fetcher.fallback(req)
    
    assert result["nickname"] == "同学"
    assert result["grade_code"] == "G07"


@pytest.mark.asyncio
async def test_orchestrator_parallel_execution():
    """验证无依赖区并行执行"""
    orch = Orchestrator(cache=AsyncMock(), metrics=MagicMock())
    
    fetch_times = {}
    
    class SlowFetcher(ZoneFetcher):
        zone_name = "slow"
        timeout_ms = 5000
        
        async def fetch(self, req, deps):
            await asyncio.sleep(0.2)
            return {"data": "slow_result"}
    
    class FastFetcher(ZoneFetcher):
        zone_name = "fast"
        timeout_ms = 1000
        
        async def fetch(self, req, deps):
            await asyncio.sleep(0.05)
            return {"data": "fast_result"}
    
    orch.register(SlowFetcher())
    orch.register(FastFetcher())
    
    req = AggregateRequest(
        user_id=1, client_type="mobile", client_version="1.0.0",
        platform="android", grade_code="G07", stage="junior",
    )
    
    start = time.monotonic()
    response = await orch.aggregate(req, ["slow", "fast"])
    elapsed = time.monotonic() - start
    
    # 并行执行：总时间应接近 200ms（较慢的那个），而非 250ms（串行）
    assert elapsed < 0.35  # 留一些余量
    assert response.zones["slow"].data == {"data": "slow_result"}
    assert response.zones["fast"].data == {"data": "fast_result"}


@pytest.mark.asyncio
async def test_orchestrator_with_dependencies():
    """验证依赖区串行执行"""
    orch = Orchestrator(cache=AsyncMock(), metrics=MagicMock())
    
    class ProfileFetcher(ZoneFetcher):
        zone_name = "profile"
        
        async def fetch(self, req, deps):
            return {"stage": "junior", "grade": "G07"}
    
    class RecommendFetcher(ZoneFetcher):
        zone_name = "recommend"
        dependencies = ["profile"]
        
        async def fetch(self, req, deps):
            profile = deps["profile"].data
            assert profile["stage"] == "junior"
            return {"items": [f"rec_for_{profile['grade']}"]}
    
    orch.register(ProfileFetcher())
    orch.register(RecommendFetcher())
    
    req = AggregateRequest(
        user_id=1, client_type="mobile", client_version="1.0.0",
        platform="android", grade_code="G07", stage="junior",
    )
    
    response = await orch.aggregate(req, ["profile", "recommend"])
    assert response.zones["recommend"].data["items"] == ["rec_for_G07"]


@pytest.mark.asyncio
async def test_orchestrator_timeout_fallback():
    """验证超时降级"""
    orch = Orchestrator(cache=AsyncMock(), metrics=MagicMock())
    
    class TimeoutFetcher(ZoneFetcher):
        zone_name = "timeout_zone"
        timeout_ms = 100  # 100ms 超时
        
        async def fetch(self, req, deps):
            await asyncio.sleep(1)  # 故意延迟 1s
            return {"data": "never_reached"}
        
        async def fallback(self, req):
            return {"data": "fallback_value"}
    
    orch.register(TimeoutFetcher())
    
    req = AggregateRequest(
        user_id=1, client_type="mobile", client_version="1.0.0",
        platform="android", grade_code="G07", stage="junior",
    )
    
    response = await orch.aggregate(req, ["timeout_zone"])
    zone = response.zones["timeout_zone"]
    
    assert zone.status == ZoneStatus.FALLBACK
    assert zone.data == {"data": "fallback_value"}
    assert zone.error == "timeout"
```

### 13.2 集成测试

```python
@pytest.mark.asyncio
async def test_home_aggregate_e2e(test_client, mock_services):
    """首页聚合端到端集成测试"""
    # 准备 mock 服务数据
    mock_services["user"].setup_profile(user_id=1, nickname="小明", grade="G07")
    mock_services["plan"].setup_tasks(user_id=1, tasks=[
        {"id": "t1", "type": "chapter", "title": "方程基础", "completed": True},
    ])
    
    # 发送请求
    response = await test_client.get(
        "/api/v1/bff/home",
        headers={
            "Authorization": "Bearer test_token",
            "X-Client-Type": "mobile",
            "X-Client-Version": "1.2.0",
            "X-Platform": "android",
        },
    )
    
    assert response.status_code == 200
    data = response.json()["data"]
    
    # 验证各数据区
    assert data["userProfile"]["nickname"] == "小明"
    assert data["todayTasks"]["total_count"] == 1
    assert data["todayTasks"]["items"][0]["title"] == "方程基础"
    assert "degraded_zones" in data
    assert len(data["degraded_zones"]) == 0
```

### 13.3 压测场景

| 场景 | 并发 | 持续时间 | 目标 |
|------|------|----------|------|
| 首页聚合正常 | 100 | 5min | P99 < 1s |
| 首页聚合缓存命中 | 500 | 5min | P99 < 100ms |
| 首页聚合下游超时 | 50 | 5min | P99 < 2s，降级率 < 100% |
| AI辅导页聚合 | 200 | 5min | P99 < 1.5s |
| 多端混合请求 | 300 | 10min | 各端响应正确 |

---

## 14. 演进路线图

### Phase 1：MVP（单体 BFF）

- BFF 代码在单体应用的 `bff/` 包内
- 首页聚合 API（P0）
- AI 辅导页聚合 API（P0）
- 基础缓存和降级
- 移动端适配器

### Phase 2：V1.0（完善 BFF）

- 错题复习页聚合 API
- 家长仪表盘聚合 API
- Web / 小程序适配器
- 版本路由器
- 增量刷新 API
- 预加载 API
- 完整监控指标

### Phase 3：V1.5（优化 BFF）

- 教师班级页聚合 API
- 多孩子批量聚合
- GraphQL 接口（Web 端按需查询）
- 更精细的缓存失效策略
- 并行效率优化
- A/B 测试集成

### Phase 4：V2.0（独立 BFF 服务）

- BFF 拆分为独立服务
- gRPC 调用下游服务
- 独立扩缩容
- 多区域部署支持
- GraphQL Federation
