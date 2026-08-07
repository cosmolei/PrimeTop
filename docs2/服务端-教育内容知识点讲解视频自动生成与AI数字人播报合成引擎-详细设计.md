# 服务端-教育内容知识点讲解视频自动生成与AI数字人播报合成引擎-详细设计

## 1. 概述

### 1.1 功能定位

本引擎是 PrimeTop 教育平台内容生产管线的核心组件之一，负责将结构化的知识点数据自动转化为带有 AI 数字人播报的讲解视频。通过整合 LLM 脚本生成、TTS 语音合成、数字人动画渲染和视频合成技术，实现教育视频内容的规模化、标准化、低成本生产。

### 1.2 目标

| 目标 | 描述 |
| --- | --- |
| 规模化生产 | 单知识点讲解视频从脚本到成品全流程自动化，日均产能 ≥ 500 个视频 |
| 质量保障 | 知识准确性 ≥ 98%，语音自然度 MOS ≥ 4.0，数字人唇形同步偏差 ≤ 80ms |
| 成本控制 | 单分钟视频生产成本 ≤ 传统录制的 1/10 |
| 多学段适配 | 同一知识点可自动生成幼儿/小学/初中/高中四个难度版本 |
| 多格式输出 | 输出 16:9 横屏（教学视频）、9:16 竖屏（短视频）、1:1 方形（卡片视频） |

### 1.3 适用范围

- 教材章节知识点讲解视频
- 考点专项突破视频
- 错题解析视频（按需生成）
- 每日一题/知识点短视频
- 假期专题微课

### 1.4 系统边界

```
本引擎负责                           外部依赖
─────────────                       ─────────
┌─────────────────────────┐         ┌──────────────────┐
│  脚本生成（LLM）         │ ◄───── │ 知识图谱数据库    │
│  语音合成（TTS）         │ ◄───── │ 教材章节内容      │
│  数字人渲染              │ ◄───── │ TTS 服务          │
│  视频合成                │ ◄───── │ LLM API           │
│  质量审核                │         │ 素材库（图片/动画）│
│  存储分发                │         │ 对象存储 OSS      │
└─────────────────────────┘         └──────────────────┘
```

---

## 2. 系统架构

### 2.1 整体架构

```
                    ┌──────────────────────────────────────┐
                    │       视频生成任务调度器                │
                    │   (VideoGenerationOrchestrator)       │
                    └──────────┬───────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   脚本生成模块    │ │   语音合成模块     │ │   视频合成模块     │
│ ScriptGenerator │ │  TTSEngine        │ │ VideoComposer    │
└─────────────────┘ └──────────────────┘ └──────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   数字人模块      │ │   素材准备模块     │ │   质量审核模块     │
│ AvatarRenderer  │ │ AssetPreparer    │ │ QualityReviewer  │
└─────────────────┘ └──────────────────┘ └──────────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ▼
                    ┌──────────────────────────┐
                    │    对象存储 / CDN 分发      │
                    └──────────────────────────┘
```

### 2.2 技术选型

| 组件 | 推荐方案 | 备选 |
| --- | --- | --- |
| 脚本生成 LLM | GLM-4 / DeepSeek-V3 | GPT-4o, Claude |
| TTS 服务 | 阿里云 CosyVoice / 字节 TTS | 微软 Azure TTS |
| 数字人渲染 | 硅基智能 / 灰豚数字人 SDK | HeyGen API, D-ID |
| 视频合成 | FFmpeg + Python | Node.js + fluent-ffmpeg |
| 任务调度 | Celery + Redis | Apache Airflow |
| 对象存储 | 阿里云 OSS | 腾讯云 COS |
| GPU 集群 | NVIDIA T4/A10 | 云函数 GPU |

---

## 3. 数据结构定义

### 3.1 视频生成任务表 `video_generation_tasks`

```sql
CREATE TABLE video_generation_tasks (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_no         VARCHAR(64) NOT NULL UNIQUE COMMENT '任务编号 VT{timestamp}{random}',
    knowledge_point_id BIGINT NOT NULL COMMENT '知识点ID',
    chapter_id      BIGINT COMMENT '章节ID',
    
    -- 脚本参数
    target_stage    TINYINT NOT NULL COMMENT '目标学段: 1=幼儿 2=小学 3=初中 4=高中',
    target_subject  VARCHAR(20) NOT NULL COMMENT '学科',
    video_style     VARCHAR(32) NOT NULL DEFAULT 'standard' COMMENT '视频风格: standard/lively/concise/exam',
    duration_target INT NOT NULL DEFAULT 180 COMMENT '目标时长(秒)',
    format_target   VARCHAR(20) NOT NULL DEFAULT '16:9' COMMENT '输出格式: 16:9 / 9:16 / 1:1',
    
    -- 状态
    status          VARCHAR(32) NOT NULL DEFAULT 'PENDING' COMMENT '任务状态',
    current_step    VARCHAR(64) COMMENT '当前执行步骤',
    progress        TINYINT NOT NULL DEFAULT 0 COMMENT '进度百分比 0-100',
    
    -- 脚本
    script_id       BIGINT COMMENT '关联脚本ID',
    
    -- 产出
    video_url       VARCHAR(512) COMMENT '最终视频URL',
    thumbnail_url   VARCHAR(512) COMMENT '缩略图URL',
    duration_actual INT COMMENT '实际时长(秒)',
    file_size_bytes BIGINT COMMENT '文件大小',
    resolution      VARCHAR(20) COMMENT '分辨率 如1920x1080',
    
    -- 质量
    quality_score   DECIMAL(3,2) COMMENT '质量评分 0-10',
    review_status   VARCHAR(32) DEFAULT 'PENDING_REVIEW' COMMENT '审核状态',
    reviewer_id     BIGINT COMMENT '审核人ID',
    review_notes    TEXT COMMENT '审核备注',
    
    -- 成本
    llm_tokens_used INT DEFAULT 0 COMMENT 'LLM Token消耗',
    tts_seconds     INT DEFAULT 0 COMMENT 'TTS合成秒数',
    gpu_seconds     INT DEFAULT 0 COMMENT 'GPU使用秒数',
    estimated_cost  DECIMAL(10,4) COMMENT '预估成本(元)',
    
    -- 元数据
    created_by      BIGINT NOT NULL COMMENT '创建人',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at    DATETIME COMMENT '完成时间',
    
    INDEX idx_status (status),
    INDEX idx_kp (knowledge_point_id, target_stage),
    INDEX idx_created (created_at),
    INDEX idx_review (review_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频生成任务表';
```

### 3.2 视频脚本表 `video_scripts`

```sql
CREATE TABLE video_scripts (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         BIGINT NOT NULL COMMENT '关联任务ID',
    version         INT NOT NULL DEFAULT 1 COMMENT '脚本版本号',
    
    -- 脚本内容 (JSON)
    title           VARCHAR(256) NOT NULL COMMENT '视频标题',
    segments        JSON NOT NULL COMMENT '分段脚本内容',
    
    -- 脚本元数据
    total_duration  INT COMMENT '预计总时长(秒)',
    word_count      INT COMMENT '总字数',
    difficulty_level TINYINT COMMENT '难度等级 1-5',
    
    -- LLM 信息
    llm_model       VARCHAR(64) COMMENT '使用的LLM模型',
    llm_prompt_hash VARCHAR(64) COMMENT 'Prompt哈希(版本追踪)',
    
    -- 状态
    status          VARCHAR(32) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/APPROVED/REJECTED/ARCHIVED',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_task (task_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频脚本表';
```

### 3.3 脚本段（segments）JSON 结构

```json
{
  "segments": [
    {
      "segment_id": "seg_001",
      "type": "INTRO",
      "duration_estimate": 15,
      "narration": "同学们好！今天我们来学习一元二次方程的求根公式。",
      "avatar_action": "wave",
      "avatar_expression": "friendly",
      "visual": {
        "type": "TEXT_OVERLAY",
        "content": "一元二次方程求根公式",
        "position": "center",
        "animation": "fade_in"
      },
      "bgm_mood": "uplifting"
    },
    {
      "segment_id": "seg_002",
      "type": "CONCEPT",
      "duration_estimate": 30,
      "narration": "对于一般形式的一元二次方程 ax²+bx+c=0（a≠0），它的根可以用公式 x=(-b±√(b²-4ac))/2a 来求解。这个公式叫做求根公式。",
      "avatar_action": "point_right",
      "avatar_expression": "focused",
      "visual": {
        "type": "FORMULA_RENDER",
        "latex": "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
        "position": "right_panel",
        "animation": "step_by_step"
      },
      "bgm_mood": "neutral"
    },
    {
      "segment_id": "seg_003",
      "type": "EXAMPLE",
      "duration_estimate": 45,
      "narration": "我们来看一个例子。解方程 x²-5x+6=0。这里 a=1，b=-5，c=6。代入公式...",
      "avatar_action": "write",
      "avatar_expression": "thoughtful",
      "visual": {
        "type": "STEP_BY_STEP",
        "steps": [
          {"text": "a=1, b=-5, c=6", "narration": "首先确定系数"},
          {"text": "\\Delta = b^2-4ac = 25-24 = 1", "narration": "计算判别式"},
          {"text": "x = \\frac{5 \\pm 1}{2}", "narration": "代入求根公式"},
          {"text": "x_1=3, x_2=2", "narration": "得到两个根"}
        ],
        "position": "right_panel",
        "animation": "typewriter"
      },
      "bgm_mood": "neutral"
    },
    {
      "segment_id": "seg_004",
      "type": "SUMMARY",
      "duration_estimate": 15,
      "narration": "记住：只要能确定 a、b、c 的值，代入求根公式就能求出根。下节课我们学习判别式的作用。",
      "avatar_action": "nod",
      "avatar_expression": "encouraging",
      "visual": {
        "type": "KEY_POINTS",
        "points": ["确定系数 a, b, c", "代入求根公式", "化简得到结果"],
        "position": "center",
        "animation": "fade_in"
      },
      "bgm_mood": "uplifting"
    }
  ]
}
```

### 3.4 数字人形象配置表 `avatar_configs`

```sql
CREATE TABLE avatar_configs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    avatar_code     VARCHAR(32) NOT NULL UNIQUE COMMENT '形象编码',
    name            VARCHAR(64) NOT NULL COMMENT '形象名称',
    gender          VARCHAR(10) NOT NULL COMMENT 'male/female',
    
    -- 适用场景
    suitable_stages VARCHAR(50) NOT NULL COMMENT '适用学段: 1,2,3,4',
    suitable_subjects VARCHAR(100) NOT NULL COMMENT '适用学科: math,physics,...',
    
    -- 数字人资源
    model_url       VARCHAR(512) NOT NULL COMMENT '数字人模型资源URL',
    voice_id        VARCHAR(64) NOT NULL COMMENT '默认TTS音色ID',
    voice_speed     DECIMAL(3,2) NOT NULL DEFAULT 1.00 COMMENT '语速倍率',
    
    -- 动作集
    available_actions JSON NOT NULL COMMENT '支持的动作列表',
    available_expressions JSON NOT NULL COMMENT '支持的表情列表',
    
    -- 状态
    status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE/INACTIVE',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_stages (suitable_stages),
    INDEX idx_subjects (suitable_subjects)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数字人形象配置表';
```

### 3.5 视频资源库表 `generated_videos`

```sql
CREATE TABLE generated_videos (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         BIGINT NOT NULL COMMENT '生成任务ID',
    knowledge_point_id BIGINT NOT NULL,
    chapter_id      BIGINT,
    
    -- 视频信息
    title           VARCHAR(256) NOT NULL,
    description     TEXT,
    video_url       VARCHAR(512) NOT NULL COMMENT 'OSS URL',
    thumbnail_url   VARCHAR(512) NOT NULL,
    duration        INT NOT NULL COMMENT '时长(秒)',
    file_size       BIGINT NOT NULL COMMENT '文件大小(bytes)',
    resolution      VARCHAR(20) NOT NULL COMMENT '如 1920x1080',
    format          VARCHAR(10) NOT NULL DEFAULT 'mp4' COMMENT '视频格式',
    bitrate         INT NOT NULL COMMENT '码率(kbps)',
    
    -- 分类标签
    stage           TINYINT NOT NULL COMMENT '学段',
    subject         VARCHAR(20) NOT NULL COMMENT '学科',
    video_type      VARCHAR(32) NOT NULL COMMENT 'EXPLAIN/EXAMPLE/REVIEW/MICRO',
    
    -- 关联
    script_id       BIGINT COMMENT '使用的脚本ID',
    avatar_code     VARCHAR(32) COMMENT '使用的数字人',
    
    -- 统计
    view_count      INT NOT NULL DEFAULT 0,
    like_count      INT NOT NULL DEFAULT 0,
    completion_rate DECIMAL(3,2) DEFAULT 0 COMMENT '平均完播率',
    
    -- 状态
    status          VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED' COMMENT 'DRAFT/PUBLISHED/OFFLINE/ARCHIVED',
    published_at    DATETIME,
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_kp_stage (knowledge_point_id, stage),
    INDEX idx_chapter (chapter_id),
    INDEX idx_status (status),
    INDEX idx_published (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='生成视频资源库';
```

---

## 4. API 接口设计

### 4.1 提交视频生成任务

```
POST /api/v1/video-generation/tasks
```

**请求体：**
```json
{
  "knowledge_point_id": 10086,
  "chapter_id": 246,
  "target_stage": 3,
  "target_subject": "math",
  "video_style": "standard",
  "duration_target": 180,
  "format_target": "16:9",
  "avatar_code": "teacher_female_01",
  "priority": "NORMAL",
  "callback_url": "https://api.primetop.com/internal/video-callback"
}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "task_no": "VT20260807183000ABC123",
    "status": "PENDING",
    "estimated_time_seconds": 600,
    "estimated_cost": 0.85
  }
}
```

### 4.2 查询任务状态

```
GET /api/v1/video-generation/tasks/{task_no}
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "task_no": "VT20260807183000ABC123",
    "status": "PROCESSING",
    "current_step": "TTS_SYNTHESIS",
    "progress": 45,
    "steps": [
      {"name": "SCRIPT_GENERATION", "status": "COMPLETED", "duration_ms": 8500},
      {"name": "SCRIPT_REVIEW", "status": "COMPLETED", "duration_ms": 1200},
      {"name": "TTS_SYNTHESIS", "status": "PROCESSING", "progress": 60},
      {"name": "AVATAR_RENDERING", "status": "PENDING"},
      {"name": "VIDEO_COMPOSITION", "status": "PENDING"},
      {"name": "QUALITY_CHECK", "status": "PENDING"}
    ],
    "script_preview": {
      "title": "一元二次方程求根公式",
      "total_segments": 4,
      "estimated_duration": 105
    }
  }
}
```

### 4.3 批量生成（按章节）

```
POST /api/v1/video-generation/batch
```

**请求体：**
```json
{
  "chapter_id": 246,
  "knowledge_point_ids": [10086, 10087, 10088, 10089],
  "target_stage": 3,
  "target_subject": "math",
  "video_style": "concise",
  "format_target": "9:16",
  "concurrency_limit": 3
}
```

### 4.4 脚本预览与编辑

```
GET  /api/v1/video-generation/tasks/{task_no}/script
PUT  /api/v1/video-generation/scripts/{script_id}
```

**PUT 请求体（编辑脚本分段）：**
```json
{
  "segments": [
    {
      "segment_id": "seg_001",
      "narration": "修改后的旁白文本...",
      "visual": {
        "type": "TEXT_OVERLAY",
        "content": "修改后的标题"
      }
    }
  ],
  "notes": "调整了开头引入部分，更加生动"
}
```

### 4.5 视频审核接口

```
POST /api/v1/video-generation/tasks/{task_no}/review
```

```json
{
  "action": "APPROVE",
  "quality_score": 8.5,
  "notes": "讲解清晰，但语速可以稍快",
  "tags": ["clear_explanation", "good_pacing"]
}
```

### 4.6 获取生成视频列表

```
GET /api/v1/video-generation/videos?knowledge_point_id=10086&stage=3&page=1&size=20
```

### 4.7 Webhook 回调通知

当任务完成或失败时，系统向 `callback_url` 发送 POST 请求：

```json
{
  "event": "VIDEO_GENERATION_COMPLETED",
  "task_no": "VT20260807183000ABC123",
  "status": "COMPLETED",
  "video_url": "https://oss.primetop.com/videos/VT20260807183000ABC123.mp4",
  "thumbnail_url": "https://oss.primetop.com/thumbnails/VT20260807183000ABC123.jpg",
  "duration": 102,
  "quality_score": 8.3,
  "cost": 0.72,
  "timestamp": "2026-08-07T10:25:00Z"
}
```

---

## 5. 核心流程详细设计

### 5.1 整体工作流状态机

```
                    ┌─────────┐
                    │ PENDING │
                    └────┬────┘
                         │ start
                         ▼
                ┌────────────────┐
                │SCRIPT_GENERATING│
                └───────┬────────┘
                        │ script_done
                        ▼
                ┌────────────────┐     reject
            ┌──►│SCRIPT_REVIEW   │───────────► FAILED
            |   └───────┬────────┘
            |           │ approve
            |           ▼
            |   ┌────────────────┐
            |   │TTS_SYNTHESIS   │
            |   └───────┬────────┘
            |           │ tts_done
            |           ▼
            |   ┌────────────────────┐
            |   │AVATAR_RENDERING    │
            |   └───────┬────────────┘
            |           │ render_done
            |           ▼
            |   ┌────────────────────┐
            |   │VIDEO_COMPOSITION   │
            |   └───────┬────────────┘
            |           │ compose_done
            |           ▼
            |   ┌────────────────┐
            |   │QUALITY_CHECK   │
            |   └───────┬────────┘
            |           │ qc_pass
            |           ▼
            |   ┌────────────────┐
            |   │PENDING_REVIEW  │◄──────── manual_edit ─┐
            |   └───────┬────────┘                       │
            |           │ approve                        │
            |           ▼                                │
            |   ┌────────────────┐                       │
            └───│COMPLETED       │                       │
                └────────────────┘                       │
                                                         │
                    Any Step ──► FAILED ──► retry ───────┘
```

### 5.2 步骤一：脚本生成（ScriptGeneration）

#### 5.2.1 Prompt 模板

```python
SCRIPT_GENERATION_PROMPT = """你是一位专业的{subject}教研专家，请为{stage}学生生成一个关于"{knowledge_point_name}"的讲解视频脚本。

## 要求
1. 目标时长：{duration_target}秒（约{word_count}字）
2. 风格：{video_style_desc}
3. 学段：{stage_name}
4. 教材版本：{textbook_version}
5. 难度：{difficulty_level}/5

## 脚本结构
按照以下分段结构生成：
- INTRO（引入）：15-20秒，吸引注意力，引入主题
- CONCEPT（概念讲解）：30-60秒，核心知识点讲解
- EXAMPLE（例题）：30-60秒，典型例题分步演示
- SUMMARY（总结）：10-15秒，要点回顾

## 输出格式
严格按照 JSON 格式输出，包含 segments 数组，每个 segment 包含：
- segment_id: seg_001 格式
- type: INTRO/CONCEPT/EXAMPLE/SUMMARY
- duration_estimate: 预计秒数
- narration: 旁白文本（口语化，适合播报）
- avatar_action: wave/point_right/point_left/write/nod/think
- avatar_expression: friendly/focused/thoughtful/encouraging
- visual: 视觉内容描述
- bgm_mood: uplifting/neutral/calm

## 知识点信息
{knowledge_point_detail}

## 教材章节信息
{chapter_detail}

## 注意事项
- 旁白必须是口语化表达，适合语音播报，避免书面语
- 数学公式使用 LaTeX 格式
- 每段旁白不超过3句话，便于停顿和节奏控制
- 内容要准确无误，符合{stage_name}学生认知水平
"""
```

#### 5.2.2 脚本生成核心代码

```python
import json
import hashlib
from typing import Optional

class ScriptGenerator:
    """视频脚本生成器"""
    
    def __init__(self, llm_client, knowledge_service, textbook_service):
        self.llm = llm_client
        self.knowledge = knowledge_service
        self.textbook = textbook_service
    
    async def generate(
        self,
        knowledge_point_id: int,
        chapter_id: int,
        target_stage: int,
        target_subject: str,
        video_style: str,
        duration_target: int
    ) -> dict:
        """生成视频脚本"""
        
        # 1. 获取知识点详情
        kp_detail = await self.knowledge.get_point_detail(knowledge_point_id)
        if not kp_detail:
            raise ValueError(f"Knowledge point {knowledge_point_id} not found")
        
        # 2. 获取章节信息
        chapter = await self.textbook.get_chapter(chapter_id)
        
        # 3. 构建Prompt
        stage_names = {1: "幼儿", 2: "小学", 3: "初中", 4: "高中"}
        style_descs = {
            "standard": "标准教学风格，条理清晰，语言简洁",
            "lively": "活泼生动风格，多用比喻和生活化例子",
            "concise": "精炼简洁风格，直击要点，适合复习",
            "exam": "应试导向风格，突出考点和易错点"
        }
        
        prompt = SCRIPT_GENERATION_PROMPT.format(
            subject=target_subject,
            stage=target_stage,
            stage_name=stage_names[target_stage],
            knowledge_point_name=kp_detail['name'],
            knowledge_point_detail=json.dumps(kp_detail, ensure_ascii=False),
            chapter_detail=json.dumps(chapter, ensure_ascii=False),
            duration_target=duration_target,
            word_count=int(duration_target * 3.5),  # 平均语速约3.5字/秒
            video_style_desc=style_descs.get(video_style, style_descs['standard']),
            textbook_version=chapter.get('textbook_version', '人教版'),
            difficulty_level=kp_detail.get('difficulty', 3)
        )
        
        # 4. 调用LLM生成脚本
        response = await self.llm.chat(
            model="glm-4-plus",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            response_format={"type": "json_object"},
            max_tokens=4096
        )
        
        script_data = json.loads(response.content)
        
        # 5. 后处理与校验
        script_data = self._post_process(script_data, duration_target)
        
        # 6. 记录Prompt哈希用于版本追踪
        script_data['llm_prompt_hash'] = hashlib.sha256(
            prompt.encode('utf-8')
        ).hexdigest()[:16]
        script_data['llm_model'] = response.model
        
        return script_data
    
    def _post_process(self, script_data: dict, target_duration: int) -> dict:
        """脚本后处理：校验、调整时长"""
        
        segments = script_data.get('segments', [])
        if not segments:
            raise ValueError("LLM returned empty segments")
        
        total = 0
        for seg in segments:
            # 确保必要字段存在
            seg.setdefault('avatar_action', 'nod')
            seg.setdefault('avatar_expression', 'focused')
            seg.setdefault('bgm_mood', 'neutral')
            
            # 根据旁白字数重新估算时长
            narration = seg.get('narration', '')
            char_count = len(narration)
            estimated_seconds = max(5, int(char_count / 3.5) + 2)  # 3.5字/秒 + 2秒停顿
            seg['duration_estimate'] = estimated_seconds
            total += estimated_seconds
        
        script_data['total_duration'] = total
        script_data['word_count'] = sum(
            len(s.get('narration', '')) for s in segments
        )
        
        return script_data
```

### 5.3 步骤二：TTS 语音合成（TTSSynthesis）

#### 5.3.1 设计要点

- 按 segment 粒度分别合成，便于失败重试
- 合成后检测音频时长，与脚本预估时长对比
- 支持多音色切换（不同学段/学科可配置不同音色）
- 自动在段落间插入停顿（INTRO 后插入 0.5s，EXAMPLE 步骤间插入 0.3s）

#### 5.3.2 核心代码

```python
import asyncio
import io
from dataclasses import dataclass

@dataclass
class TTSResult:
    segment_id: str
    audio_data: bytes
    duration_ms: int
    sample_rate: int
    
class TTSEngine:
    """语音合成引擎"""
    
    # 学段默认音色配置
    STAGE_VOICE_MAP = {
        1: {"voice_id": "cosyvoice_child_female", "speed": 0.95, "pitch": 1.1},
        2: {"voice_id": "cosyvoice_gentle_female", "speed": 1.0, "pitch": 1.0},
        3: {"voice_id": "cosyvoice_standard_female", "speed": 1.05, "pitch": 1.0},
        4: {"voice_id": "cosyvoice_professional_female", "speed": 1.1, "pitch": 0.95},
    }
    
    def __init__(self, tts_client, oss_client):
        self.tts = tts_client
        self.oss = oss_client
    
    async def synthesize_script(
        self,
        script: dict,
        stage: int,
        avatar_config: dict
    ) -> list[TTSResult]:
        """合成整个脚本的语音"""
        
        voice_config = self._get_voice_config(stage, avatar_config)
        segments = script['segments']
        
        # 并发合成各段语音（控制并发数避免限流）
        semaphore = asyncio.Semaphore(5)
        tasks = [
            self._synthesize_segment(semaphore, seg, voice_config)
            for seg in segments
        ]
        results = await asyncio.gather(*tasks)
        
        return list(results)
    
    def _get_voice_config(self, stage: int, avatar_config: dict) -> dict:
        """获取音色配置"""
        config = self.STAGE_VOICE_MAP.get(stage, self.STAGE_VOICE_MAP[3])
        # 数字人自定义音色优先
        if avatar_config.get('voice_id'):
            config['voice_id'] = avatar_config['voice_id']
        if avatar_config.get('voice_speed'):
            config['speed'] = float(avatar_config['voice_speed'])
        return config
    
    async def _synthesize_segment(
        self,
        semaphore: asyncio.Semaphore,
        segment: dict,
        voice_config: dict
    ) -> TTSResult:
        """合成单段语音"""
        
        async with semaphore:
            narration = segment['narration']
            seg_type = segment.get('type', 'CONCEPT')
            
            # 段尾添加停顿
            pause_map = {"INTRO": 0.5, "CONCEPT": 0.3, "EXAMPLE": 0.2, "SUMMARY": 0.5}
            pause_seconds = pause_map.get(seg_type, 0.3)
            
            # 调用TTS API
            for attempt in range(3):
                try:
                    audio_bytes = await self.tts.synthesize(
                        text=narration,
                        voice_id=voice_config['voice_id'],
                        speed=voice_config['speed'],
                        pitch=voice_config['pitch'],
                        format='wav',
                        sample_rate=24000
                    )
                    
                    # 添加段尾停顿（静音）
                    if pause_seconds > 0:
                        audio_bytes = self._append_silence(
                            audio_bytes, pause_seconds, sample_rate=24000
                        )
                    
                    # 计算实际时长
                    duration_ms = self._get_audio_duration_ms(audio_bytes)
                    
                    return TTSResult(
                        segment_id=segment['segment_id'],
                        audio_data=audio_bytes,
                        duration_ms=duration_ms,
                        sample_rate=24000
                    )
                    
                except Exception as e:
                    if attempt == 2:
                        raise RuntimeError(
                            f"TTS failed for segment {segment['segment_id']}: {e}"
                        )
                    await asyncio.sleep(2 ** attempt)
    
    def _append_silence(self, audio_bytes: bytes, seconds: float, sample_rate: int) -> bytes:
        """在音频末尾添加静音"""
        # 实现依赖于音频处理库，这里用伪代码表示
        silence_samples = int(seconds * sample_rate * 2)  # 16bit = 2 bytes/sample
        silence = b'\x00' * silence_samples
        return audio_bytes + silence
    
    def _get_audio_duration_ms(self, audio_bytes: bytes) -> int:
        """计算WAV音频时长"""
        # 解析WAV头获取时长
        import struct
        if len(audio_bytes) < 44:
            return 0
        sample_rate = struct.unpack('<I', audio_bytes[24:28])[0]
        data_size = len(audio_bytes) - 44
        bytes_per_sample = 2  # 16bit
        duration_ms = int((data_size / (sample_rate * bytes_per_sample)) * 1000)
        return duration_ms
```

### 5.4 步骤三：数字人渲染（AvatarRendering）

#### 5.4.1 渲染流程

```
输入                           处理                         输出
─────                         ─────                       ─────
音频文件 ──────────────►  唇形序列分析  ──────────►  口型关键帧序列
                          │
动作指令 ──────────────►  动作映射    ──────────►  身体动作帧序列
                          │
表情指令 ──────────────►  表情插值    ──────────►  面部表情帧序列
                          │
背景模板 ──────────────►  场景合成    ──────────►  背景图层
                          │
                    合并所有帧 ──────►  透明背景数字人视频序列 (PNG sequence / WebM)
```

#### 5.4.2 渲染调度代码

```python
from enum import Enum

class RenderResolution(str, Enum):
    HD_720P = "1280x720"
    FHD_1080P = "1920x1080"
    VERTICAL_1080x1920 = "1080x1920"
    SQUARE_1080x1080 = "1080x1080"

class AvatarRenderer:
    """数字人渲染引擎"""
    
    RESOLUTION_MAP = {
        "16:9": RenderResolution.FHD_1080P,
        "9:16": RenderResolution.VERTICAL_1080x1920,
        "1:1": RenderResolution.SQUARE_1080x1080,
    }
    
    def __init__(self, render_client, oss_client):
        self.render = render_client  # 数字人SDK客户端
        self.oss = oss_client
    
    async def render_video(
        self,
        task_no: str,
        avatar_code: str,
        tts_results: list[TTSResult],
        script_segments: list[dict],
        format_target: str
    ) -> dict:
        """
        渲染数字人视频
        返回: {render_url, total_frames, fps, resolution}
        """
        resolution = self.RESOLUTION_MAP.get(
            format_target, RenderResolution.FHD_1080P
        )
        
        # 1. 合并音频为完整文件
        merged_audio = self._merge_audio(tts_results)
        audio_url = await self.oss.upload(
            f"temp/{task_no}_audio.wav", merged_audio
        )
        
        # 2. 构建动作时间轴
        action_timeline = self._build_action_timeline(tts_results, script_segments)
        
        # 3. 提交渲染任务到数字人SDK
        render_task = await self.render.submit(
            model_id=avatar_code,
            audio_url=audio_url,
            action_timeline=action_timeline,
            resolution=resolution.value,
            background="transparent",  # 透明背景，后续合成
            output_format="png_sequence",
            fps=25,
            lip_sync=True,
            quality="high"
        )
        
        # 4. 轮询渲染状态
        result = await self._poll_render_result(render_task['task_id'], timeout=600)
        
        return {
            'render_url': result['output_url'],
            'total_frames': result['total_frames'],
            'fps': 25,
            'resolution': resolution.value,
            'render_duration_s': result.get('render_time', 0)
        }
    
    def _merge_audio(self, tts_results: list[TTSResult]) -> bytes:
        """合并所有段音频为一个完整WAV"""
        # 按segment顺序合并
        merged = bytearray()
        # 写入WAV头
        sample_rate = tts_results[0].sample_rate if tts_results else 24000
        
        for result in sorted(tts_results, key=lambda r: r.segment_id):
            # 去除各段WAV头，只保留数据
            data = result.audio_data[44:] if len(result.audio_data) > 44 else result.audio_data
            merged.extend(data)
        
        # 重新构建WAV头
        import struct
        data_size = len(merged)
        wav_header = struct.pack(
            '<4sI4s4sIHHIIHH4sI',
            b'RIFF', 36 + data_size, b'WAVE',
            b'fmt ', 16, 1, 1, sample_rate,
            sample_rate * 2, 2, 16,
            b'data', data_size
        )
        return bytes(wav_header) + bytes(merged)
    
    def _build_action_timeline(
        self,
        tts_results: list[TTSResult],
        segments: list[dict]
    ) -> list[dict]:
        """构建数字人动作时间轴"""
        timeline = []
        current_ms = 0
        
        # 创建segment_id到segment的映射
        seg_map = {s['segment_id']: s for s in segments}
        
        for result in sorted(tts_results, key=lambda r: r.segment_id):
            seg = seg_map.get(result.segment_id, {})
            
            timeline.append({
                "start_ms": current_ms,
                "end_ms": current_ms + result.duration_ms,
                "action": seg.get('avatar_action', 'nod'),
                "expression": seg.get('avatar_expression', 'focused'),
                "look_at": "camera"  # 默认看镜头
            })
            
            current_ms += result.duration_ms
        
        return timeline
    
    async def _poll_render_result(
        self, task_id: str, timeout: int = 600
    ) -> dict:
        """轮询数字人渲染结果"""
        import time
        start = time.time()
        
        while time.time() - start < timeout:
            status = await self.render.get_status(task_id)
            
            if status['state'] == 'COMPLETED':
                return status['result']
            elif status['state'] == 'FAILED':
                raise RuntimeError(
                    f"Avatar rendering failed: {status.get('error')}"
                )
            
            await asyncio.sleep(10)
        
        raise TimeoutError(f"Avatar rendering timeout after {timeout}s")
```

### 5.5 步骤四：视频合成（VideoComposition）

#### 5.5.1 合成层级

```
最终视频画面 (1920x1080)
┌─────────────────────────────────────────────┐
│              背景层 (BG Layer)                │
│  ┌──────────────────────────────────────┐   │
│  │         纯色/渐变/模板背景              │   │
│  │                                      │   │
│  │  ┌─────────────┐  ┌───────────────┐  │   │
│  │  │  数字人层    │  │   内容面板层    │  │   │
│  │  │  (左侧1/3)  │  │  (右侧2/3)    │  │   │
│  │  │             │  │               │  │   │
│  │  │  [Teacher]  │  │  [公式/图表/   │  │   │
│  │  │             │  │   文字内容]    │  │   │
│  │  └─────────────┘  └───────────────┘  │   │
│  │                                      │   │
│  │  ┌──────────────────────────────────┐│   │
│  │  │         字幕层 (底部)              ││   │
│  │  └──────────────────────────────────┘│   │
│  └──────────────────────────────────────┘   │
│              BGM 背景音乐层                   │
└─────────────────────────────────────────────┘
```

#### 5.5.2 FFmpeg 合成脚本

```python
import subprocess
import tempfile
import os
from pathlib import Path

class VideoComposer:
    """视频合成器"""
    
    # 各格式布局配置
    LAYOUT_CONFIG = {
        "16:9": {
            "canvas": "1920x1080",
            "avatar_area": "0:0:640:1080",       # 左侧1/3
            "content_area": "640:0:1280:1080",   # 右侧2/3
            "subtitle_area": "center_bottom"
        },
        "9:16": {
            "canvas": "1080x1920",
            "avatar_area": "0:0:1080:720",       # 上方
            "content_area": "0:720:1080:1200",   # 中间
            "subtitle_area": "center_bottom"
        },
        "1:1": {
            "canvas": "1080x1080",
            "avatar_area": "0:0:360:1080",
            "content_area": "360:0:720:1080",
            "subtitle_area": "center_bottom"
        }
    }
    
    def __init__(self, oss_client, bgm_library):
        self.oss = oss_client
        self.bgm = bgm_library
    
    async def compose(
        self,
        task_no: str,
        render_result: dict,
        tts_results: list[TTSResult],
        script: dict,
        format_target: str,
        avatar_code: str
    ) -> dict:
        """
        合成最终视频
        """
        layout = self.LAYOUT_CONFIG[format_target]
        work_dir = Path(tempfile.mkdtemp(prefix=f"video_{task_no}_"))
        
        try:
            # 1. 下载数字人渲染结果帧序列
            frame_dir = work_dir / "frames"
            await self._download_frames(render_result['render_url'], frame_dir)
            
            # 2. 合并音频
            audio_path = work_dir / "full_audio.wav"
            self._write_merged_audio(audio_path, tts_results)
            
            # 3. 为每个segment生成内容面板图片
            content_images = await self._generate_content_panels(
                script['segments'], layout, work_dir
            )
            
            # 4. 生成字幕文件 (SRT)
            subtitle_path = work_dir / "subtitles.srt"
            self._generate_srt(subtitle_path, tts_results, script['segments'])
            
            # 5. 选择BGM
            bgm_path = await self._select_bgm(
                script['segments'], work_dir
            )
            
            # 6. FFmpeg 合成
            output_path = work_dir / f"{task_no}.mp4"
            await self._ffmpeg_compose(
                frame_dir=frame_dir,
                audio_path=str(audio_path),
                content_images=content_images,
                subtitle_path=str(subtitle_path),
                bgm_path=str(bgm_path),
                output_path=str(output_path),
                layout=layout,
                fps=render_result['fps'],
                canvas=layout['canvas']
            )
            
            # 7. 生成缩略图
            thumbnail_path = work_dir / f"{task_no}_thumb.jpg"
            self._extract_thumbnail(str(output_path), str(thumbnail_path))
            
            # 8. 上传到OSS
            video_url = await self.oss.upload(
                f"videos/{task_no}.mp4", output_path.read_bytes()
            )
            thumb_url = await self.oss.upload(
                f"thumbnails/{task_no}.jpg", thumbnail_path.read_bytes()
            )
            
            # 9. 获取视频信息
            video_info = self._probe_video(str(output_path))
            
            return {
                'video_url': video_url,
                'thumbnail_url': thumb_url,
                'duration': video_info['duration'],
                'file_size': output_path.stat().st_size,
                'resolution': video_info['resolution'],
                'bitrate': video_info['bitrate']
            }
            
        finally:
            # 清理临时文件
            import shutil
            shutil.rmtree(work_dir, ignore_errors=True)
    
    async def _ffmpeg_compose(
        self,
        frame_dir: Path,
        audio_path: str,
        content_images: list,
        subtitle_path: str,
        bgm_path: str,
        output_path: str,
        layout: dict,
        fps: int,
        canvas: str
    ):
        """使用FFmpeg合成最终视频"""
        
        # 构建FFmpeg滤镜链
        # 输入：
        #   - 数字人帧序列 (PNG sequence)
        #   - 内容面板图片（按时间段切换）
        #   - 背景画布
        #   - 音频（旁白 + BGM）
        #   - 字幕
        
        avatar_x, avatar_y, avatar_w, avatar_h = (
            self._parse_area(layout['avatar_area'])
        )
        
        filter_complex = f"""
        [0:v]fps={fps},scale={avatar_w}:{avatar_h}[avatar];
        color=c=0x1a1a2e:s={canvas}:d=9999[bg];
        [bg][avatar]overlay={avatar_x}:{avatar_y}[base];
        [base][1:v]overlay=eof_action=pass:shortest=1[with_content];
        [with_content]subtitles={subtitle_path}:force_style='FontSize=24,PrimaryColour=&HFFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=2,Shadow=0,MarginV=40'[out];
        """
        
        cmd = [
            "ffmpeg", "-y",
            "-i", f"{frame_dir}/frame_%06d.png",       # 输入0: 数字人帧
            "-i", str(content_images[0]['path']),       # 输入1: 内容面板（首帧，后续用timeline切换）
            "-i", audio_path,                            # 输入2: 旁白音频
            "-i", bgm_path,                              # 输入3: BGM
            "-filter_complex", " ".join(filter_complex.split()),
            "-map", "[out]",
            "-map", "2:a",
            "-map", "3:a",
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a:0", "aac", "-b:a:0", "192k",
            "-c:a:1", "aac", "-b:a:1", "64k",
            "-filter:a:1", "volume=0.15",                # BGM音量降低
            "-shortest",
            "-movflags", "+faststart",
            output_path
        ]
        
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        _, stderr = await process.communicate()
        
        if process.returncode != 0:
            raise RuntimeError(
                f"FFmpeg composition failed: {stderr.decode()[:500]}"
            )
    
    def _generate_srt(
        self,
        srt_path: Path,
        tts_results: list,
        segments: list
    ):
        """生成SRT字幕文件"""
        seg_map = {s['segment_id']: s for s in segments}
        current_ms = 0
        
        with open(srt_path, 'w', encoding='utf-8') as f:
            idx = 1
            for result in sorted(tts_results, key=lambda r: r.segment_id):
                seg = seg_map.get(result.segment_id, {})
                narration = seg.get('narration', '')
                
                start = self._ms_to_srt_time(current_ms)
                end = self._ms_to_srt_time(current_ms + result.duration_ms)
                
                f.write(f"{idx}\n")
                f.write(f"{start} --> {end}\n")
                f.write(f"{narration}\n\n")
                
                current_ms += result.duration_ms
                idx += 1
    
    @staticmethod
    def _ms_to_srt_time(ms: int) -> str:
        """毫秒转SRT时间格式 HH:MM:SS,mmm"""
        h = ms // 3600000
        m = (ms % 3600000) // 60000
        s = (ms % 60000) // 1000
        msec = ms % 1000
        return f"{h:02d}:{m:02d}:{s:02d},{msec:03d}"
    
    @staticmethod
    def _parse_area(area_str: str):
        """解析区域字符串 'x:y:w:h' -> (x, y, w, h)"""
        parts = area_str.split(':')
        return tuple(int(p) for p in parts)
```

---

## 6. 任务调度器设计

### 6.1 任务调度架构

```python
from celery import Celery, Task
from celery.exceptions import SoftTimeLimitExceeded
import redis
import json

# Celery 应用配置
app = Celery('video_generation')
app.conf.update(
    broker_url='redis://redis-cluster:6379/0',
    result_backend='redis://redis-cluster:6379/1',
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='Asia/Shanghai',
    enable_utc=True,
    
    # 并发控制
    worker_concurrency=4,
    worker_prefetch_multiplier=1,
    
    # 任务时限
    task_soft_time_limit=900,   # 15分钟软限制
    task_time_limit=1200,       # 20分钟硬限制
    
    # 重试
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_default_retry_delay=60,
    task_max_retries=2,
    
    # 队列路由
    task_routes={
        'video_generation.generate_single': {'queue': 'video_gen'},
        'video_generation.tts_batch': {'queue': 'tts'},
        'video_generation.render_batch': {'queue': 'gpu_render'},
        'video_generation.compose': {'queue': 'compose'},
    }
)

class VideoGenerationOrchestrator:
    """视频生成编排器"""
    
    STEP_CHAIN = [
        'SCRIPT_GENERATION',
        'SCRIPT_VALIDATION', 
        'TTS_SYNTHESIS',
        'AVATAR_RENDERING',
        'VIDEO_COMPOSITION',
        'QUALITY_CHECK'
    ]
    
    def __init__(self, db, redis_client, script_gen, tts_engine, 
                 avatar_renderer, video_composer, quality_checker):
        self.db = db
        self.redis = redis_client
        self.script_gen = script_gen
        self.tts = tts_engine
        self.renderer = avatar_renderer
        self.composer = video_composer
        self.quality = quality_checker
    
    async def execute_task(self, task_id: int):
        """执行完整的视频生成流程"""
        
        task = await self._load_task(task_id)
        
        try:
            await self._update_status(task_id, 'PROCESSING', 'SCRIPT_GENERATION', 5)
            
            # Step 1: 脚本生成
            script = await self.script_gen.generate(
                knowledge_point_id=task['knowledge_point_id'],
                chapter_id=task['chapter_id'],
                target_stage=task['target_stage'],
                target_subject=task['target_subject'],
                video_style=task['video_style'],
                duration_target=task['duration_target']
            )
            script_id = await self._save_script(task_id, script)
            await self._update_status(task_id, 'PROCESSING', 'SCRIPT_VALIDATION', 15)
            
            # Step 2: 脚本校验（自动 + 规则）
            validation = await self._validate_script(script, task)
            if not validation['passed']:
                # 自动修复一次
                script = await self.script_gen.fix_issues(script, validation['issues'])
                validation = await self._validate_script(script, task)
                if not validation['passed']:
                    raise ValueError(f"Script validation failed: {validation['issues']}")
            
            await self._update_status(task_id, 'PROCESSING', 'TTS_SYNTHESIS', 25)
            
            # Step 3: TTS语音合成
            avatar_config = await self._get_avatar_config(task.get('avatar_code'))
            tts_results = await self.tts.synthesize_script(
                script=script,
                stage=task['target_stage'],
                avatar_config=avatar_config
            )
            await self._save_intermediate(task_id, 'tts_results', tts_results)
            await self._update_status(task_id, 'PROCESSING', 'AVATAR_RENDERING', 50)
            
            # Step 4: 数字人渲染
            render_result = await self.renderer.render_video(
                task_no=task['task_no'],
                avatar_code=avatar_config['avatar_code'],
                tts_results=tts_results,
                script_segments=script['segments'],
                format_target=task['format_target']
            )
            await self._update_status(task_id, 'PROCESSING', 'VIDEO_COMPOSITION', 75)
            
            # Step 5: 视频合成
            composition = await self.composer.compose(
                task_no=task['task_no'],
                render_result=render_result,
                tts_results=tts_results,
                script=script,
                format_target=task['format_target'],
                avatar_code=avatar_config['avatar_code']
            )
            await self._update_status(task_id, 'PROCESSING', 'QUALITY_CHECK', 90)
            
            # Step 6: 质量检查
            qc_result = await self.quality.check(
                video_url=composition['video_url'],
                script=script,
                tts_results=tts_results
            )
            
            if qc_result['passed']:
                await self._complete_task(task_id, composition, qc_result)
                await self._notify_callback(task, 'COMPLETED', composition)
            else:
                await self._fail_task(
                    task_id, 
                    f"Quality check failed: {qc_result['issues']}"
                )
                await self._notify_callback(task, 'FAILED', {'reason': qc_result['issues']})
            
        except SoftTimeLimitExceeded:
            await self._fail_task(task_id, "Task exceeded time limit (15min)")
        except Exception as e:
            await self._fail_task(task_id, str(e))
            await self._notify_callback(task, 'FAILED', {'error': str(e)})
    
    async def _update_status(
        self, task_id: int, status: str, step: str, progress: int
    ):
        """更新任务状态"""
        await self.db.execute(
            """UPDATE video_generation_tasks 
               SET status=%s, current_step=%s, progress=%s, updated_at=NOW()
               WHERE id=%s""",
            (status, step, progress, task_id)
        )
        # 发布进度事件到Redis（供前端实时查询）
        self.redis.publish(
            f"video_task:{task_id}",
            json.dumps({"status": status, "step": step, "progress": progress})
        )
```

---

## 7. 质量检查模块

### 7.1 质量检查策略

| 维度 | 检查项 | 方法 | 阈值 |
| --- | --- | --- | --- |
| 音画同步 | 音频与口型时间差 | 对齐检测算法 | ≤ 80ms |
| 音频质量 | 信噪比、音量、 clipping | 音频分析库 | SNR ≥ 30dB |
| 视频质量 | 分辨率、帧率、码率 | FFprobe | 1080p@25fps |
| 内容准确性 | 旁白与知识点一致性 | LLM 二次校验 | 置信度 ≥ 0.9 |
| 字幕对齐 | 字幕与音频匹配 | 时间戳对比 | 偏差 ≤ 200ms |
| 时长合规 | 实际时长 vs 目标 | 时长对比 | ±20% |

### 7.2 核心代码

```python
class QualityChecker:
    """视频质量检查器"""
    
    async def check(
        self,
        video_url: str,
        script: dict,
        tts_results: list
    ) -> dict:
        """执行全套质量检查"""
        
        results = {}
        issues = []
        
        # 1. 视频基础信息检查
        video_info = await self._probe_video(video_url)
        results['video_info'] = video_info
        
        if video_info['duration'] < 10:
            issues.append({"type": "TOO_SHORT", "detail": f"Duration {video_info['duration']}s < 10s"})
        
        target_duration = script.get('total_duration', 180)
        duration_ratio = video_info['duration'] / target_duration
        if duration_ratio < 0.8 or duration_ratio > 1.2:
            issues.append({
                "type": "DURATION_MISMATCH",
                "detail": f"Actual {video_info['duration']}s vs target {target_duration}s"
            })
        
        # 2. 音频质量检查
        audio_quality = await self._check_audio_quality(video_url)
        results['audio_quality'] = audio_quality
        
        if audio_quality['snr'] < 30:
            issues.append({
                "type": "LOW_SNR",
                "detail": f"Audio SNR {audio_quality['snr']}dB < 30dB"
            })
        
        if audio_quality['peak_db'] > -1.0:
            issues.append({
                "type": "AUDIO_CLIPPING",
                "detail": f"Peak level {audio_quality['peak_db']}dB may cause clipping"
            })
        
        # 3. 内容准确性检查（LLM校验）
        content_check = await self._check_content_accuracy(script)
        results['content_accuracy'] = content_check
        
        if content_check['confidence'] < 0.9:
            issues.append({
                "type": "CONTENT_INACCURATE",
                "detail": content_check.get('concerns', [])
            })
        
        # 4. 适龄性检查
        age_check = await self._check_age_appropriateness(script)
        results['age_appropriate'] = age_check
        
        if not age_check['appropriate']:
            issues.append({
                "type": "AGE_INAPPROPRIATE",
                "detail": age_check.get('issues', [])
            })
        
        passed = len(issues) == 0
        quality_score = self._calculate_score(results, issues)
        
        return {
            'passed': passed,
            'issues': issues,
            'quality_score': quality_score,
            'details': results
        }
    
    def _calculate_score(self, results: dict, issues: list) -> float:
        """计算质量评分 (0-10)"""
        base_score = 10.0
        
        severity_weight = {
            "TOO_SHORT": 5.0,
            "DURATION_MISMATCH": 1.0,
            "LOW_SNR": 2.0,
            "AUDIO_CLIPPING": 1.5,
            "CONTENT_INACCURATE": 4.0,
            "AGE_INAPPROPRIATE": 5.0
        }
        
        for issue in issues:
            base_score -= severity_weight.get(issue['type'], 1.0)
        
        return max(0.0, round(base_score, 1))
    
    async def _check_content_accuracy(self, script: dict) -> dict:
        """使用LLM校验讲解内容准确性"""
        narration_text = " ".join(
            seg['narration'] for seg in script['segments']
        )
        
        prompt = f"""请检查以下教育讲解内容的知识准确性。检查是否有事实错误、
概念混淆、公式错误或表述不当的地方。

讲解内容：
{narration_text}

请按JSON格式返回：
{{
  "accurate": true/false,
  "confidence": 0.0-1.0,
  "errors": ["具体错误1", "具体错误2"],
  "concerns": ["潜在问题1"]
}}
"""
        response = await self.llm.chat(
            model="glm-4-plus",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"}
        )
        
        return json.loads(response.content)
```

---

## 8. 错误处理与重试策略

### 8.1 错误分类

| 错误码 | 错误类型 | 描述 | 处理策略 |
| --- | --- | --- | --- |
| VG_SCRIPT_001 | SCRIPT_GEN_FAILED | LLM脚本生成失败 | 重试3次，更换模型后重试1次 |
| VG_SCRIPT_002 | SCRIPT_INVALID | 脚本校验不通过 | 自动修复1次，仍失败标记FAILED |
| VG_SCRIPT_003 | SCRIPT_TIMEOUT | 脚本生成超时 | 重试2次 |
| VG_TTS_001 | TTS_API_ERROR | TTS服务调用失败 | 按段重试3次，指数退避 |
| VG_TTS_002 | TTS_RATE_LIMIT | TTS服务限流 | 等待60s后重试 |
| VG_TTS_003 | TTS_AUDIO_EMPTY | 合成音频为空 | 重试2次，更换音色 |
| VG_RENDER_001 | RENDER_SUBMIT_FAILED | 渲染任务提交失败 | 重试2次 |
| VG_RENDER_002 | RENDER_TIMEOUT | 渲染超时 | 重试1次，降低质量等级 |
| VG_RENDER_003 | RENDER_OOM | GPU内存不足 | 排队等待，降低分辨率重试 |
| VG_COMPOSE_001 | FFMPEG_ERROR | FFmpeg合成失败 | 检查输入文件，重试1次 |
| VG_COMPOSE_002 | OSS_UPLOAD_FAILED | OSS上传失败 | 重试3次 |
| VG_QC_001 | QC_CONTENT_ERROR | 内容质量不通过 | 标记FAILED，通知人工审核 |
| VG_QC_002 | QC_AUDIO_DESYNC | 音画不同步 | 重新合成该段 |

### 8.2 重试策略实现

```python
from enum import Enum
import asyncio

class RetryPolicy:
    """重试策略"""
    
    POLICIES = {
        "SCRIPT_GEN_FAILED": {"max_retries": 3, "backoff": "exponential", 
                              "base_delay": 5, "max_delay": 60, "fallback_model": "deepseek-v3"},
        "SCRIPT_INVALID": {"max_retries": 1, "backoff": "fixed", "delay": 0},
        "TTS_API_ERROR": {"max_retries": 3, "backoff": "exponential", 
                          "base_delay": 2, "max_delay": 30},
        "TTS_RATE_LIMIT": {"max_retries": 5, "backoff": "fixed", "delay": 60},
        "RENDER_SUBMIT_FAILED": {"max_retries": 2, "backoff": "fixed", "delay": 30},
        "RENDER_TIMEOUT": {"max_retries": 1, "backoff": "fixed", "delay": 0, 
                          "fallback_action": "lower_quality"},
        "FFMPEG_ERROR": {"max_retries": 1, "backoff": "fixed", "delay": 5},
        "OSS_UPLOAD_FAILED": {"max_retries": 3, "backoff": "exponential", 
                             "base_delay": 2, "max_delay": 20},
    }
    
    @classmethod
    async def execute_with_retry(cls, error_code: str, func, *args, **kwargs):
        """带重试策略执行函数"""
        policy = cls.POLICIES.get(error_code, 
                                   {"max_retries": 2, "backoff": "fixed", "delay": 10})
        
        last_error = None
        for attempt in range(policy['max_retries'] + 1):
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                last_error = e
                
                if attempt < policy['max_retries']:
                    delay = cls._calculate_delay(policy, attempt)
                    await asyncio.sleep(delay)
                else:
                    # 尝试fallback
                    if policy.get('fallback_model'):
                        kwargs['model'] = policy['fallback_model']
                        try:
                            return await func(*args, **kwargs)
                        except Exception:
                            pass
                    
        raise last_error
    
    @classmethod
    def _calculate_delay(cls, policy: dict, attempt: int) -> float:
        """计算重试延迟"""
        if policy['backoff'] == 'exponential':
            delay = policy['base_delay'] * (2 ** attempt)
            return min(delay, policy.get('max_delay', 60))
        else:
            return policy.get('delay', 10)
```

---

## 9. 成本估算与资源管理

### 9.1 单视频成本模型

```
总成本 = 脚本生成成本 + TTS成本 + 渲染成本 + 合成成本 + 存储成本

具体估算（3分钟视频为例）：
┌──────────────┬─────────────────────────────────────┬──────────┐
│ 环节          │ 计算公式                              │ 预估成本  │
├──────────────┼─────────────────────────────────────┼──────────┤
│ LLM 脚本生成  │ ~2000 tokens × 0.05元/千tokens       │ ¥0.10    │
│ TTS 语音合成  │ 180秒 × 0.01元/秒                    │ ¥1.80    │
│ 数字人渲染    │ 180秒 × 0.02元/秒 (GPU)              │ ¥3.60    │
│ 视频合成      │ 固定成本                              │ ¥0.20    │
│ 存储（月）    │ ~50MB × 0.12元/GB/月                  │ ¥0.006   │
├──────────────┼─────────────────────────────────────┼──────────┤
│ 总计          │                                      │ ≈ ¥5.71  │
└──────────────┴─────────────────────────────────────┴──────────┘
```

### 9.2 成本控制策略

```python
class CostController:
    """成本控制器"""
    
    # 月度预算阈值
    MONTHLY_BUDGET = 50000  # 5万元/月
    
    # 各环节成本单价
    UNIT_COSTS = {
        'llm_tokens_per_1k': 0.05,
        'tts_per_second': 0.01,
        'render_per_second': 0.02,
        'composition_fixed': 0.20,
        'storage_per_gb_month': 0.12,
    }
    
    async def estimate_cost(self, duration_target: int) -> float:
        """预估单视频成本"""
        return (
            2000 / 1000 * self.UNIT_COSTS['llm_tokens_per_1k'] +
            duration_target * self.UNIT_COSTS['tts_per_second'] +
            duration_target * self.UNIT_COSTS['render_per_second'] +
            self.UNIT_COSTS['composition_fixed']
        )
    
    async def check_budget(self) -> dict:
        """检查月度预算"""
        monthly_spent = await self._get_monthly_spending()
        
        return {
            'monthly_budget': self.MONTHLY_BUDGET,
            'monthly_spent': monthly_spent,
            'remaining': self.MONTHLY_BUDGET - monthly_spent,
            'usage_rate': monthly_spent / self.MONTHLY_BUDGET,
            'can_generate': (self.MONTHLY_BUDGET - monthly_spent) > 10  # 至少够生成1个视频
        }
    
    async def record_cost(self, task_id: int, actual_costs: dict):
        """记录实际成本"""
        total = sum(actual_costs.values())
        await self.db.execute(
            """UPDATE video_generation_tasks 
               SET llm_tokens_used=%s, tts_seconds=%s, gpu_seconds=%s,
                   estimated_cost=%s
               WHERE id=%s""",
            (
                actual_costs.get('llm_tokens', 0),
                actual_costs.get('tts_seconds', 0),
                actual_costs.get('gpu_seconds', 0),
                total,
                task_id
            )
        )
```

---

## 10. 监控指标

### 10.1 关键监控指标

| 指标名 | 类型 | 描述 | 告警阈值 |
| --- | --- | --- | --- |
| vg.task.queue_depth | Gauge | 待处理任务队列深度 | > 50 |
| vg.task.success_rate | Rate | 任务成功率（24h） | < 90% |
| vg.task.avg_duration | Gauge | 平均任务完成时间 | > 900s |
| vg.task.failure_by_step | Counter | 按步骤分类的失败数 | - |
| vg.script.gen_time_p95 | Gauge | 脚本生成P95耗时 | > 30s |
| vg.tts.synthesis_time_p95 | Gauge | TTS合成P95耗时 | > 120s |
| vg.render.time_p95 | Gauge | 数字人渲染P95耗时 | > 600s |
| vg.compose.time_p95 | Gauge | 视频合成P95耗时 | > 180s |
| vg.quality.avg_score | Gauge | 质量评分平均值 | < 7.0 |
| vg.quality.audio_desync_rate | Rate | 音画不同步发生率 | > 5% |
| vg.cost.daily_total | Counter | 每日总成本 | > ¥2000 |
| vg.cost.per_video_avg | Gauge | 单视频平均成本 | > ¥8.0 |
| vg.gpu.utilization | Gauge | GPU利用率 | > 85% |

### 10.2 Prometheus 指标定义

```python
from prometheus_client import Counter, Gauge, Histogram

# 任务计数
vg_task_total = Counter(
    'vg_task_total', 'Total video generation tasks',
    ['status', 'target_stage', 'subject']
)

vg_task_duration = Histogram(
    'vg_task_duration_seconds', 'Task total duration',
    buckets=[60, 120, 300, 600, 900, 1200, 1800]
)

# 各步骤耗时
vg_step_duration = Histogram(
    'vg_step_duration_seconds', 'Step duration',
    ['step_name'],
    buckets=[5, 10, 30, 60, 120, 300, 600]
)

# 质量评分
vg_quality_score = Histogram(
    'vg_quality_score', 'Video quality score',
    buckets=[2, 4, 6, 7, 8, 9, 10]
)

# 成本
vg_cost_per_video = Gauge(
    'vg_cost_per_video_yuan', 'Cost per video in CNY'
)

vg_daily_cost = Counter(
    'vg_daily_cost_yuan_total', 'Daily total cost in CNY'
)

# 队列深度
vg_queue_depth = Gauge(
    'vg_queue_depth', 'Task queue depth',
    ['queue_name']
)
```

---

## 11. 缓存与性能优化

### 11.1 脚本缓存

相同知识点 + 学段 + 风格的脚本缓存复用：

```python
class ScriptCache:
    """脚本缓存服务"""
    
    CACHE_TTL = 86400 * 7  # 7天
    
    async def get_or_create(self, cache_key_params: dict) -> Optional[dict]:
        """获取缓存的脚本或创建新的"""
        cache_key = self._build_key(cache_key_params)
        
        # 从Redis获取
        cached = await self.redis.get(f"script_cache:{cache_key}")
        if cached:
            return json.loads(cached)
        
        return None
    
    async def cache_script(self, cache_key_params: dict, script: dict):
        """缓存脚本"""
        cache_key = self._build_key(cache_key_params)
        await self.redis.setex(
            f"script_cache:{cache_key}",
            self.CACHE_TTL,
            json.dumps(script, ensure_ascii=False)
        )
    
    def _build_key(self, params: dict) -> str:
        """构建缓存键"""
        import hashlib
        key_str = f"{params['kp_id']}:{params['stage']}:{params['style']}:{params['duration']}"
        return hashlib.md5(key_str.encode()).hexdigest()
```

### 11.2 TTS 音频复用

对于固定开场白和结尾语（如"同学们好"、"我们下节课再见"），预合成并缓存：

```python
# 预合成常用音频片段
COMMON_PHRASES = [
    ("intro_greeting_primary", "同学们好！今天我们来学习一个新知识。"),
    ("intro_greeting_review", "同学们好！今天我们来复习一个重要知识点。"),
    ("outro_encourage", "你学会了吗？下次课我们继续！"),
    ("outro_summary", "今天的内容就到这里，记得课后多练习哦！"),
]

async def pre_synthesize_common_phrases(tts_engine: TTSEngine):
    """预合成常用音频片段"""
    for phrase_key, text in COMMON_PHRASES:
        cache_key = f"tts_common:{phrase_key}"
        if not await redis.exists(cache_key):
            audio = await tts_engine.tts.synthesize(
                text=text, voice_id="default", format="wav"
            )
            await redis.setex(cache_key, 86400 * 30, audio)
```

---

## 12. 安全与权限

### 12.1 接口权限

| 接口 | 需要权限 | 说明 |
| --- | --- | --- |
| POST /tasks | `video:generate` | 内容运营、管理员 |
| GET /tasks/{id} | `video:read` | 所有后台用户 |
| POST /batch | `video:batch_generate` | 内容主管、管理员 |
| PUT /scripts/{id} | `video:edit_script` | 内容运营 |
| POST /review | `video:review` | 内容审核员 |
| GET /videos | `video:read` | 所有后台用户 |

### 12.2 内容安全

- 脚本生成阶段注入安全 Prompt 约束
- TTS 合成前对旁白文本进行敏感词过滤
- 质量检查包含内容准确性校验（LLM二次审核）
- 所有生成视频需人工审核后方可发布

---

## 13. 部署与扩展

### 13.1 部署拓扑

```
                    ┌──────────────┐
                    │  API Gateway  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │ Task Scheduler│  (Celery Beat)
                    │   (Main)     │
                    └──────┬───────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐
    │ Script Gen  │ │  TTS Worker │ │GPU Renderer │
    │  Worker x4  │ │  Pool x8    │ │  Pool x4    │
    │ (CPU)       │ │ (CPU)       │ │ (GPU T4/A10)│
    └─────────────┘ └────────────┘ └─────────────┘
                           │
                    ┌──────▼───────┐
                    │ Video Composer│
                    │ Worker x4     │
                    │ (CPU + FFmpeg)│
                    └──────────────┘
```

### 13.2 弹性扩缩

```yaml
# Kubernetes HPA 配置
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: video-gen-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: video-gen-script-worker
  minReplicas: 2
  maxReplicas: 8
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: External
    external:
      metric:
        name: vg_queue_depth
        selector:
          matchLabels:
            queue_name: video_gen
      target:
        type: AverageValue
        averageValue: "5"
```

---

## 14. 附录

### 14.1 数字人形象选择策略

```python
def select_avatar(stage: int, subject: str, style: str) -> str:
    """根据学段、学科和风格选择最合适的数字人"""
    
    AVATAR_MATRIX = {
        # 幼儿：亲和力强、活泼
        (1, "*"): ["cartoon_rabbit", "cartoon_bear", "teacher_young_female_01"],
        
        # 小学：亲切温柔
        (2, "chinese"): ["teacher_gentle_female_01", "teacher_warm_male_01"],
        (2, "math"): ["teacher_gentle_female_02", "teacher_patience_male_01"],
        (2, "english"): ["teacher_native_female_01", "teacher_young_male_01"],
        
        # 初中：专业清晰
        (3, "math"): ["teacher_professional_female_01", "teacher_serious_male_01"],
        (3, "physics"): ["teacher_professional_male_01", "teacher_female_glasses_01"],
        (3, "chinese"): ["teacher_elegant_female_01", "teacher_scholar_male_01"],
        
        # 高中：严谨权威
        (4, "math"): ["teacher_strict_male_01", "teacher_professional_female_02"],
        (4, "physics"): ["teacher_strict_male_02", "teacher_female_glasses_02"],
        (4, "chemistry"): ["teacher_lab_male_01", "teacher_lab_female_01"],
    }
    
    # 精确匹配 → 学科通配 → 默认
    avatars = (
        AVATAR_MATRIX.get((stage, subject)) or
        AVATAR_MATRIX.get((stage, "*")) or
        ["teacher_standard_female_01"]
    )
    
    return avatars[0]
```

### 14.2 BGM 选择策略

```python
BGM_LIBRARY = {
    "uplifting": ["bgm_inspire_01.mp3", "bgm_bright_02.mp3", "bgm_chirpy_01.mp3"],
    "neutral": ["bgm_soft_01.mp3", "bgm_calm_02.mp3", "bgm_piano_01.mp3"],
    "calm": ["bgm_ambient_01.mp3", "bgm_meditation_01.mp3"],
    "energetic": ["bgm_upbeat_01.mp3", "bgm_energetic_02.mp3"],
}

def select_bgm(segments: list) -> str:
    """根据脚本整体氛围选择BGM"""
    mood_counts = {}
    for seg in segments:
        mood = seg.get('bgm_mood', 'neutral')
        mood_counts[mood] = mood_counts.get(mood, 0) + 1
    
    dominant_mood = max(mood_counts, key=mood_counts.get)
    bgm_list = BGM_LIBRARY.get(dominant_mood, BGM_LIBRARY['neutral'])
    
    return random.choice(bgm_list)
```

### 14.3 错误码总表

| 错误码 | HTTP | 描述 |
| --- | --- | --- |
| 40001 | 400 | 参数错误 |
| 40004 | 404 | 任务不存在 |
| 40009 | 409 | 任务已存在（重复提交） |
| 40301 | 403 | 无权限操作 |
| 42901 | 429 | 生成任务提交频率超限 |
| 50001 | 500 | 脚本生成内部错误 |
| 50002 | 500 | TTS服务异常 |
| 50003 | 500 | 渲染服务异常 |
| 50004 | 500 | 视频合成异常 |
| 50005 | 500 | 质量检查异常 |
| 50301 | 503 | GPU资源不足，请稍后重试 |
| 50302 | 503 | 月度预算已用完 |

---

## 15. 版本记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-08-07 | 初版：完整设计文档 |
