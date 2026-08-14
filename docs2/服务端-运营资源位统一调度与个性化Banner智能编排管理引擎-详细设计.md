# 服务端-运营资源位统一调度与个性化Banner智能编排管理引擎-详细设计

## 1. 模块概述

### 1.1 模块定位

运营资源位统一调度与个性化 Banner 智能编排管理引擎（以下简称"资源位引擎"）负责管理 APP 各页面中**内嵌于页面布局的持久性运营展示位**——包括首页轮播 Banner、学科入口图标网格、学习专区推荐卡、个人中心活动横幅、支付成功页推广位等。

与"运营弹窗规则引擎"的区别：

| 维度 | 运营弹窗（已有） | 运营资源位（本模块） |
|------|-----------------|---------------------|
| 展示形式 | 覆盖式弹窗/浮窗/对话框 | 页面内嵌的布局元素 |
| 触发方式 | 事件触发（启动、页面进入等） | 随页面渲染加载 |
| 用户感知 | 打断型（需关闭才消失） | 原生型（随页面内容一起呈现） |
| 生命周期 | 短时弹出 → 用户关闭 | 持续展示直到页面切换 |
| 频次控制 | 需严格防骚扰 | 由页面浏览自然约束 |
| 内容形态 | 图片/HTML/组件 | 图片轮播、图标网格、卡片、视频 |
| 典型场景 | 活动弹窗、公告对话框 | 首页 Banner、快捷入口、专区推荐 |

### 1.2 核心职责

1. **资源位注册与管理**：统一定义 APP 中所有可运营的展示位置，支持动态新增
2. **素材管理**：管理 Banner 图片、图标、文案等素材的上传、审核与版本管理
3. **投放规则引擎**：根据用户画像、学段、年级、会员状态、地域等条件精准投放
4. **个性化排序**：基于用户兴趣和行为数据对同一资源位的多条素材进行个性化排序
5. **调度与排期**：支持素材的定时上线/下线、优先级排期、互斥规则
6. **效果分析**：曝光、点击、转化（注册/购买/参与）全链路数据采集与分析
7. **A/B 实验**：支持资源位内容的 A/B 测试与效果对比
8. **未成年人保护**：对未成年用户过滤不适宜的商业推广内容

### 1.3 系统边界

```
┌─────────────────────────────────────────────────────────────────────┐
│                     管理后台（运营人员 / 内容编辑）                    │
│   资源位配置 ｜ 素材上传 ｜ 投放规则 ｜ 排期日历 ｜ 数据看板 ｜ AB实验  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ REST API
┌──────────────────────────▼──────────────────────────────────────────┐
│                     资源位引擎服务（本模块）                           │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ 资源位注册     │  │ 素材管理       │  │ 投放规则匹配引擎           │  │
│  │ Registry     │  │ Material Mgr │  │ Rule Engine              │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ 排期调度器     │  │ 个性化排序     │  │ 效果分析 & 归因            │  │
│  │ Scheduler    │  │ Ranker       │  │ Analytics               │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐                                │
│  │ A/B 实验分流   │  │ 缓存与预热     │                                │
│  │ Splitter     │  │ Cache Layer  │                                │
│  └──────────────┘  └──────────────┘                                │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ REST API + CDN
┌──────────────────────────▼──────────────────────────────────────────┐
│                       客户端（Flutter APP）                           │
│   资源位渲染 ｜ 轮播组件 ｜ 图标网格 ｜ 卡片展示 ｜ 行为埋点上报        │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.4 设计原则

1. **配置驱动**：所有资源位内容由后台配置，客户端零硬编码
2. **体验优先**：资源位内容不干扰核心学习流程，未成年用户无商业广告
3. **性能极致**：首屏资源位数据通过 CDN 预热 + 客户端预加载，做到零等待
4. **数据闭环**：从配置→投放→曝光→点击→转化→分析完整闭环
5. **渐进增强**：支持从简单图片 Banner 到富媒体交互卡片的平滑升级

---

## 2. 数据模型

### 2.1 资源位定义表 (slot_definition)

资源位是 APP 中可投放运营内容的抽象位置。每个资源位有唯一的位置编码。

```sql
CREATE TABLE slot_definition (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    slot_code           VARCHAR(64) NOT NULL UNIQUE COMMENT '资源位编码，全局唯一',
    slot_name           VARCHAR(128) NOT NULL COMMENT '资源位名称',
    page_code           VARCHAR(64) NOT NULL COMMENT '所属页面编码',
    page_name           VARCHAR(128) COMMENT '所属页面名称',
    slot_type           VARCHAR(32) NOT NULL COMMENT '资源位类型: banner_carousel/icon_grid/content_card/strip_banner/video_card/float_icon',
    display_area        VARCHAR(64) COMMENT '页面区域: top/middle/bottom/sidebar',
    max_items           INT NOT NULL DEFAULT 1 COMMENT '最大同时展示素材数',
    min_items           INT NOT NULL DEFAULT 0 COMMENT '最小展示素材数（不足则隐藏该区域）',
    width_ratio         DECIMAL(5,2) COMMENT '建议宽比',
    height_ratio        DECIMAL(5,2) COMMENT '建议高比',
    carousel_interval   INT DEFAULT 3000 COMMENT '轮播间隔(ms)，仅轮播类型',
    support_personalize TINYINT DEFAULT 0 COMMENT '是否支持个性化排序: 0=否, 1=是',
    support_ab_test     TINYINT DEFAULT 0 COMMENT '是否支持AB实验: 0=否, 1=是',
    audit_required      TINYINT DEFAULT 1 COMMENT '素材是否需要审核: 0=否, 1=是',
    status              TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 0=禁用, 1=启用',
    client_version_min  VARCHAR(32) COMMENT '要求的最低客户端版本',
    client_version_max  VARCHAR(32) COMMENT '要求的最高客户端版本（空=不限）',
    description         TEXT COMMENT '资源位描述说明',
    created_by          BIGINT NOT NULL COMMENT '创建人',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by          BIGINT COMMENT '最后修改人',
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME COMMENT '软删除时间',
    INDEX idx_page (page_code, status),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源位定义表';
```

#### 预置资源位编码规范

```
格式：{page}.{area}.{type}_{sequence}

示例：
  home.top.banner_carousel_1     → 首页顶部轮播 Banner
  home.middle.icon_grid_1        → 首页中部快捷入口图标网格
  home.middle.content_card_1     → 首页中部推荐内容卡片
  home.bottom.strip_banner_1     → 首页底部条幅
  ai_chat.bottom.strip_banner_1  → AI对话页底部条幅
  profile.top.content_card_1     → 个人中心顶部卡片
  practice.result.content_card_1 → 练习结果页推荐卡片
  error_book.top.banner_carousel_1 → 错题本顶部Banner
  payment.success.strip_banner_1  → 支付成功页推广条幅
  member.center.banner_carousel_1 → 会员中心轮播
```

### 2.2 素材表 (slot_material)

素材是投放到资源位的具体内容单元。

```sql
CREATE TABLE slot_material (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    material_code       VARCHAR(64) NOT NULL UNIQUE COMMENT '素材编码',
    title               VARCHAR(256) NOT NULL COMMENT '素材标题（管理用）',
    slot_code           VARCHAR(64) NOT NULL COMMENT '投放的目标资源位编码',
    material_type       VARCHAR(32) NOT NULL COMMENT '素材类型: image/rich_card/video/mini_program_link',
    
    -- 图片素材
    image_url           VARCHAR(512) COMMENT '主图URL（CDN地址）',
    image_url_night     VARCHAR(512) COMMENT '夜间模式图片URL',
    image_url_pad       VARCHAR(512) COMMENT '平板适配图片URL',
    
    -- 富文本卡片
    card_title          VARCHAR(128) COMMENT '卡片标题',
    card_subtitle       VARCHAR(256) COMMENT '卡片副标题',
    card_icon           VARCHAR(512) COMMENT '卡片图标URL',
    card_bg_color       VARCHAR(32) COMMENT '卡片背景色',
    card_text_color     VARCHAR(32) COMMENT '卡片文字颜色',
    card_tag            VARCHAR(64) COMMENT '卡片标签文字（如"热门""新上线"）',
    
    -- 跳转配置
    action_type         VARCHAR(32) NOT NULL DEFAULT 'none' COMMENT '点击动作: none/page/deeplink/url/app_page',
    action_url          VARCHAR(1024) COMMENT '跳转地址或深链接',
    action_params       JSON COMMENT '跳转附加参数',
    
    -- 排序与权重
    weight              INT NOT NULL DEFAULT 100 COMMENT '基础权重（数字越大越靠前）',
    
    -- 排期
    start_time          DATETIME NOT NULL COMMENT '上线时间',
    end_time            DATETIME NOT NULL COMMENT '下线时间',
    is_persistent       TINYINT DEFAULT 0 COMMENT '是否常驻（1=忽略排期，手动下架）',
    
    -- 状态
    status              TINYINT NOT NULL DEFAULT 0 COMMENT '状态: 0=草稿, 1=待审核, 2=审核拒绝, 3=已上架, 4=已下架, 5=已过期',
    audit_remark        VARCHAR(512) COMMENT '审核备注',
    audit_by            BIGINT COMMENT '审核人',
    audit_at            DATETIME COMMENT '审核时间',
    
    -- 版本管理
    version             INT NOT NULL DEFAULT 1 COMMENT '版本号',
    source_material_id  BIGINT COMMENT '源素材ID（版本迭代时关联）',
    
    -- 创建信息
    created_by          BIGINT NOT NULL COMMENT '创建人',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME COMMENT '软删除时间',
    
    INDEX idx_slot_status (slot_code, status, start_time, end_time),
    INDEX idx_time_range (start_time, end_time, status),
    INDEX idx_created (created_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源位素材表';
```

### 2.3 投放规则表 (delivery_rule)

每条素材可关联多条投放规则，规则之间为 AND 关系。

```sql
CREATE TABLE delivery_rule (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    material_id         BIGINT NOT NULL COMMENT '素材ID',
    rule_type           VARCHAR(32) NOT NULL COMMENT '规则类型',
    rule_operator       VARCHAR(16) NOT NULL COMMENT '操作符: eq/neq/in/not_in/gt/lt/gte/lte/between/contains',
    rule_value          VARCHAR(1024) NOT NULL COMMENT '规则值（JSON数组或单值）',
    priority            INT DEFAULT 0 COMMENT '规则优先级（多条同类规则时）',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_material (material_id),
    INDEX idx_rule_type (rule_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投放规则表';
```

#### 规则类型枚举

| rule_type | 说明 | operator 示例 | value 示例 |
|-----------|------|--------------|-----------|
| `user_segment` | 用户分群 | `in` | `["new_user","active_7d"]` |
| `grade` | 年级 | `in` | `["grade_7","grade_8","grade_9"]` |
| `stage` | 学段 | `eq` | `"middle_school"` |
| `membership_level` | 会员等级 | `in` | `["free","monthly"]` |
| `province` | 省份 | `in` | `["广东","北京"]` |
| `textbook_version` | 教材版本 | `eq` | `"renjiao"` |
| `register_days` | 注册天数 | `gte` | `"30"` |
| `last_active_days` | 最近活跃天数 | `lte` | `"3"` |
| `subject_preference` | 学科偏好 | `contains` | `"math"` |
| `age_group` | 年龄段 | `between` | `"[6,12]"` |
| `is_minor` | 是否未成年 | `eq` | `"true"` |
| `device_type` | 设备类型 | `in` | `["ios","android"]` |
| `app_version` | APP 版本 | `gte` | `"2.0.0"` |
| `custom_tag` | 自定义标签 | `in` | `["tag_a","tag_b"]` |
| `learning_goal` | 学习目标 | `eq` | `"zhongkao"` |
| `weak_subject` | 薄弱学科 | `contains` | `"physics"` |

### 2.4 排期与互斥表 (slot_schedule)

```sql
CREATE TABLE slot_schedule (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    slot_code           VARCHAR(64) NOT NULL COMMENT '资源位编码',
    material_id         BIGINT NOT NULL COMMENT '素材ID',
    priority            INT NOT NULL DEFAULT 100 COMMENT '排期优先级（同时间段高优先级在前）',
    effective_start     DATETIME NOT NULL COMMENT '排期生效开始时间',
    effective_end       DATETIME NOT NULL COMMENT '排期生效结束时间',
    daily_start_time    TIME COMMENT '每日展示开始时间（如 08:00:00），空=全天',
    daily_end_time      TIME COMMENT '每日展示结束时间（如 22:00:00），空=全天',
    week_days           VARCHAR(32) COMMENT '星期几展示（逗号分隔：1,2,3,4,5），空=每天',
    exclude_holidays    TINYINT DEFAULT 0 COMMENT '是否节假日不展示',
    
    -- 互斥组：同一互斥组内同一时间只展示一条素材
    mutex_group         VARCHAR(64) COMMENT '互斥组编码（同组素材同时段只取优先级最高）',
    
    -- 流量控制
    traffic_percentage  DECIMAL(5,2) DEFAULT 100.00 COMMENT '流量分配比例（%）',
    
    status              TINYINT NOT NULL DEFAULT 1 COMMENT '0=禁用, 1=启用',
    created_by          BIGINT NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_slot_time (slot_code, effective_start, effective_end, status),
    INDEX idx_mutex (mutex_group, effective_start, effective_end),
    INDEX idx_material (material_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源位排期表';
```

### 2.5 曝光与点击日志表 (slot_event_log)

```sql
CREATE TABLE slot_event_log (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id            VARCHAR(64) NOT NULL COMMENT '事件唯一ID（防重）',
    event_type          VARCHAR(16) NOT NULL COMMENT '事件类型: impression/click/close/convert',
    material_id         BIGINT NOT NULL COMMENT '素材ID',
    slot_code           VARCHAR(64) NOT NULL COMMENT '资源位编码',
    page_code           VARCHAR(64) NOT NULL COMMENT '页面编码',
    user_id             BIGINT NOT NULL COMMENT '用户ID',
    device_id           VARCHAR(64) COMMENT '设备ID',
    session_id          VARCHAR(64) COMMENT '会话ID',
    experiment_id       VARCHAR(64) COMMENT 'AB实验ID（如有）',
    experiment_group    VARCHAR(32) COMMENT 'AB实验分组',
    
    -- 用户画像快照（便于离线分析）
    user_grade          VARCHAR(32) COMMENT '用户年级',
    user_stage          VARCHAR(32) COMMENT '用户学段',
    membership_level    VARCHAR(32) COMMENT '会员等级',
    is_minor            TINYINT COMMENT '是否未成年',
    
    -- 环境
    device_type         VARCHAR(16) COMMENT '设备类型',
    app_version         VARCHAR(32) COMMENT 'APP版本',
    os_version          VARCHAR(32) COMMENT '系统版本',
    network_type        VARCHAR(16) COMMENT '网络类型',
    ip_province         VARCHAR(32) COMMENT 'IP省份',
    
    -- 转化追踪
    ref_event_id        VARCHAR(64) COMMENT '关联的上游事件ID（如点击关联曝光）',
    conversion_target   VARCHAR(64) COMMENT '转化目标（如 order_create, activity_join）',
    conversion_value    DECIMAL(12,2) COMMENT '转化金额（分）',
    
    event_time          DATETIME NOT NULL COMMENT '事件发生时间',
    server_time         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '服务端接收时间',
    
    INDEX idx_material_event (material_id, event_type, event_time),
    INDEX idx_user_event (user_id, event_type, event_time),
    INDEX idx_slot_event (slot_code, event_type, event_time),
    INDEX idx_event_id (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源位事件日志表';
```

### 2.6 A/B 实验配置表 (slot_experiment)

```sql
CREATE TABLE slot_experiment (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    experiment_code     VARCHAR(64) NOT NULL UNIQUE COMMENT '实验编码',
    experiment_name     VARCHAR(128) NOT NULL COMMENT '实验名称',
    slot_code           VARCHAR(64) NOT NULL COMMENT '实验资源位编码',
    description         TEXT COMMENT '实验描述',
    
    -- 实验组配置
    groups_config       JSON NOT NULL COMMENT '实验组配置',
    /*
    groups_config 结构示例:
    {
      "groups": [
        {
          "group_name": "control",
          "group_label": "对照组",
          "traffic_percentage": 50,
          "material_ids": [1001, 1002]
        },
        {
          "group_name": "variant_a",
          "group_label": "实验组A",
          "traffic_percentage": 50,
          "material_ids": [1003, 1004]
        }
      ]
    }
    */
    
    -- 实验指标
    primary_metric      VARCHAR(64) NOT NULL COMMENT '主指标: ctr/conversion_rate/engagement_rate',
    secondary_metrics   JSON COMMENT '辅助指标',
    
    -- 分流配置
    salt                VARCHAR(32) NOT NULL COMMENT '分流盐值（保证不同实验独立性）',
    targeting_rules     JSON COMMENT '实验定向条件（复用delivery_rule格式）',
    
    -- 状态
    status              TINYINT NOT NULL DEFAULT 0 COMMENT '0=草稿, 1=运行中, 2=已暂停, 3=已完成, 4=已归档',
    start_time          DATETIME COMMENT '实验开始时间',
    end_time            DATETIME COMMENT '实验结束时间',
    
    created_by          BIGINT NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_slot_status (slot_code, status),
    INDEX idx_code (experiment_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源位AB实验配置表';
```

### 2.7 资源位缓存快照表 (slot_cache_snapshot)

用于 CDN 缓存和客户端预加载的精简数据结构。

```sql
CREATE TABLE slot_cache_snapshot (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    cache_key           VARCHAR(256) NOT NULL UNIQUE COMMENT '缓存键',
    cache_version       VARCHAR(64) NOT NULL COMMENT '缓存版本号',
    user_segment        VARCHAR(128) NOT NULL DEFAULT 'default' COMMENT '用户分群标识',
    slot_data           JSON NOT NULL COMMENT '资源位数据快照（精简后）',
    ttl_seconds         INT NOT NULL DEFAULT 300 COMMENT '缓存有效期（秒）',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          DATETIME NOT NULL COMMENT '过期时间',
    
    INDEX idx_key_version (cache_key, cache_version),
    INDEX idx_segment (user_segment, expires_at),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='资源位缓存快照表';
```

---

## 3. API 接口设计

### 3.1 客户端聚合获取接口

客户端进入页面时一次性获取该页面所有资源位数据。

```
POST /api/v1/slot/page-config
```

**请求参数：**

```json
{
  "page_code": "home",
  "user_context": {
    "user_id": 1000234,
    "grade": "grade_8",
    "stage": "middle_school",
    "membership_level": "monthly",
    "is_minor": true,
    "province": "广东",
    "textbook_version": "renjiao",
    "device_type": "ios",
    "app_version": "2.1.0",
    "register_days": 45,
    "last_active_days": 0,
    "custom_tags": ["active_7d", "math_lover"],
    "learning_goal": "zhongkao",
    "weak_subjects": ["physics"]
  },
  "client_cache_versions": {
    "home.top.banner_carousel_1": "v20260813_1",
    "home.middle.icon_grid_1": "v20260812_3"
  }
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "page_code": "home",
    "request_id": "req_abc123",
    "server_cache_version": "v20260813_2",
    "slots": [
      {
        "slot_code": "home.top.banner_carousel_1",
        "slot_type": "banner_carousel",
        "cache_version": "v20260813_2",
        "cache_changed": true,
        "carousel_interval": 4000,
        "items": [
          {
            "material_id": 50012,
            "material_type": "image",
            "image_url": "https://cdn.primetop.com/banner/zk_sprint_2026.png",
            "image_url_night": "https://cdn.primetop.com/banner/zk_sprint_2026_night.png",
            "action_type": "page",
            "action_url": "/exam_sprint/detail?id=zs2026",
            "action_params": {"source": "home_banner"},
            "tag": "热门",
            "tracking_params": {
              "impression_id": "imp_x1y2z3",
              "click_url": "/api/v1/slot/track/click",
              "material_code": "M20260813001"
            }
          },
          {
            "material_id": 50013,
            "material_type": "rich_card",
            "card_title": "暑期数学特训营",
            "card_subtitle": "7天突破函数与几何",
            "card_icon": "https://cdn.primetop.com/icons/math_camp.png",
            "card_bg_color": "#E8F5E9",
            "card_tag": "限时",
            "action_type": "page",
            "action_url": "/camp/detail?id=math_camp_2026",
            "tracking_params": {
              "impression_id": "imp_a4b5c6",
              "click_url": "/api/v1/slot/track/click",
              "material_code": "M20260813002"
            }
          }
        ]
      },
      {
        "slot_code": "home.middle.icon_grid_1",
        "slot_type": "icon_grid",
        "cache_version": "v20260812_3",
        "cache_changed": false,
        "items": []
      },
      {
        "slot_code": "home.middle.content_card_1",
        "slot_type": "content_card",
        "cache_version": "v20260813_1",
        "cache_changed": true,
        "items": [
          {
            "material_id": 50020,
            "material_type": "rich_card",
            "card_title": "你的物理有3个薄弱点待突破",
            "card_subtitle": "基于本周练习分析",
            "card_icon": "https://cdn.primetop.com/icons/weak_alert.png",
            "card_bg_color": "#FFF3E0",
            "action_type": "page",
            "action_url": "/analysis/weak_subjects",
            "tracking_params": {
              "impression_id": "imp_d7e8f9",
              "click_url": "/api/v1/slot/track/click",
              "material_code": "M20260813003"
            }
          }
        ]
      }
    ],
    "global_config": {
      "default_image_placeholder": "https://cdn.primetop