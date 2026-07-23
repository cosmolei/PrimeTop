# 服务端-学生作业AI生成内容检测与AI辅助学习比例分析引擎-详细设计

## 1. 概述

### 1.1 功能定位

PrimeTop 作为 AI 辅助学习平台，为学生提供 AI 智能辅导、作文批改、解题辅助等能力。但平台同时承担教育责任：需要识别学生提交的作业（作文、简答题、报告等）中 AI 生成内容的比例，帮助教师和家长了解学生的真实写作能力和独立思考水平。

本引擎是连接"AI 辅助学习"与"学习成果真实性保障"的核心枢纽，通过多维度检测策略，输出 **AI 辅助比例评分** 和 **原创性分析报告**，为教师批改、家长监督、学情评估提供数据支撑。

### 1.2 核心目标

| 目标 | 说明 |
| --- | --- |
| AI 生成内容检测 | 识别学生提交的文本中哪些段落/句子由大模型生成 |
| AI 辅助比例量化 | 输出 0-100 的 AI 辅助比例分数，分为 5 个等级 |
| 原创性报告生成 | 为每份提交生成详细的原创性分析报告 |
| 学习行为关联分析 | 结合学生在平台内的 AI 对话记录，交叉验证作业真实性 |
| 教学辅助建议 | 为教师提供"哪些学生可能过度依赖 AI"的预警 |

### 1.3 适用范围

- **作文提交**：语文作文、英语作文
- **主观题作答**：简答题、论述题、实验报告
- **长文本作业**：读书笔记、研究报告、学习总结
- **口语表达文本**：语音背诵转文本后的内容

### 1.4 设计原则

1. **辅助而非惩罚**：检测结果用于引导和干预，不直接判定作弊
2. **多信号融合**：不依赖单一指标，结合文本特征、行为数据、上下文信息
3. **低误报率**：宁可漏报（保守估计），不可大量误报挫伤学生积极性
4. **透明可解释**：每份报告必须给出可解释的判断依据
5. **隐私保护**：检测结果仅对教师和家长可见，学生端展示鼓励性建议

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                   触发来源                                │
│  作文提交 │ 主观题作答 │ 长文本作业 │ 口语转文本 │ 教师手动触发 │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              AI内容检测编排服务 (核心)                     │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ 文本统计  │ │ 风格分析  │ │ 水印检测  │ │ 行为关联  │   │
│  │ 特征提取  │ │ 指纹比对  │ │ 模块     │ │ 分析模块  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                       │                                 │
│                       ▼                                 │
│              ┌────────────────┐                         │
│              │  融合决策引擎   │                         │
│              └────────────────┘                         │
│                       │                                 │
│                       ▼                                 │
│              ┌────────────────┐                         │
│              │  报告生成服务   │                         │
│              └────────────────┘                         │
└─────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  教师批改工作台 │ 家长学情报告 │ 学生学习建议 │ 管理后台    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 职责 | 技术依赖 |
| --- | --- | --- |
| 文本统计特征提取 | 分析文本的困惑度(Perplexity)、突发性(Burstiness)、句长分布等 | Python NLP 库 |
| 风格指纹比对 | 与学生历史作品进行写作风格一致性比对 | 嵌入向量模型 |
| 水印检测 | 检测 PrimeTop 平台 AI 输出的隐式水印 | 水印解析库 |
| 行为关联分析 | 对比学生提交内容与近期 AI 对话记录的相似度 | 向量检索 |
| 融合决策引擎 | 综合多维度信号输出最终评分和置信度 | 规则引擎 + ML 模型 |
| 报告生成服务 | 生成可视化原创性分析报告 | 模板渲染 |

---

## 3. 数据结构定义

### 3.1 检测任务表 `ai_detection_tasks`

```sql
CREATE TABLE ai_detection_tasks (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         VARCHAR(36) NOT NULL UNIQUE COMMENT '任务唯一ID (UUID)',
    student_id      BIGINT NOT NULL COMMENT '学生ID',
    submission_id   BIGINT NOT NULL COMMENT '关联提交记录ID',
    submission_type VARCHAR(20) NOT NULL COMMENT '提交类型: ESSAY/SHORT_ANSWER/REPORT/NOTE/ORAL_TEXT',
    subject         VARCHAR(20) COMMENT '学科: CHINESE/MATH/ENGLISH/...',
    grade_level     VARCHAR(20) COMMENT '年级',
    
    -- 原始内容
    content_text    TEXT NOT NULL COMMENT '待检测文本内容',
    content_hash    VARCHAR(64) NOT NULL COMMENT '内容SHA256哈希',
    word_count      INT NOT NULL COMMENT '字数',
    
    -- 检测结果
    ai_ratio_score      DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'AI辅助比例分数 0-100',
    ai_ratio_level      VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT '比例等级: MINIMAL/LOW/MODERATE/HIGH/EXTENSIVE/PENDING',
    confidence_score    DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '置信度 0-100',
    originality_score   DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '原创性评分 0-100',
    
    -- 检测状态
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/PROCESSING/COMPLETED/FAILED',
    retry_count     INT NOT NULL DEFAULT 0,
    error_message   TEXT,
    
    -- 时间
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completed_at    DATETIME,
    
    INDEX idx_student (student_id),
    INDEX idx_submission (submission_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI内容检测任务';
```

### 3.2 检测维度明细表 `ai_detection_dimensions`

```sql
CREATE TABLE ai_detection_dimensions (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id         VARCHAR(36) NOT NULL COMMENT '关联检测任务ID',
    
    -- 维度类型
    dimension       VARCHAR(40) NOT NULL COMMENT '检测维度: PERPLEXITY/BURSTINESS/STYLE_FINGERPRINT/WATERMARK/BEHAVIOR_CORRELATION/SENTENCE_PATTERN',
    
    -- 维度评分
    dimension_score     DECIMAL(5,2) NOT NULL COMMENT '该维度的AI概率分数 0-100',
    dimension_weight    DECIMAL(5,2) NOT NULL COMMENT '该维度权重 0-1',
    contribution        DECIMAL(5,2) NOT NULL COMMENT '对总分的贡献值',
    
    -- 详细数据
    detail_json     TEXT COMMENT '维度详细数据JSON',
    
    -- 段落级标注 (可选)
    paragraph_marks JSON COMMENT '段落级AI概率标注 [{para_idx, start, end, probability, evidence}]',
    
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_task (task_id),
    INDEX idx_dimension (dimension)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI检测维度明细';
```

### 3.3 学生写作风格基线表 `student_writing_baseline`

```sql
CREATE TABLE student_writing_baseline (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    student_id      BIGINT NOT NULL COMMENT '学生ID',
    subject         VARCHAR(20) NOT NULL DEFAULT 'GENERAL' COMMENT '学科',
    
    -- 风格指纹
    style_embedding BLOB COMMENT '写作风格嵌入向量 (768维)',
    avg_sentence_length     DECIMAL(5,1) COMMENT '平均句长',
    sentence_length_std     DECIMAL(5,1) COMMENT '句长标准差',
    vocabulary_richness     DECIMAL(5,3) COMMENT '词汇丰富度 (TTR)',
    common_transition_words TEXT COMMENT '常用过渡词JSON数组',
    error_patterns          TEXT COMMENT '常见错误模式JSON数组',
    punctuation_habits      TEXT COMMENT '标点使用习惯JSON',
    
    -- 样本来源
    sample_count        INT NOT NULL DEFAULT 0 COMMENT '基线样本数',
    last_sample_date    DATE COMMENT '最近样本日期',
    baseline_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_student_subject (student_id, subject),
    INDEX idx_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生写作风格基线';
```

### 3.4 AI对话行为关联表 `ai_conversation_correlation`

```sql
CREATE TABLE ai_conversation_correlation (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    detection_task_id   VARCHAR(36) NOT NULL COMMENT '检测任务ID',
    student_id          BIGINT NOT NULL,
    
    -- 关联的AI对话
    conversation_id     VARCHAR(36) NOT NULL COMMENT 'AI对话会话ID',
    message_id          VARCHAR(36) NOT NULL COMMENT 'AI消息ID',
    
    -- 相似度
    similarity_score    DECIMAL(5,2) NOT NULL COMMENT '文本相似度 0-100',
    similarity_type     VARCHAR(20) NOT NULL COMMENT '相似类型: EXACT_MATCH/PARAPHRASE/STRUCTURAL/SEMANTIC',
    
    -- 匹配详情
    matched_segments    JSON COMMENT '匹配片段 [{student_text, ai_text, similarity, position}]',
    
    -- 时间关系
    ai_message_time     DATETIME NOT NULL COMMENT 'AI消息时间',
    submission_time     DATETIME NOT NULL COMMENT '提交时间',
    time_gap_minutes    INT NOT NULL COMMENT '时间差(分钟)',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_task (detection_task_id),
    INDEX idx_student_time (student_id, ai_message_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI对话行为关联分析';
```

### 3.5 检测报告表 `ai_detection_reports`

```sql
CREATE TABLE ai_detection_reports (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
    task_id             VARCHAR(36) NOT NULL UNIQUE,
    student_id          BIGINT NOT NULL,
    
    -- 报告摘要
    summary             TEXT NOT NULL COMMENT '报告摘要(自然语言)',
    overall_assessment  VARCHAR(20) NOT NULL COMMENT '总评: LIKELY_INDEPENDENT/LIKELY_ASSISTED/MIXED/LIKELY_AI_GENERATED',
    
    -- 可视化数据
    paragraph_heatmap   JSON COMMENT '段落级热力图数据',
    dimension_radar     JSON COMMENT '维度雷达图数据',
    timeline_correlation JSON COMMENT 'AI对话时间线关联',
    
    -- 建议
    teacher_suggestion  TEXT COMMENT '给教师的建议',
    student_suggestion  TEXT COMMENT '给学生的鼓励性建议',
    parent_suggestion   TEXT COMMENT '给家长的建议',
    
    -- 可见性控制
    visible_to_student  TINYINT NOT NULL DEFAULT 0 COMMENT '学生是否可见 (默认不可见)',
    visible_to_parent   TINYINT NOT NULL DEFAULT 1 COMMENT '家长是否可见',
    visible_to_teacher  TINYINT NOT NULL DEFAULT 1 COMMENT '教师是否可见',
    
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_task (task_id),
    INDEX idx_student (student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI检测详细报告';
```

---

## 4. 检测维度详细设计

### 4.1 维度概览

| 维度 | 权重 | 说明 | 误报风险 |
| --- | --- | --- | --- |
| 困惑度(Perplexity) | 0.20 | AI文本困惑度普遍偏低 | 中 |
| 突发性(Burstiness) | 0.15 | AI文本句长分布更均匀 | 中 |
| 风格指纹(Style Fingerprint) | 0.25 | 与学生历史风格偏离度 | 低 |
| 水印检测(Watermark) | 0.15 | 平台AI输出的隐式水印 | 极低 |
| 行为关联(Behavior Correlation) | 0.15 | 与平台内AI对话的相似度 | 极低 |
| 句式模式(Sentence Pattern) | 0.10 | AI常用句式结构特征匹配 | 高 |

> **注意**：权重默认值可通过管理后台调整，不同年级和学科可配置不同权重方案。

### 4.2 困惑度分析 (Perplexity)

#### 原理

大模型生成的文本对语言模型来说"不意外"，因此困惑度（衡量文本对模型的"意外程度"的指标）偏低。学生自主写作的文本通常包含更多个人化表达、非标准句式，困惑度偏高。

#### 算法

```python
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

class PerplexityAnalyzer:
    """文本困惑度分析器"""
    
    def __init__(self, model_name="gpt2-chinese-cluebase"):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForCausalLM.from_pretrained(model_name)
        self.model.eval()
        self.max_length = 1024
    
    def calculate_perplexity(self, text: str) -> dict:
        """
        计算文本困惑度
        返回: {
            'perplexity': float,      # 整体困惑度
            'paragraph_ppls': list,   # 段落级困惑度
            'low_ppl_ratio': float,   # 低困惑度段落占比
            'avg_token_loss': float   # 平均token损失
        }
        """
        paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
        paragraph_ppls = []
        
        for para in paragraphs:
            if len(para) < 10:
                continue
            
            encodings = self.tokenizer(
                para, 
                return_tensors='pt',
                truncation=True,
                max_length=self.max_length
            )
            
            with torch.no_grad():
                outputs = self.model(**encodings, labels=encodings['input_ids'])
                loss = outputs.loss.item()
                ppl = torch.exp(torch.tensor(loss)).item()
            
            paragraph_ppls.append({
                'text': para[:100] + '...' if len(para) > 100 else para,
                'perplexity': round(ppl, 2),
                'length': len(para)
            })
        
        if not paragraph_ppls:
            return {'perplexity': 0, 'paragraph_ppls': [], 'low_ppl_ratio': 0, 'avg_token_loss': 0}
        
        overall_ppl = sum(p['perplexity'] for p in paragraph_ppls) / len(paragraph_ppls)
        low_ppl_count = sum(1 for p in paragraph_ppls if p['perplexity'] < 30)
        low_ppl_ratio = low_ppl_count / len(paragraph_ppls)
        
        # 困惑度AI概率分数: 低困惑度占比越高, AI概率越高
        # 经验阈值: PPL < 30 倾向AI生成, PPL > 80 倾向人类写作
        ai_probability = self._ppl_to_ai_probability(overall_ppl, low_ppl_ratio)
        
        return {
            'perplexity': round(overall_ppl, 2),
            'paragraph_ppls': paragraph_ppls,
            'low_ppl_ratio': round(low_ppl_ratio, 3),
            'avg_token_loss': round(overall_ppl / 100, 4),
            'ai_probability': round(ai_probability, 2)
        }
    
    def _ppl_to_ai_probability(self, ppl: float, low_ratio: float) -> float:
        """
        将困惑度指标转换为AI生成概率
        基于校准数据的分段线性映射
        """
        # 整体困惑度映射
        if ppl < 20:
            ppl_score = 90
        elif ppl < 30:
            ppl_score = 70
        elif ppl < 50:
            ppl_score = 50
        elif ppl < 80:
            ppl_score = 30
        elif ppl < 120:
            ppl_score = 15
        else:
            ppl_score = 5
        
        # 低困惑度段落占比加权
        # 如果超过60%的段落都是低困惑度, 提高AI概率
        ratio_bonus = max(0, (low_ratio - 0.3) * 50)
        
        return min(100, ppl_score + ratio_bonus)
```

### 4.3 突发性分析 (Burstiness)

#### 原理

人类写作倾向于"突发性"——有时写长句，有时写短句，句长变化大。AI 生成的文本句长更加均匀。通过分析句长分布的标准差和变异系数来判断。

```python
import re
import numpy as np
from collections import namedtuple

BurstinessResult = namedtuple('BurstinessResult', [
    'avg_length', 'std_length', 'cv', 'burstiness_score', 'ai_probability'
])

class BurstinessAnalyzer:
    """文本突发性分析器"""
    
    def analyze(self, text: str) -> dict:
        """
        分析文本的突发性特征
        """
        sentences = self._split_sentences(text)
        if len(sentences) < 3:
            return self._default_result()
        
        lengths = np.array([len(s) for s in sentences])
        
        avg_length = float(np.mean(lengths))
        std_length = float(np.std(lengths))
        cv = std_length / avg_length if avg_length > 0 else 0
        
        # 句长分布偏度
        skewness = self._calculate_skewness(lengths)
        
        # 短句长句交替频率
        alternation_rate = self._calculate_alternation_rate(lengths)
        
        # 突发性综合评分 (越高越像人类写作)
        burstiness_score = self._calculate_burstiness(cv, skewness, alternation_rate)
        
        # 转换为AI概率 (突发性越低, AI概率越高)
        ai_probability = max(0, 100 - burstiness_score)
        
        return {
            'avg_length': round(avg_length, 1),
            'std_length': round(std_length, 1),
            'cv': round(cv, 3),
            'skewness': round(skewness, 3),
            'alternation_rate': round(alternation_rate, 3),
            'burstiness_score': round(burstiness_score, 2),
            'ai_probability': round(ai_probability, 2),
            'sentence_lengths': lengths.tolist()
        }
    
    def _split_sentences(self, text: str) -> list:
        """中文友好的分句"""
        # 按中文标点分句
        pattern = r'[。！？；\.\!\?;]+'
        sentences = re.split(pattern, text)
        return [s.strip() for s in sentences if len(s.strip()) > 2]
    
    def _calculate_skewness(self, lengths: np.ndarray) -> float:
        n = len(lengths)
        if n < 3:
            return 0
        mean = np.mean(lengths)
        std = np.std(lengths)
        if std == 0:
            return 0
        return float(np.sum(((lengths - mean) / std) ** 3) / n)
    
    def _calculate_alternation_rate(self, lengths: np.ndarray) -> float:
        """计算长短句交替频率"""
        if len(lengths) < 2:
            return 0
        median = np.median(lengths)
        binary = (lengths > median).astype(int)
        changes = np.sum(np.diff(binary) != 0)
        return changes / (len(binary) - 1)
    
    def _calculate_burstiness(self, cv, skewness, alternation_rate) -> float:
        # 人类写作: CV通常 0.5-1.2, AI: 0.2-0.4
        cv_component = min(50, cv * 60)
        # 人类写作偏度通常 > 0.5 (右偏, 偶尔长句)
        skew_component = min(25, max(0, skewness) * 30)
        # 人类写作交替频率通常 0.4-0.7
        alt_component = min(25, alternation_rate * 40)
        return cv_component + skew_component + alt_component
    
    def _default_result(self) -> dict:
        return {
            'avg_length': 0, 'std_length': 0, 'cv': 0,
            'skewness': 0, 'alternation_rate': 0,
            'burstiness_score': 50, 'ai_probability': 50,
            'sentence_lengths': []
        }
```

### 4.4 风格指纹比对 (Style Fingerprint)

#### 原理

每个学生都有独特的写作风格——用词偏好、句式习惯、标点使用、常见错误模式。将当前提交与学生在平台内积累的历史作品进行风格一致性比对。

```python
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

class StyleFingerprintAnalyzer:
    """学生写作风格指纹分析器"""
    
    def __init__(self):
        # 使用多语言句向量模型
        self.encoder = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
    
    def analyze(
        self,
        current_text: str,
        student_baseline: dict,
        in_classroom_essays: list = None
    ) -> dict:
        """
        与学生历史写作风格进行比对
        
        Args:
            current_text: 当前提交文本
            student_baseline: 学生风格基线数据
            in_classroom_essays: 课内限时写作样本 (作为高可信参考)
        
        Returns:
            风格一致性分析结果
        """
        # 1. 编码当前文本
        current_embedding = self.encoder.encode([current_text])[0]
        
        # 2. 与基线嵌入向量比对
        baseline_embedding = np.frombuffer(
            student_baseline['style_embedding'], dtype=np.float32
        )
        style_similarity = cosine_similarity(
            current_embedding.reshape(1, -1),
            baseline_embedding.reshape(1, -1)
        )[0][0]
        
        # 3. 多维度风格特征比对
        current_features = self._extract_style_features(current_text)
        feature_distance = self._calculate_feature_distance(
            current_features,
            student_baseline
        )
        
        # 4. 如果有课内限时写作，作为高可信基线
        classroom_similarity = 0
        if in_classroom_essays:
            classroom_embeddings = self.encoder.encode(in_classroom_essays)
            classroom_centroid = np.mean(classroom_embeddings, axis=0)
            classroom_similarity = cosine_similarity(
                current_embedding.reshape(1, -1),
                classroom_centroid.reshape(1, -1)
            )[0][0]
        
        # 5. 综合评分
        # 风格偏离度越高 -> AI概率越高
        # 课内写作相似度权重更大 (因为是监督环境下写的)
        if classroom_similarity > 0:
            # 有课内写作参考时, 更有信心
            combined_similarity = 0.3 * style_similarity + 0.7 * classroom_similarity
        else:
            combined_similarity = style_similarity
        
        ai_probability = max(0, min(100, (1 - combined_similarity) * 100))
        
        # 6. 具体风格差异点
        style_diffs = self._identify_style_differences(
            current_features,
            student_baseline
        )
        
        return {
            'style_similarity': round(float(style_similarity), 3),
            'classroom_similarity': round(float(classroom_similarity), 3),
            'combined_similarity': round(float(combined_similarity), 3),
            'feature_distance': round(feature_distance, 3),
            'ai_probability': round(ai_probability, 2),
            'style_diffs': style_diffs,
            'current_features': current_features
        }
    
    def _extract_style_features(self, text: str) -> dict:
        """提取文本风格特征"""
        import jieba
        from collections import Counter
        
        sentences = text.split('。')
        sentences = [s.strip() for s in sentences if s.strip()]
        
        words = list(jieba.cut(text))
        word_lengths = [len(w) for w in words]
        
        # 标点分析
        punctuation_counts = Counter(c for c in text if c in '，。、；：！？""''《》（）')
        
        return {
            'avg_sentence_length': np.mean([len(s) for s in sentences]) if sentences else 0,
            'sentence_count': len(sentences),
            'word_count': len(words),
            'ttr': len(set(words)) / len(words) if words else 0,  # 词汇丰富度
            'avg_word_length': np.mean(word_lengths) if word_lengths else 0,
            'punctuation_density': sum(punctuation_counts.values()) / len(text) if text else 0,
            'comma_ratio': punctuation_counts.get('，', 0) / max(1, sum(punctuation_counts.values())),
            'error_indicators': self._count_error_patterns(text),
            'colloquial_markers': self._count_colloquial_markers(text),
        }
    
    def _count_error_patterns(self, text: str) -> int:
        """统计常见学生写作错误模式"""
        patterns = [
            r'的得地', r'再在', r'做作', r'以为认为',
            r'\d+多', r'非常.{1,2}极了',  # 语病模式
        ]
        count = 0
        for p in patterns:
            count += len(re.findall(p, text))
        return count
    
    def _count_colloquial_markers(self, text: str) -> int:
        """统计口语化标记词数量 (学生写作中常见的口语化痕迹)"""
        markers = ['然后', '就是', '那个', '这个', '其实', '反正', '好像', '感觉']
        count = 0
        for m in markers:
            count += text.count(m)
        return count
    
    def _calculate_feature_distance(self, current: dict, baseline: dict) -> float:
        """计算风格特征距离 (欧氏距离)"""
        keys = ['avg_sentence_length', 'ttr', 'avg_word_length', 
                'punctuation_density', 'error_indicators']
        distances = []
        for k in keys:
            c_val = current.get(k, 0)
            b_val = baseline.get(k, 0) if isinstance(baseline, dict) else getattr(baseline, k, 0)
            if b_val > 0:
                distances.append(abs(c_val - b_val) / b_val)
        return float(np.mean(distances)) if distances else 0.5
    
    def _identify_style_differences(self, current: dict, baseline: dict) -> list:
        """识别具体风格差异点"""
        diffs = []
        
        # 句长差异
        curr_avg = current.get('avg_sentence_length', 0)
        base_avg = baseline.get('avg_sentence_length', curr_avg) if isinstance(baseline, dict) else getattr(baseline, 'avg_sentence_length', curr_avg)
        if base_avg > 0 and abs(curr_avg - base_avg) / base_avg > 0.3:
            direction = '更长' if curr_avg > base_avg else '更短'
            diffs.append({
                'feature': 'sentence_length',
                'description': f'平均句长({curr_avg:.0f}字)比历史风格{direction}(历史平均{base_avg:.0f}字)',
                'significance': 'high' if abs(curr_avg - base_avg) / base_avg > 0.5 else 'medium'
            })
        
        # 词汇丰富度差异
        curr_ttr = current.get('ttr', 0)
        base_ttr = baseline.get('ttr', curr_ttr) if isinstance(baseline, dict) else getattr(baseline, 'vocabulary_richness', curr_ttr)
        if base_ttr > 0 and curr_ttr > base_ttr * 1.3:
            diffs.append({
                'feature': 'vocabulary_richness',
                'description': f'词汇丰富度({curr_ttr:.3f})显著高于历史水平({base_ttr:.3f})，可能使用了AI推荐的词汇',
                'significance': 'medium'
            })
        
        # 错误模式差异
        curr_errors = current.get('error_indicators', 0)
        base_errors = baseline.get('error_patterns', 0) if isinstance(baseline, dict) else 0
        if curr_errors == 0 and base_errors > 2:
            diffs.append({
                'feature': 'error_patterns',
                'description': '本次提交无常见语法错误，历史作品通常存在少量错误',
                'significance': 'high'
            })
        
        return diffs


### 4.5 水印检测 (Watermark Detection)

#### 原理

PrimeTop 平台所有 AI 输出内容均嵌入**隐式文本水印**（基于词汇选择偏置和 n-gram 统计特征）。当学生提交的作业中出现带有平台水印的文本片段时，可直接确认该部分来源于平台 AI 输出。

```python
import hashlib

class WatermarkDetector:
    """平台AI输出水印检测器"""
    
    # 水印词汇表 - 用于词汇选择偏置检测
    WATERMARK_LEXICON = {
        # 这些词汇在AI输出中被轻微偏好使用
        # 通过统计模型训练得到, 每个词有一个水印权重
        '首先': 0.8, '其次': 0.8, '最后': 0.7, '综上所述': 0.9,
        '总而言之': 0.8, '值得注意的是': 0.85, '与此同时': 0.75,
        '不仅...而且': 0.8, '然而': 0.6, '此外': 0.65,
        '因此': 0.5, '从而': 0.6, '由此可见': 0.85,
    }
    
    # 水印哈希前缀池 (平台AI输出的句子前缀哈希)
    WATERMARK_HASH_POOL = set()  # 从数据库/Redis加载
    
    def detect(self, text: str, student_id: int) -> dict:
        """
        检测文本中是否包含平台AI水印
        """
        # 1. 词汇级水印检测
        lexical_score = self._detect_lexical_watermark(text)
        
        # 2. 句子级水印哈希匹配
        sentence_matches = self._detect_sentence_watermark(text)
        
        # 3. 段落级水印模式检测
        paragraph_patterns = self._detect_paragraph_watermark(text)
        
        # 4. 综合水印评分
        has_watermark = len(sentence_matches) > 0 or lexical_score > 0.7
        watermark_strength = self._calculate_strength(
            lexical_score, sentence_matches, paragraph_patterns
        )
        
        return {
            'has_watermark': has_watermark,
            'watermark_strength': round(watermark_strength, 2),
            'lexical_score': round(lexical_score, 2),
            'matched_sentences': sentence_matches,
            'paragraph_patterns': paragraph_patterns,
            'ai_probability': round(watermark_strength * 100, 2) if has_watermark else 5.0
        }
    
    def _detect_lexical_watermark(self, text: str) -> float:
        """检测水印词汇出现频率"""
        total_watermark_hits = 0
        total_words = len(text)
        
        for word, weight in self.WATERMARK_LEXICON.items():
            count = text.count(word)
            total_watermark_hits += count * weight
        
        # 归一化: 水印词密度
        if total_words == 0:
            return 0
        density = total_watermark_hits / (total_words / 1000)  # 每千字水印词数
        
        # 经验阈值
        if density > 8:
            return 0.9
        elif density > 5:
            return 0.7
        elif density > 3:
            return 0.4
        else:
            return 0.1
    
    def _detect_sentence_watermark(self, text: str) -> list:
        """检测句子级水印哈希匹配"""
        import re
        sentences = re.split(r'[。！？]', text)
        matches = []
        
        for i, sent in enumerate(sentences):
            sent = sent.strip()
            if len(sent) < 8:
                continue
            
            # 生成句子指纹 (前N个字的哈希)
            fingerprint = hashlib.md5(sent[:20].encode()).hexdigest()[:8]
            
            if fingerprint in self.WATERMARK_HASH_POOL:
                matches.append({
                    'paragraph_index': i,
                    'text': sent[:50] + '...' if len(sent) > 50 else sent,
                    'hash': fingerprint,
                    'match_type': 'EXACT_HASH'
                })
        
        return matches
    
    def _detect_paragraph_watermark(self, text: str) -> list:
        """检测段落级水印模式"""
        patterns = []
        
        # AI常用段落结构模式
        ai_paragraph_patterns = [
            # "总-分-总" 结构高频
            (r'^(.{20,50})。.{50,200}。\1。$', 'DEDUCTIVE_STRUCTURE'),
            # 列举式 (第一/第二/第三)
            (r'第一.{10,50}。第二.{10,50}。第三.{10,50}。', 'LIST_STRUCTURE'),
            # 过渡词密集
            (r'此外.{10,30}。同时.{10,30}。另外.{10,30}。', 'TRANSITION_CHAIN'),
        ]
        
        paragraphs = text.split('\n')
        for i, para in enumerate(paragraphs):
            para = para.strip()
            if len(para) < 20:
                continue
            for pattern, ptype in ai_paragraph_patterns:
                if re.search(pattern, para):
                    patterns.append({
                        'paragraph_index': i,
                        'pattern_type': ptype,
                        'text': para[:80] + '...' if len(para) > 80 else para
                    })
        
        return patterns
    
    def _calculate_strength(self, lexical, sentences, patterns) -> float:
        """计算水印强度"""
        strength = 0
        if sentences:
            strength = max(strength, 0.95)  # 句子哈希精确匹配, 极高可信度
        if lexical > 0.7:
            strength = max(strength, 0.7)
        if len(patterns) >= 2:
            strength = max(strength, 0.6)
        elif len(patterns) >= 1:
            strength = max(strength, 0.4)
        return strength
```


### 4.6 行为关联分析 (Behavior Correlation)

#### 原理

PrimeTop 平台可以获取学生在平台内的完整 AI 对话历史。当学生提交作业前曾与 AI 进行过相关话题的对话，且对话内容与提交内容存在语义相似性时，可以精确量化 AI 辅助的程度。

```python
from datetime import datetime, timedelta

class BehaviorCorrelationAnalyzer:
    """学生AI使用行为关联分析器"""
    
    def __init__(self, vector_store, conversation_service):
        self.vector_store = vector_store  # 向量数据库
        self.conversation_service = conversation_service
        self.similarity_threshold = 0.65
    
    async def analyze(
        self,
        student_id: int,
        submission_text: str,
        submission_time: datetime,
        lookback_hours: int = 48
    ) -> dict:
        """
        分析提交内容与学生近期AI对话的关联性
        
        Args:
            student_id: 学生ID
            submission_text: 提交的文本
            submission_time: 提交时间
            lookback_hours: 向前追溯多少小时的AI对话
        """
        # 1. 获取学生近期AI对话记录
        since = submission_time - timedelta(hours=lookback_hours)
        conversations = await self.conversation_service.get_student_conversations(
            student_id=student_id,
            since=since,
            until=submission_time
        )
        
        if not conversations:
            return {
                'has_correlation': False,
                'correlation_count': 0,
                'max_similarity': 0,
                'ai_probability': 10,  # 没有AI对话记录, 低概率
                'matched_conversations': []
            }
        
        # 2. 向量检索匹配
        matches = await self._find_similar_content(
            submission_text,
            conversations
        )
        
        # 3. 分析匹配类型
        high_confidence_matches = []
        moderate_matches = []
        
        for match in matches:
            if match['similarity_score'] >= 0.85:
                match['similarity_type'] = 'EXACT_MATCH'
                high_confidence_matches.append(match)
            elif match['similarity_score'] >= 0.70:
                match['similarity_type'] = 'PARAPHRASE'
                high_confidence_matches.append(match)
            elif match['similarity_score'] >= self.similarity_threshold:
                match['similarity_type'] = 'STRUCTURAL'
                moderate_matches.append(match)
        
        # 4. 计算AI概率
        if high_confidence_matches:
            ai_probability = min(95, 60 + len(high_confidence_matches) * 10)
        elif moderate_matches:
            ai_probability = min(70, 30 + len(moderate_matches) * 10)
        else:
            ai_probability = 15
        
        # 5. 时间紧迫性分析 (AI对话后多快提交)
        time_urgency = self._analyze_time_urgency(
            high_confidence_matches, submission_time
        )
        
        all_matches = high_confidence_matches + moderate_matches
        
        return {
            'has_correlation': len(all_matches) > 0,
            'correlation_count': len(all_matches),
            'high_confidence_count': len(high_confidence_matches),
            'max_similarity': max(m['similarity_score'] for m in all_matches) if all_matches else 0,
            'ai_probability': ai_probability,
            'time_urgency': time_urgency,
            'matched_conversations': all_matches[:10]  # 最多返回10条
        }
    
    async def _find_similar_content(
        self,
        submission_text: str,
        conversations: list
    ) -> list:
        """从对话记录中检索与提交内容相似的AI回答"""
        from sentence_transformers import SentenceTransformer
        from sklearn.metrics.pairwise import cosine_similarity
        
        encoder = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
        submission_embedding = encoder.encode([submission_text])[0]
        
        matches = []
        
        for conv in conversations:
            for msg in conv.get('messages', []):
                if msg['role'] != 'assistant':
                    continue
                
                ai_text = msg['content']
                if len(ai_text) < 20:
                    continue
                
                ai_embedding = encoder.encode([ai_text])[0]
                similarity = cosine_similarity(
                    submission_embedding.reshape(1, -1),
                    ai_embedding.reshape(1, -1)
                )[0][0]
                
                if similarity >= self.similarity_threshold:
                    # 找到具体匹配片段
                    matched_segments = self._locate_matched_segments(
                        submission_text, ai_text, encoder
                    )
                    
                    matches.append({
                        'conversation_id': conv['conversation_id'],
                        'message_id': msg['message_id'],
                        'similarity_score': round(float(similarity) * 100, 2),
                        'ai_message_time': msg['created_at'],
                        'matched_segments': matched_segments,
                        'ai_text_preview': ai_text[:100] + '...'
                    })
        
        # 按相似度排序
        matches.sort(key=lambda x: x['similarity_score'], reverse=True)
        return matches
    
    def _locate_matched_segments(
        self, student_text: str, ai_text: str, encoder
    ) -> list:
        """定位具体匹配的文本片段"""
        # 按句子分割学生文本
        import re
        student_sentences = re.split(r'[。！？；]', student_text)
        student_sentences = [s.strip() for s in student_sentences if len(s.strip()) > 8]
        
        ai_sentences = re.split(r'[。！？；]', ai_text)
        ai_sentences = [s.strip() for s in ai_sentences if len(s.strip()) > 8]
        
        if not student_sentences or not ai_sentences:
            return []
        
        # 编码所有句子
        stu_embeddings = encoder.encode(student_sentences)
        ai_embeddings = encoder.encode(ai_sentences)
        
        segments = []
        for i, stu_emb in enumerate(stu_embeddings):
            sims = cosine_similarity(stu_emb.reshape(1, -1), ai_embeddings)[0]
            best_idx = sims.argmax()
            best_sim = sims[best_idx]
            
            if best_sim >= 0.65:
                segments.append({
                    'student_text': student_sentences[i][:80],
                    'ai_text': ai_sentences[best_idx][:80],
                    'similarity': round(float(best_sim) * 100, 2)
                })
        
        return segments
    
    def _analyze_time_urgency(
        self, matches: list, submission_time: datetime
    ) -> dict:
        """分析AI使用到提交的时间紧迫性"""
        if not matches:
            return {'level': 'NONE', 'gap_minutes': None}
        
        min_gap = min(
            (submission_time - m['ai_message_time']).total_seconds() / 60
            for m in matches
        )
        
        if min_gap < 10:
            return {'level': 'IMMEDIATE', 'gap_minutes': int(min_gap), 'note': 'AI对话后10分钟内即提交'}
        elif min_gap < 30:
            return {'level': 'QUICK', 'gap_minutes': int(min_gap), 'note': 'AI对话后30分钟内提交'}
        elif min_gap < 120:
            return {'level': 'MODERATE', 'gap_minutes': int(min_gap), 'note': 'AI对话后2小时内提交'}
        else:
            return {'level': 'DELAYED', 'gap_minutes': int(min_gap), 'note': 'AI对话后较长时间才提交'}
```


## 5. 融合决策引擎

### 5.1 决策流程

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class DetectionInput:
    """各维度检测结果输入"""
    perplexity_result: dict
    burstiness_result: dict
    style_result: Optional[dict]
    watermark_result: dict
    behavior_result: dict
    student_context: dict  # 年级、学科等上下文

@dataclass
class DetectionOutput:
    """融合决策输出"""
    ai_ratio_score: float          # 0-100
    ai_ratio_level: str            # MINIMAL/LOW/MODERATE/HIGH/EXTENSIVE
    confidence: float              # 0-100
    originality_score: float       # 0-100
    assessment: str                # LIKELY_INDEPENDENT 等
    dimension_contributions: dict  # 各维度贡献
    key_evidence: list             # 关键证据列表

class FusionDecisionEngine:
    """多维度融合决策引擎"""
    
    # 默认权重配置
    DEFAULT_WEIGHTS = {
        'PERPLEXITY': 0.20,
        'BURSTINESS': 0.15,
        'STYLE_FINGERPRINT': 0.25,
        'WATERMARK': 0.15,
        'BEHAVIOR_CORRELATION': 0.15,
        'SENTENCE_PATTERN': 0.10,
    }
    
    # 年级调整因子 (低年级学生AI痕迹更明显)
    GRADE_ADJUSTMENT = {
        'PRIMARY_LOW': {'WATERMARK': 1.2, 'BEHAVIOR_CORRELATION': 1.2},
        'PRIMARY_HIGH': {},
        'JUNIOR': {},
        'SENIOR': {'PERPLEXITY': 0.9, 'BURSTINESS': 0.9},  # 高中生写作风格本身较成熟
    }
    
    # AI比例等级划分
    LEVEL_THRESHOLDS = [
        (20, 'MINIMAL', '极少AI辅助'),
        (40, 'LOW', '少量AI辅助'),
        (60, 'MODERATE', '适度AI辅助'),
        (80, 'HIGH', '较多AI辅助'),
        (101, 'EXTENSIVE', '大量AI生成内容'),
    ]
    
    def decide(self, detection_input: DetectionInput) -> DetectionOutput:
        """
        融合各维度结果做出最终决策
        """
        weights = self._get_adjusted_weights(detection_input.student_context)
        
        # 1. 收集各维度AI概率
        dimension_scores = {
            'PERPLEXITY': detection_input.perplexity_result.get('ai_probability', 50),
            'BURSTINESS': detection_input.burstiness_result.get('ai_probability', 50),
            'STYLE_FINGERPRINT': detection_input.style_result.get('ai_probability', 50) if detection_input.style_result else 50,
            'WATERMARK': detection_input.watermark_result.get('ai_probability', 5),
            'BEHAVIOR_CORRELATION': detection_input.behavior_result.get('ai_probability', 10),
            'SENTENCE_PATTERN': self._analyze_sentence_patterns(detection_input.perplexity_result),
        }
        
        # 2. 加权融合
        total_weight = sum(weights.values())
        weighted_score = sum(
            dimension_scores[dim] * weights.get(dim, 0)
            for dim in dimension_scores
        ) / total_weight
        
        # 3. 硬性规则覆盖
        # 如果检测到确切水印, 提升下限
        if detection_input.watermark_result.get('matched_sentences'):
            weighted_score = max(weighted_score, 60)
        # 如果检测到确切行为匹配, 提升下限
        if detection_input.behavior_result.get('high_confidence_count', 0) > 0:
            weighted_score = max(weighted_score, 55)
        # 如果没有AI使用记录且无水印, 降低上限
        if (not detection_input.behavior_result.get('has_correlation') 
            and not detection_input.watermark_result.get('has_watermark')):
            weighted_score = min(weighted_score, 70)
        
        # 4. 计算置信度
        confidence = self._calculate_confidence(
            dimension_scores, weights, detection_input
        )
        
        # 5. 确定等级
        ai_ratio_score = round(weighted_score, 2)
        ai_ratio_level = self._score_to_level(ai_ratio_score)
        originality_score = round(100 - weighted_score, 2)
        assessment = self._score_to_assessment(ai_ratio_score, confidence)
        
        # 6. 提取关键证据
        key_evidence = self._extract_key_evidence(detection_input, dimension_scores)
        
        # 7. 各维度贡献
        contributions = {
            dim: round(dimension_scores[dim] * weights.get(dim, 0) / total_weight, 2)
            for dim in dimension_scores
        }
        
        return DetectionOutput(
            ai_ratio_score=ai_ratio_score,
            ai_ratio_level=ai_ratio_level,
            confidence=round(confidence, 2),
            originality_score=originality_score,
            assessment=assessment,
            dimension_contributions=contributions,
            key_evidence=key_evidence
        )
    
    def _get_adjusted_weights(self, ctx: dict) -> dict:
        """根据年级学科调整权重"""
        weights = self.DEFAULT_WEIGHTS.copy()
        grade = ctx.get('grade_level', '')
        
        if grade.startswith('小学一') or grade.startswith('小学二') or grade.startswith('小学三'):
            adj = self.GRADE_ADJUSTMENT.get('PRIMARY_LOW', {})
        elif grade.startswith('小学'):
            adj = self.GRADE_ADJUSTMENT.get('PRIMARY_HIGH', {})
        elif grade.startswith('初中'):
            adj = self.GRADE_ADJUSTMENT.get('JUNIOR', {})
        else:
            adj = self.GRADE_ADJUSTMENT.get('SENIOR', {})
        
        for dim, factor in adj.items():
            weights[dim] = weights.get(dim, 0) * factor
        
        return weights
    
    def _analyze_sentence_patterns(self, perplexity_result: dict) -> float:
        """基于困惑度结果的句式模式分析"""
        para_ppls = perplexity_result.get('paragraph_ppls', [])
        if not para_ppls:
            return 50
        
        low_ppl_ratio = perplexity_result.get('low_ppl_ratio', 0)
        # 句式统一度高 + 低困惑度 = 更像AI
        return min(90, low_ppl_ratio * 80 + 20)
    
    def _calculate_confidence(
        self, scores: dict, weights: dict, inp: DetectionInput
    ) -> float:
        """计算决策置信度"""
        # 信号一致性: 各维度方向是否一致
        values = list(scores.values())
        agreement = 100 - np.std(values) * 1.5
        
        # 强信号加成: 水印和行为关联是强信号
        strong_signal_bonus = 0
        if inp.watermark_result.get('matched_sentences'):
            strong_signal_bonus += 20
        if inp.behavior_result.get('high_confidence_count', 0) > 0:
            strong_signal_bonus += 15
        
        # 风格基线可信度: 样本越多越可信
        style_samples = 0
        if inp.style_result:
            style_samples = inp.student_context.get('baseline_sample_count', 0)
        sample_bonus = min(10, style_samples * 2)
        
        return max(20, min(100, agreement + strong_signal_bonus + sample_bonus))
    
    def _score_to_level(self, score: float) -> str:
        for threshold, level, _ in self.LEVEL_THRESHOLDS:
            if score < threshold:
                return level
        return 'EXTENSIVE'
    
    def _score_to_assessment(self, score: float, confidence: float) -> str:
        if score < 25 and confidence > 50:
            return 'LIKELY_INDEPENDENT'
        elif score < 45:
            return 'MIXED'
        elif score < 70:
            return 'LIKELY_ASSISTED'
        else:
            return 'LIKELY_AI_GENERATED'
    
    def _extract_key_evidence(
        self, inp: DetectionInput, scores: dict
    ) -> list:
        """提取关键证据"""
        evidence = []
        
        # 水印证据
        wm = inp.watermark_result
        if wm.get('matched_sentences'):
            evidence.append({
                'type': 'WATERMARK_MATCH',
                'severity': 'HIGH',
                'description': f"检测到{len(wm['matched_sentences'])}处平台AI输出水印匹配",
                'detail': wm['matched_sentences'][:3]
            })
        
        # 行为关联证据
        br = inp.behavior_result
        if br.get('high_confidence_count', 0) > 0:
            urgency = br.get('time_urgency', {})
            evidence.append({
                'type': 'BEHAVIOR_CORRELATION',
                'severity': 'HIGH',
                'description': f"发现{br['high_confidence_count']}处与AI对话高度相似内容",
                'detail': {
                    'max_similarity': br.get('max_similarity'),
                    'time_urgency': urgency.get('level'),
                    'note': urgency.get('note', '')
                }
            })
        
        # 风格偏离证据
        if inp.style_result and inp.style_result.get('style_diffs'):
            for diff in inp.style_result['style_diffs']:
                if diff['significance'] == 'high':
                    evidence.append({
                        'type': 'STYLE_DEVIATION',
                        'severity': 'MEDIUM',
                        'description': diff['description']
                    })
        
        # 困惑度证据
        pp = inp.perplexity_result
        if pp.get('low_ppl_ratio', 0) > 0.5:
            evidence.append({
                'type': 'LOW_PERPLEXITY',
                'severity': 'MEDIUM',
                'description': f"{pp['low_ppl_ratio']*100:.0f}%的段落困惑度偏低, 符合AI生成特征"
            })
        
        # 按严重度排序
        severity_order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
        evidence.sort(key=lambda x: severity_order.get(x['severity'], 3))
        
        return evidence
```


## 6. API 接口设计

### 6.1 提交检测任务

```
POST /api/v1/ai-detection/analyze
```

**请求体:**
```json
{
  "submission_id": 123456,
  "submission_type": "ESSAY",
  "student_id": 10086,
  "content": "(待检测的完整文本内容)",
  "subject": "CHINESE",
  "grade_level": "初二",
  "priority": "NORMAL",
  "callback_url": "https://api.primetop.com/internal/detection-callback"
}
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "task_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "PROCESSING",
    "estimated_completion_seconds": 15
  }
}
```

### 6.2 查询检测结果

```
GET /api/v1/ai-detection/tasks/{task_id}
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "task_id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "COMPLETED",
    "student_id": 10086,
    "submission_type": "ESSAY",
    "result": {
      "ai_ratio_score": 35.5,
      "ai_ratio_level": "LOW",
      "confidence": 72.0,
      "originality_score": 64.5,
      "assessment": "MIXED",
      "dimension_contributions": {
        "PERPLEXITY": 8.2,
        "BURSTINESS": 5.1,
        "STYLE_FINGERPRINT": 12.3,
        "WATERMARK": 0.0,
        "BEHAVIOR_CORRELATION": 7.5,
        "SENTENCE_PATTERN": 2.4
      },
      "key_evidence": [
        {
          "type": "BEHAVIOR_CORRELATION",
          "severity": "HIGH",
          "description": "发现1处与AI对话高度相似内容",
          "detail": {
            "max_similarity": 78.5,
            "time_urgency": "MODERATE",
            "note": "AI对话后2小时内提交"
          }
        },
        {
          "type": "STYLE_DEVIATION",
          "severity": "MEDIUM",
          "description": "词汇丰富度(0.712)显著高于历史水平(0.523)"
        }
      ]
    }
  }
}
```

### 6.3 获取详细报告

```
GET /api/v1/ai-detection/tasks/{task_id}/report?viewer_role=TEACHER
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "task_id": "550e8400-e29b-41d4-a716-446655440000",
    "report": {
      "summary": "该作文部分段落与学生在平台内的AI对话存在较高相似度(78%)。整体写作风格与学生历史水平存在一定偏离，主要表现在词汇丰富度提升。建议教师关注学生在写作过程中对AI工具的使用方式。",
      "overall_assessment": "MIXED",
      "ai_ratio_level": "LOW",
      "ai_ratio_score": 35.5,
      "paragraph_heatmap": [
        {"para_idx": 0, "probability": 15, "label": "INDEPENDENT"},
        {"para_idx": 1, "probability": 65, "label": "ASSISTED"},
        {"para_idx": 2, "probability": 20, "label": "INDEPENDENT"},
        {"para_idx": 3, "probability": 80, "label": "ASSISTED"}
      ],
      "dimension_radar": {
        "labels": ["困惑度", "突发性", "风格一致", "水印检测", "行为关联", "句式模式"],
        "values": [45, 55, 35, 5, 75, 30]
      },
      "teacher_suggestion": "学生第2、4段与AI对话内容相似度较高，建议课后了解学生在写作时是否参考了AI建议，引导其将AI作为辅助工具而非直接引用。",
      "student_suggestion": "你的作文整体结构清晰！第1、3段的独立写作部分表达自然。继续练习用自己的话展开论述，相信你会越来越棒！",
      "parent_suggestion": "孩子在本次作文中使用了一定的AI辅助，这在学习过程中是正常的。建议引导孩子先独立思考再使用AI进行参考。"
    }
  }
}
```

### 6.4 批量检测接口

```
POST /api/v1/ai-detection/batch-analyze
```

**请求体:**
```json
{
  "submissions": [
    {
      "submission_id": 123001,
      "student_id": 10086,
      "content": "...",
      "submission_type": "ESSAY",
      "subject": "CHINESE",
      "grade_level": "初二"
    },
    ...
  ],
  "max_batch_size": 50
}
```

### 6.5 获取班级AI使用概览

```
GET /api/v1/ai-detection/classroom/{class_id}/overview?date_from=2026-07-01&date_to=2026-07-24
```

**响应:**
```json
{
  "code": 0,
  "data": {
    "class_id": "CLS2026001",
    "date_range": "2026-07-01 ~ 2026-07-24",
    "total_submissions": 156,
    "detection_summary": {
      "independent": 98,
      "mixed": 35,
      "assisted": 18,
      "ai_generated": 5
    },
    "avg_ai_ratio": 22.3,
    "students_needing_attention": [
      {
        "student_id": 10092,
        "student_name": "张三",
        "avg_ai_ratio": 68.5,
        "trend": "INCREASING",
        "latest_level": "HIGH"
      }
    ],
    "subject_breakdown": {
      "CHINESE": {"avg_ratio": 28.1, "count": 80},
      "ENGLISH": {"avg_ratio": 15.2, "count": 76}
    }
  }
}
```


## 7. 状态流转

### 7.1 检测任务状态机

```
                  ┌─────────┐
    创建任务 ───→ │ PENDING │
                  └────┬────┘
                       │ 开始处理
                       ▼
                  ┌───────────┐
                   │ PROCESSING │
                  └────┬──────┘
                       │
            ┌──────────┼──────────┐
            │          │          │
            ▼          ▼          ▼
     ┌──────┐   ┌──────┐   ┌──────┐
     │COMPLETED│  │FAILED│  │TIMEOUT│
     └──────┘   └──┬───┘   └──┬───┘
                   │          │
                   ▼          ▼
              重试(n<3)   标记失败
                   │
                   ▼
              ┌───────────┐
              │ PROCESSING │
              └───────────┘
```

### 7.2 状态定义

| 状态 | 说明 | 后续动作 |
| --- | --- | --- |
| PENDING | 任务已创建，等待处理 | 调度器拉取 |
| PROCESSING | 正在执行检测 | 等待完成 |
| COMPLETED | 检测完成，结果已写入 | 通知回调 |
| FAILED | 检测失败 | 自动重试(最多3次) |
| TIMEOUT | 处理超时 | 自动重试或降级处理 |


## 8. 异步任务编排

### 8.1 检测流水线

```python
import asyncio
from enum import Enum

class PipelineStage(Enum):
    PREPROCESS = 'preprocess'
    PARALLEL_DETECT = 'parallel_detect'
    FUSION_DECISION = 'fusion_decision'
    REPORT_GENERATION = 'report_generation'
    NOTIFICATION = 'notification'

class DetectionPipeline:
    """AI内容检测异步流水线"""
    
    def __init__(self, redis_client, mq_producer):
        self.redis = redis_client
        self.mq = mq_producer
        
        # 各阶段分析器
        self.ppl_analyzer = PerplexityAnalyzer()
        self.burstiness_analyzer = BurstinessAnalyzer()
        self.style_analyzer = StyleFingerprintAnalyzer()
        self.watermark_detector = WatermarkDetector()
        self.behavior_analyzer = BehaviorCorrelationAnalyzer(...)
        self.fusion_engine = FusionDecisionEngine()
    
    async def execute(self, task_id: str, input_data: dict):
        """执行完整检测流水线"""
        try:
            # 阶段1: 预处理
            await self._update_status(task_id, 'PROCESSING')
            processed = await self._preprocess(input_data)
            
            # 阶段2: 并行执行各维度检测
            results = await asyncio.gather(
                self._safe_run('perplexity', self.ppl_analyzer.calculate_perplexity, processed['text']),
                self._safe_run('burstiness', self.burstiness_analyzer.analyze, processed['text']),
                self._safe_run('style', self._run_style_analysis, processed, input_data),
                self._safe_run('watermark', self.watermark_detector.detect, processed['text'], input_data['student_id']),
                self._safe_run('behavior', self.behavior_analyzer.analyze, input_data['student_id'], processed['text'], input_data['submission_time']),
                return_exceptions=True
            )
            
            ppl_result, burst_result, style_result, wm_result, behavior_result = results
            
            # 处理异常结果
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    results[i] = self._get_fallback_result(i)
            
            # 阶段3: 融合决策
            detection_input = DetectionInput(
                perplexity_result=results[0],
                burstiness_result=results[1],
                style_result=results[2],
                watermark_result=results[3],
                behavior_result=results[4],
                student_context={
                    'grade_level': input_data.get('grade_level', ''),
                    'baseline_sample_count': input_data.get('baseline_samples', 0)
                }
            )
            
            decision = self.fusion_engine.decide(detection_input)
            
            # 阶段4: 持久化维度明细
            await self._save_dimensions(task_id, detection_input, decision)
            
            # 阶段5: 生成报告
            report = await self._generate_report(task_id, input_data, decision, results)
            
            # 阶段6: 更新学生风格基线 (如果是独立完成的)
            if decision.ai_ratio_score < 30:
                await self._update_writing_baseline(
                    input_data['student_id'],
                    input_data['content'],
                    input_data.get('subject', 'GENERAL')
                )
            
            # 阶段7: 回调通知
            await self._notify_callback(task_id, decision, input_data)
            
            await self._update_status(task_id, 'COMPLETED')
            
        except Exception as e:
            await self._handle_failure(task_id, e)
    
    async def _safe_run(self, name: str, func, *args):
        """安全执行单个维度检测"""
        try:
            if asyncio.iscoroutinefunction(func):
                return await func(*args)
            else:
                return await asyncio.to_thread(func, *args)
        except Exception as e:
            return {'error': str(e), 'ai_probability': 50}
    
    async def _preprocess(self, input_data: dict) -> dict:
        """文本预处理"""
        text = input_data['content']
        # 清洗: 去除多余空行、统一标点
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = text.strip()
        
        return {
            'text': text,
            'word_count': len(text),
            'paragraph_count': len([p for p in text.split('\n') if p.strip()])
        }
```


## 9. 错误处理与降级策略

### 9.1 错误码定义

| 错误码 | 说明 | 处理策略 |
| --- | --- | --- |
| DETECT_001 | 任务不存在 | 返回404 |
| DETECT_002 | 内容过短(低于50字) | 跳过检测，标记为 INSUFFICIENT_CONTENT |
| DETECT_003 | 困惑度模型加载失败 | 降级使用其他维度，降低置信度 |
| DETECT_004 | 风格基线不足(样本<3) | 跳过风格比对，其他维度权重补偿 |
| DETECT_005 | 行为关联服务超时 | 跳过行为关联，降低置信度 |
| DETECT_006 | 检测超时(>60s) | 返回部分结果，标记为 PARTIAL_RESULT |
| DETECT_007 | 报告生成失败 | 返回评分但无详细报告 |

### 9.2 降级逻辑

```python
class DetectionDegradation:
    """检测降级策略"""
    
    DEGRADATION_RULES = {
        'PERPLEXITY': {
            'fallback_value': {'ai_probability': 50},
            'weight_redistribute': {'BURSTINESS': 0.05, 'SENTENCE_PATTERN': 0.05}
        },
        'STYLE_FINGERPRINT': {
            'fallback_value': {'ai_probability': 50},
            'weight_redistribute': {'WATERMARK': 0.10, 'BEHAVIOR_CORRELATION': 0.15}
        },
        'BEHAVIOR_CORRELATION': {
            'fallback_value': {'ai_probability': 10},
            'weight_redistribute': {'STYLE_FINGERPRINT': 0.10, 'PERPLEXITY': 0.05}
        },
    }
    
    @classmethod
    def apply_degradation(cls, failed_dimension: str, fusion_engine, detection_input: DetectionInput):
        """应用降级策略"""
        rule = cls.DEGRADATION_RULES.get(failed_dimension)
        if not rule:
            return fusion_engine  # 不需要降级
        
        # 调整权重
        for target, additional in rule['weight_redistribute'].items():
            fusion_engine.DEFAULT_WEIGHTS[target] = fusion_engine.DEFAULT_WEIGHTS.get(target, 0) + additional
        
        # 设置fallback值
        setattr(detection_input, f'{failed_dimension.lower()}_result', rule['fallback_value'])
        
        return fusion_engine
```


## 10. 性能优化

### 10.1 缓存策略

| 缓存项 | 存储 | TTL | 更新策略 |
| --- | --- | --- | --- |
| 学生风格基线向量 | Redis | 7天 | 新作品提交时异步更新 |
| 水印哈希池 | Redis (Set) | 旖1小时 | 定时从数据库同步 |
| AI对话向量索引 | Milvus | 实时 | 消息产生时实时写入 |
| 班级检测概览 | Redis | 1小时 | 每次检测完成后增量更新 |
| 困惑度模型 | 本地内存 | 进程生命周期 | 启动时加载 |

### 10.2 并发控制

```yaml
# 检测任务并发配置
 detection_concurrency:
  max_concurrent_tasks: 20        # 单节点最大并发检测任务
  max_concurrent_per_dimension: 5 # 单维度最大并发
  task_queue_size: 200            # 任务队列大小
  task_timeout_seconds: 60        # 单任务超时
  retry_max: 3                    # 最大重试次数
  retry_backoff_seconds: [5, 15, 30]  # 重试退避
```

### 10.3 批量检测优化

对于教师批量提交（如全班作文），采用分批并行处理:

```python
async def batch_detect(submissions: list, batch_size: int = 10):
    """批量检测优化"""
    semaphore = asyncio.Semaphore(batch_size)
    
    async def detect_one(sub):
        async with semaphore:
            return await detection_pipeline.execute(
                task_id=sub['task_id'],
                input_data=sub
            )
    
    results = await asyncio.gather(*[detect_one(s) for s in submissions])
    return results
```


## 11. 安全与权限

### 11.1 数据可见性矩阵

| 数据项 | 学生本人 | 家长 | 教师 | 管理员 |
| --- | --- | --- | --- | --- |
| AI比例分数 | ✗ | ✓ | ✓ | ✓ |
| 详细维度分析 | ✗ | ✗ | ✓ | ✓ |
| 原始AI对话匹配 | ✗ | ✗ | ✓ | ✓ |
| 鼓励性建议 | ✓ | ✓ | ✓ | ✓ |
| 班级概览 | ✗ | 仅自家孩子 | ✓ | ✓ |
| 全校统计 | ✗ | ✗ | ✗ | ✓ |

### 11.2 敏感操作审计

所有检测结果的查看操作记录审计日志:

```sql
CREATE TABLE ai_detection_audit (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    operator_id BIGINT NOT NULL COMMENT '操作者ID',
    operator_role VARCHAR(20) NOT NULL COMMENT 'TEACHER/PARENT/ADMIN',
    task_id     VARCHAR(36) NOT NULL,
    student_id  BIGINT NOT NULL,
    action      VARCHAR(30) NOT NULL COMMENT 'VIEW_RESULT/VIEW_REPORT/EXPORT/BATCH_QUERY',
    ip_address  VARCHAR(45),
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_operator (operator_id),
    INDEX idx_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI检测审计日志';
```


## 12. 监控与告警

### 12.1 关键指标

| 指标 | 说明 | 告警阈值 |
| --- | --- | --- |
| detection_completion_rate | 检测完成率 | < 95% |
| avg_detection_latency | 平均检测延迟 | > 15s |
| dimension_failure_rate | 单维度失败率 | > 5% |
| high_ratio_alert_count | 高AI比例预警数 | 突增50% |
| false_feedback_rate | 用户反馈误报率 | > 10% |

### 12.2 Prometheus 指标定义

```python
from prometheus_client import Counter, Histogram, Gauge

# 检测任务计数
detection_tasks_total = Counter(
    'ai_detection_tasks_total',
    'Total AI detection tasks',
    ['status', 'submission_type']
)

# 检测延迟
detection_latency = Histogram(
    'ai_detection_latency_seconds',
    'AI detection latency',
    ['dimension'],
    buckets=[1, 3, 5, 10, 15, 30, 60]
)

# AI比例分布
ai_ratio_distribution = Histogram(
    'ai_detection_ratio_distribution',
    'AI ratio score distribution',
    buckets=[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
)

# 维度失败计数
dimension_failures = Counter(
    'ai_detection_dimension_failures_total',
    'Dimension detection failures',
    ['dimension', 'reason']
)
```


## 13. 与其他系统的集成

### 13.1 集成关系图

```
┌──────────────┐     提交触发      ┌───────────────┐
│  作文批改系统  │────────────────→│              │
│  Essay Grader │                  │              │
└──────────────┘                  │   AI内容      │
┌──────────────┐     提交触发      │   检测引擎     │
│  作业管理系统  │────────────────→│              │
│  Homework Svc │                  │              │
└──────────────┘                  └──────┬───────┘
┌──────────────┐     行为数据      ↑      │
│  AI对话引擎   │─────────────────│      │ 检测结果
│  AI Chat     │                  │      ▼
└──────────────┘                  │  ┌──────────────┐
┌──────────────┐     水印注册      │  │  教师工作台   │
│  AI输出服务   │─────────────────│  │  家长报告     │
│  AI Output   │                  │  │  管理后台     │
└──────────────┘                  │  └──────────────┘
┌──────────────┐     学情数据      │
│  学情分析系统  │←────────────────│
│  Analytics   │                  │
└──────────────┘
```

### 13.2 关键集成点

| 对接系统 | 交互方式 | 说明 |
| --- | --- | --- |
| AI对话引擎 | 读取对话记录 | 获取学生近期AI对话用于行为关联分析 |
| AI输出服务 | 水印注册 | AI输出时注册句子哈希到水印池 |
| 作文批改系统 | 消息队列 | 作文提交时触发检测，检测完成回调 |
| 作业管理系统 | 消息队列 | 主观题提交时触发检测 |
| 学情分析系统 | 数据写入 | 将AI辅助比例写入学生学情画像 |
| 教师工作台 | API调用 | 教师查看检测结果和班级概览 |
| 家长端 | API调用 | 家长查看孩子作业AI辅助情况 |


## 14. 部署与配置

### 14.1 服务部署

```yaml
# docker-compose.yml 片段
services:
  ai-detection-service:
    image: primetop/ai-detection:latest
    replicas: 3
    resources:
      limits:
        cpu: '4'
        memory: 8Gi
      requests:
        cpu: '2'
        memory: 4Gi
    env:
      - DB_HOST=mysql-primary
      - REDIS_HOST=redis-cluster
      - VECTOR_DB_URL=http://milvus:19530
      - MQ_HOST=rabbitmq-cluster
      - MODEL_CACHE_DIR=/models
      - MAX_CONCURRENT_TASKS=20
    health_check:
      path: /health
      interval: 30s
      timeout: 5s
    dependencies:
      - mysql-primary
      - redis-cluster
      - milvus
      - rabbitmq-cluster
```

### 14.2 关键配置项

```yaml
# application.yml
detection:
  # 模型配置
  perplexity_model: "gpt2-chinese-cluebase"
  style_encoder: "paraphrase-multilingual-MiniLM-L12-v2"
  model_cache_dir: "/app/models"
  
  # 检测参数
  min_text_length: 50          # 最小检测文本长度
  max_text_length: 20000       # 最大检测文本长度
  lookback_hours: 48           # 行为关联追溯时长
  similarity_threshold: 0.65   # 相似度判定阈值
  
  # 维度权重
  weights:
    PERPLEXITY: 0.20
    BURSTINESS: 0.15
    STYLE_FINGERPRINT: 0.25
    WATERMARK: 0.15
    BEHAVIOR_CORRELATION: 0.15
    SENTENCE_PATTERN: 0.10
  
  # 并发控制
  max_concurrent_tasks: 20
  task_timeout_seconds: 60
  retry_max: 3
  
  # 可见性
  default_student_visible: false
  default_parent_visible: true
  default_teacher_visible: true
  
  # 水印池
  watermark_pool_refresh_interval: 3600  # 秒
```