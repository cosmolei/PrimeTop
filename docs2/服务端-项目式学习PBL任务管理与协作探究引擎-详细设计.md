# 服务端 - 项目式学习(PBL)任务管理与协作探究引擎 详细设计

## 1. 概述

### 1.1 模块定位

项目式学习（Project-Based Learning, PBL）任务管理与协作探究引擎是 PrimeTop 平台中支持跨学科、长周期、探究式学习场景的核心服务。与传统作业管理（单题提交、即时批改）不同，PBL 强调**以真实问题为驱动、以学生主动探究为主线、以成果产出为终点**，周期通常为 3天～4周，涉及资料搜集、实验探究、团队协作、成果制作和展示反思等环节。

本引擎为 PBL 场景提供从项目创建、任务分解、角色分工、过程追踪、资源管理到成果评价的全生命周期管理能力。

### 1.2 核心职责

| 职责 | 说明 |
| --- | --- |
| 项目模板管理 | 预置与自定义 PBL 项目模板，支持学科标签、适用学段、难度分级 |
| 项目实例创建 | 从模板派生或自由创建项目实例，设置周期、目标与评价标准 |
| 任务分解与里程碑 | 将项目拆解为多级任务和阶段性里程碑，支持依赖关系 |
| 角色分工与协作 | 支持个人/小组模式，组内角色分配（组长、研究员、记录员、展示者等） |
| 过程记录与日志 | 学生提交探究日志、实验记录、阶段性成果 |
| 资源管理 | 管理项目相关文档、图片、视频、链接等素材 |
| 教师指导与反馈 | 教师/家长/AI 辅导在各阶段提供指导和形成性反馈 |
| 成果评价 | 多维度评价（自评、互评、师评、AI评），含过程性+结果性评价 |
| 成果展示与归档 | 支持成果作品展示、班级/年级分享、学期归档 |

### 1.3 依赖关系

```
PBL 引擎
├── 用户服务 (学生/教师/家长身份)
├── 班级服务 (小组组建、成员查询)
├── 内容服务 (学科知识点关联、教材章节映射)
├── AI 辅导服务 (AI 指导建议、AI 评价)
├── 文件存储服务 (资源上传与管理)
├── 通知服务 (任务提醒、里程碑到期通知)
├── 学情分析服务 (PBL 学习行为数据回流)
└── 审核服务 (学生上传内容安全审核)
```

---

## 2. 数据模型

### 2.1 核心实体 ER 关系

```
ProjectTemplate 1───< ProjectInstance >───── 1 Group
                         │                       │
                         │                       │
              ┌──────────┴──────────┐      ┌────┴────┐
              │                     │      │         │
        Milestone              ProjectLog   GroupMember
              │                  (探究日志)
              │
         Task (任务)
              │
         Submission (提交物)
              │
         Evaluation (评价)
```

### 2.2 数据库表结构

#### 2.2.1 `pbl_project_template` — 项目模板

```sql
CREATE TABLE pbl_project_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    title           VARCHAR(200) NOT NULL COMMENT '模板标题',
    subtitle        VARCHAR(500) COMMENT '副标题/简介',
    cover_image_url VARCHAR(500) COMMENT '封面图URL',
    
    -- 适用范围
    subject_ids     JSON NOT NULL COMMENT '关联学科ID列表, 如[1,3]表示语文+英语跨学科',
    stage_min       TINYINT NOT NULL COMMENT '最低学段: 1幼 2小 3初 4高',
    stage_max       TINYINT NOT NULL COMMENT '最高学段',
    grade_min       TINYINT COMMENT '最低年级(1-12)',
    grade_max       TINYINT COMMENT '最高年级',
    difficulty      TINYINT NOT NULL DEFAULT 2 COMMENT '难度: 1入门 2标准 3挑战 4竞赛',
    
    -- 项目结构
    driving_question VARCHAR(1000) NOT NULL COMMENT '驱动性问题, 如: 我们如何设计一个节能的校园?',
    description     TEXT NOT NULL COMMENT '项目详细描述',
    learning_goals  JSON NOT NULL COMMENT '学习目标, ["理解能量转换原理","培养团队协作"]',
    knowledge_points JSON COMMENT '关联知识点ID列表',
    estimated_hours INT NOT NULL DEFAULT 10 COMMENT '预计总学时(小时)',
    estimated_days  INT NOT NULL DEFAULT 7 COMMENT '预计周期(天)',
    
    -- 评价配置
    rubric_template JSON COMMENT '评价量规模板',
    
    -- 状态
    status          TINYINT NOT NULL DEFAULT 0 COMMENT '0草稿 1上架 2下架',
    source          TINYINT NOT NULL DEFAULT 0 COMMENT '0官方 1教研 2教师自建',
    creator_id      BIGINT NOT NULL,
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME NULL,
    
    INDEX idx_subject (subject_ids(64)),
    INDEX idx_stage_difficulty (stage_min, stage_max, difficulty),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL项目模板';
```

#### 2.2.2 `pbl_milestone_template` — 里程碑模板

```sql
CREATE TABLE pbl_milestone_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_id     BIGINT NOT NULL COMMENT '所属项目模板',
    seq             INT NOT NULL COMMENT '顺序序号(从1开始)',
    title           VARCHAR(200) NOT NULL COMMENT '里程碑标题',
    description     TEXT COMMENT '里程碑说明',
    milestone_type  TINYINT NOT NULL COMMENT '1启动 2调研 3设计 4实施 5展示 6反思',
    guidance        TEXT COMMENT 'AI指导Prompt线索',
    deliverable_desc VARCHAR(1000) COMMENT '阶段性成果要求描述',
    estimated_hours INT COMMENT '本阶段预计学时',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_template_seq (template_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL里程碑模板';
```

#### 2.2.3 `pbl_project_instance` — 项目实例

```sql
CREATE TABLE pbl_project_instance (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    template_id     BIGINT NULL COMMENT '来源模板ID(NULL表示自由创建)',
    title           VARCHAR(200) NOT NULL,
    class_id        BIGINT COMMENT '关联班级ID',
    
    -- 发起人
    teacher_id      BIGINT NOT NULL COMMENT '发起教师ID',
    school_id       BIGINT COMMENT '学校ID',
    
    -- 项目设置
    mode            TINYINT NOT NULL DEFAULT 1 COMMENT '1个人 2小组 3混合',
    group_size_min  INT DEFAULT 3 COMMENT '小组最少人数',
    group_size_max  INT DEFAULT 6 COMMENT '小组最多人数',
    
    -- 周期
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    
    -- 驱动性问题与目标
    driving_question VARCHAR(1000) NOT NULL,
    learning_goals  JSON NOT NULL,
    knowledge_points JSON COMMENT '关联知识点',
    
    -- 评价配置
    rubric          JSON COMMENT '评价量规(可覆盖模板)',
    enable_peer_eval TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用同伴互评',
    enable_self_eval TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用自评',
    enable_ai_eval   TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用AI评价',
    ai_eval_weight   DECIMAL(3,2) DEFAULT 0.20 COMMENT 'AI评价权重',
    teacher_eval_weight DECIMAL(3,2) DEFAULT 0.50 COMMENT '教师评价权重',
    peer_eval_weight  DECIMAL(3,2) DEFAULT 0.15 COMMENT '同伴互评权重',
    self_eval_weight  DECIMAL(3,2) DEFAULT 0.15 COMMENT '自评权重',
    
    -- 状态
    status          TINYINT NOT NULL DEFAULT 0 COMMENT '0待开始 1进行中 2待评审 3已完成 4已终止',
    current_milestone_id BIGINT COMMENT '当前里程碑ID',
    
    -- 配置
    allow_late_submit TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否允许补交',
    late_penalty     DECIMAL(3,2) DEFAULT 0.10 COMMENT '迟交扣分比例/天',
    require_ai_guidance TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用AI阶段指导',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_teacher (teacher_id),
    INDEX idx_class (class_id),
    INDEX idx_status (status),
    INDEX idx_dates (start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL项目实例';
```

#### 2.2.4 `pbl_milestone` — 项目里程碑

```sql
CREATE TABLE pbl_milestone (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL,
    seq             INT NOT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    milestone_type  TINYINT NOT NULL COMMENT '1启动 2调研 3设计 4实施 5展示 6反思',
    deliverable_desc VARCHAR(1000),
    
    -- 时间节点
    planned_start   DATE NOT NULL,
    planned_end     DATE NOT NULL,
    actual_end      DATE NULL COMMENT '实际完成日期',
    
    -- 状态
    status          TINYINT NOT NULL DEFAULT 0 COMMENT '0未开始 1进行中 2已提交 3已评审 4已跳过',
    
    -- AI指导
    ai_guidance_enabled TINYINT(1) NOT NULL DEFAULT 1,
    ai_guidance_prompt TEXT COMMENT 'AI指导线索',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_project_seq (project_id, seq),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL里程碑';
```

#### 2.2.5 `pbl_task` — 任务

```sql
CREATE TABLE pbl_task (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL,
    milestone_id    BIGINT NOT NULL,
    parent_task_id  BIGINT NULL COMMENT '父任务ID(支持二级分解)',
    seq             INT NOT NULL DEFAULT 0 COMMENT '排序',
    
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    task_type       TINYINT NOT NULL DEFAULT 0 COMMENT '0普通 1资料搜集 2实验 3写作 4制作 5调研 6展示准备',
    
    -- 负责人
    assignee_type   TINYINT NOT NULL DEFAULT 0 COMMENT '0全员 1指定角色 2指定成员',
    assigned_role   VARCHAR(50) COMMENT '指定角色名(如"研究员")',
    assigned_member_id BIGINT COMMENT '指定学生ID',
    
    -- 时间
    planned_end     DATE NOT NULL,
    actual_end      DATE NULL,
    
    -- 依赖
    depends_on      JSON COMMENT '依赖的任务ID列表',
    
    -- 状态
    status          TINYINT NOT NULL DEFAULT 0 COMMENT '0待开始 1进行中 2已完成 3已搁置',
    completion_pct  INT DEFAULT 0 COMMENT '完成度0-100',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_project (project_id),
    INDEX idx_milestone (milestone_id),
    INDEX idx_assignee (assigned_member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL任务';
```

#### 2.2.6 `pbl_group` — 项目小组

```sql
CREATE TABLE pbl_group (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL,
    group_name      VARCHAR(100) NOT NULL COMMENT '小组名称, 如"绿色校园先锋队"',
    group_no        INT NOT NULL COMMENT '组号',
    leader_id       BIGINT COMMENT '组长学生ID',
    slogan          VARCHAR(200) COMMENT '小组口号',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_project_groupno (project_id, group_no),
    INDEX idx_leader (leader_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL项目小组';
```

#### 2.2.7 `pbl_group_member` — 小组成员

```sql
CREATE TABLE pbl_group_member (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    group_id        BIGINT NOT NULL,
    student_id      BIGINT NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT '成员' COMMENT '角色: 组长/研究员/记录员/展示者/设计师/编辑',
    role_id         TINYINT COMMENT '角色枚举: 1组长 2研究员 3记录员 4展示者 5设计师 6编辑',
    joined_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at         DATETIME NULL COMMENT '退出时间',
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    
    UNIQUE KEY uk_group_student (group_id, student_id),
    INDEX idx_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL小组成员';
```

#### 2.2.8 `pbl_project_log` — 探究日志

```sql
CREATE TABLE pbl_project_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL,
    milestone_id    BIGINT COMMENT '关联里程碑',
    task_id         BIGINT COMMENT '关联任务',
    student_id      BIGINT NOT NULL COMMENT '记录人',
    group_id        BIGINT COMMENT '关联小组',
    
    log_type        TINYINT NOT NULL COMMENT '1调研记录 2实验记录 3讨论纪要 4学习反思 5困难记录 6灵感创意',
    title           VARCHAR(200) NOT NULL,
    content         TEXT NOT NULL COMMENT '日志内容(支持富文本)',
    
    -- 附件
    attachments     JSON COMMENT '附件列表 [{type:"image", url:"...", name:"..."}]',
    
    -- 关联
    knowledge_points JSON COMMENT '涉及知识点',
    
    -- AI辅助
    ai_feedback     TEXT COMMENT 'AI对日志的反馈(可选)',
    
    -- 教师
    teacher_comment TEXT COMMENT '教师批注',
    teacher_commented_by BIGINT COMMENT '批注教师ID',
    teacher_commented_at DATETIME,
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_project (project_id),
    INDEX idx_student (student_id),
    INDEX idx_milestone (milestone_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL探究日志';
```

#### 2.2.9 `pbl_submission` — 成果提交

```sql
CREATE TABLE pbl_submission (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL,
    milestone_id    BIGINT NOT NULL,
    group_id        BIGINT COMMENT '小组提交时关联',
    submitter_id    BIGINT NOT NULL COMMENT '提交人',
    
    submission_type TINYINT NOT NULL COMMENT '1文档 2演示文稿 3视频 4图片 5链接 6代码 7实物照片 8综合',
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    
    -- 内容
    content_urls    JSON NOT NULL COMMENT '成果文件URL列表',
    text_content    MEDIUMTEXT COMMENT '文本类成果正文',
    external_links  JSON COMMENT '外部链接列表',
    
    -- 提交元信息
    is_late         TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否迟交',
    late_days       INT DEFAULT 0 COMMENT '迟交天数',
    version         INT NOT NULL DEFAULT 1 COMMENT '版本号(支持修改后重新提交)',
    
    -- 状态
    status          TINYINT NOT NULL DEFAULT 0 COMMENT '0草稿 1已提交 2已评审 3需修改',
    
    -- AI初审
    ai初审_score    DECIMAL(5,2) COMMENT 'AI评分(0-100)',
    ai初审_feedback TEXT COMMENT 'AI初审反馈',
    ai初审_at       DATETIME,
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at    DATETIME NULL COMMENT '正式提交时间',
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_project_milestone (project_id, milestone_id),
    INDEX idx_group (group_id),
    INDEX idx_submitter (submitter_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL成果提交';
```

#### 2.2.10 `pbl_evaluation` — 评价记录

```sql
CREATE TABLE pbl_evaluation (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL,
    submission_id   BIGINT NOT NULL COMMENT '评价的提交物',
    
    -- 评价人
    evaluator_id    BIGINT NOT NULL,
    evaluator_type  TINYINT NOT NULL COMMENT '1教师 2学生(自评) 3学生(互评) 4AI 5家长',
    
    -- 评分明细
    scores          JSON NOT NULL COMMENT '各维度得分, {"内容质量":85,"创意":90,"协作":80,"表达":88}',
    total_score     DECIMAL(5,2) NOT NULL COMMENT '加权总分(0-100)',
    
    -- 文字评价
    strengths       TEXT COMMENT '优点',
    improvements    TEXT COMMENT '改进建议',
    overall_comment TEXT COMMENT '总体评语',
    
    -- 权重(运行时快照)
    weight          DECIMAL(3,2) NOT NULL COMMENT '本次评价在综合分中的权重',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_submission (submission_id),
    INDEX idx_project (project_id),
    INDEX idx_evaluator (evaluator_id, evaluator_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL评价记录';
```

#### 2.2.11 `pbl_project_resource` — 项目资源库

```sql
CREATE TABLE pbl_project_resource (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    project_id      BIGINT NOT NULL,
    uploader_id     BIGINT NOT NULL COMMENT '上传者',
    group_id        BIGINT COMMENT '所属小组(NULL为公共资源)',
    
    resource_type   TINYINT NOT NULL COMMENT '1文档 2图片 3视频 4音频 5链接 6数据集 7其他',
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    file_url        VARCHAR(500) NOT NULL,
    file_size       BIGINT COMMENT '文件大小(字节)',
    mime_type       VARCHAR(100),
    external_url    VARCHAR(500) COMMENT '外部链接',
    
    -- 分类标签
    category        VARCHAR(50) COMMENT '自定义分类',
    tags            JSON COMMENT '标签列表',
    
    -- 安全
    audit_status    TINYINT NOT NULL DEFAULT 0 COMMENT '0待审核 1通过 2拒绝',
    audited_at      DATETIME NULL,
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at      DATETIME NULL,
    
    INDEX idx_project (project_id),
    INDEX idx_group (group_id),
    INDEX idx_uploader (uploader_id),
    INDEX idx_audit (audit_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='PBL项目资源';
```

### 2.3 缓存策略

| 缓存键 | TTL | 说明 |
| --- | --- | --- |
| `pbl:project:{projectId}` | 30min | 项目实例详情 |
| `pbl:project:{projectId}:milestones` | 15min | 里程碑列表 |
| `pbl:project:{projectId}:groups` | 10min | 小组列表 |
| `pbl:group:{groupId}:members` | 10min | 小组成员 |
| `pbl:project:{projectId}:progress` | 5min | 整体进度快照 |
| `pbl:student:{studentId}:active_projects` | 5min | 学生进行中的项目列表 |
| `pbl:teacher:{teacherId}:projects` | 5min | 教师管理的项目列表 |

---

## 3. API 接口设计

### 3.1 接口总览

| 模块 | 接口 | 方法 | 路径 |
| --- | --- | --- | --- |
| 模板管理 | 获取模板列表 | GET | `/api/v1/pbl/templates` |
| 模板管理 | 获取模板详情 | GET | `/api/v1/pbl/templates/{id}` |
| 模板管理 | 创建模板(教师) | POST | `/api/v1/pbl/templates` |
| 项目管理 | 创建项目 | POST | `/api/v1/pbl/projects` |
| 项目管理 | 获取项目详情 | GET | `/api/v1/pbl/projects/{id}` |
| 项目管理 | 获取我的项目列表 | GET | `/api/v1/pbl/projects/mine` |
| 项目管理 | 更新项目状态 | PATCH | `/api/v1/pbl/projects/{id}/status` |
| 项目管理 | 终止项目 | POST | `/api/v1/pbl/projects/{id}/terminate` |
| 小组管理 | 创建小组 | POST | `/api/v1/pbl/projects/{id}/groups` |
| 小组管理 | 获取小组列表 | GET | `/api/v1/pbl/projects/{id}/groups` |
| 小组管理 | 加入小组 | POST | `/api/v1/pbl/groups/{id}/join` |
| 小组管理 | 退出小组 | POST | `/api/v1/pbl/groups/{id}/leave` |
| 小组管理 | 更新成员角色 | PATCH | `/api/v1/pbl/groups/{id}/members/{studentId}` |
| 里程碑 | 获取里程碑列表 | GET | `/api/v1/pbl/projects/{id}/milestones` |
| 里程碑 | 进入下一里程碑 | POST | `/api/v1/pbl/projects/{id}/milestones/next` |
| 任务管理 | 获取任务列表 | GET | `/api/v1/pbl/milestones/{id}/tasks` |
| 任务管理 | 创建/更新任务 | POST/PUT | `/api/v1/pbl/tasks` |
| 任务管理 | 更新任务状态 | PATCH | `/api/v1/pbl/tasks/{id}/status` |
| 探究日志 | 提交日志 | POST | `/api/v1/pbl/projects/{id}/logs` |
| 探究日志 | 获取日志列表 | GET | `/api/v1/pbl/projects/{id}/logs` |
| 探究日志 | 教师批注日志 | POST | `/api/v1/pbl/logs/{id}/comment` |
| 成果提交 | 提交成果 | POST | `/api/v1/pbl/milestones/{id}/submissions` |
| 成果提交 | 获取提交详情 | GET | `/api/v1/pbl/submissions/{id}` |
| 成果提交 | AI初审 | POST | `/api/v1/pbl/submissions/{id}/ai-review` |
| 评价管理 | 提交评价 | POST | `/api/v1/pbl/submissions/{id}/evaluations` |
| 评价管理 | 获取综合评价 | GET | `/api/v1/pbl/submissions/{id}/final-score` |
| 资源管理 | 上传资源 | POST | `/api/v1/pbl/projects/{id}/resources` |
| 资源管理 | 获取资源列表 | GET | `/api/v1/pbl/projects/{id}/resources` |
| 数据看板 | 获取项目进度概览 | GET | `/api/v1/pbl/projects/{id}/dashboard` |
| 数据看板 | 获取小组/个人贡献 | GET | `/api/v1/pbl/projects/{id}/contributions` |

### 3.2 核心 API 详细定义

#### 3.2.1 创建项目

```
POST /api/v1/pbl/projects
```

**请求体:**
```json
{
  "templateId": 101,
  "title": "设计节能校园——物理与地理跨学科项目",
  "classId": 2001,
  "mode": 2,
  "groupSizeMin": 4,
  "groupSizeMax": 6,
  "startDate": "2026-09-15",
  "endDate": "2026-10-13",
  "drivingQuestion": "我们如何利用物理和地理知识，为学校设计一个可行的节能改造方案？",
  "learningGoals": [
    "理解能量守恒与转换定律",
    "分析校园地理环境对日照/通风的影响",
    "培养团队协作与项目管理能力",
    "提升环保意识与可持续发展理念"
  ],
  "knowledgePointIds": [301, 302, 305, 410],
  "rubric": {
    "dimensions": [
      {"name": "科学准确性", "maxScore": 25, "desc": "物理原理和地理分析是否正确"},
      {"name": "方案可行性", "maxScore": 25, "desc": "节能方案是否可在校园实际应用"},
      {"name": "团队协作", "maxScore": 20, "desc": "分工合理，人人参与"},
      {"name": "展示表达", "maxScore": 15, "desc": "汇报清晰，数据可视化到位"},
      {"name": "创新创意", "maxScore": 15, "desc": "方案是否有独特见解"}
    ]
  },
  "enablePeerEval": true,
  "enableSelfEval": true,
  "enableAiEval": true,
  "aiEvalWeight": 0.20,
  "teacherEvalWeight": 0.50,
  "peerEvalWeight": 0.15,
  "selfEvalWeight": 0.15,
  "requireAiGuidance": true
}
```

**响应 (201 Created):**
```json
{
  "code": 0,
  "data": {
    "projectId": 5001,
    "title": "设计节能校园——物理与地理跨学科项目",
    "status": 0,
    "milestones": [
      {"id": 1, "seq": 1, "title": "项目启动与分组", "type": 1, "plannedStart": "2026-09-15", "plannedEnd": "2026-09-17", "status": 0},
      {"id": 2, "seq": 2, "title": "校园能耗调研", "type": 2, "plannedStart": "2026-09-18", "plannedEnd": "2026-09-24", "status": 0},
      {"id": 3, "seq": 3, "title": "节能方案设计", "type": 3, "plannedStart": "2026-09-25", "plannedEnd": "2026-10-03", "status": 0},
      {"id": 4, "seq": 4, "title": "方案实施与验证", "type": 4, "plannedStart": "2026-10-04", "plannedEnd": "2026-10-10", "status": 0},
      {"id": 5, "seq": 5, "title": "成果展示", "type": 5, "plannedStart": "2026-10-11", "plannedEnd": "2026-10-12", "status": 0},
      {"id": 6, "seq": 6, "title": "反思与总结", "type": 6, "plannedStart": "2026-10-13", "plannedEnd": "2026-10-13", "status": 0}
    ],
    "createdAt": "2026-09-14T10:30:00Z"
  }
}
```

#### 3.2.2 提交探究日志

```
POST /api/v1/pbl/projects/{projectId}/logs
```

**请求体:**
```json
{
  "milestoneId": 2,
  "taskId": 15,
  "groupId": 8,
  "logType": 2,
  "title": "教学楼A栋用电量实测数据",
  "content": "## 调研日期：2026-09-20\n\n### 数据记录\n我们在午休时间(12:00-13:00)测量了教学楼A栋3间教室的用电情况：\n\n| 教室 | 空调(W) | 照明(W) | 投影(W) | 总功率(W) |\n|------|---------|---------|---------|------------|\n| 301  | 1500    | 240     | 300     | 2040       |\n| 302  | 1500    | 240     | 0       | 1740       |\n| 303  | 0       | 240     | 300     | 540        |\n\n### 发现\n1. 空调是最大耗电设备\n2. 302教室无人但空调未关\n3. 午休时段照明全开存在浪费\n\n### 初步想法\n可以安装红外人体传感器，无人时自动断电。",
  "attachments": [
    {"type": "image", "url": "oss://pbl/5001/logs/meter-reading.jpg", "name": "电表读数照片"},
    {"type": "image", "url": "oss://pbl/5001/logs/classroom-layout.png", "name": "教室平面图"}
  ],
  "knowledgePoints": [301, 410]
}
```

**响应 (201 Created):**
```json
{
  "code": 0,
  "data": {
    "logId": 20086,
    "aiFeedback": "出色的数据采集工作！你发现了真实场景中的能源浪费问题，这很有价值。建议进一步思考：1) 不同时段的用电差异有多大？可以选取上午、中午、下午三个时段对比；2) 红外传感器的方案很实际，可以调研一下市场成本和节能效果预估。——期待你们的方案！",
    "createdAt": "2026-09-20T14:22:00Z"
  }
}
```

#### 3.2.3 提交成果

```
POST /api/v1/pbl/milestones/{milestoneId}/submissions
```

**请求体:**
```json
{
  "groupId": 8,
  "submissionType": 8,
  "title": "教学楼A栋节能改造方案",
  "description": "基于两周的实地调研和数据分析，我们提出了包含照明优化、智能控制、行为引导三方面的综合节能方案。",
  "contentUrls": [
    "oss://pbl/5001/submissions/energy-plan.pdf",
    "oss://pbl/5001/submissions/data-analysis.pptx",
    "oss://pbl/5001/submissions/cost-model.xlsx"
  ],
  "textContent": "## 方案概述\n\n...(完整方案正文)...",
  "externalLinks": [
    {"label": "节能效果仿真视频", "url": "https://example.com/sim-video"}
  ]
}
```

#### 3.2.4 提交评价

```
POST /api/v1/pbl/submissions/{submissionId}/evaluations
```

**请求体 (教师评价示例):**
```json
{
  "evaluatorType": 1,
  "scores": {
    "科学准确性": 23,
    "方案可行性": 22,
    "团队协作": 18,
    "展示表达": 14,
    "创新创意": 13
  },
  "totalScore": 90.0,
  "weight": 0.50,
  "strengths": "数据采集详实，分析逻辑清晰，红外传感器方案具有落地可行性。",
  "improvements": "成本回收周期计算偏乐观，建议参考更多实际案例数据。展示PPT可以增加对比图表。",
  "overallComment": "优秀的小组协作项目！方案既有科学依据又有实际操作性，展现了跨学科思维的威力。"
}
```

#### 3.2.5 获取项目进度看板

```
GET /api/v1/pbl/projects/{projectId}/dashboard
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "projectId": 5001,
    "title": "设计节能校园——物理与地理跨学科项目",
    "status": 1,
    "progress": {
      "overall": 62,
      "currentMilestone": {
        "id": 3,
        "title": "节能方案设计",
        "seq": 3,
        "type": 3,
        "daysRemaining": 4
      },
      "milestones": [
        {"id": 1, "title": "项目启动与分组", "status": 3, "completionPct": 100},
        {"id": 2, "title": "校园能耗调研", "status": 3, "completionPct": 100},
        {"id": 3, "title": "节能方案设计", "status": 1, "completionPct": 55},
        {"id": 4, "title": "方案实施与验证", "status": 0, "completionPct": 0},
        {"id": 5, "title": "成果展示", "status": 0, "completionPct": 0},
        {"id": 6, "title": "反思与总结", "status": 0, "completionPct": 0}
      ]
    },
    "groups": [
      {
        "groupId": 8,
        "groupName": "绿色校园先锋队",
        "leaderName": "张小明",
        "memberCount": 5,
        "taskCompletionRate": 0.65,
        "logCount": 14,
        "submissionCount": 2
      },
      {
        "groupId": 9,
        "groupName": "节能达人组",
        "leaderName": "李华",
        "memberCount": 5,
        "taskCompletionRate": 0.58,
        "logCount": 11,
        "submissionCount": 1
      }
    ],
    "alerts": [
      {"type": "late_task", "message": "第2组'数据可视化'任务已逾期2天", "severity": "warning"},
      {"type": "inactive_member", "message": "第3组'王五'已5天无活动记录", "severity": "info"}
    ]
  }
}
```

### 3.3 错误码定义

| 错误码 | HTTP状态码 | 说明 |
| --- | --- | --- |
| 30001 | 400 | 项目参数校验失败 |
| 30002 | 403 | 无权限操作该项目 |
| 30003 | 404 | 项目不存在 |
| 30004 | 409 | 项目状态不允许该操作 |
| 30005 | 400 | 小组人数超出限制 |
| 30006 | 409 | 学生已在其他小组 |
| 30007 | 400 | 里程碑尚未到达 |
| 30008 | 409 | 成果已提交且已评审，无法修改 |
| 30009 | 400 | 评价权重配置错误(总和不为1.0) |
| 30010 | 403 | 评价截止时间已过 |
| 30011 | 400 | 模板已被引用，无法删除 |
| 30012 | 400 | 任务依赖未完成 |
| 30013 | 429 | AI初审请求过于频繁(限流) |

---

## 4. 业务逻辑

### 4.1 项目状态流转图

```
                  ┌─────────────┐
     创建 ──────> │ 待开始(0)    │
                  └──────┬──────┘
                         │ 到达开始日期 / 手动启动
                         ▼
                  ┌─────────────┐
                  │ 进行中(1)    │ ◄──── 里程碑流转
                  └──────┬──────┘
                         │ 所有里程碑完成 + 成果提交
                         ▼
                  ┌─────────────┐
                  │ 待评审(2)    │
                  └──────┬──────┘
                         │ 教师完成评价
                         ▼
                  ┌─────────────┐
                  │ 已完成(3)    │ ──── 归档入库
                  └─────────────┘
                         │
                         │ 手动终止
                         ▼
                  ┌─────────────┐
                  │ 已终止(4)    │
                  └─────────────┘
```

### 4.2 里程碑流转逻辑

```java
public class MilestoneTransitionService {
    
    /**
     * 推进到下一里程碑
     * 条件：
     * 1. 当前里程碑所有必提交务已提交
     * 2. 当前里程碑状态为"已提交"或"已评审"
     * 3. 下一里程碑存在且状态为"未开始"
     */
    public Milestone advanceToNext(Long projectId) {
        ProjectInstance project = projectDao.getById(projectId);
        validateProjectInProgress(project);
        
        Milestone current = milestoneDao.getById(project.getCurrentMilestoneId());
        Milestone next = milestoneDao.findNext(projectId, current.getSeq());
        
        if (next == null) {
            throw new BusinessException(30004, "已是最后一个里程碑，请提交最终成果");
        }
        
        // 检查当前里程碑交付物
        List<Task> requiredTasks = taskDao.findByMilestone(current.getId());
        List<Task> incompleteTasks = requiredTasks.stream()
            .filter(t -> t.getStatus() != 2) // 未完成
            .collect(Collectors.toList());
        
        if (!incompleteTasks.isEmpty()) {
            String names = incompleteTasks.stream()
                .map(Task::getTitle)
                .collect(Collectors.joining(", "));
            throw new BusinessException(30012, 
                "当前里程碑存在未完成任务: " + names);
        }
        
        // 检查当前里程碑成果提交（若需要）
        if (current.getDeliverableDesc() != null) {
            List<Submission> submissions = submissionDao
                .findByMilestoneAndStatus(current.getId(), 1); // 已提交
            if (submissions.isEmpty()) {
                throw new BusinessException(30012, "请先提交本阶段成果");
            }
        }
        
        // 流转
        current.setStatus(3); // 已评审/已完成
        milestoneDao.update(current);
        
        next.setStatus(1); // 进行中
        milestoneDao.update(next);
        
        project.setCurrentMilestoneId(next.getId());
        projectDao.update(project);
        
        // 发送通知
        notificationService.notifyMilestoneStarted(projectId, next);
        
        // 如果下一个里程碑是"展示"类型，自动创建展示任务
        if (next.getMilestoneType() == 5) {
            createPresentationTasks(projectId, next.getId());
        }
        
        // AI阶段指导
        if (Boolean.TRUE.equals(next.getAiGuidanceEnabled())) {
            aiGuidanceService.sendStageGuidance(projectId, next);
        }
        
        return next;
    }
}
```

### 4.3 AI 阶段指导策略

每个里程碑类型对应不同的 AI 指导 Prompt 策略：

| 里程碑类型 | AI 指导方向 | 示例 Prompt 模板 |
| --- | --- | --- |
| 1 启动 | 帮助理解驱动性问题，头脑风暴 | "学生们正在开始项目'{title}'，驱动性问题是'{question}'。请为{stage}学生提供：1) 理解问题的三个引导性问题；2) 头脑风暴方向建议；3) 常见误区提醒。" |
| 2 调研 | 调研方法指导，数据收集建议 | "学生们正在进行'{milestone}'阶段的调研。已收集的信息：{logs_summary}。请指导：1) 还需要收集哪些维度的数据；2) 推荐的调研方法；3) 如何辨别信息可靠性。" |
| 3 设计 | 方案设计指导，可行性分析 | "学生们正在设计方案。已有调研发现：{summary}。请指导：1) 方案设计的思考框架；2) 如何评估可行性；3) 类似案例参考。" |
| 4 实施 | 遇到困难时的提示，验证方法 | "学生们在实施阶段遇到困难：{difficulty_desc}。请提供：1) 排查思路；2) 可能的解决方案；3) 验证方法。" |
| 5 展示 | 展示技巧指导，PPT结构建议 | "学生们准备成果展示。成果概要：{deliverable_summary}。请建议：1) 5分钟展示的最佳结构；2) 数据可视化建议；3) 可能被问到的问题及应答要点。" |
| 6 反思 | 反思引导，经验总结 | "项目即将结束。请引导学生反思：1) 最大的收获是什么；2) 遇到的最大挑战及如何克服；3) 如果重做会有什么不同；4) 学科知识在实际中如何运用。" |

### 4.4 评价计算引擎

```java
public class EvaluationScoreCalculator {
    
    /**
     * 计算提交物的最终综合得分
     * 
     * 计算规则：
     * 1. 每种评价类型(教师/同伴/自评/AI)内部取平均
     * 2. 按权重加权得到最终分
     * 3. 迟交扣分
     */
    public FinalScoreResult calculate(Long submissionId) {
        Submission submission = submissionDao.getById(submissionId);
        ProjectInstance project = projectDao.getById(submission.getProjectId());
        
        List<Evaluation> allEvals = evaluationDao.findBySubmission(submissionId);
        
        // 按类型分组求均值
        Map<EvaluatorType, Double> typeAverages = allEvals.stream()
            .collect(Collectors.groupingBy(
                e -> EvaluatorType.fromCode(e.getEvaluatorType()),
                Collectors.averagingDouble(Evaluation::getTotalScoreValue)
            ));
        
        // 按权重加权
        double weightedScore = 0.0;
        weightedScore += typeAverages.getOrDefault(EvaluatorType.TEACHER, 0.0) 
            * project.getTeacherEvalWeight();
        weightedScore += typeAverages.getOrDefault(EvaluatorType.PEER, 0.0) 
            * project.getPeerEvalWeight();
        weightedScore += typeAverages.getOrDefault(EvaluatorType.SELF, 0.0) 
            * project.getSelfEvalWeight();
        weightedScore += typeAverages.getOrDefault(EvaluatorType.AI, 0.0) 
            * project.getAiEvalWeight();
        
        // 迟交扣分
        double latePenalty = 0.0;
        if (submission.getIsLate()) {
            latePenalty = submission.getLateDays() 
                * project.getLatePenalty().doubleValue();
        }
        
        double finalScore = Math.max(0, weightedScore - latePenalty);
        
        // 各维度明细
        Map<String, Double> dimensionScores = calculateDimensionAverages(allEvals);
        
        return FinalScoreResult.builder()
            .submissionId(submissionId)
            .finalScore(BigDecimal.valueOf(finalScore).setScale(2, RoundingMode.HALF_UP))
            .weightedRawScore(BigDecimal.valueOf(weightedScore).setScale(2, RoundingMode.HALF_UP))
            .latePenalty(BigDecimal.valueOf(latePenalty).setScale(2, RoundingMode.HALF_UP))
            .typeAverages(typeAverages)
            .dimensionScores(dimensionScores)
            .evaluatorCount(allEvals.size())
            .build();
    }
    
    private Map<String, Double> calculateDimensionAverages(List<Evaluation> evals) {
        Map<String, List<Double>> dimensionMap = new HashMap<>();
        for (Evaluation eval : evals) {
            Map<String, Number> scores = JsonUtils.parseObject(
                eval.getScores(), Map.class);
            scores.forEach((dim, score) -> 
                dimensionMap.computeIfAbsent(dim, k -> new ArrayList<>())
                    .add(score.doubleValue()));
        }
        return dimensionMap.entrySet().stream()
            .collect(Collectors.toMap(
                Map.Entry::getKey,
                e -> e.getValue().stream().mapToDouble(d -> d).average().orElse(0)
            ));
    }
}
```

### 4.5 小组贡献度分析

```java
/**
 * 计算项目中小组成员各自贡献度
 * 
 * 维度：
 * - 任务完成数与完成质量
 * - 探究日志提交数
 * - 成果提交次数
 * - 同伴互评中"协作"维度得分
 */
public class ContributionAnalyzer {
    
    public Map<Long, ContributionScore> analyzeGroup(Long groupId, Long projectId) {
        List<GroupMember> members = groupMemberDao.findActiveMembers(groupId);
        
        Map<Long, ContributionScore> scores = new HashMap<>();
        
        for (GroupMember member : members) {
            ContributionScore score = new ContributionScore();
            score.setStudentId(member.getStudentId());
            score.setRole(member.getRole());
            
            // 1. 任务完成统计
            List<Task> assignedTasks = taskDao.findByAssignee(
                projectId, member.getStudentId());
            score.setTaskTotal(assignedTasks.size());
            score.setTaskCompleted((int) assignedTasks.stream()
                .filter(t -> t.getStatus() == 2).count());
            score.setTaskOnTimeRate(calculateOnTimeRate(assignedTasks));
            
            // 2. 日志贡献
            int logCount = logDao.countByStudent(projectId, member.getStudentId());
            score.setLogCount(logCount);
            
            // 3. 成果提交
            int submissionCount = submissionDao.countBySubmitter(
                projectId, member.getStudentId());
            score.setSubmissionCount(submissionCount);
            
            // 4. 同伴评价中的协作分
            Double peerCollabScore = evaluationDao.getAvgPeerDimensionScore(
                projectId, member.getStudentId(), "团队协作");
            score.setPeerCollaborationScore(peerCollabScore);
            
            // 综合贡献指数(0-100)
            score.setContributionIndex(calculateIndex(score));
            
            scores.put(member.getStudentId(), score);
        }
        
        return scores;
    }
    
    private double calculateIndex(ContributionScore s) {
        // 权重分配
        double taskScore = s.getTaskTotal() > 0 
            ? (s.getTaskCompleted() * 1.0 / s.getTaskTotal()) * 30 : 0;
        double logScore = Math.min(s.getLogCount() * 3.0, 25); // 封顶25
        double submissionScore = Math.min(s.getSubmissionCount() * 8.0, 20);
        double peerScore = (s.getPeerCollaborationScore() != null 
            ? s.getPeerCollaborationScore() / 100.0 * 25 : 12.5); // 默认中值
        return taskScore + logScore + submissionScore + peerScore;
    }
}
```

---

## 5. 关键代码示例

### 5.1 项目服务核心类

```java
/**
 * PBL 项目服务
 */
@Service
@Slf4j
public class PblProjectService {
    
    @Autowired private PblProjectInstanceDao projectDao;
    @Autowired private PblMilestoneDao milestoneDao;
    @Autowired private PblTaskDao taskDao;
    @Autowired private PblGroupDao groupDao;
    @Autowired private PblGroupMemberDao memberDao;
    @Autowired private FileStorageService fileStorageService;
    @Autowired private NotificationService notificationService;
    @Autowired private AuditService auditService;
    @Autowired private PblCacheManager cacheManager;
    
    /**
     * 创建项目
     */
    @Transactional
    public ProjectInstance createProject(CreateProjectRequest req, Long teacherId) {
        // 1. 参数校验
        validateProjectRequest(req);
        
        // 2. 创建项目实例
        ProjectInstance project = new ProjectInstance();
        project.setTemplateId(req.getTemplateId());
        project.setTitle(req.getTitle());
        project.setClassId(req.getClassId());
        project.setTeacherId(teacherId);
        project.setMode(req.getMode());
        project.setGroupSizeMin(req.getGroupSizeMin());
        project.setGroupSizeMax(req.getGroupSizeMax());
        project.setStartDate(req.getStartDate());
        project.setEndDate(req.getEndDate());
        project.setDrivingQuestion(req.getDrivingQuestion());
        project.setLearningGoals(JsonUtils.toJson(req.getLearningGoals()));
        project.setKnowledgePoints(JsonUtils.toJson(req.getKnowledgePointIds()));
        project.setRubric(JsonUtils.toJson(req.getRubric()));
        project.setEnablePeerEval(req.isEnablePeerEval() ? 1 : 0);
        project.setEnableSelfEval(req.isEnableSelfEval() ? 1 : 0);
        project.setEnableAiEval(req.isEnableAiEval() ? 1 : 0);
        project.setTeacherEvalWeight(BigDecimal.valueOf(req.getTeacherEvalWeight()));
        project.setPeerEvalWeight(BigDecimal.valueOf(req.getPeerEvalWeight()));
        project.setSelfEvalWeight(BigDecimal.valueOf(req.getSelfEvalWeight()));
        project.setAiEvalWeight(BigDecimal.valueOf(req.getAiEvalWeight()));
        project.setRequireAiGuidance(req.isRequireAiGuidance() ? 1 : 0);
        project.setStatus(0); // 待开始
        project.setAllowLateSubmit(req.isAllowLateSubmit() ? 1 : 0);
        
        // 权重校验
        validateEvalWeights(project);
        
        projectDao.insert(project);
        
        // 3. 生成里程碑
        List<Milestone> milestones = generateMilestones(project, req);
        milestoneDao.batchInsert(milestones);
        
        // 4. 设置第一个里程碑为当前
        if (!milestones.isEmpty()) {
            project.setCurrentMilestoneId(milestones.get(0).getId());
            projectDao.update(project);
        }
        
        // 5. 发送通知
        notificationService.notifyProjectCreated(project);
        
        log.info("PBL项目已创建: id={}, title={}, teacherId={}", 
            project.getId(), project.getTitle(), teacherId);
        
        return project;
    }
    
    /**
     * 从模板生成里程碑
     */
    private List<Milestone> generateMilestones(ProjectInstance project, 
                                                CreateProjectRequest req) {
        List<MilestoneTemplate> templates;
        if (req.getTemplateId() != null) {
            templates = milestoneTemplateDao.findByTemplateId(req.getTemplateId());
        } else {
            // 无模板时，使用默认6阶段结构
            templates = createDefaultMilestones(project);
        }
        
        // 按日期均分里程碑区间
        int totalDays = (int) ChronoUnit.DAYS.between(
            project.getStartDate(), project.getEndDate()) + 1;
        int milestoneCount = templates.size();
        int daysPerMilestone = totalDays / milestoneCount;
        
        List<Milestone> milestones = new ArrayList<>();
        LocalDate cursor = project.getStartDate();
        
        for (int i = 0; i < templates.size(); i++) {
            MilestoneTemplate tpl = templates.get(i);
            Milestone m = new Milestone();
            m.setProjectId(project.getId());
            m.setSeq(i + 1);
            m.setTitle(tpl.getTitle());
            m.setDescription(tpl.getDescription());
            m.setMilestoneType(tpl.getMilestoneType());
            m.setDeliverableDesc(tpl.getDeliverableDesc());
            m.setPlannedStart(cursor);
            
            // 最后一个里程碑到项目结束日期
            if (i == templates.size() - 1) {
                m.setPlannedEnd(project.getEndDate());
            } else {
                m.setPlannedEnd(cursor.plusDays(daysPerMilestone - 1));
            }
            
            m.setStatus(0); // 未开始
            m.setAiGuidanceEnabled(project.getRequireAiGuidance());
            m.setAiGuidancePrompt(tpl.getGuidance());
            
            cursor = m.getPlannedEnd().plusDays(1);
            milestones.add(m);
        }
        
        return milestones;
    }
    
    private List<MilestoneTemplate> createDefaultMilestones(ProjectInstance p) {
        return List.of(
            MilestoneTemplate.of("项目启动与分组", "理解驱动性问题，完成分组和分工", 1, 
                "分组方案和项目计划书"),
            MilestoneTemplate.of("信息调研", "收集相关资料和数据", 2, 
                "调研报告或数据集"),
            MilestoneTemplate.of("方案设计", "提出解决方案或设计方案", 3, 
                "设计方案文档"),
            MilestoneTemplate.of("实施验证", "实施方案并进行验证或测试", 4, 
                "实施过程记录和验证结果"),
            MilestoneTemplate.of("成果展示", "向班级/评委展示成果", 5, 
                "展示PPT和演示视频"),
            MilestoneTemplate.of("反思总结", "复盘项目过程与收获", 6, 
                "个人反思报告")
        );
    }
    
    private void validateEvalWeights(ProjectInstance project) {
        double sum = project.getTeacherEvalWeight().doubleValue()
            + project.getPeerEvalWeight().doubleValue()
            + project.getSelfEvalWeight().doubleValue()
            + project.getAiEvalWeight().doubleValue();
        if (Math.abs(sum - 1.0) > 0.001) {
            throw new BusinessException(30009, 
                "评价权重之和必须为1.0, 当前: " + sum);
        }
    }
    
    private void validateProjectRequest(CreateProjectRequest req) {
        if (req.getStartDate() == null || req.getEndDate() == null) {
            throw new BusinessException(30001, "项目起止日期不能为空");
        }
        if (!req.getEndDate().isAfter(req.getStartDate())) {
            throw new BusinessException(30001, "结束日期必须晚于开始日期");
        }
        long days = ChronoUnit.DAYS.between(req.getStartDate(), req.getEndDate());
        if (days < 2) {
            throw new BusinessException(30001, "项目周期至少需要3天");
        }
        if (days > 60) {
            throw new BusinessException(30001, "项目周期不能超过60天");
        }
        if (StringUtils.isBlank(req.getDrivingQuestion())) {
            throw new BusinessException(30001, "驱动性问题不能为空");
        }
        if (req.getMode() == 2) { // 小组模式
            if (req.getGroupSizeMin() < 2 || req.getGroupSizeMax() > 8) {
                throw new BusinessException(30001, "小组人数应在2-8人之间");
            }
            if (req.getGroupSizeMin() > req.getGroupSizeMax()) {
                throw new BusinessException(30001, "小组最少人数不能大于最多人数");
            }
        }
    }
}
```

### 5.2 探究日志服务

```java
@Service
public class PblLogService {
    
    @Autowired private PblProjectLogDao logDao;
    @Autowired private PblProjectInstanceDao projectDao;
    @Autowired private AiGuidanceService aiService;
    @Autowired private AuditService auditService;
    @Autowired private NotificationService notificationService;
    
    /**
     * 提交探究日志
     */
    @Transactional
    public ProjectLog submitLog(Long projectId, SubmitLogRequest req, Long studentId) {
        // 校验项目状态
        ProjectInstance project = projectDao.getById(projectId);
        if (project.getStatus() != 1) {
            throw new BusinessException(30004, "项目不在进行中，无法提交日志");
        }
        
        // 内容安全审核(异步)
        auditService.auditAsync(req.getContent(), AuditScene.PBL_LOG);
        
        // 保存日志
        ProjectLog log = new ProjectLog();
        log.setProjectId(projectId);
        log.setMilestoneId(req.getMilestoneId());
        log.setTaskId(req.getTaskId());
        log.setStudentId(studentId);
        log.setGroupId(req.getGroupId());
        log.setLogType(req.getLogType());
        log.setTitle(req.getTitle());
        log.setContent(req.getContent());
        log.setAttachments(JsonUtils.toJson(req.getAttachments()));
        log.setKnowledgePoints(JsonUtils.toJson(req.getKnowledgePoints()));
        
        logDao.insert(log);
        
        // AI反馈(异步)
        if (project.getRequireAiGuidance() == 1) {
            CompletableFuture.runAsync(() -> {
                try {
                    String feedback = aiService.generateLogFeedback(log, project);
                    log.setAiFeedback(feedback);
                    logDao.update(log);
                    
                    // 推送AI反馈通知
                    notificationService.notifyStudent(
                        studentId, 
                        "AI辅导老师对你的探究日志发表了反馈",
                        NotificationType.PBL_LOG_FEEDBACK);
                } catch (Exception e) {
                    log.warn("AI日志反馈失败: logId={}", log.getId(), e);
                }
            });
        }
        
        return log;
    }
    
    /**
     * 教师批注日志
     */
    @Transactional
    public void teacherComment(Long logId, String comment, Long teacherId) {
        ProjectLog log = logDao.getById(logId);
        if (log == null) {
            throw new BusinessException(30003, "日志不存在");
        }
        
        log.setTeacherComment(comment);
        log.setTeacherCommentedBy(teacherId);
        log.setTeacherCommentedAt(LocalDateTime.now());
        
        logDao.update(log);
        
        notificationService.notifyStudent(
            log.getStudentId(),
            "老师对你的探究日志'" + log.getTitle() + "'发表了批注",
            NotificationType.PBL_TEACHER_COMMENT);
    }
}
```

### 5.3 AI 成果评价 Prompt 构建器

```java
@Component
public class PblAiReviewPromptBuilder {
    
    private static final String SYSTEM_PROMPT = """
        你是一位经验丰富的教育评价专家，擅长项目式学习(PBL)的成果评价。
        请根据评价量规和成果内容，给出专业、公正、有建设性的评价。
        评分应基于学生的实际表现，避免过严或过宽。
        """;
    
    /**
     * 构建成果评价Prompt
     */
    public ChatRequest buildReviewPrompt(Submission submission, 
                                          ProjectInstance project,
                                          List<ProjectLog> logs) {
        
        StringBuilder userPrompt = new StringBuilder();
        
        // 项目背景
        userPrompt.append("## 项目信息\n");
        userPrompt.append("项目标题：").append(project.getTitle()).append("\n");
        userPrompt.append("驱动性问题：").append(project.getDrivingQuestion()).append("\n");
        userPrompt.append("学习目标：").append(project.getLearningGoals()).append("\n\n");
        
        // 评价量规
        userPrompt.append("## 评价量规\n");
        Rubric rubric = JsonUtils.parseObject(project.getRubric(), Rubric.class);
        for (RubricDimension dim : rubric.getDimensions()) {
            userPrompt.append("- ").append(dim.getName())
                .append("(").append(dim.getMaxScore()).append("分): ")
                .append(dim.getDesc()).append("\n");
        }
        userPrompt.append("\n");
        
        // 成果内容
        userPrompt.append("## 成果提交\n");
        userPrompt.append("标题：").append(submission.getTitle()).append("\n");
        userPrompt.append("描述：").append(submission.getDescription()).append("\n");
        if (submission.getTextContent() != null) {
            // 截取前3000字避免Token超限
            String content = submission.getTextContent();
            if (content.length() > 3000) {
                content = content.substring(0, 3000) + "\n...(内容过长，已截断)";
            }
            userPrompt.append("正文：\n").append(content).append("\n\n");
        }
        
        // 过程记录摘要
        if (!logs.isEmpty()) {
            userPrompt.append("## 过程记录摘要(探究日志)\n");
            for (ProjectLog log : logs.stream().limit(10).collect(Collectors.toList())) {
                userPrompt.append("[").append(log.getCreatedAt().toLocalDate()).append("] ");
                userPrompt.append(log.getTitle()).append("\n");
            }
            userPrompt.append("\n");
        }
        
        // 输出格式要求
        userPrompt.append("## 请按以下JSON格式输出评价\n");
        userPrompt.append("""
            {
              "scores": {
                "<维度名>": <0到该维度最高分的整数>,
                ...
              },
              "totalScore": <加权总分>,
              "strengths": "<优点, 2-3句>",
              "improvements": "<改进建议, 2-3句>",
              "overallComment": "<总体评语, 3-5句>"
            }
            """);
        
        return ChatRequest.builder()
            .systemPrompt(SYSTEM_PROMPT)
            .userPrompt(userPrompt.toString())
            .temperature(0.3) // 低温度确保评分一致性
            .maxTokens(2000)
            .responseFormat("json_object")
            .build();
    }
    
    /**
     * 构建阶段指导Prompt
     */
    public ChatRequest buildGuidancePrompt(Milestone milestone, 
                                            ProjectInstance project,
                                            List<ProjectLog> recentLogs) {
        StringBuilder prompt = new StringBuilder();
        
        prompt.append("你是一位PBL项目指导老师。当前项目信息如下：\n\n");
        prompt.append("项目：").append(project.getTitle()).append("\n");
        prompt.append("驱动性问题：").append(project.getDrivingQuestion()).append("\n");
        prompt.append("当前阶段：").append(milestone.getTitle()).append("\n");
        prompt.append("阶段说明：").append(milestone.getDescription()).append("\n\n");
        
        if (!recentLogs.isEmpty()) {
            prompt.append("学生最近的探究记录：\n");
            for (ProjectLog log : recentLogs) {
                prompt.append("- ").append(log.getTitle()).append(": ");
                String content = log.getContent();
                if (content.length() > 200) {
                    content = content.substring(0, 200) + "...";
                }
                prompt.append(content).append("\n\n");
            }
        }
        
        prompt.append("\n请根据以上信息，为学生提供本阶段的指导建议(200-400字)，");
        prompt.append("包含：\n1. 当前进展的评价\n2. 下一步建议\n3. 注意事项\n");
        prompt.append("语气要亲切鼓励，适合中小学生阅读。");
        
        return ChatRequest.builder()
            .systemPrompt("你是一位亲切、专业的PBL项目指导老师。")
            .userPrompt(prompt.toString())
            .temperature(0.6)
            .maxTokens(800)
            .build();
    }
}
```

### 5.4 定时任务：项目状态巡检

```java
/**
 * PBL 定时任务
 */
@Component
@Slf4j
public class PblScheduledJobs {
    
    @Autowired private PblProjectInstanceDao projectDao;
    @Autowired private PblMilestoneDao milestoneDao;
    @Autowired private NotificationService notificationService;
    @Autowired private PblCacheManager cacheManager;
    
    /**
     * 每30分钟检查项目状态
     * 1. 自动启动到达开始日期的项目
     * 2. 标记逾期的里程碑
     * 3. 发送到期提醒
     */
    @Scheduled(fixedRate = 30 * 60 * 1000)
    public void checkProjectStatus() {
        LocalDate today = LocalDate.now();
        
        // 1. 自动启动
        List<ProjectInstance> toStart = projectDao.findByStatusAndStartDate(0, today);
        for (ProjectInstance project : toStart) {
            project.setStatus(1);
            // 激活第一个里程碑
            Milestone firstMilestone = milestoneDao.findFirst(project.getId());
            if (firstMilestone != null) {
                firstMilestone.setStatus(1);
                milestoneDao.update(firstMilestone);
                project.setCurrentMilestoneId(firstMilestone.getId());
            }
            projectDao.update(project);
            
            notificationService.notifyProjectStarted(project);
            cacheManager.invalidateProject(project.getId());
            log.info("项目自动启动: {}", project.getId());
        }
        
        // 2. 里程碑到期提醒
        List<Milestone> upcomingDeadlines = milestoneDao
            .findByStatusAndPlannedEnd(1, today, today.plusDays(2));
        for (Milestone m : upcomingDeadlines) {
            long daysLeft = ChronoUnit.DAYS.between(today, m.getPlannedEnd());
            notificationService.notifyMilestoneDeadline(
                m.getProjectId(), m, (int) daysLeft);
        }
        
        // 3. 自动关闭到期的里程碑(标记逾期)
        List<Milestone> overdue = milestoneDao
            .findByStatusAndPlannedEndBefore(1, today);
        for (Milestone m : overdue) {
            if (m.getStatus() == 1) {
                // 不自动关闭，但发送逾期提醒
                ProjectInstance project = projectDao.getById(m.getProjectId());
                if (project.getAllowLateSubmit() == 1) {
                    notificationService.notifyMilestoneOverdue(
                        m.getProjectId(), m);
                }
            }
        }
        
        // 4. 自动完成：所有里程碑已评审 + 成果已提交
        List<ProjectInstance> inProgress = projectDao.findByStatus(1);
        for (ProjectInstance project : inProgress) {
            if (shouldAutoComplete(project)) {
                project.setStatus(2); // 待评审
                projectDao.update(project);
                notificationService.notifyProjectReadyForReview(project);
                cacheManager.invalidateProject(project.getId());
            }
        }
    }
    
    private boolean shouldAutoComplete(ProjectInstance project) {
        List<Milestone> milestones = milestoneDao.findByProjectId(project.getId());
        if (milestones.isEmpty()) return false;
        
        // 检查最后一个里程碑是否完成
        Milestone lastMilestone = milestones.get(milestones.size() - 1);
        if (lastMilestone.getStatus() < 2) return false;
        
        // 检查是否到结束日期
        return !LocalDate.now().isBefore(project.getEndDate());
    }
}
```

---

## 6. 错误处理

### 6.1 异常分类与处理策略

| 异常类型 | 场景 | 处理策略 |
| --- | --- | --- |
| 参数校验异常 | 日期非法、权重不匹配、人数超限 | 返回 400 + 具体字段错误信息 |
| 权限异常 | 非项目成员操作、学生越权教师功能 | 返回 403 |
| 状态冲突异常 | 已结束项目提交、已评审成果修改 | 返回 409 + 当前状态提示 |
| AI 服务异常 | AI 指导/评价生成失败 | 降级为跳过AI反馈，记录告警日志，不影响主流程 |
| 文件上传异常 | OSS 上传失败 | 自动重试3次，失败后提示用户重新上传 |
| 审核异常 | 学生上传内容触发安全规则 | 标记审核状态为"拒绝"，通知教师复核 |

### 6.2 AI 服务降级策略

```java
@Component
@Slf4j
public class PblAiServiceFallback {
    
    /**
     * AI日志反馈降级策略
     */
    public String fallbackLogFeedback(ProjectLog log) {
        // 根据日志类型返回预设反馈模板
        return switch (log.getLogType()) {
            case 1 -> "你的调研记录很详细！继续保持，记得关注数据的准确性。";
            case 2 -> "实验记录很认真！记得拍照留存过程，方便后续分析。";
            case 3 -> "讨论纪要整理得不错！注意记录不同观点和最终决策理由。";
            case 4 -> "反思做得很好！回顾过程也是学习的重要环节。";
            case 5 -> "遇到困难很正常，这正是学习的过程。可以尝试换个角度思考，或向同伴和老师求助。";
            case 6 -> "很棒的想法！把灵感记录下来，后续可以进一步探索。";
            default -> "记录已收到，继续加油！";
        };
    }
    
    /**
     * AI成果评价降级策略
     */
    public Evaluation fallbackReview(Submission submission, ProjectInstance project) {
        // AI不可用时，仅标记为"待教师评审"
        log.warn("AI评价降级: submissionId={}", submission.getId());
        return null; // 返回null，由调用方跳过AI评价
    }
}
```

### 6.3 幂等性保障

| 操作 | 幂等键 | TTL | 说明 |
| --- | --- | --- | --- |
| 创建项目 | `pbl:create:{teacherId}:{title}:{classId}` | 10s | 防止重复提交 |
| 提交成果 | `pbl:submit:{milestoneId}:{groupId}` | 30s | 同组防重复提交 |
| 提交评价 | `pbl:eval:{submissionId}:{evaluatorId}` | 30s | 同人防重复评价 |
| 日志提交 | `pbl:log:{projectId}:{studentId}:{title}` | 5s | 防重复日志 |

---

## 7. 性能优化

### 7.1 数据库优化

```sql
-- 进度查询优化：物化视图或定期刷新表
CREATE TABLE pbl_project_progress_snapshot (
    project_id      BIGINT PRIMARY KEY,
    overall_pct     INT NOT NULL DEFAULT 0,
    milestone_count INT NOT NULL DEFAULT 0,
    completed_milestones INT NOT NULL DEFAULT 0,
    total_tasks     INT NOT NULL DEFAULT 0,
    completed_tasks INT NOT NULL DEFAULT 0,
    group_count     INT NOT NULL DEFAULT 0,
    log_count       INT NOT NULL DEFAULT 0,
    submission_count INT NOT NULL DEFAULT 0,
    last_activity_at DATETIME,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 定时刷新快照(每5分钟)
-- 查询时直接读快照表，避免多表JOIN
```

### 7.2 并发控制

| 场景 | 策略 |
| --- | --- |
| 加入小组 | Redis分布式锁 `pbl:group:join:{groupId}`，防止超额 |
| 里程碑推进 | Redis分布式锁 `pbl:milestone:advance:{projectId}` |
| 成果提交 | Redis分布式锁 `pbl:submit:{milestoneId}:{groupId}` |
| 评价提交 | 乐观锁(version字段) + 幂等键 |

### 7.3 批量操作优化

```java
/**
 * 批量获取项目进度（减少N+1查询）
 */
public Map<Long, ProjectProgress> batchGetProgress(List<Long> projectIds) {
    // 1. 批量查快照表
    List<ProgressSnapshot> snapshots = progressDao
        .findByProjectIds(projectIds);
    
    // 2. 批量查里程碑状态
    Map<Long, List<Milestone>> milestoneMap = milestoneDao
        .batchFindByProjectIds(projectIds)
        .stream()
        .collect(Collectors.groupingBy(Milestone::getProjectId));
    
    // 3. 组装
    return snapshots.stream()
        .collect(Collectors.toMap(
            ProgressSnapshot::getProjectId,
            snap -> assembleProgress(snap, milestoneMap.get(snap.getProjectId()))
        ));
}
```

---

## 8. 安全考虑

### 8.1 权限控制矩阵

| 操作 | 学生 | 组长 | 教师 | 管理员 |
| --- | --- | --- | --- | --- |
| 查看项目 | 项目成员 ✓ | ✓ | ✓ | ✓ |
| 创建项目 | ✗ | ✗ | ✓ | ✓ |
| 编辑项目配置 | ✗ | ✗ | ✓(发起人) | ✓ |
| 创建小组 | ✗ | ✗ | ✓ | ✓ |
| 加入/退出小组 | ✓ | ✓(退出需转让组长) | ✗ | ✗ |
| 分配任务 | ✗ | ✓(组内) | ✓ | ✓ |
| 提交日志 | ✓ | ✓ | ✗ | ✗ |
| 教师批注 | ✗ | ✗ | ✓ | ✗ |
| 提交成果 | ✓ | ✓ | ✗ | ✗ |
| 里程碑推进 | ✗ | ✓(组长) / ✗ | ✓ | ✗ |
| 提交评价(互评) | ✓(同组) | ✓ | ✗ | ✗ |
| 提交评价(师评) | ✗ | ✗ | ✓ | ✗ |
| 终止项目 | ✗ | ✗ | ✓(发起人) | ✓ |

### 8.2 内容安全

```java
@Component
public class PblContentSecurityFilter {
    
    /**
     * 学生上传内容安全检查
     */
    public void checkContent(String content, Long studentId) {
        AuditResult result = auditService.quickCheck(content);
        if (result.isBlocked()) {
            // 记录安全事件
            securityEventService.record(SecurityEvent.builder()
                .userId(studentId)
                .scene("PBL_CONTENT")
                .content(content)
                .reason(result.getReason())
                .severity(result.getSeverity())
                .build());
            
            throw new BusinessException(30999, "内容包含不适宜信息，请修改后重新提交");
        }
    }
    
    /**
     * 资源文件安全扫描
     */
    public void scanResource(String fileUrl, ResourceType type) {
        // 1. 文件类型校验
        // 2. 病毒扫描(对接安全服务)
        // 3. 图片内容审核(OCR + 图像识别)
        // 4. 视频内容审核(抽帧检测)
    }
}
```

### 8.3 数据隔离

- 学生只能查看自己所在小组的项目数据和资源
- 教师只能管理自己发起或被分配的项目
- PBL 数据回流学情分析时进行匿名化处理
- 项目归档后，非项目参与者仅能查看公开展示的成果

---

## 9. 测试策略

### 9.1 单元测试

```java
@ExtendWith(MockitoExtension.class)
class PblProjectServiceTest {
    
    @Mock private PblProjectInstanceDao projectDao;
    @Mock private PblMilestoneDao milestoneDao;
    @InjectMocks private PblProjectService service;
    
    @Test
    @DisplayName("创建项目 - 正常流程")
    void createProject_success() {
        // Given
        CreateProjectRequest req = CreateProjectRequest.builder()
            .title("测试项目")
            .mode(2)
            .groupSizeMin(3)
            .groupSizeMax(5)
            .startDate(LocalDate.of(2026, 9, 1))
            .endDate(LocalDate.of(2026, 9, 14))
            .drivingQuestion("测试驱动性问题")
            .learningGoals(List.of("目标1"))
            .teacherEvalWeight(0.50)
            .peerEvalWeight(0.20)
            .selfEvalWeight(0.10)
            .aiEvalWeight(0.20)
            .build();
        
        // When
        when(projectDao.insert(any())).thenAnswer(invocation -> {
            ProjectInstance p = invocation.getArgument(0);
            p.setId(1001L);
            return 1;
        });
        
        ProjectInstance result = service.createProject(req, 200L);
        
        // Then
        assertThat(result.getId()).isEqualTo(1001L);
        assertThat(result.getStatus()).isEqualTo(0);
        verify(milestoneDao).batchInsert(anyList());
    }
    
    @Test
    @DisplayName("创建项目 - 权重总和不为1应抛异常")
    void createProject_invalidWeights() {
        CreateProjectRequest req = CreateProjectRequest.builder()
            .title("测试")
            .startDate(LocalDate.of(2026, 9, 1))
            .endDate(LocalDate.of(2026, 9, 14))
            .drivingQuestion("测试")
            .learningGoals(List.of("目标"))
            .teacherEvalWeight(0.50)
            .peerEvalWeight(0.30)
            .selfEvalWeight(0.30) // 总和1.1
            .aiEvalWeight(0.00)
            .build();
        
        assertThatThrownBy(() -> service.createProject(req, 200L))
            .hasMessageContaining("权重之和必须为1.0");
    }
    
    @Test
    @DisplayName("评价计算 - 多类型加权正确")
    void calculateFinalScore_multiType() {
        // Given: 教师评90(权重0.5), 同伴评85(权重0.2), 自评95(0.1), AI评88(0.2)
        // Expected: 90*0.5 + 85*0.2 + 95*0.1 + 88*0.2 = 45+17+9.5+17.6 = 89.1
        
        // ... setup mocks ...
        
        FinalScoreResult result = calculator.calculate(1L);
        assertThat(result.getFinalScore()).isEqualByComparingTo("89.10");
    }
}
```

### 9.2 集成测试场景

| 场景 | 步骤 | 预期结果 |
| --- | --- | --- |
| 完整PBL流程 | 创建项目→分组→提交日志→提交成果→评价→完成 | 状态正确流转，最终得分正确 |
| 迟交扣分 | 在截止日期后提交成果 | 综合分扣除对应天数罚分 |
| AI服务降级 | AI评价服务超时 | 降级跳过AI评价，其余评价正常 |
| 并发加入小组 | 2人同时加入最后一个名额 | 1人成功，1人收到"小组已满" |
| 任务依赖检查 | 前置任务未完成时推进里程碑 | 返回30012错误 |
| 权限隔离 | A组学生查看B组成果 | 返回403 |
| 自动状态巡检 | 到达开始日期的项目 | 自动变为"进行中" |

### 9.3 性能测试

| 指标 | 目标 |
| --- | --- |
| 项目看板查询 | P99 < 200ms (单项目，10小组以内) |
| 日志提交(含AI反馈) | 主流程 < 500ms，AI反馈 < 10s(异步) |
| 成果评价计算 | P99 < 100ms |
| 教师管理10个项目看板 | P99 < 500ms (批量查询) |
| 并发提交评价 | 100 TPS 无错误 |

---

## 10. 客户端适配要点

### 10.1 学生端关键页面

| 页面 | 功能 |
| --- | --- |
| PBL首页 | 我参与的项目列表、进行中的项目卡片、快捷入口 |
| 项目详情 | 里程碑进度条、当前任务清单、小组信息、资源入口 |
| 探究日志编辑 | 富文本编辑器、附件上传、知识点选择、保存草稿 |
| 成果提交 | 多类型上传(文档/图片/视频/链接)、预览、提交确认 |
| 小组工作区 | 组内讨论区、任务看板(Kanban风格)、组员贡献视图 |
| 成果展示 | 作品浏览、点赞/评论、分享 |
| 评价页 | 自评/互评表单、查看综合评价报告 |

### 10.2 教师端关键页面

| 页面 | 功能 |
| --- | --- |
| PBL管理台 | 项目创建、模板选择、班级选择、评价配置 |
| 项目监控看板 | 全班各小组进度一览、逾期预警、活跃度热力图 |
| 批注工作台 | 待批注日志队列、快速批注模板、批量操作 |
| 成果评审 | 提交物预览、评价量规表、AI初审参考、评分录入 |

### 10.3 客户端缓存策略

```dart
// Flutter 客户端示例：PBL项目详情缓存
class PblProjectCache {
  static const _boxName = 'pbl_cache';
  
  // 项目详情本地缓存(支持离线浏览)
  static Future<ProjectDetail?> getCachedProject(int projectId) async {
    final box = await Hive.openBox(_boxName);
    final cached = box.get('project_$projectId');
    if (cached != null) {
      final data = jsonDecode(cached);
      final timestamp = data['cachedAt'] as int;
      // 缓存有效期10分钟
      if (DateTime.now().millisecondsSinceEpoch - timestamp < 600000) {
        return ProjectDetail.fromJson(data['project']);
      }
    }
    return null;
  }
  
  // 探究日志本地草稿
  static Future<void> saveLogDraft(int projectId, String content) async {
    final box = await Hive.openBox('pbl_drafts');
    await box.put('draft_log_$projectId', {
      'content': content,
      'savedAt': DateTime.now().toIso8601String(),
    });
  }
}
```

---

## 11. 与其他模块的集成协议

### 11.1 学情分析数据回流

PBL 引擎向学情分析服务推送以下事件：

```json
// 项目完成事件
{
  "eventType": "PBL_PROJECT_COMPLETED",
  "studentId": 10086,
  "projectId": 5001,
  "subjectIds": [3, 6],
  "finalScore": 88.5,
  "dimensions": {"科学准确性": 23, "方案可行性": 22, "团队协作": 18, "展示表达": 14, "创新创意": 13},
  "duration": {
    "days": 28,
    "activeDays": 22,
    "totalHours": 18.5
  },
  "knowledgePoints": [301, 302, 305, 410],
  "role": "组长",
  "logCount": 14,
  "submissionCount": 3,
  "peerCollaborationScore": 92.0,
  "timestamp": "2026-10-14T12:00:00Z"
}
```

### 11.2 AI 辅导服务集成

PBL 引擎通过标准 ChatRequest 接口调用 AI 服务，遵循 AI 辅导全链路请求处理规范：

| 调用场景 | Prompt 来源 | 模型策略 | 限流 |
| --- | --- | --- | --- |
| 日志反馈 | PblAiService.buildLogFeedback() | 通用问答模型 | 10次/分钟/学生 |
| 阶段指导 | PblAiService.buildGuidancePrompt() | 推理增强模型 | 5次/分钟/小组 |
| 成果评价 | PblAiReviewPromptBuilder.buildReviewPrompt() | 推理增强模型 | 3次/分钟/项目 |
| AI互评 | 适配评价场景的Prompt | 通用问答模型 | 10次/分钟/学生 |

### 11.3 通知服务集成

| 事件 | 通知对象 | 渠道 | 模板Key |
| --- | --- | --- | --- |
| 项目创建 | 班级学生 | App推送 | `pbl.project.created` |
| 项目启动 | 班级学生 | App推送+站内信 | `pbl.project.started` |
| 里程碑开始 | 项目成员 | App推送 | `pbl.milestone.started` |
| 里程碑到期提醒 | 项目成员+组长 | App推送 | `pbl.milestone.deadline` |
| 里程碑逾期 | 组长+教师 | App推送 | `pbl.milestone.overdue` |
| AI反馈生成 | 日志提交者 | App推送(静默) | `pbl.ai.feedback` |
| 教师批注 | 日志提交者 | App推送 | `pbl.teacher.comment` |
| 成果待评审 | 教师 | App推送 | `pbl.submission.pending` |
| 评价完成 | 被评价学生 | App推送 | `pbl.evaluation.completed` |

### 11.4 文件存储服务集成

| 资源类型 | 存储路径 | 访问控制 | 过期策略 |
| --- | --- | --- | --- |
| 探究日志附件 | `oss://pbl/{projectId}/logs/{logId}/` | 项目成员可读 | 项目归档后2年 |
| 成果提交文件 | `oss://pbl/{projectId}/submissions/{submissionId}/` | 教师+组员可读 | 项目归档后3年 |
| 项目资源库 | `oss://pbl/{projectId}/resources/` | 按小组/公共权限 | 项目归档后2年 |
| 成果展示作品 | `oss://pbl/{projectId}/showcase/` | 全校可读(展示期) | 展示结束后1年 |

---

## 12. 版本演进规划

| 版本 | 功能范围 |
| --- | --- |
| V1.0 | 项目创建、里程碑管理、任务管理、日志提交、成果提交、教师评价 |
| V1.5 | 小组协作、同伴互评、AI阶段指导、贡献度分析 |
| V2.0 | AI成果评价、项目模板市场、跨班/跨校PBL协作、成果展示大厅 |
| V2.5 | VR/AR成果展示、社区PBL项目库、家长参与式评价、PBL学习证书 |