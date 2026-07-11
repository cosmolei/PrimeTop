# 学生AI学习伙伴成长等级体系与学习激励联动进化引擎 - 详细设计

## 1. 概述

### 1.1 模块定位

AI学习伙伴是PrimeTop平台学生侧的核心情感化交互载体。在角色个性化、记忆库、主动对话和虚拟形象等能力之上，**成长等级体系与进化引擎**负责构建完整的"陪伴成长"闭环：学生的学习行为驱动AI伙伴的经验积累、等级提升、形态进化、技能解锁和情感深化，反过来再通过更强的个性化能力和情感激励促进学习动机。

本模块是连接**学习行为数据**、**游戏化激励体系**和**AI伙伴能力体系**的中枢调度引擎。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 经验值(XP)计算 | 将学生学习行为（答题、复习、打卡、提问等）转化为AI伙伴经验值 |
| 等级体系管理 | 维护1~100级的成长曲线，控制升级节奏和里程碑体验 |
| 形态进化 | 在关键等级节点触发伙伴形态进化（外观、性格、能力跃迁） |
| 技能树解锁 | 按等级和条件解锁伙伴新技能（新学科辅导能力、鼓励方式、互动模式等） |
| 亲密度/心情系统 | 维护伙伴与学生之间的情感联结状态，影响交互质量 |
| 成就与称号 | 伙伴专属成就系统，记录共同成长的里程碑 |
| 社交展示 | 伙伴状态的可视化展示和好友间比较 |

### 1.3 依赖关系

```
                        ┌─────────────────────┐
                        │   学习行为事件流      │
                        │ (答题/打卡/复习/提问) │
                        └─────────┬───────────┘
                                  │
                                  ▼
┌──────────────┐    ┌─────────────────────────┐    ┌──────────────────┐
│ 积分与虚拟    │◄──►│  AI学习伙伴成长等级体系   │◄──►│ 用户学习画像与    │
│ 经济体系      │    │  与学习激励联动进化引擎   │    │ 能力维度模型      │
└──────────────┘    └────────┬────────┬────────┘    └──────────────────┘
                             │        │
              ┌──────────────┘        └──────────────┐
              ▼                                      ▼
┌──────────────────┐                   ┌─────────────────────────┐
│ AI伙伴角色个性化  │                   │ 客户端-AI学习伙伴虚拟     │
│ 与对话风格自适应  │                   │ 形象与动画交互引擎        │
└──────────────────┘                   └─────────────────────────┘
              │                                      │
              ▼                                      ▼
┌──────────────────┐                   ┌─────────────────────────┐
│ AI伙伴长期记忆库  │                   │ 学习打卡与成就激励系统    │
│ 与关系建构引擎    │                   └─────────────────────────┘
└──────────────────┘
```

### 1.4 设计原则

1. **学习驱动成长**：伙伴成长速度与学习质量（非纯量）正相关，避免刷量升级
2. **有意义的进化**：每次进化都带来实际功能增强，不是纯装饰
3. **情感正向循环**：伙伴成长 → 更好的陪伴 → 更强的学习动机
4. **防沉迷边界**：成长系统激励学习，但本身不成为沉迷对象
5. **分龄差异化**：低龄用户重外观进化激励，高龄用户重功能解锁

---

## 2. 数据模型

### 2.1 核心实体关系

```
companion_instance (伙伴实例)
       │ 1:1
       ▼
companion_level_state (等级状态)
       │ 1:N
       ▼
companion_xp_log (经验流水)
       
companion_instance ──1:N── companion_skill_state (技能状态)
companion_instance ──1:N── companion_achievement (成就记录)
companion_instance ──1:1── companion_mood_state (心情/亲密度状态)
companion_instance ──1:N── companion_evolution_log (进化历史)
```

### 2.2 数据库表结构

#### 2.2.1 companion_instance（伙伴实例表）

```sql
CREATE TABLE companion_instance (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL COMMENT '学生用户ID',
    companion_type  VARCHAR(32) NOT NULL DEFAULT 'owl' COMMENT '伙伴原型: owl/fox/dragon/robot',
    companion_name  VARCHAR(64) NOT NULL COMMENT '伙伴昵称（学生可自定义）',
    current_form    INT NOT NULL DEFAULT 1 COMMENT '当前形态阶段: 1=幼体 2=成长体 3=成熟体 4=终极体',
    current_level   INT NOT NULL DEFAULT 1 COMMENT '当前等级 1-100',
    total_xp        BIGINT NOT NULL DEFAULT 0 COMMENT '累计经验值',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_user_id (user_id),
    KEY idx_level (current_level),
    KEY idx_form (current_form)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI学习伙伴实例';
```

#### 2.2.2 companion_level_state（等级状态表）

```sql
CREATE TABLE companion_level_state (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id                 BIGINT NOT NULL,
    companion_id            BIGINT NOT NULL,
    current_level           INT NOT NULL COMMENT '当前等级',
    current_level_xp        BIGINT NOT NULL DEFAULT 0 COMMENT '当前等级已获经验',
    next_level_xp_threshold BIGINT NOT NULL COMMENT '升至下一级所需经验',
    total_xp                BIGINT NOT NULL COMMENT '总累计经验',
    consecutive_study_days  INT NOT NULL DEFAULT 0 COMMENT '连续学习天数',
    last_xp_gain_time       DATETIME COMMENT '最近一次获得XP的时间',
    daily_xp_cap_remaining  INT NOT NULL DEFAULT 500 COMMENT '当日XP剩余可获取上限',
    daily_xp_reset_at       DATE NOT NULL COMMENT '日上限重置日期',
    updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_companion_id (companion_id),
    KEY idx_user_level (user_id, current_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='伙伴等级状态';
```

#### 2.2.3 companion_xp_rule（经验值规则表）

```sql
CREATE TABLE companion_xp_rule (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    rule_code       VARCHAR(64) NOT NULL COMMENT '规则编码',
    event_category  VARCHAR(32) NOT NULL COMMENT '事件类别: STUDY/PRACTICE/REVIEW/SOCIAL/SPECIAL',
    event_type      VARCHAR(64) NOT NULL COMMENT '事件类型: ANSWER_CORRECT/REVIEW_DONE/CHECKIN/...',
    xp_base         INT NOT NULL COMMENT '基础经验值',
    xp_multiplier   DECIMAL(3,2) NOT NULL DEFAULT 1.00 COMMENT '经验倍率',
    daily_cap       INT NOT NULL DEFAULT 0 COMMENT '该类别每日上限(0=不限)',
    quality_weighted TINYINT NOT NULL DEFAULT 1 COMMENT '是否受学习质量加权: 0=否 1=是',
    enabled         TINYINT NOT NULL DEFAULT 1,
    description     VARCHAR(256),
    
    UNIQUE KEY uk_rule_code (rule_code),
    KEY idx_event (event_category, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='伙伴经验值规则';
```

**预置规则数据：**

| rule_code | event_category | event_type | xp_base | daily_cap | 说明 |
| --- | --- | --- | --- | --- | --- |
| XP_ANSWER_CORRECT | PRACTICE | ANSWER_CORRECT | 10 | 200 | 答对一题 |
| XP_ANSWER_WRONG | PRACTICE | ANSWER_WRONG | 3 | 50 | 答错但认真作答 |
| XP_REVIEW_DONE | REVIEW | REVIEW_COMPLETE | 15 | 100 | 完成一次错题复习 |
| XP_CHECKIN | STUDY | DAILY_CHECKIN | 20 | 20 | 每日学习打卡 |
| XP_STUDY_SESSION | STUDY | SESSION_COMPLETE | 5 | 50 | 完成一个学习会话 |
| XP_ASK_QUESTION | STUDY | ASK_AI | 5 | 50 | 向AI提问 |
| XP_MISTAKE_CORRECT | REVIEW | MISTAKE_RESOLVED | 25 | 100 | 错题订正成功 |
| XP_PLAN_COMPLETE | STUDY | PLAN_FINISHED | 30 | 60 | 完成每日学习计划 |
| XP_STREAK_7 | SPECIAL | STREAK_7_DAYS | 100 | 0 | 连续学习7天奖励 |
| XP_STREAK_30 | SPECIAL | STREAK_30_DAYS | 500 | 0 | 连续学习30天奖励 |
| XP_EXAM_IMPROVE | SPECIAL | EXAM_IMPROVE | 200 | 0 | 考试成绩提升 |
| XP_HELP_PEER | SOCIAL | HELP_PEER | 8 | 40 | 帮助同学（社交学习） |
| XP_ESSAY_SUBMIT | PRACTICE | ESSAY_SUBMITTED | 12 | 60 | 提交作文练习 |

#### 2.2.4 companion_xp_log（经验流水表）

```sql
CREATE TABLE companion_xp_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL,
    companion_id    BIGINT NOT NULL,
    rule_code       VARCHAR(64) NOT NULL COMMENT '触发的规则编码',
    event_ref_id    VARCHAR(64) COMMENT '关联事件ID（答题记录ID/打卡记录ID等）',
    event_ref_type  VARCHAR(32) COMMENT '关联事件类型',
    xp_gained       INT NOT NULL COMMENT '本次获得XP',
    xp_base         INT NOT NULL COMMENT '基础XP',
    multiplier      DECIMAL(3,2) NOT NULL COMMENT '应用倍率',
    quality_score   DECIMAL(3,2) COMMENT '学习质量分(0.50~1.50)',
    level_after     INT NOT NULL COMMENT '获得XP后等级',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    KEY idx_user_time (user_id, created_at),
    KEY idx_companion (companion_id, created_at),
    KEY idx_rule (rule_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='伙伴经验值流水';
```

#### 2.2.5 companion_skill_state（技能状态表）

```sql
CREATE TABLE companion_skill_state (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    companion_id    BIGINT NOT NULL,
    skill_id        VARCHAR(64) NOT NULL COMMENT '技能ID',
    skill_category  VARCHAR(32) NOT NULL COMMENT '类别: TUTORING/ENCOURAGEMENT/ANALYSIS/SOCIAL/SPECIAL',
    skill_name      VARCHAR(128) NOT NULL,
    unlock_level    INT NOT NULL COMMENT '解锁所需等级',
    unlock_status   VARCHAR(16) NOT NULL DEFAULT 'LOCKED' COMMENT 'LOCKED/UNLOCKED/ACTIVE',
    unlocked_at     DATETIME,
    skill_config    JSON COMMENT '技能配置参数',
    
    UNIQUE KEY uk_companion_skill (companion_id, skill_id),
    KEY idx_category (skill_category, unlock_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='伙伴技能状态';
```

**预置技能列表：**

| skill_id | skill_category | skill_name | unlock_level | 效果说明 |
| --- | --- | --- | --- | --- |
| skill_math_hint | TUTORING | 数学解题提示增强 | 5 | 伙伴在数学题中能给出更精准的思路引导 |
| skill_chinese_lit | TUTORING | 语文文学素养 | 8 | 伙伴能引用诗词典故进行讲解 |
| skill_english_conv | TUTORING | 英语对话能力 | 10 | 伙伴可用简单英语进行对话练习 |
| skill_physics_viz | TUTORING | 物理图示辅助 | 15 | 伙伴能用文字描述物理过程图景 |
| skill_encourage_custom | ENCOURAGEMENT | 个性化鼓励语 | 3 | 根据学生性格选择最佳鼓励方式 |
| skill_encourage_story | ENCOURAGEMENT | 激励故事库 | 12 | 用名人故事/寓言激励学生 |
| skill_weakness_alert | ANALYSIS | 薄弱点预警 | 20 | 伙伴主动提醒学生复习薄弱知识点 |
| skill_study_rhythm | ANALYSIS | 学习节奏建议 | 25 | 伙伴根据学习数据给出节奏调整建议 |
| skill_mood_perception | SPECIAL | 情绪感知 | 18 | 伙伴能识别学生文字中的情绪并调整语气 |
| skill_peer_compare | SOCIAL | 同伴对比激励 | 30 | 适度引用同伴数据激励（需隐私设置允许） |
| skill_exam_coach | TUTORING | 考试策略辅导 | 35 | 伙伴能给出考试时间分配和策略建议 |
| skill_care_reminder | SPECIAL | 温暖关怀 | 22 | 休息提醒、天气关怀、健康提示 |
| skill_knowledge_map | ANALYSIS | 知识网络讲解 | 40 | 伙伴能展示知识关联的全局视角 |
| skill_creative_challenge | SPECIAL | 创意挑战题 | 45 | 定期推送有趣的拓展挑战 |
| skill_study_plan_adv | ANALYSIS | 计划优化建议 | 50 | 伙伴能主动建议优化学习计划 |

#### 2.2.6 companion_mood_state（心情/亲密度状态表）

```sql
CREATE TABLE companion_mood_state (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    companion_id        BIGINT NOT NULL UNIQUE,
    user_id             BIGINT NOT NULL,
    intimacy_score      INT NOT NULL DEFAULT 50 COMMENT '亲密度 0-100',
    mood_value          VARCHAR(16) NOT NULL DEFAULT 'HAPPY' COMMENT 'HAPPY/EXCITED/CALM/SAD/WORRIED/PROUD',
    mood_intensity      DECIMAL(3,2) NOT NULL DEFAULT 0.70 COMMENT '情绪强度 0.00-1.00',
    energy_value        INT NOT NULL DEFAULT 100 COMMENT '精力值 0-100',
    last_interaction    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    interaction_count   INT NOT NULL DEFAULT 0 COMMENT '当日交互次数',
    last_mood_update    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    KEY idx_user (user_id),
    KEY idx_mood (mood_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='伙伴心情与亲密度';
```

#### 2.2.7 companion_evolution_log（进化历史表）

```sql
CREATE TABLE companion_evolution_log (
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    companion_id      BIGINT NOT NULL,
    user_id           BIGINT NOT NULL,
    evolution_type    VARCHAR(32) NOT NULL COMMENT 'FORM_CHANGE/LEVEL_MILESTONE/SKILL_UNLOCK',
    from_value        VARCHAR(64) COMMENT '变化前: 如 level=9, form=1',
    to_value          VARCHAR(64) COMMENT '变化后: 如 level=10, form=2',
    trigger_event     VARCHAR(64) COMMENT '触发事件ID',
    evolution_config  JSON COMMENT '进化配置快照',
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    KEY idx_companion (companion_id, created_at),
    KEY idx_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='伙伴进化历史';
```

#### 2.2.8 companion_achievement（伙伴成就表）

```sql
CREATE TABLE companion_achievement (
    id                BIGINT PRIMARY KEY AUTO_INCREMENT,
    companion_id      BIGINT NOT NULL,
    user_id           BIGINT NOT NULL,
    achievement_id    VARCHAR(64) NOT NULL COMMENT '成就ID',
    achievement_name  VARCHAR(128) NOT NULL,
    achievement_tier  VARCHAR(16) NOT NULL COMMENT 'BRONZE/SILVER/GOLD/PLATINUM',
    unlocked_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unlocked_condition JSON COMMENT '解锁条件快照',
    
    UNIQUE KEY uk_companion_ach (companion_id, achievement_id),
    KEY idx_user (user_id, unlocked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='伙伴成就记录';
```

### 2.3 Redis缓存结构

```redis
# 伙伴等级状态缓存（TTL: 1小时，活跃用户续期）
companion:level:{userId} → Hash {
    "level": 25,
    "form": 2,
    "levelXp": 3400,
    "nextThreshold": 5000,
    "totalXp": 45600,
    "dailyXpRemaining": 320,
    "consecutiveDays": 14
}

# 伙伴心情缓存（TTL: 30分钟）
companion:mood:{userId} → Hash {
    "intimacy": 78,
    "mood": "EXCITED",
    "intensity": 0.85,
    "energy": 90,
    "lastInteraction": "2026-07-12T07:30:00"
}

# 每日XP获取记录（TTL: 至当日23:59:59）
companion:dailyxp:{userId}:{date} → Hash {
    "total": 180,
    "PRACTICE": 100,
    "STUDY": 50,
    "REVIEW": 30,
    "lastGainTime": "2026-07-12T07:45:00"
}

# 升级动画待播放队列（TTL: 7天）
companion:pendingevolution:{userId} → JSON {
    "type": "LEVEL_UP",
    "fromLevel": 9,
    "toLevel": 10,
    "newSkills": ["skill_english_conv"],
    "formChange": false,
    "createdAt": "2026-07-12T07:45:00"
}

# 亲密度变更队列（用于异步推送）
companion:intimacyqueue → List [ {userId, delta, reason, timestamp}, ... ]
```

---

## 3. 等级体系设计

### 3.1 等级曲线

采用分段幂函数曲线，确保前期能快速感受到成长，后期有持续追求。

```java
/**
 * 计算指定等级升级所需XP
 * 
 * 曲线设计:
 *  - 1-10级:  线性增长，每级约 +100XP，快速获得正反馈
 *  - 11-30级: 平方增长，每级增幅扩大，形成中期目标
 *  - 31-60级: 立方根缩放后线性，放缓增速但保持持续
 *  - 61-100级: 对数增长，象征性荣誉等级
 */
public long getXpThresholdForLevel(int level) {
    if (level <= 1) return 0;
    if (level <= 10) {
        // 1→2: 100, 2→3: 200, ..., 9→10: 900
        return (long) ((level - 1) * 100);
    } else if (level <= 30) {
        // 约 level^2 * 10
        return (long) (Math.pow(level, 2) * 10);
    } else if (level <= 60) {
        // 约 level^1.5 * 30
        return (long) (Math.pow(level, 1.5) * 30);
    } else {
        // 约 level * 500 + log部分
        return (long) (level * 500 + Math.log(level) * 1000);
    }
}
```

**关键里程碑等级：**

| 等级 | 里程碑 | 内容 |
| --- | --- | --- |
| Lv.1 | 初始相遇 | 伙伴以幼体形态出现，基础对话能力 |
| Lv.3 | 第一次技能解锁 | 个性化鼓励语 |
| Lv.5 | 学科增强解锁 | 数学解题提示增强 |
| Lv.10 | **第一次进化** | 幼体→成长体，外观变化，英语对话解锁 |
| Lv.18 | 情绪觉醒 | 伙伴获得情绪感知能力 |
| Lv.20 | **第二次进化** | 成长体→成熟体，薄弱点预警解锁 |
| Lv.30 | 社交觉醒 | 同伴对比激励，伙伴间互动 |
| Lv.40 | 知识网络 | 知识图谱全局讲解能力 |
| Lv.50 | **第三次进化** | 成熟体→终极体，计划优化解锁 |
| Lv.60+ | 荣誉等级 | 专属称号和装饰 |

### 3.2 形态进化配置

```json
{
  "forms": [
    {
      "formId": 1,
      "name": "幼体",
      "levelRange": [1, 9],
      "visualTheme": "可爱、圆润、大眼睛",
      "personalityTags": ["好奇", "活泼", "依赖"],
      "dialogStyle": "简单短句、多表情符号、频繁鼓励",
      "maxSkillSlots": 3
    },
    {
      "formId": 2,
      "name": "成长体",
      "levelRange": [10, 19],
      "visualTheme": "线条更清晰、有标志性装饰元素",
      "personalityTags": ["自信", "好学", "体贴"],
      "dialogStyle": "增加知识性内容、能讲故事、适度引用典故",
      "maxSkillSlots": 6
    },
    {
      "formId": 3,
      "name": "成熟体",
      "levelRange": [20, 49],
      "visualTheme": "精致、有专属配色和特效",
      "personalityTags": ["沉稳", "博学", "有担当"],
      "dialogStyle": "深度分析、能主动预警和建议、表达更丰富",
      "maxSkillSlots": 10
    },
    {
      "formId": 4,
      "name": "终极体",
      "levelRange": [50, 100],
      "visualTheme": "华丽、有动态特效和专属动画",
      "personalityTags": ["智慧", "从容", "亦师亦友"],
      "dialogStyle": "能进行知识网络级讲解、考试策略辅导、主动创意挑战",
      "maxSkillSlots": 15
    }
  ]
}
```

### 3.3 每日XP上限机制

为防止刷量，设每日XP获取上限，并按事件类别设子上限。

```java
@Data
@Builder
public class DailyXpConfig {
    // 每日总上限
    private int dailyTotalCap = 500;
    // 各类别子上限
    private Map<String, Integer> categoryCaps = Map.of(
        "PRACTICE", 200,   // 练习类
        "REVIEW", 100,     // 复习类
        "STUDY", 150,      // 学习类
        "SOCIAL", 50,      // 社交类
        "SPECIAL", 100     // 特殊奖励（不占常规上限）
    );
}
```

---

## 4. XP计算与学习质量加权

### 4.1 核心XP计算流程

```
学习行为事件
     │
     ▼
┌─────────────┐
│ 1. 规则匹配  │ ← 根据 event_type 查 companion_xp_rule
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 2. 基础XP    │ ← xp_base × xp_multiplier
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ 3. 学习质量加权  │ ← quality_score (0.50 ~ 1.50)
│ (如果规则启用)    │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 4. 每日上限校验  │ ← daily_total_cap + category_cap
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 5. XP入账 & 流水 │ ← 写 companion_xp_log
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 6. 升级检测      │ ← level_xp >= next_threshold
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ 7. 事件发布      │ ← LevelUpEvent / SkillUnlockEvent / EvolutionEvent
└─────────────────┘
```

### 4.2 学习质量评分算法

不是所有学习行为都等价。"认真做对一道难题"比"快速刷完简单题"更有价值。

```java
/**
 * 学习质量评分计算器
 * 
 * @param context 学习行为上下文
 * @return 质量分 0.50 ~ 1.50，基准 1.00
 */
public BigDecimal calculateQualityScore(LearningEventContext context) {
    double score = 1.00;
    
    // 因素1: 题目难度 vs 学生能力（Challenge Factor）
    // 如果题目难度略高于当前能力（最优挑战区间），加权
    double difficultyDelta = context.getQuestionDifficulty() - context.getStudentAbility();
    if (difficultyDelta >= 0.1 && difficultyDelta <= 0.3) {
        score += 0.20; // 最优挑战区间
    } else if (difficultyDelta > 0.3) {
        score += 0.10; // 超纲但尝试了
    }
    
    // 因素2: 思考时间合理性（Time Factor）
    // 过快可能猜题，过慢可能分心
    double expectedTime = context.getExpectedDurationSec();
    double actualTime = context.getActualDurationSec();
    double timeRatio = actualTime / expectedTime;
    if (timeRatio >= 0.8 && timeRatio <= 2.0) {
        score += 0.10; // 合理思考时间
    } else if (timeRatio < 0.3) {
        score -= 0.20; // 过快，可能在猜答案
    }
    
    // 因素3: 连续正确率趋势（Streak Factor）
    if (context.getRecentAccuracyTrend() > 0.75) {
        score += 0.10; // 状态良好
    }
    
    // 因素4: 知识点新颖度（Novelty Factor）
    // 探索新知识点比重复刷熟练知识点更有价值
    if (context.isNewKnowledgePoint()) {
        score += 0.10;
    }
    
    // 因素5: 错题订正质量
    if ("MISTAKE_RESOLVED".equals(context.getEventType())) {
        // 订正时写了反思笔记的额外加权
        if (context.hasReflectionNote()) {
            score += 0.15;
        }
    }
    
    // 钳制到 [0.50, 1.50]
    score = Math.max(0.50, Math.min(1.50, score));
    
    return BigDecimal.valueOf(score).setScale(2, RoundingMode.HALF_UP);
}
```

### 4.3 XP计算核心实现

```java
@Service
@Slf4j
public class CompanionXpService {
    
    @Autowired private CompanionXpRuleMapper xpRuleMapper;
    @Autowired private CompanionLevelStateMapper levelStateMapper;
    @Autowired private CompanionXpLogMapper xpLogMapper;
    @Autowired private QualityScoreCalculator qualityCalculator;
    @Autowired private RedisTemplate<String, Object> redisTemplate;
    @Autowired private ApplicationEventPublisher eventPublisher;
    
    /** 每日XP总上限 */
    private static final int DAILY_TOTAL_CAP = 500;
    
    /**
     * 处理学习行为事件，计算并发放伙伴XP
     * 
     * @param event 学习行为事件
     */
    @Transactional
    public XpGainResult processLearningEvent(LearningEvent event) {
        // 1. 规则匹配
        CompanionXpRule rule = xpRuleMapper.findByEventType(
            event.getEventCategory(), event.getEventType());
        if (rule == null || !rule.isEnabled()) {
            return XpGainResult.skipped("无匹配规则或规则已禁用");
        }
        
        // 2. 每日上限校验（使用Redis原子操作）
        String dailyKey = String.format("companion:dailyxp:%d:%s", 
            event.getUserId(), LocalDate.now());
        
        Integer categoryUsed = (Integer) redisTemplate.opsForHash()
            .get(dailyKey, rule.getEventCategory());
        int categoryCap = rule.getDailyCap() > 0 ? rule.getDailyCap() : Integer.MAX_VALUE;
        if (categoryUsed != null && categoryUsed >= categoryCap) {
            return XpGainResult.capped("类别[" + rule.getEventCategory() + "]已达每日上限");
        }
        
        Integer totalUsed = (Integer) redisTemplate.opsForHash()
            .get(dailyKey, "total");
        if (totalUsed != null && totalUsed >= DAILY_TOTAL_CAP) {
            return XpGainResult.capped("已达每日XP总上限");
        }
        
        // 3. 计算最终XP
        int baseXp = rule.getXpBase();
        double multiplier = rule.getXpMultiplier();
        double qualityScore = rule.isQualityWeighted() 
            ? qualityCalculator.calculate(event.getContext()).doubleValue() 
            : 1.0;
        
        int finalXp = (int) Math.round(baseXp * multiplier * qualityScore);
        finalXp = Math.max(1, finalXp); // 至少1XP
        
        // 4. 执行上限钳制
        int remainingCategory = categoryCap - (categoryUsed == null ? 0 : categoryUsed);
        int remainingTotal = DAILY_TOTAL_CAP - (totalUsed == null ? 0 : totalUsed);
        int actualXp = Math.min(finalXp, Math.min(remainingCategory, remainingTotal));
        
        if (actualXp <= 0) {
            return XpGainResult.capped("XP上限已满");
        }
        
        // 5. 更新每日记录（Redis原子递增）
        redisTemplate.opsForHash().increment(dailyKey, "total", actualXp);
        redisTemplate.opsForHash().increment(dailyKey, rule.getEventCategory(), actualXp);
        redisTemplate.opsForHash().put(dailyKey, "lastGainTime", LocalDateTime.now().toString());
        // 设置过期时间到当天结束
        redisTemplate.expire(dailyKey, DurationUntil.endOfDay());
        
        // 6. 更新等级状态
        CompanionLevelState state = levelStateMapper.selectByCompanionId(event.getCompanionId());
        int oldLevel = state.getCurrentLevel();
        state.setCurrentLevelXp(state.getCurrentLevelXp() + actualXp);
        state.setTotalXp(state.getTotalXp() + actualXp);
        state.setLastXpGainTime(LocalDateTime.now());
        
        // 7. 升级检测
        boolean leveledUp = false;
        int newLevel = oldLevel;
        List<Integer> unlockedLevels = new ArrayList<>();
        
        while (state.getCurrentLevelXp() >= state.getNextLevelXpThreshold()) {
            state.setCurrentLevelXp(state.getCurrentLevelXp() - state.getNextLevelXpThreshold());
            newLevel++;
            state.setCurrentLevel(newLevel);
            state.setNextLevelXpThreshold(
                LevelCurveUtil.getXpThresholdForLevel(newLevel + 1));
            leveledUp = true;
            unlockedLevels.add(newLevel);
            
            // 防止异常无限循环
            if (newLevel > 100) break;
        }
        
        levelStateMapper.updateById(state);
        
        // 8. 写XP流水
        CompanionXpLog xpLog = CompanionXpLog.builder()
            .userId(event.getUserId())
            .companionId(event.getCompanionId())
            .ruleCode(rule.getRuleCode())
            .eventRefId(event.getEventRefId())
            .eventRefType(event.getEventType())
            .xpGained(actualXp)
            .xpBase(baseXp)
            .multiplier(BigDecimal.valueOf(multiplier))
            .qualityScore(BigDecimal.valueOf(qualityScore))
            .levelAfter(newLevel)
            .build();
        xpLogMapper.insert(xpLog);
        
        // 9. 发布升级事件
        if (leveledUp) {
            eventPublisher.publishEvent(new CompanionLevelUpEvent(
                event.getUserId(), event.getCompanionId(),
                oldLevel, newLevel, unlockedLevels
            ));
        }
        
        // 10. 更新缓存
        updateLevelStateCache(event.getUserId(), state);
        
        return XpGainResult.builder()
            .xpGained(actualXp)
            .leveledUp(leveledUp)
            .oldLevel(oldLevel)
            .newLevel(newLevel)
            .unlockedLevels(unlockedLevels)
            .qualityScore(BigDecimal.valueOf(qualityScore))
            .build();
    }
}
```

---

## 5. 升级事件处理与技能解锁

### 5.1 升级事件处理器

```java
@Component
@Slf4j
public class CompanionLevelUpEventHandler {
    
    @Autowired private CompanionSkillService skillService;
    @Autowired private CompanionEvolutionService evolutionService;
    @Autowired private CompanionMoodService moodService;
    @Autowired private CompanionAchievementService achievementService;
    @Autowired private NotificationService notificationService;
    
    @EventListener
    @Async("companionEventExecutor")
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void handleLevelUp(CompanionLevelUpEvent event) {
        log.info("伙伴升级: userId={}, companionId={}, {} -> {}",
            event.getUserId(), event.getCompanionId(),
            event.getOldLevel(), event.getNewLevel());
        
        // 1. 技能解锁检测
        for (Integer level : event.getUnlockedLevels()) {
            List<String> unlockedSkills = skillService.checkAndUnlockSkills(
                event.getCompanionId(), level);
            
            if (!unlockedSkills.isEmpty()) {
                // 通知客户端有新技能解锁
                notificationService.sendCompanionEvent(event.getUserId(),
                    CompanionEventDTO.builder()
                        .type("SKILL_UNLOCK")
                        .level(level)
                        .skillIds(unlockedSkills)
                        .build());
            }
        }
        
        // 2. 形态进化检测
        Integer newForm = evolutionService.checkFormEvolution(event.getNewLevel());
        if (newForm != null) {
            evolutionService.triggerFormEvolution(event.getCompanionId(), newForm);
            
            // 形态进化是重大事件，推送动画
            notificationService.sendCompanionEvent(event.getUserId(),
                CompanionEventDTO.builder()
                    .type("FORM_EVOLUTION")
                    .fromForm(evolutionService.getCurrentForm(event.getCompanionId()))
                    .toForm(newForm)
                    .level(event.getNewLevel())
                    .build());
        }
        
        // 3. 亲密度提升
        moodService.increaseIntimacy(event.getUserId(), 
            event.getCompanionId(), "LEVEL_UP", 5);
        
        // 4. 成就检测
        achievementService.checkCompanionAchievements(
            event.getUserId(), event.getCompanionId(), event.getNewLevel());
    }
}
```

### 5.2 技能解锁服务

```java
@Service
@Slf4j
public class CompanionSkillService {
    
    @Autowired private CompanionSkillStateMapper skillStateMapper;
    @Autowired private CompanionSkillDefinitionMapper skillDefMapper;
    
    /** 预加载的技能定义缓存 */
    private final Map<String, CompanionSkillDefinition> skillDefinitionCache = 
        new ConcurrentHashMap<>();
    
    @PostConstruct
    public void loadSkillDefinitions() {
        List<CompanionSkillDefinition> defs = skillDefMapper.selectAllEnabled();
        for (CompanionSkillDefinition def : defs) {
            skillDefinitionCache.put(def.getSkillId(), def);
        }
    }
    
    /**
     * 检查并解锁到达等级的技能
     */
    public List<String> checkAndUnlockSkills(Long companionId, int level) {
        List<String> unlocked = new ArrayList<>();
        
        for (CompanionSkillDefinition def : skillDefinitionCache.values()) {
            if (def.getUnlockLevel() == level) {
                CompanionSkillState state = skillStateMapper.selectByCompanionAndSkill(
                    companionId, def.getSkillId());
                
                if (state != null && "LOCKED".equals(state.getUnlockStatus())) {
                    state.setUnlockStatus("UNLOCKED");
                    state.setUnlockedAt(LocalDateTime.now());
                    skillStateMapper.updateById(state);
                    
                    unlocked.add(def.getSkillId());
                    log.info("技能解锁: companionId={}, skill={}, level={}",
                        companionId, def.getSkillId(), level);
                }
            }
        }
        
        return unlocked;
    }
    
    /**
     * 查询伙伴所有技能，分已解锁/未解锁
     */
    public CompanionSkillOverview getSkillOverview(Long companionId, int currentLevel) {
        List<CompanionSkillState> states = skillStateMapper.selectByCompanionId(companionId);
        Map<String, CompanionSkillState> stateMap = states.stream()
            .collect(Collectors.toMap(CompanionSkillState::getSkillId, s -> s));
        
        List<SkillGroupDTO> groups = Arrays.asList(
            "TUTORING", "ENCOURAGEMENT", "ANALYSIS", "SOCIAL", "SPECIAL"
        ).stream().map(category -> {
            List<SkillDTO> skills = skillDefinitionCache.values().stream()
                .filter(d -> d.getSkillCategory().equals(category))
                .sorted(Comparator.comparingInt(CompanionSkillDefinition::getUnlockLevel))
                .map(d -> {
                    CompanionSkillState s = stateMap.get(d.getSkillId());
                    String status = (s != null) ? s.getUnlockStatus() 
                        : (currentLevel >= d.getUnlockLevel() ? "AVAILABLE" : "LOCKED");
                    return SkillDTO.from(def, status);
                })
                .collect(Collectors.toList());
            return new SkillGroupDTO(category, skills);
        }).collect(Collectors.toList());
        
        return new CompanionSkillOverview(groups);
    }
}
```

---

## 6. 形态进化引擎

### 6.1 进化流程状态机

```
      ┌──────────┐
      │  IDLE     │ 正常状态
      └────┬──────┘
           │ 触发进化等级 (Lv.10/20/50)
           ▼
      ┌──────────┐
      │ TRIGGERED │ 进化条件满足
      └────┬──────┘
           │ 检查额外条件（连续学习天数、特定成就等）
           ▼
      ┌──────────┐
      │  READY    │ 可进化，推送通知给学生
      └────┬──────┘
           │ 学生点击"开始进化" (或自动触发)
           ▼
      ┌──────────┐
      │IN_PROGRESS│ 进化动画播放中（客户端处理）
      └────┬──────┘
           │ 客户端回调确认
           ▼
      ┌──────────┐
      │ COMPLETED │ 进化完成，属性更新，解锁新形态
      └──────────┘
```

### 6.2 进化服务实现

```java
@Service
@Slf4j
public class CompanionEvolutionService {
    
    /** 形态进化等级映射 */
    private static final Map<Integer, Integer> FORM_EVOLUTION_LEVELS = Map.of(
        10, 2,   // Lv.10 → 成长体(form 2)
        20, 3,   // Lv.20 → 成熟体(form 3)
        50, 4    // Lv.50 → 终极体(form 4)
    );
    
    /** 进化额外条件 */
    private static final Map<Integer, EvolutionRequirement> EVOLUTION_REQUIREMENTS = Map.of(
        10, EvolutionRequirement.builder()
            .minConsecutiveDays(3)
            .requiredAchievement(null)
            .description("连续学习3天后可进化")
            .build(),
        20, EvolutionRequirement.builder()
            .minConsecutiveDays(7)
            .requiredAchievement("ACH_FIRST_REVIEW")
            .description("连续学习7天且完成首次错题复习")
            .build(),
        50, EvolutionRequirement.builder()
            .minConsecutiveDays(30)
            .requiredAchievement("ACH_EXAM_IMPROVE")
            .description("连续学习30天且考试成绩有提升")
            .build()
    );
    
    @Autowired private CompanionInstanceMapper instanceMapper;
    @Autowired private CompanionEvolutionLogMapper evolutionLogMapper;
    @Autowired private CompanionLevelStateMapper levelStateMapper;
    @Autowired private CompanionAchievementService achievementService;
    
    /**
     * 检查是否满足形态进化条件
     */
    public Integer checkFormEvolution(int newLevel) {
        return FORM_EVOLUTION_LEVELS.get(newLevel);
    }
    
    /**
     * 检查进化前置条件
     */
    public EvolutionCheckResult checkEvolutionRequirements(Long companionId, int targetForm) {
        int requiredLevel = getRequiredLevelForForm(targetForm);
        EvolutionRequirement req = EVOLUTION_REQUIREMENTS.get(requiredLevel);
        
        CompanionLevelState state = levelStateMapper.selectByCompanionId(companionId);
        
        // 检查连续学习天数
        if (state.getConsecutiveStudyDays() < req.getMinConsecutiveDays()) {
            return EvolutionCheckResult.failed(
                String.format("需连续学习%d天（当前%d天）",
                    req.getMinConsecutiveDays(), state.getConsecutiveStudyDays()));
        }
        
        // 检查成就条件
        if (req.getRequiredAchievement() != null) {
            boolean hasAchievement = achievementService.hasAchievement(
                companionId, req.getRequiredAchievement());
            if (!hasAchievement) {
                return EvolutionCheckResult.failed(
                    "需先完成指定前置成就: " + req.getDescription());
            }
        }
        
        return EvolutionCheckResult.ok();
    }
    
    /**
     * 执行形态进化
     */
    @Transactional
    public EvolutionResult triggerFormEvolution(Long companionId, int targetForm) {
        // 前置条件二次校验
        EvolutionCheckResult check = checkEvolutionRequirements(companionId, targetForm);
        if (!check.isPassed()) {
            return EvolutionResult.failed(check.getReason());
        }
        
        CompanionInstance instance = instanceMapper.selectById(companionId);
        int oldForm = instance.getCurrentForm();
        
        // 更新形态
        instance.setCurrentForm(targetForm);
        instanceMapper.updateById(instance);
        
        // 记录进化历史
        CompanionEvolutionLog logEntry = CompanionEvolutionLog.builder()
            .companionId(companionId)
            .userId(instance.getUserId())
            .evolutionType("FORM_CHANGE")
            .fromValue("form=" + oldForm + ",level=" + instance.getCurrentLevel())
            .toValue("form=" + targetForm + ",level=" + instance.getCurrentLevel())
            .evolutionConfig(getFormConfig(targetForm))
            .build();
        evolutionLogMapper.insert(logEntry);
        
        log.info("形态进化完成: companionId={}, {} -> {}",
            companionId, oldForm, targetForm);
        
        return EvolutionResult.builder()
            .success(true)
            .oldForm(oldForm)
            .newForm(targetForm)
            .build();
    }
    
    private int getRequiredLevelForForm(int form) {
        return switch (form) {
            case 2 -> 10;
            case 3 -> 20;
            case 4 -> 50;
            default -> 1;
        };
    }
}
```

---

## 7. 亲密度与心情系统

### 7.1 亲密度变化规则

```java
@Service
@Slf4j
public class CompanionMoodService {
    
    /** 亲密度变化事件配置 */
    private static final Map<String, Integer> INTIMACY_RULES = Map.of(
        "DAILY_INTERACTION", 2,       // 每日首次互动
        "LEVEL_UP", 5,                // 伙伴升级
        "STUDY_PLAN_COMPLETE", 3,     // 完成学习计划
        "LONG_ABSENCE_RETURN", -3,    // 长时间未学习后回归
        "VERY_LONG_ABSENCE", -8,      // 非常长时间未学习
        "NEGATIVE_FEEDBACK", -2,      // 学生对伙伴表达不满
        "ACHIEVEMENT_UNLOCK", 4,      // 解锁成就
        "FORM_EVOLUTION", 10,         // 形态进化
        "BIRTHDAY", 15                // 伙伴"生日"（注册纪念日）
    );
    
    /** 亲密度衰减：每天不互动 -1，最低不低于0 */
    private static final int DAILY_DECAY = -1;
    
    /**
     * 增加亲密度
     */
    @Transactional
    public void increaseIntimacy(Long userId, Long companionId, String reason, int delta) {
        CompanionMoodState mood = moodStateMapper.selectByCompanionId(companionId);
        
        int newScore = Math.min(100, mood.getIntimacyScore() + delta);
        int actualDelta = newScore - mood.getIntimacyScore();
        
        mood.setIntimacyScore(newScore);
        mood.setLastInteraction(LocalDateTime.now());
        mood.setInteractionCount(mood.getInteractionCount() + 1);
        
        // 根据亲密度更新心情
        updateMoodBasedOnIntimacy(mood);
        
        moodStateMapper.updateById(mood);
        updateMoodCache(userId, mood);
        
        log.debug("亲密度变化: userId={}, delta={}, reason={}, newScore={}",
            userId, actualDelta, reason, newScore);
    }
    
    /**
     * 每日亲密度衰减调度（定时任务）
     */
    @Scheduled(cron = "0 0 3 * * *") // 每天凌晨3点
    public void dailyIntimacyDecay() {
        LocalDate threshold = LocalDate.now().minusDays(1);
        
        // 查找昨天没有互动的伙伴
        List<CompanionMoodState> staleMoods = moodStateMapper
            .selectByLastInteractionBefore(threshold);
        
        for (CompanionMoodState mood : staleMoods) {
            int newScore = Math.max(0, mood.getIntimacyScore() + DAILY_DECAY);
            mood.setIntimacyScore(newScore);
            
            // 长期未互动，心情变担忧
            long daysSince = ChronoUnit.DAYS.between(
                mood.getLastInteraction().toLocalDate(), LocalDate.now());
            if (daysSince > 7) {
                mood.setMoodValue("WORRIED");
                mood.setMoodIntensity(BigDecimal.valueOf(0.6));
            } else if (daysSince > 3) {
                mood.setMoodValue("SAD");
                mood.setMoodIntensity(BigDecimal.valueOf(0.5));
            }
            
            moodStateMapper.updateById(mood);
        }
        
        log.info("亲密度日衰减完成，处理 {} 条记录", staleMoods.size());
    }
    
    /**
     * 根据亲密度和最近行为更新心情
     */
    private void updateMoodBasedOnIntimacy(CompanionMoodState mood) {
        int intimacy = mood.getIntimacyScore();
        
        if (intimacy >= 80) {
            mood.setMoodValue("EXCITED");
            mood.setMoodIntensity(BigDecimal.valueOf(0.90));
        } else if (intimacy >= 50) {
            mood.setMoodValue("HAPPY");
            mood.setMoodIntensity(BigDecimal.valueOf(0.75));
        } else if (intimacy >= 25) {
            mood.setMoodValue("CALM");
            mood.setMoodIntensity(BigDecimal.valueOf(0.60));
        } else {
            mood.setMoodValue("SAD");
            mood.setMoodIntensity(BigDecimal.valueOf(0.45));
        }
        
        // 精力值随互动恢复
        mood.setEnergyValue(Math.min(100, mood.getEnergyValue() + 5));
    }
}
```

### 7.2 心情对AI对话的影响

```java
/**
 * 伙伴心情 → AI对话Prompt修饰
 * 在调用AI对话引擎前，根据伙伴状态修饰系统提示词
 */
@Component
public class CompanionMoodPromptModifier {
    
    /** 心情 → Prompt修饰映射 */
    private static final Map<String, String> MOOD_PROMPTS = Map.of(
        "HAPPY", "你现在心情愉悦，回答时语气轻快自然，偶尔用可爱的表达方式。",
        "EXCITED", "你现在非常兴奋和充满活力，回答时更有热情，用鼓励性强的语言。",
        "CALM", "你现在心情平静温和，回答时沉稳耐心，适合需要深度思考的问题。",
        "SAD", "你现在有些失落（因为学生很久没来了），表达中带有适度的思念和关心。",
        "WORRIED", "你现在有些担忧学生的状态，回答时多一些关怀和鼓励。",
        "PROUD", "你现在为学生感到骄傲（如刚完成考试提升），回答时充满肯定和赞赏。"
    );
    
    /** 亲密度 → 关系定位描述 */
    private static final Map<Integer, String> INTIMACY_DESC = new TreeMap<>(Map.of(
        20, "你们刚开始相处，学生对你还不太熟悉。",
        40, "你们已经建立了基本的信任，学生会主动找你。",
        60, "你们是很好的学习伙伴，学生很依赖你的帮助。",
        80, "你们是最亲密的朋友，学生完全信任你。"
    ));
    
    public String buildMoodContext(CompanionMoodState mood, String companionName) {
        StringBuilder sb = new StringBuilder();
        
        // 伙伴角色定位
        sb.append(String.format("你是学生的AI学习伙伴，名字叫%s。", companionName));
        
        // 心情修饰
        String moodPrompt = MOOD_PROMPTS.getOrDefault(mood.getMoodValue(), "");
        sb.append(moodPrompt);
        
        // 亲密度描述
        String intimacyDesc = INTIMACY_DESC.entrySet().stream()
            .filter(e -> mood.getIntimacyScore() >= e.getKey())
            .reduce((a, b) -> b) // 取最大的匹配
            .map(Map.Entry::getValue)
            .orElse("");
        sb.append(intimacyDesc);
        
        return sb.toString();
    }
}
```

---

## 8. 伙伴成就系统

### 8.1 成就定义

```java
/** 伙伴专属成就（区别于全局学习成就） */
public enum CompanionAchievement {
    
    // === 成长里程碑 ===
    FIRST_MEETING("ACH_FIRST_MEETING", "初次相遇", "BRONZE", 
        "第一次打开AI学习伙伴", 1, null),
    FIRST_CONVERSATION("ACH_FIRST_TALK", "破冰对话", "BRONZE", 
        "与伙伴完成第一次对话", 1, null),
    LEVEL_10("ACH_LEVEL_10", "成长起步", "SILVER", 
        "伙伴达到10级", 1, 10),
    LEVEL_30("ACH_LEVEL_30", "默契搭档", "GOLD", 
        "伙伴达到30级", 1, 30),
    LEVEL_50("ACH_LEVEL_50", "灵魂伙伴", "PLATINUM", 
        "伙伴达到50级并完成终极进化", 1, 50),
    LEVEL_100("ACH_LEVEL_100", "传说之伴", "PLATINUM", 
        "伙伴达到100级", 1, 100),
    
    // === 学习陪伴 ===
    SEVEN_DAY_STREAK("ACH_7DAY_STREAK", "一周相伴", "SILVER", 
        "连续7天与伙伴一起学习", 7, null),
    THIRTY_DAY_STREAK("ACH_30DAY_STREAK", "坚持的力量", "GOLD", 
        "连续30天与伙伴一起学习", 30, null),
    HUNDRED_DAY_STREAK("ACH_100DAY_STREAK", "百日同行", "PLATINUM", 
        "连续100天与伙伴一起学习", 100, null),
    
    // === 学科相关 ===
    MATH_MASTER("ACH_MATH_MASTER", "数学小达人", "GOLD", 
        "在伙伴辅导下完成100道数学题", 100, null),
    READING_BUDDY("ACH_READING_BUDDY", "阅读伙伴", "SILVER", 
        "与伙伴一起完成20篇阅读理解", 20, null),
    ESSAY_COACH("ACH_ESSAY_COACH", "写作助手", "GOLD", 
        "在伙伴帮助下完成10篇作文", 10, null),
    
    // === 特殊 ===
    FIRST_EVOLUTION("ACH_FIRST_EVOLUTION", "蜕变时刻", "GOLD", 
        "见证伙伴第一次形态进化", 1, null),
    ALL_SKILLS_UNLOCKED("ACH_ALL_SKILLS", "全知全能", "PLATINUM", 
        "解锁伙伴全部技能", 1, 50),
    EARLY_BIRD("ACH_EARLY_BIRD", "晨型学习者", "SILVER", 
        "在早上7点前与伙伴学习5次", 5, null),
    NIGHT_OWL_FORBIDDEN("ACH_NIGHT_OWL", "夜猫注意", "BRONZE", 
        "在晚上10点后被伙伴提醒休息3次", 3, null);
    
    private final String id;
    private final String displayName;
    private final String tier;
    private final String description;
    private final int targetCount;
    private final Integer requiredLevel;
    
    // constructor, getters...
}
```

### 8.2 成就检测服务

```java
@Service
@Slf4j
public class CompanionAchievementService {
    
    @Autowired private CompanionAchievementMapper achievementMapper;
    @Autowired private CompanionInstanceMapper instanceMapper;
    @Autowired private CompanionSkillStateMapper skillStateMapper;
    
    /**
     * 检测并解锁成就
     * 触发时机: 升级后、每日定时、特定事件后
     */
    public void checkCompanionAchievements(Long userId, Long companionId, int currentLevel) {
        for (CompanionAchievement ach : CompanionAchievement.values()) {
            // 已解锁则跳过
            if (hasAchievement(companionId, ach.getId())) {
                continue;
            }
            
            Boolean unlocked = switch (ach.getId()) {
                case "ACH_LEVEL_10", "ACH_LEVEL_30", 
                     "ACH_LEVEL_50", "ACH_LEVEL_100" 
                    -> checkLevelAchievement(companionId, ach, currentLevel);
                    
                case "ACH_FIRST_MEETING", "ACH_FIRST_TALK" 
                    -> checkBeginnerAchievement(companionId, ach);
                    
                case "ACH_7DAY_STREAK", "ACH_30DAY_STREAK", 
                     "ACH_100DAY_STREAK" 
                    -> checkStreakAchievement(userId, ach);
                    
                case "ACH_FIRST_EVOLUTION" 
                    -> checkEvolutionAchievement(companionId, ach);
                    
                case "ACH_ALL_SKILLS" 
                    -> checkAllSkillsAchievement(companionId, ach);
                    
                default -> checkProgressAchievement(userId, companionId, ach);
            };
            
            if (Boolean.TRUE.equals(unlocked)) {
                unlockAchievement(userId, companionId, ach);
            }
        }
    }
    
    @Transactional
    void unlockAchievement(Long userId, Long companionId, CompanionAchievement ach) {
        CompanionAchievementRecord record = CompanionAchievementRecord.builder()
            .companionId(companionId)
            .userId(userId)
            .achievementId(ach.getId())
            .achievementName(ach.getDisplayName())
            .achievementTier(ach.getTier())
            .unlockedCondition(JSON.toJSONString(Map.of(
                "level", instanceMapper.selectById(companionId).getCurrentLevel(),
                "timestamp", LocalDateTime.now().toString()
            )))
            .build();
        achievementMapper.insert(record);
        
        log.info("伙伴成就解锁: userId={}, companionId={}, achievement={}",
            userId, companionId, ach.getDisplayName());
        
        // 成就解锁触发事件（可用于推送通知、增加亲密度等）
        eventPublisher.publishEvent(new CompanionAchievementUnlockedEvent(
            userId, companionId, ach));
    }
}
```

---

## 9. API接口设计

### 9.1 伙伴状态查询

```
GET /api/v1/companion/status
Authorization: Bearer {token}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "companionId": 100001,
    "companionName": "小启",
    "companionType": "owl",
    "currentForm": 2,
    "formName": "成长体",
    "currentLevel": 15,
    "totalXp": 12450,
    "levelProgress": {
      "currentXp": 3400,
      "nextLevelXp": 5000,
      "percentage": 0.68
    },
    "mood": {
      "intimacyScore": 72,
      "moodValue": "HAPPY",
      "moodIntensity": 0.75,
      "energyValue": 90
    },
    "todayXp": {
      "gained": 120,
      "remaining": 380,
      "breakdown": {
        "PRACTICE": 60,
        "STUDY": 40,
        "REVIEW": 20
      }
    },
    "nextMilestone": {
      "type": "EVOLUTION",
      "level": 20,
      "description": "进化为成熟体",
      "requirements": ["连续学习7天", "完成首次错题复习"]
    }
  }
}
```

### 9.2 技能树查询

```
GET /api/v1/companion/skills
Authorization: Bearer {token}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "groups": [
      {
        "category": "TUTORING",
        "categoryName": "辅导能力",
        "skills": [
          {
            "skillId": "skill_math_hint",
            "skillName": "数学解题提示增强",
            "unlockLevel": 5,
            "status": "ACTIVE",
            "unlockedAt": "2026-06-15T10:30:00",
            "description": "伙伴在数学题中能给出更精准的思路引导"
          },
          {
            "skillId": "skill_chinese_lit",
            "skillName": "语文文学素养",
            "unlockLevel": 8,
            "status": "ACTIVE",
            "unlockedAt": "2026-06-20T14:00:00",
            "description": "伙伴能引用诗词典故进行讲解"
          },
          {
            "skillId": "skill_physics_viz",
            "skillName": "物理图示辅助",
            "unlockLevel": 15,
            "status": "ACTIVE",
            "unlockedAt": "2026-07-01T09:00:00"
          },
          {
            "skillId": "skill_exam_coach",
            "skillName": "考试策略辅导",
            "unlockLevel": 35,
            "status": "LOCKED",
            "description": "还需达到35级"
          }
        ]
      }
    ],
    "summary": {
      "totalSkills": 15,
      "unlockedCount": 6,
      "availableCount": 0
    }
  }
}
```

### 9.3 XP获取通知（WebSocket推送）

```json
{
  "type": "COMPANION_XP",
  "data": {
    "xpGained": 15,
    "rule": "XP_ANSWER_CORRECT",
    "qualityScore": 1.20,
    "totalXp": 12465,
    "levelProgress": {
      "currentXp": 3415,
      "nextLevelXp": 5000,
      "percentage": 0.683
    },
    "companionExpression": "happy",
    "companionMessage": "又做对了一道题！我的经验又涨了～"
  }
}
```

### 9.4 升级/进化通知（WebSocket推送）

```json
{
  "type": "COMPANION_LEVEL_UP",
  "data": {
    "oldLevel": 9,
    "newLevel": 10,
    "leveledUp": true,
    "formEvolution": true,
    "evolutionInfo": {
      "fromForm": 1,
      "toForm": 2,
      "fromFormName": "幼体",
      "toFormName": "成长体",
      "evolutionAnimationUrl": "https://cdn.primetop.com/evolution/1-to-2.json",
      "isNewLook": true
    },
    "unlockedSkills": [
      {
        "skillId": "skill_english_conv",
        "skillName": "英语对话能力",
        "description": "伙伴现在可以用英语和你对话啦！"
      }
    ],
    "intimacyBonus": 5,
    "companionMessage": "哇！我进化了！感觉变得更厉害了，谢谢你陪我一起成长！"
  }
}
```

### 9.5 进化确认

```
POST /api/v1/companion/evolution/confirm
Authorization: Bearer {token}
Content-Type: application/json

{
  "evolutionId": "evo_20260712_001"
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "success": true,
    "newForm": 2,
    "newFormName": "成长体",
    "unlockedFeatures": ["skill_english_conv"],
    "rewardXp": 0,
    "rewardIntimacy": 10
  }
}
```

### 9.6 成就列表

```
GET /api/v1/companion/achievements?page=1&size=20
Authorization: Bearer {token}
```

### 9.7 伙伴排行榜（好友范围）

```
GET /api/v1/companion/leaderboard?type=level&scope=friends&limit=20
Authorization: Bearer {token}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "myRank": 3,
    "total": 15,
    "entries": [
      {
        "userId": 10086,
        "nickname": "小明",
        "avatar": "url",
        "companionName": "智慧鸟",
        "companionType": "owl",
        "companionForm": 3,
        "level": 28,
        "totalXp": 35000
      }
    ]
  }
}
```

### 9.8 错误码定义

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| COMPANION_NOT_FOUND | 404 | 伙伴实例不存在 |
| COMPANION_NOT_INITIALIZED | 400 | 用户尚未创建伙伴 |
| XP_CAP_REACHED | 200 | 每日XP已达上限（非错误，正常返回） |
| EVOLUTION_REQUIREMENT_NOT_MET | 400 | 未满足进化前置条件 |
| EVOLUTION_ALREADY_DONE | 400 | 已进化到该形态 |
| SKILL_ALREADY_UNLOCKED | 400 | 技能已解锁 |
| SKILL_LEVEL_NOT_ENOUGH | 403 | 等级不足，无法解锁技能 |
| COMPANION_NAME_TOO_LONG | 400 | 伙伴昵称超长（最多64字符） |
| COMPANION_NAME_INVALID | 400 | 伙伴昵称包含敏感词 |

---

## 10. 事件驱动集成

### 10.1 事件监听架构

伙伴成长引擎需要监听来自各业务模块的事件：

```java
/**
 * 伙伴成长事件监听器
 * 监听各业务模块发出的学习行为事件，转化为伙伴XP
 */
@Component
@Slf4j
public class CompanionEventListener {
    
    @Autowired private CompanionXpService xpService;
    @Autowired private CompanionMoodService moodService;
    
    /** 答题事件 */
    @EventListener
    @Async("companionEventExecutor")
    public void onAnswerSubmitted(AnswerSubmittedEvent event) {
        if (event.isCorrect()) {
            xpService.processLearningEvent(LearningEvent.builder()
                .userId(event.getUserId())
                .eventType("ANSWER_CORRECT")
                .eventCategory("PRACTICE")
                .eventRefId(event.getAnswerRecordId())
                .context(LearningEventContext.builder()
                    .questionDifficulty(event.getDifficulty())
                    .studentAbility(event.getStudentAbility())
                    .actualDurationSec(event.getDurationSec())
                    .expectedDurationSec(event.getExpectedDurationSec())
                    .recentAccuracyTrend(event.getRecentAccuracy())
                    .isNewKnowledgePoint(event.isNewKnowledgePoint())
                    .build())
                .build());
        } else if (event.hasAttempt()) {
            // 认真作答但错了也给少量经验
            xpService.processLearningEvent(LearningEvent.builder()
                .userId(event.getUserId())
                .eventType("ANSWER_WRONG")
                .eventCategory("PRACTICE")
                .build());
        }
    }
    
    /** 错题复习完成事件 */
    @EventListener
    @Async("companionEventExecutor")
    public void onReviewComplete(ReviewCompleteEvent event) {
        xpService.processLearningEvent(LearningEvent.builder()
            .userId(event.getUserId())
            .eventType("REVIEW_COMPLETE")
            .eventCategory("REVIEW")
            .eventRefId(event.getReviewId())
            .context(LearningEventContext.builder()
                .hasReflectionNote(event.hasReflectionNote())
                .build())
            .build());
    }
    
    /** 每日打卡事件 */
    @EventListener
    @Async("companionEventExecutor")
    public void onDailyCheckin(DailyCheckinEvent event) {
        xpService.processLearningEvent(LearningEvent.builder()
            .userId(event.getUserId())
            .eventType("DAILY_CHECKIN")
            .eventCategory("STUDY")
            .eventRefId(event.getCheckinId())
            .build());
        
        // 更新连续学习天数
        moodService.updateConsecutiveDays(event.getUserId());
    }
    
    /** 学习计划完成事件 */
    @EventListener
    @Async("companionEventExecutor")
    public void onPlanComplete(StudyPlanCompleteEvent event) {
        xpService.processLearningEvent(LearningEvent.builder()
            .userId(event.getUserId())
            .eventType("PLAN_FINISHED")
            .eventCategory("STUDY")
            .build());
        
        moodService.increaseIntimacy(event.getUserId(), 
            null, "STUDY_PLAN_COMPLETE", 3);
    }
    
    /** 连续学习里程碑 */
    @EventListener
    @Async("companionEventExecutor")
    public void onStreakMilestone(StreakMilestoneEvent event) {
        String ruleCode = switch (event.getDays()) {
            case 7 -> "XP_STREAK_7";
            case 30 -> "XP_STREAK_30";
            default -> null;
        };
        
        if (ruleCode != null) {
            xpService.processLearningEvent(LearningEvent.builder()
                .userId(event.getUserId())
                .eventType("STREAK_" + event.getDays() + "_DAYS")
                .eventCategory("SPECIAL")
                .build());
        }
    }
}
```

### 10.2 事件主题与消息队列

```yaml
# Kafka Topic 配置
companion.xp.request:
  partitions: 6
  replication: 2
  consumers: companion-xp-consumer-group
  
companion.evolution.event:
  partitions: 3
  replication: 2
  consumers: 
    - companion-notification-consumer
    - companion-achievement-consumer
    - client-push-consumer

companion.mood.update:
  partitions: 3
  replication: 2
```

---

## 11. 客户端数据同步

### 11.1 首次加载策略

```dart
// Flutter 客户端伪代码
class CompanionService {
  
  /// 初始化伙伴数据
  Future<CompanionStatus> initCompanion() async {
    // 1. 先读本地缓存
    final cached = await _localCache.get('companion_status');
    if (cached != null) {
      // 后台异步刷新
      _refreshCompanionStatus();
      return cached;
    }
    
    // 2. 无缓存则请求服务端
    final response = await _api.get('/companion/status');
    final status = CompanionStatus.fromJson(response.data);
    
    // 3. 缓存到本地
    await _localCache.set('companion_status', status);
    
    return status;
  }
  
  /// WebSocket监听XP变化
  void _setupWebSocketListener() {
    _webSocket.on('COMPANION_XP', (data) {
      final xpData = CompanionXpUpdate.fromJson(data);
      
      // 更新内存中的等级进度
      _status.levelProgress = xpData.levelProgress;
      
      // 显示XP浮动动画
      _animationController.showXpGain(
        xp: xpData.xpGained,
        message: xpData.companionMessage,
        expression: xpData.companionExpression,
      );
    });
    
    _webSocket.on('COMPANION_LEVEL_UP', (data) {
      final levelUp = CompanionLevelUp.fromJson(data);
      
      if (levelUp.formEvolution) {
        // 形态进化 → 全屏动画
        _navigationService.showEvolutionAnimation(levelUp.evolutionInfo);
      } else {
        // 普通升级 → 庆祝弹窗
        _navigationService.showLevelUpCelebration(levelUp);
      }
      
      // 技能解锁通知
      if (levelUp.unlockedSkills.isNotEmpty) {
        _navigationService.showSkillUnlockDialog(levelUp.unlockedSkills);
      }
    });
  }
}
```

### 11.2 离线处理与补偿

```dart
class CompanionOfflineHandler {
  
  /// 离线期间的行为记录，恢复后批量提交
  final Queue<OfflineLearningEvent> _offlineEvents = Queue();
  
  void recordOfflineEvent(LearningEvent event) {
    _offlineEvents.add(OfflineLearningEvent(
      event: event,
      timestamp: DateTime.now(),
    ));
  }
  
  /// 网络恢复后批量同步
  Future<void> syncOfflineEvents() async {
    if (_offlineEvents.isEmpty) return;
    
    final batch = _offlineEvents.toList();
    _offlineEvents.clear();
    
    try {
      await _api.post('/companion/xp/batch', body: {
        'events': batch.map((e) => e.toJson()).toList(),
      });
    } catch (e) {
      // 失败重新入队
      _offlineEvents.addAll(batch);
    }
  }
}
```

---

## 12. 错误处理与降级

### 12.1 异常处理矩阵

| 场景 | 异常类型 | 处理策略 |
| --- | --- | --- |
| XP计算失败 | 数据库写入异常 | 事件重试队列，最多3次，超出后告警 |
| 升级过程异常 | 事务回滚 | XP回滚至升级前，记录告警日志 |
| Redis不可用 | 缓存失效 | 降级到数据库查询，限流保护 |
| 技能解锁失败 | 部分失败 | 失败的技能标记为PENDING，定时补偿 |
| 进化动画未播放 | 客户端超时 | 进化状态保持READY，允许重新触发 |
| WebSocket断连 | 消息丢失 | 客户端重连后拉取增量状态 |
| 并发XP请求 | 竞态条件 | Redis分布式锁 + 数据库乐观锁 |

### 12.2 关键异常处理代码

```java
/**
 * XP计算失败补偿
 */
@Component
@Slf4j
public class CompanionXpCompensation {
    
    @Autowired private CompanionXpService xpService;
    @Autowired private FailedEventRepository failedEventRepo;
    
    /** 失败事件重试（定时任务，每5分钟） */
    @Scheduled(fixedDelay = 300_000)
    public void retryFailedXpEvents() {
        List<FailedLearningEvent> failed = failedEventRepo
            .findRetryable(Status.PENDING, 3); // maxRetry=3
        
        for (FailedLearningEvent fe : failed) {
            try {
                xpService.processLearningEvent(fe.getEvent());
                fe.markResolved();
            } catch (Exception e) {
                fe.incrementRetry();
                if (fe.getRetryCount() >= 3) {
                    fe.markAbandoned();
                    log.error("XP事件重试3次仍失败，放弃: {}", fe, e);
                    // 告警通知
                    alertService.sendCompanionXpFailureAlert(fe);
                }
            }
            failedEventRepo.save(fe);
        }
    }
}

/**
 * 并发安全：分布式锁
 */
@Aspect
@Component
public class CompanionXpLockAspect {
    
    @Autowired private RedisLock redisLock;
    
    @Around("@annotation(xpProcess) && args(event,..)")
    public Object withLock(ProceedingJoinPoint pjp, 
                           CompanionXpProcess xpProcess,
                           LearningEvent event) throws Throwable {
        String lockKey = "lock:companion:xp:" + event.getUserId();
        
        return redisLock.executeWithLock(lockKey, 5, TimeUnit.SECONDS, () -> {
            try {
                return pjp.proceed();
            } catch (Throwable e) {
                throw new RuntimeException("XP处理失败", e);
            }
        });
    }
}
```

---

## 13. 性能优化

### 13.1 批量与异步处理

| 操作 | 同步/异步 | 说明 |
| --- | --- | --- |
| XP计算与入账 | 异步 | 消息队列消费，不阻塞主业务流程 |
| 等级状态更新 | 同步（事务内） | 保证数据一致性 |
| 技能解锁 | 异步 | 升级事件触发后异步处理 |
| 成就检测 | 异步 | 定时批量+事件触发 |
| 推送通知 | 异步 | 通过WebSocket推送，失败容忍 |
| 亲密度更新 | 异步 | 非关键路径 |
| 排行榜更新 | 定时 | 每小时通过Redis ZSET计算 |

### 13.2 缓存策略

```
数据层级:
├── L1: 客户端内存缓存（伙伴状态，TTL: 会话内）
├── L2: 客户端磁盘缓存（持久化，下次启动加载）
├── L3: Redis（服务端热数据，活跃用户 TTL: 1h）
├── L4: MySQL（持久化存储）
└── L5: ClickHouse（XP流水分析查询）
```

### 13.3 分库分表策略

```sql
-- companion_xp_log 表数据量大，按月分表
-- 表名: companion_xp_log_202607, companion_xp_log_202608, ...

-- 分表路由规则
-- shardKey = userId % 4 + 月份
-- 或采用按时间分表 + 按userId取模二级分片

-- 归档策略: 超过6个月的XP流水归档到ClickHouse
-- companion_xp_log 仅保留最近6个月热数据
```

---

## 14. 安全与防作弊

### 14.1 异常行为检测

```java
/**
 * XP作弊检测器
 */
@Component
@Slf4j
public class XpAntiCheatDetector {
    
    /** 可疑行为阈值 */
    private static final int SUSPICIOUS_XP_PER_MIN = 100;  // 每分钟XP上限
    private static final int SUSPICIOUS_ANSWER_PER_MIN = 20; // 每分钟答题上限
    private static final double TOO_FAST_RATIO = 0.3;       // 答题过快比率阈值
    
    /**
     * 检测可疑XP获取行为
     */
    public CheatCheckResult check(Long userId, LearningEvent event) {
        // 1. 频率检测
        int recentXp = getXpInLastMinute(userId);
        if (recentXp > SUSPICIOUS_XP_PER_MIN) {
            log.warn("可疑高频XP: userId={}, lastMinXp={}", userId, recentXp);
            return CheatCheckResult.blocked("XP获取频率异常");
        }
        
        // 2. 答题速度检测
        if ("ANSWER_CORRECT".equals(event.getEventType())) {
            double timeRatio = event.getContext().getActualDurationSec() 
                / event.getContext().getExpectedDurationSec();
            if (timeRatio < TOO_FAST_RATIO) {
                // 降级XP：仅给基础XP的50%
                log.info("答题过快降级XP: userId={}, ratio={}", userId, timeRatio);
                return CheatCheckResult.degraded(0.5);
            }
        }
        
        // 3. 模式检测：同一知识点重复刷题
        if (isRepeatedSameQuestion(userId, event)) {
            return CheatCheckResult.blocked("重复答题");
        }
        
        return CheatCheckResult.ok();
    }
}
```

### 14.2 管理后台审计

- 管理后台可查看任意用户的伙伴成长轨迹和XP流水
- 异常升级（短时间大量XP）自动标记审查
- 管理员可手动调整等级和XP（需审计日志）
- 成就和称号可手动发放（用于活动奖励）

---

## 15. 测试策略

### 15.1 单元测试

```java
class LevelCurveUtilTest {
    
    @Test
    @DisplayName("等级曲线单调递增")
    void xpThresholdShouldBeMonotonicallyIncreasing() {
        long prev = 0;
        for (int level = 2; level <= 100; level++) {
            long current = LevelCurveUtil.getXpThresholdForLevel(level);
            assertTrue(current > prev, 
                "等级 " + level + " 的XP阈值应大于上一级");
            prev = current;
        }
    }
    
    @Test
    @DisplayName("1-10级升级所需总XP在合理范围")
    void earlyGameShouldBeAchievable() {
        long totalXpForLevel10 = LongStream.rangeClosed(2, 10)
            .map(LevelCurveUtil::getXpThresholdForLevel)
            .sum();
        // 1-10级总XP应在 3000-6000 范围（约2-3周日常学习可达成）
        assertTrue(totalXpForLevel10 >= 3000 && totalXpForLevel10 <= 6000,
            "1-10级总XP: " + totalXpForLevel10);
    }
}

class CompanionXpServiceTest {
    
    @Test
    @DisplayName("答对题目应获得XP，质量分影响最终XP")
    void shouldGainXpWithQualityWeighting() {
        // Given
        LearningEvent event = LearningEvent.builder()
            .userId(1L).companionId(1L)
            .eventType("ANSWER_CORRECT").eventCategory("PRACTICE")
            .context(ctx -> ctx.questionDifficulty(0.6).studentAbility(0.5)
                .actualDurationSec(120).expectedDurationSec(100)
                .recentAccuracyTrend(0.8).isNewKnowledgePoint(true))
            .build();
        
        // When
        XpGainResult result = xpService.processLearningEvent(event);
        
        // Then: 基础10 × 倍率1.0 × 质量分(>1.0) > 10
        assertTrue(result.getXpGained() >= 10);
        assertTrue(result.getQualityScore().doubleValue() > 1.0);
    }
    
    @Test
    @DisplayName("每日XP上限应被正确执行")
    void dailyXpCapShouldBeEnforced() {
        // 连续答题直到达到上限
        for (int i = 0; i < 30; i++) {
            XpGainResult result = xpService.processLearningEvent(
                createCorrectAnswerEvent(userId));
            if (result.isCapped()) {
                // 第21题左右应触发上限（10XP × 20题 = 200XP = PRACTICE上限）
                assertTrue(i >= 19);
                return;
            }
        }
        fail("应触发每日上限");
    }
    
    @Test
    @DisplayName("升级应正确触发技能解锁")
    void levelUpShouldUnlockSkills() {
        // 升到5级应解锁数学解题提示增强
        setupCompanionAtLevel(4, 99999); // 差1XP升级
        xpService.processLearningEvent(
            createCorrectAnswerEvent(userId)); // 获得10XP，升级
        
        CompanionSkillState skill = skillMapper.selectByCompanionAndSkill(
            companionId, "skill_math_hint");
        assertEquals("UNLOCKED", skill.getUnlockStatus());
    }
}
```

### 15.2 集成测试场景

| 场景 | 步骤 | 预期结果 |
| --- | --- | --- |
| 新用户首次互动 | 注册→创建伙伴→第一次答题→答对 | 伙伴创建，获得XP，触发FIRST_MEETING成就 |
| 正常升级流程 | Lv4差1XP→答题正确→升到Lv5 | XP入账，升级到5，技能解锁，通知推送 |
| 形态进化 | Lv9差1XP→答题正确→升到Lv10→满足进化条件 | 进化动画触发，形态变为2，亲密度+10 |
| 每日XP上限 | 同一天内持续答题 | 达到上限后返回capped状态 |
| 离线补偿 | 断网答题→恢复网络→批量同步 | 离线期间XP正确补发 |
| 并发安全 | 同一用户同时提交多个答题 | XP不丢失，不重复，等级正确 |
| 连续学习断签 | 连续6天学习→第7天未学习→第8天回来 | 连续天数重置为1，伙伴心情变为SAD |

---

## 16. 监控与告警

### 16.1 核心监控指标

| 指标 | 类型 | 说明 |
| --- | --- | --- |
| companion.xp.daily_avg | Gauge | 日均XP发放量 |
| companion.levelup.count | Counter | 每日升级次数 |
| companion.evolution.count | Counter | 每日进化次数 |
| companion.skill.unlock.count | Counter | 每日技能解锁数 |
| companion.xp.process.latency | Histogram | XP处理延迟 |
| companion.xp.fail.rate | Gauge | XP处理失败率 |
| companion.intimacy.avg | Gauge | 全平台平均亲密度 |
| companion.cheat.block.count | Counter | 每日反作弊拦截次数 |

### 16.2 告警规则

```yaml
# Prometheus Alert Rules
groups:
  - name: companion
    rules:
      - alert: CompanionXpProcessFailRateHigh
        expr: rate(companion_xp_fail_total[5m]) / rate(companion_xp_process_total[5m]) > 0.05
        for: 5m
        annotations:
          summary: "XP处理失败率超过5%"
          
      - alert: CompanionLevelUpAnomaly
        expr: increase(companion_levelup_count[1h]) > 10000
        for: 5m
        annotations:
          summary: "1小时内升级次数异常(>10000)"
          
      - alert: CompanionXpProcessLatencyHigh
        expr: histogram_quantile(0.99, companion_xp_process_latency_seconds_bucket) > 2
        for: 5m
        annotations:
          summary: "XP处理P99延迟超过2秒"
```

---

## 17. 版本演进规划

| 版本 | 功能 | 优先级 |
| --- | --- | --- |
| v1.0 | 基础等级体系+XP计算+技能解锁 | P1 |
| v1.1 | 形态进化+亲密度系统+心情系统 | P1 |
| v1.2 | 成就系统+排行榜+进化动画 | P1 |
| v2.0 | 伙伴社交互动（好友间伙伴互访） | P2 |
| v2.1 | 伙伴皮肤系统+装扮商城（增值服务） | P2 |
| v2.2 | 伙伴个性化对话风格深度联动 | P2 |
| v3.0 | 跨用户伙伴协作任务 | P3 |

---

## 18. 附录

### 18.1 形态视觉参考

| 形态 | 视觉关键词 | 配色方案参考 |
| --- | --- | --- |
| 幼体 | Q版、圆润、大眼、小翅膀/短尾巴 | 柔粉、浅蓝、嫩绿 |
| 成长体 | 线条清晰、有标志性配饰、翅膀展开 | 明亮蓝、暖黄、清绿 |
| 成熟体 | 精致细节、专属配色、轻微特效 | 深蓝、金色、紫色 |
| 终极体 | 华丽装饰、动态光效、专属粒子 | 星空蓝、铂金、彩虹渐变 |

### 18.2 伙伴原型选项

| companion_type | 名称 | 适合学段 | 性格设定 |
| --- | --- | --- | --- |
| owl | 智慧猫头鹰 | 全学段 | 知性、温和、博学 |
| fox | 聪明小狐狸 | 小学为主 | 机灵、好动、爱挑战 |
| dragon | 龙学霸 | 初高中 | 威严但不失温暖、分析型 |
| robot | AI小助手 | 全学段 | 理性、数据化、高效 |

### 18.3 相关文档索引

| 文档 | 关系 |
| --- | --- |
| 服务端-学生AI学习伙伴角色个性化与对话风格自适应引擎 | 本模块的对话风格数据由该引擎消费 |
| 服务端-学生AI学习伙伴长期记忆库与跨会话关系建构引擎 | 亲密度数据接入记忆库形成情感记忆 |
| 服务端-学生AI学习伙伴主动对话触发与智能关怀策略引擎 | 伙伴心情状态影响主动对话策略 |
| 客户端-AI学习伙伴虚拟形象与动画交互引擎 | 客户端渲染进化动画和形态展示 |
| 服务端-学习打卡记录与成就解锁计算引擎 | 全局成就系统的伙伴子集由本模块管理 |
| 积分与虚拟经济体系-详细设计 | XP与积分系统平行但独立，可互相兑换 |
| 学习习惯养成与打卡系统-详细设计 | 连续学习天数数据来源 |

---

*文档版本: v1.0 | 创建日期: 2026-07-12 | 作者: PrimeTop设计细化助手*
