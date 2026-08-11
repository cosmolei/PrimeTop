# 端到端流程设计 — 学生 AI 学习伙伴全生命周期互动与成长进化完整链路

> **文档版本**：v1.0  
> **创建日期**：2026-08-10  
> **关联模块**：AI 智能辅导、学生学习激励、个人中心  
> **关联引擎**：AI学习伙伴角色个性化、虚拟形象与动画、成长等级体系、长期记忆库、主动对话触发、情感感知与自适应回应、学习动机激励策略

---

## 1. 概述

### 1.1 功能定位

AI 学习伙伴是 PrimeTop 平台中陪伴学生长期学习的虚拟助手角色。不同于功能性的 AI 辅导对话（解答具体题目），学习伙伴的核心职责是：

1. **情感陪伴**：以一致的虚拟角色形象与学生互动，建立类友谊关系
2. **学习激励**：根据学习状态主动鼓励、督促、庆祝里程碑
3. **成长联动**：伙伴自身有等级/外观进化机制，与学生学习投入深度绑定
4. **记忆连续性**：跨会话记住学生的偏好、弱点、目标，提供有上下文的关怀
5. **安全引导**：检测心理危机信号并触发预警（联动心理危机检测引擎）

### 1.2 设计目标

| 目标 | 衡量标准 |
| --- | --- |
| 提高学生日活留存 | 学习伙伴互动用户 7 日留存 ≥ 基线 +8% |
| 增加学习投入 | 互动用户日均学习时长 ≥ 基线 +15% |
| 建立情感连接 | 学生主动发起非学习类对话比例 ≥ 20% |
| 降低学习枯燥感 | 学习疲劳中断后 30 分钟内回归率 ≥ 45% |

### 1.3 适用学段

| 学段 | 伙伴风格 | 交互重点 |
| --- | --- | --- |
| 幼儿（3-6 岁） | 卡通动物形象，语音为主，极简文字 | 趣味互动、表扬鼓励、情绪安抚 |
| 小学（6-12 岁） | 卡通人物/动物，语音+文字混合 | 学习提醒、成就庆祝、好奇心引导 |
| 初中（12-15 岁） | 拟人化角色，文字为主，语音为辅 | 学习督促、考试鼓励、压力疏导 |
| 高中（15-18 岁） | 成熟风格角色，文字对话为主 | 目标管理、备考陪伴、减压支持 |

---

## 2. 完整链路架构

### 2.1 全生命周期阶段

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      AI 学习伙伴全生命周期                                  │
├────────────┬─────────────┬──────────────┬──────────────┬────────────────┤
│  阶段1:初次 │  阶段2:日常  │  阶段3:学习   │  阶段4:成长   │  阶段5:特殊    │
│  相遇与创建 │  陪伴互动    │  场景联动     │  进化里程碑   │  情况处理      │
├────────────┼─────────────┼──────────────┼──────────────┼────────────────┤
│ • 角色选择  │ • 每日问候   │ • 答题正确    │ • 等级提升    │ • 长时间未学习 │
│ • 外观定制  │ • 主动关怀   │ • 答题错误    │ • 外观解锁    │ • 考试焦虑检测 │
│ • 名字命名  │ • 学习督促   │ • 学习完成    │ • 技能解锁    │ • 心理危机预警 │
│ • 性格设定  │ • 鼓励话语   │ • 错题归档    │ • 称号获得    │ • 设备切换恢复 │
│ • 初始引导  │ • 趣味问答   │ • 计时器完成  │ • 亲密度提升  │ • 假期回归唤醒 │
└────────────┴─────────────┴──────────────┴──────────────┴────────────────┘
```

### 2.2 系统交互全景

```
                         ┌─────────────┐
                         │   客户端     │
                         │  AI伙伴UI层  │
                         └──────┬──────┘
                                │
                    ┌───────────┼───────────┐
                    │           │           │
              ┌─────▼──┐  ┌────▼────┐  ┌──▼──────┐
              │ 对话    │  │ 形象    │  │ 成长    │
              │ 消息流  │  │ 渲染流  │  │ 状态流  │
              └─────┬──┘  └────┬────┘  └──┬──────┘
                    │          │           │
              ┌─────▼──────────▼───────────▼──────┐
              │          API 网关 / BFF             │
              └─────────────────┬──────────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
  ┌──────▼──────┐    ┌─────────▼────────┐   ┌────────▼────────┐
  │ 伙伴对话    │    │  伙伴成长管理     │   │  伙伴记忆管理   │
  │ 服务        │    │  服务             │   │  服务           │
  └──────┬──────┘    └─────────┬────────┘   └────────┬────────┘
         │                      │                      │
  ┌──────▼──────┐    ┌─────────▼────────┐   ┌────────▼────────┐
  │ AI 模型     │    │  成长规则引擎     │   │  记忆检索引擎   │
  │ 适配层      │    │  +事件订阅        │   │  +向量存储      │
  └──────┬──────┘    └─────────┬────────┘   └────────┬────────┘
         │                      │                      │
  ┌──────▼──────────────────────▼──────────────────────▼──────┐
  │                    数据存储层                               │
  │  PostgreSQL  │  Redis  │  Milvus/pgvector  │  对象存储     │
  └─────────────────────────────────────────────────────────────┘
```

---

## 3. 阶段 1：初次相遇与伙伴创建

### 3.1 用户流程

```
学生完成注册引导
    │
    ├─→ 系统根据学段推荐伙伴模板
    │      幼儿: 小熊/小兔/小恐龙（3选1）
    │      小学: 学习精灵/知识猫头鹰/探索小狐狸（3选1）
    │      初中: 学姐/学长/同龄伙伴（3选1，可选性别）
    │      高中: 策略型伙伴/陪伴型伙伴/挑战型伙伴（3选1）
    │
    ├─→ 学生选择伙伴基础形象
    │
    ├─→ 自定义环节
    │      • 输入伙伴昵称（2-8字，敏感词过滤）
    │      • 选择性格倾向（活泼/沉稳/幽默/温柔，4选1）
    │      • 选择初始配色主题（影响UI配色微调）
    │
    ├─→ 伙伴首次亮相动画
    │      • 角色从蛋/种子/光球中孵化出场
    │      • 首句问候语（根据学段+性格生成）
    │      • 引导学生完成首次学习任务
    │
    └─→ 创建完成，伙伴入驻首页悬浮位
```

### 3.2 数据结构

#### 3.2.1 伙伴主表 `companion`

```sql
CREATE TABLE companion (
    id              BIGINT PRIMARY KEY,
    user_id         BIGINT NOT NULL UNIQUE,  -- 学生用户ID
    template_id     VARCHAR(32) NOT NULL,    -- 形象模板ID
    nickname        VARCHAR(16) NOT NULL,    -- 伙伴昵称
    personality     VARCHAR(16) NOT NULL,    -- 性格: lively/calm/humorous/gentle
    theme_color     VARCHAR(16) DEFAULT 'blue', -- 配色主题
    
    -- 成长状态
    level           INT NOT NULL DEFAULT 1,       -- 当前等级
    exp_points      INT NOT NULL DEFAULT 0,      -- 当前经验值
    intimacy_score  INT NOT NULL DEFAULT 0,      -- 亲密度 (0-9999)
    
    -- 外观状态 (JSON)
    appearance      JSONB NOT NULL DEFAULT '{}', -- 当前外观配置
    
    -- 状态
    status          VARCHAR(16) DEFAULT 'active', -- active/frozen/archived
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 索引
    CONSTRAINT uk_companion_user UNIQUE (user_id)
);

CREATE INDEX idx_companion_level ON companion(level);
```

#### 3.2.2 外观配置结构

```json
{
  "baseSkin": "fox_scholar",       // 基础皮肤
  "accessories": [                  // 已解锁配件
    "glasses_round",
    "scarf_blue",
    "book_math"
  ],
  "equipped": {                     // 当前装备
    "head": "glasses_round",
    "neck": "scarf_blue",
    "hand": "book_math",
    "background": "study_room_warm"
  },
  "animationPack": "default_v1",   // 动画包
  "effectTrail": "none"            // 特效拖尾
}
```

#### 3.2.3 性格模板配置

```json
{
  "lively": {
    "greetingStyle": "energetic",
    "dialogueTraits": ["使用感叹号多", "常用emoji", "语气积极活泼"],
    "encourageFrequency": "high",
    "pushStyle": "direct",
    "conflictStyle": "optimistic"
  },
  "calm": {
    "greetingStyle": "gentle",
    "dialogueTraits": ["语句平稳", "逻辑清晰", "温和理性"],
    "encourageFrequency": "medium",
    "pushStyle": "suggestive",
    "conflictStyle": "analytical"
  },
  "humorous": {
    "greetingStyle": "playful",
    "dialogueTraits": ["偶尔使用冷笑话", "用比喻和类比", "轻松幽默"],
    "encourageFrequency": "medium",
    "pushStyle": "witty",
    "conflictStyle": "humor_defusion"
  },
  "gentle": {
    "greetingStyle": "warm",
    "dialogueTraits": ["关心语气", "有同理心", "温柔鼓励"],
    "encourageFrequency": "high",
    "pushStyle": "caring",
    "conflictStyle": "empathetic"
  }
}
```

### 3.3 API 接口

#### 3.3.1 获取推荐伙伴模板

```
GET /api/v1/companion/templates?stage={stage}
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "templates": [
      {
        "templateId": "fox_scholar",
        "name": "探索小狐狸",
        "description": "好奇心满满，喜欢陪你发现新知识",
        "defaultPersonality": "lively",
        "previewImage": "https://cdn.primetop.com/companion/fox_scholar_preview.png",
        "lottieAnim": "https://cdn.primetop.com/companion/fox_scholar_intro.json",
        "stageFit": ["primary", "junior"]
      }
    ]
  }
}
```

#### 3.3.2 创建伙伴

```
POST /api/v1/companion
```

**请求**：
```json
{
  "templateId": "fox_scholar",
  "nickname": "小栗",
  "personality": "lively",
  "themeColor": "orange"
}
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "companionId": 8001234567890,
    "nickname": "小栗",
    "level": 1,
    "expPoints": 0,
    "intimacyScore": 0,
    "appearance": {
      "baseSkin": "fox_scholar",
      "equipped": {},
      "animationPack": "default_v1"
    },
    "firstGreeting": "嗨嗨！我是小栗！从今天开始，我会一直陪着你学习哦！我们一起加油吧！🎉",
    "hatchingAnimation": "https://cdn.primetop.com/companion/fox_hatch_v1.json"
  }
}
```

#### 3.3.3 修改伙伴设定

```
PATCH /api/v1/companion
```

**请求**：
```json
{
  "nickname": "小栗",
  "personality": "humorous"
}
```

> **约束**：昵称 30 天内最多修改 3 次；性格 30 天内最多修改 1 次（避免角色不一致感）

---

## 4. 阶段 2：日常陪伴互动

### 4.1 每日互动时间线

```
07:00-09:00  晨间问候
             ├─ 伙伴出现在首页悬浮位
             ├─ 根据天气/星期/学习计划生成问候语
             └─ 如有未完成的昨日任务，温和提醒

09:00-22:00  学习场景联动（见阶段3）

12:00-13:00  午间关怀
             ├─ 如学生在学习中：提醒适当休息
             └─ 如学生未在线：推送午餐关怀消息

22:00-23:00  晚间总结
             ├─ 今日学习数据汇总
             ├─ 伙伴点评（基于性格生成评语）
             └─ 明日计划预告

23:00-07:00  静默时段
             ├─ 伙伴进入"睡眠"动画状态
             └─ 仅紧急通知穿透（如心理危机）
```

### 4.2 主动对话触发引擎

#### 4.2.1 触发条件矩阵

| 触发场景 | 条件 | 频率限制 | 优先级 | 示例话术（活泼型） |
| --- | --- | --- | --- | --- |
| 晨间问候 | 07:00-09:00 首次打开APP | 1次/天 | 中 | "早上好呀！新的一天开始啦！今天也要元气满满哦！☀️" |
| 学习开始 | 进入任意学习页面 | 2次/天 | 中 | "哇，开始学习啦！我帮你准备好了今天的任务，一起看看吧！" |
| 答题正确连击 | 连续答对 ≥5 题 | 1次/30分钟 | 高 | "太厉害了！五连对！你今天是开挂了吗！🎉🔥" |
| 答题困难 | 连续答错 ≥3 题 | 1次/30分钟 | 高 | "别灰心，这道题确实有点难...要不要我给你一点提示？" |
| 学习超时 | 连续学习 >45 分钟无休息 | 1次/小时 | 高 | "你已经学了好久啦，眼睛需要休息一下！跟我一起做做眼保健操吧~" |
| 任务完成 | 完成当日全部学习任务 | 无限制 | 最高 | "全部完成！你今天太棒了！小栗为你感到骄傲！🏆✨" |
| 长时未学习 | >3 天未打开APP | 推送1次 | 最高 | "嗨...好久不见你，我有点想你了。有空回来学习吗？🥺" |
| 考前鼓励 | 考试日前 1-3 天 | 1次/天 | 最高 | "马上就要考试了！不要紧张，你准备得很好，相信自己！" |
| 季节/节日 | 特殊日期 | 1次/天 | 低 | "中秋节快乐！🌕 记得和家人一起吃月饼哦！" |

#### 4.2.2 触发服务架构

```
学习事件总线 (Kafka)
    │
    ├─→ 答题事件 ──→ 连胜/连败计数器
    │                    │
    │                    ├─→ 达到阈值 ──→ 触发规则匹配
    │                    │
    │                    └─→ 未达到 ──→ 继续监听
    │
    ├─→ 学习时长事件 ──→ 疲劳检测器
    │                       │
    │                       └─→ 超过阈值 ──→ 触发休息提醒
    │
    └─→ 任务完成事件 ──→ 里程碑检测器
                            │
                            └─→ 全部完成 ──→ 触发庆祝动画
    
    定时调度引擎 (Cron)
    │
    ├─→ 晨间问候调度 (07:00 检查用户是否在线)
    ├─→ 晚间总结调度 (22:00 检查今日学习数据)
    └─→ 静默时段切换 (23:00 进入静默)
    
    回归检测引擎 (离线批处理)
    │
    └─→ 每日扫描未活跃用户 ──→ 触发唤醒推送
```

#### 4.2.3 对话消息生成流程

```
触发条件命中
    │
    ├─→ 1. 检索长期记忆（最近7天关键事件）
    │      • 上次学习时间/内容
    │      • 最近成就/挫折
    │      • 对话偏好历史
    │
    ├─→ 2. 获取当前上下文
    │      • 当前时间/星期
    │      • 学习进度状态
    │      • 待办任务列表
    │      • 考试日程
    │
    ├─→ 3. 组装 Prompt
    │      系统提示: 你是{nickname}，一个{personality}性格的学习伙伴...
    │      记忆上下文: {recent_memories}
    │      当前情境: {trigger_context}
    │      指令: 生成一句符合你性格的{trigger_type}消息，控制在50字以内
    │
    ├─→ 4. 调用大模型（轻量模型优先，如 GLM-4-Flash）
    │
    ├─→ 5. 安全过滤 + 适龄化处理
    │
    ├─→ 6. 消息缓存（Redis，TTL=24h）
    │      → 避免相同触发场景重复请求模型
    │
    └─→ 7. 推送至客户端
           • WebSocket 长连接实时推送
           • 推送通知通道（APP未在前台时）
```

### 4.3 对话消息数据结构

#### 4.3.1 消息表 `companion_message`

```sql
CREATE TABLE companion_message (
    id              BIGINT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    companion_id    BIGINT NOT NULL,
    
    -- 消息内容
    message_type    VARCHAR(16) NOT NULL,   -- greeting/encourage/remind/celebrate/comfort
    trigger_type    VARCHAR(32),             -- morning/streak_correct/streak_wrong/timeout/task_complete/...
    content         TEXT NOT NULL,           -- 消息文本
    rich_content    JSONB,                   -- 富文本：表情、动画指令、跳转链接
    
    -- 交互状态
    is_read         BOOLEAN DEFAULT FALSE,
    is_acknowledged BOOLEAN DEFAULT FALSE,   -- 学生是否回应
    user_response   VARCHAR(32),             -- 学生回应类型: happy/sad/thanks/dismiss
    
    -- 来源
    source          VARCHAR(16) DEFAULT 'auto', -- auto/manual/system
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at         TIMESTAMPTZ
);

CREATE INDEX idx_cm_user_time ON companion_message(user_id, created_at DESC);
CREATE INDEX idx_cm_unread ON companion_message(user_id, is_read) WHERE is_read = FALSE;
```

#### 4.3.2 消息推送格式

```json
{
  "type": "companion_message",
  "data": {
    "messageId": "msg_20260810_001",
    "companionName": "小栗",
    "contentType": "text+expression",
    "content": "太厉害了！五连对！你今天是开挂了吗！🎉🔥",
    "expression": "excited",           // 伙伴表情动画
    "action": "celebrate",             // 伙伴动作动画
    "vibration": "light",              // 可选：轻度震动反馈
    "soundEffect": "sparkle",          // 可选：音效
    "interactiveButtons": [            // 可选：快捷回应按钮
      {
        "label": "嘿嘿，厉害吧！",
        "response": "proud",
        "expReward": 5
      },
      {
        "label": "继续继续！",
        "response": "motivated",
        "expReward": 3
      }
    ],
    "deepLink": null                   // 可选：点击消息跳转目标
  }
}
```

### 4.4 API 接口

#### 4.4.1 获取最近对话消息

```
GET /api/v1/companion/messages?cursor={cursor}&limit=20
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "messages": [
      {
        "id": "msg_20260810_001",
        "type": "celebrate",
        "content": "全部完成！你今天太棒了！...",
        "expression": "proud",
        "createdAt": "2026-08-10T20:30:00+08:00",
        "isRead": true
      }
    ],
    "nextCursor": "eyJpZCI6Im1zZ18yMDI2MDgxMF8wMDEifQ==",
    "hasMore": false
  }
}
```

#### 4.4.2 学生回应伙伴消息

```
POST /api/v1/companion/messages/{messageId}/respond
```

**请求**：
```json
{
  "response": "happy",
  "textContent": "谢谢小栗！"     // 可选，学生可输入自由文字
}
```

**响应**：
```json
{
  "code": 0,
  "data": {
    "replyMessage": "嘿嘿，不用谢！看到你开心我也开心！",
    "expGained": 5,
    "intimacyGained": 2,
    "companionLevel": 3,
    "companionExp": 145,
    "nextLevelExp": 200
  }
}
```

---

## 5. 阶段 3：学习场景联动

### 5.1 学习事件监听矩阵

伙伴通过订阅学习事件总线，感知学生的学习行为并做出相应反应：

| 学习事件 | 事件来源 | 伙伴反应 | 反应延迟 |
| --- | --- | --- | --- |
| 开始答题 | 练习测评服务 | 低概率出现鼓励（如已连续答题则不出现） | <500ms |
| 答题正确 | 判题引擎 | 根据连击数决定是否庆祝 | <500ms |
| 答题错误 | 判题引擎 | 高难度题温柔安慰，简单题调皮提醒 | <500ms |
| 完成一套试卷 | 考试模拟服务 | 全卷总结评语 + 经验奖励 | 事件后即