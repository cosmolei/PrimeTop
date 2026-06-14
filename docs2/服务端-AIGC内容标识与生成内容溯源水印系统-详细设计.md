# 服务端 - AIGC 内容标识与生成内容溯源水印系统 详细设计

> **文档版本**：v1.0  
> **最后更新**：2026-06-14  
> **关联模块**：AI 智能辅导、拍照搜题、作文辅导、文科背诵、AI 对话引擎  
> **合规依据**：《生成式人工智能服务管理暂行办法》(2023.8)、AIGC 内容标识强制标准、《互联网信息服务深度合成管理规定》

---

## 1. 背景与目标

### 1.1 业务背景

启硕 PrimeTop 作为全学段 AI 辅助学习软件，每日生成大量 AI 回答内容（文字解析、作文批改、背诵辅助、口语评测反馈等）。根据中国《生成式人工智能服务管理暂行办法》第十二条及后续 AIGC 内容标识强制标准要求：

1. **显式标识**：AI 生成的文字、图片、音频内容需在用户界面显著位置标注"AI 生成"或同类标识。
2. **隐式水印**：AI 生成的文本与图片需嵌入不可感知的水印信息，支持后续溯源验证。
3. **内容溯源**：每条 AI 生成内容需记录生成链路元数据（模型、时间、Prompt 摘要、用户上下文），支持事后审计与纠纷追溯。
4. **深度合成标识**：对语音合成(TTS)、图像生成等深度合成内容需额外添加数字水印并上报网信办备案。

### 1.2 系统目标

| 目标 | 说明 |
|------|------|
| 合规标识 | 所有 AI 生成内容在客户端展示时自动携带"AI 生成"显式标识 |
| 文本水印 | AI 生成的文本内容嵌入零宽度字符水印，支持提取验证 |
| 图片水印 | AI 生成/处理的图片内容嵌入频域不可见水印，支持提取溯源 |
| 元数据溯源 | 记录每条 AI 内容的完整生成链路，支持内容指纹查询与来源验证 |
| 性能无损 | 水印嵌入/提取对响应延迟影响 < 5ms（文本）/ < 50ms（图片） |
| 容错性 | 文本经过复制粘贴、格式转换后水印仍可提取；图片经压缩裁剪后水印仍可提取 |

### 1.3 适用范围

| 内容类型 | 来源场景 | 水印方式 |
|----------|----------|----------|
| AI 文字回答 | AI 对话、解题解析、作文批改、背诵辅助 | 零宽度字符 + 语义指纹 |
| AI 生成图片 | 函数图形、几何画板、物理仿真截图 | DCT 频域水印 |
| AI 语音合成 | TTS 朗读、口语示范 | 频域音频水印 |
| AI 批改报告 | 作文批改报告、学情分析报告 | 元数据标签 + 文本水印 |
| AI 摘要/卡片 | 知识要点卡片、学习摘要 | 文本水印 + 元数据 |

---

## 2. 整体架构

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                       客户端展示层                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ AI 对话   │  │ 解题解析  │  │ 作文批改  │  │ 学情报告  │    │
│  │ + 显式标识│  │ + 显式标识│  │ + 显式标识│  │ + 显式标识│    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
└───────┼──────────────┼──────────────┼──────────────┼─────────┘
        │              │              │              │
┌───────▼──────────────▼──────────────▼──────────────▼─────────┐
│                    BFF / API 网关层                           │
│            响应拦截器 → AIGC 标识注入                          │
└───────┬──────────────┬──────────────┬──────────────┬─────────┘
        │              │              │              │
┌───────▼──────────────▼──────────────▼──────────────▼─────────┐
│                   AI 服务编排层                                │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐     │
│  │ AI 对话引擎  │  │ 解题服务      │  │ 作文批改引擎     │     │
│  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘     │
│         │                │                    │               │
│         └────────────────┼────────────────────┘               │
│                          ▼                                    │
│              ┌───────────────────────┐                        │
│              │ AIGC 水印服务          │                        │
│              │ (Watermark Service)    │                        │
│              ├───────────────────────┤                        │
│              │ - TextWatermarker     │                        │
│              │ - ImageWatermarker    │                        │
│              │ - MetadataSigner      │                        │
│              │ - ProvenanceTracker   │                        │
│              └───────────┬───────────┘                        │
└──────────────────────────┼────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────┐
│                      数据存储层                                │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐       │
│  │ PostgreSQL  │  │ Redis      │  │ 对象存储(MinIO)   │       │
│  │ aigc_content│  │ 水印缓存    │  │ 水印图片/音频      │       │
│  │ _records    │  │ 指纹索引    │  │                  │       │
│  └────────────┘  └────────────┘  └──────────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件职责

| 组件 | 职责 | 部署形态 |
|------|------|----------|
| TextWatermarker | 文本水印嵌入与提取（零宽度字符 + 语义哈希） | 独立微服务 |
| ImageWatermarker | 图片水印嵌入与提取（DCT 频域） | 独立微服务 |
| AudioWatermarker | 音频水印嵌入与提取（扩频频域） | 独立微服务 |
| MetadataSigner | 生成内容元数据签名与验证 | SDK 嵌入 AI 服务 |
| ProvenanceTracker | 内容溯源链路记录与查询 | 独立微服务 |
| AigcLabelInterceptor | BFF 层响应拦截，自动注入显式标识 | BFF 中间件 |

### 2.3 处理流程

```
AI 服务生成原始内容
       │
       ▼
MetadataSigner 生成元数据签名
       │  (content_id, model_id, timestamp, user_id_hash, prompt_hash)
       ▼
根据内容类型路由
       ├──── 文本 → TextWatermarker.embed(text, content_id)
       ├──── 图片 → ImageWatermarker.embed(image_bytes, content_id)
       └──── 音频 → AudioWatermarker.embed(audio_bytes, content_id)
       │
       ▼
ProvenanceTracker 记录溯源信息
       │  → 写入 aigc_content_records 表
       │  → 写入 Redis 指纹索引（TTL 90天）
       ▼
返回带水印内容给 BFF
       │
       ▼
AigcLabelInterceptor 注入显式标识
       │  → 在响应体添加 aigc_label: true
       │  → 在响应头添加 X-AIGC-Content-Id
       │
       ▼
客户端渲染（展示"AI 生成"标识）
```

---

## 3. 数据结构设计

### 3.1 PostgreSQL 表结构

#### 3.1.1 `aigc_content_records` — AIGC 内容溯源记录表

```sql
CREATE TABLE aigc_content_records (
    id                  BIGSERIAL PRIMARY KEY,
    content_id          VARCHAR(64) NOT NULL UNIQUE,  -- 全局唯一内容ID（雪花ID+哈希）
    tenant_id           VARCHAR(32) NOT NULL DEFAULT 'default',
    
    -- 内容基本信息
    content_type        VARCHAR(20) NOT NULL,          -- TEXT / IMAGE / AUDIO / REPORT
    content_hash        VARCHAR(64) NOT NULL,          -- 原始内容 SHA-256 哈希
    watermarked_hash    VARCHAR(64),                   -- 加水印后内容 SHA-256 哈希
    content_preview     TEXT,                          -- 内容前200字符预览（图片/音频存URL）
    content_storage_url VARCHAR(512),                  -- 图片/音频的对象存储地址
    
    -- 生成链路元数据
    source_module       VARCHAR(50) NOT NULL,          -- AI_TUTOR / PHOTO_SOLVE / ESSAY_GRADING / etc.
    model_id            VARCHAR(64) NOT NULL,          -- 使用的模型标识（如 gpt-4o, glm-4）
    model_version       VARCHAR(32),                   -- 模型版本号
    prompt_template_id  VARCHAR(64),                   -- Prompt 模板ID
    prompt_hash         VARCHAR(64) NOT NULL,          -- 完整 Prompt 的 SHA-256（脱敏后）
    rag_context_ids     JSONB,                         -- RAG 检索引用的知识条目ID列表
    conversation_id     VARCHAR(64),                   -- 所属对话/会话ID
    parent_content_id   VARCHAR(64),                   -- 上一轮 AI 内容ID（多轮对话链）
    
    -- 用户上下文（脱敏）
    user_id_hash        VARCHAR(64) NOT NULL,          -- 用户ID 的 HMAC-SHA256 哈希
    user_grade          SMALLINT,                      -- 用户年级（用于适龄性审计）
    user_stage          VARCHAR(20),                   -- 学段：KINDERGARTEN/PRIMARY/JUNIOR/SENIOR
    
    -- 水印信息
    watermark_type      VARCHAR(30) NOT NULL,          -- ZWC / DCT / SPREAD_SPECTRUM / METADATA_ONLY
    watermark_payload   JSONB,                         -- 水印携带的载荷信息
    watermark_status    VARCHAR(20) NOT NULL DEFAULT 'EMBEDDED', -- EMBEDDED / FAILED / EXTRACTED / TAMPERED
    
    -- 合规标识
    aigc_label_shown    BOOLEAN NOT NULL DEFAULT TRUE, -- 客户端是否展示了"AI生成"标识
    deep_synthesis      BOOLEAN NOT NULL DEFAULT FALSE,-- 是否为深度合成内容（TTS/人脸等）
    regulatory_reported BOOLEAN NOT NULL DEFAULT FALSE,-- 是否已上报监管平台
    
    -- 时间戳
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- AI 内容生成时间
    embedded_at         TIMESTAMPTZ,                          -- 水印嵌入时间
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- 索引
    CONSTRAINT chk_content_type CHECK (content_type IN ('TEXT', 'IMAGE', 'AUDIO', 'REPORT')),
    CONSTRAINT chk_watermark_type CHECK (watermark_type IN ('ZWC', 'DCT', 'SPREAD_SPECTRUM', 'METADATA_ONLY')),
    CONSTRAINT chk_watermark_status CHECK (watermark_status IN ('EMBEDDED', 'FAILED', 'EXTRACTED', 'TAMPERED'))
);

-- 索引
CREATE INDEX idx_aigc_content_hash ON aigc_content_records (content_hash);
CREATE INDEX idx_aigc_watermarked_hash ON aigc_content_records (watermarked_hash);
CREATE INDEX idx_aigc_user_hash ON aigc_content_records (user_id_hash);
CREATE INDEX idx_aigc_conversation ON aigc_content_records (conversation_id);
CREATE INDEX idx_aigc_source_module ON aigc_content_records (source_module, generated_at DESC);
CREATE INDEX idx_aigc_generated_at ON aigc_content_records (generated_at DESC);

-- 按月分区（数据量大时启用）
-- CREATE INDEX idx_aigc_partition_month ON aigc_content_records (date_trunc('month', generated_at));
```

#### 3.1.2 `aigc_watermark_verification` — 水印验证记录表

```sql
CREATE TABLE aigc_watermark_verification (
    id                  BIGSERIAL PRIMARY KEY,
    content_id          VARCHAR(64),                   -- 匹配到的内容ID（可为空表示未匹配）
    input_content_hash  VARCHAR(64) NOT NULL,          -- 待验证内容的哈希
    input_content_type  VARCHAR(20) NOT NULL,          -- TEXT / IMAGE / AUDIO
    verification_result VARCHAR(20) NOT NULL,          -- VERIFIED / TAMPERED / NOT_FOUND / ERROR
    extracted_payload   JSONB,                         -- 提取出的水印载荷
    confidence_score    DECIMAL(5,4),                  -- 水印置信度 0.0000 ~ 1.0000
    verifier            VARCHAR(50) NOT NULL,          -- 验证来源：INTERNAL / REGULATOR / USER_REPORT
    verifier_note       TEXT,                          -- 备注
    verified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_verification_result CHECK (verification_result IN ('VERIFIED', 'TAMPERED', 'NOT_FOUND', 'ERROR'))
);

CREATE INDEX idx_verify_content_id ON aigc_watermark_verification (content_id);
CREATE INDEX idx_verify_input_hash ON aigc_watermark_verification (input_content_hash);
CREATE INDEX idx_verify_result ON aigc_watermark_verification (verification_result, verified_at DESC);
```

#### 3.1.3 `aigc_regulatory_report` — 监管上报记录表

```sql
CREATE TABLE aigc_regulatory_report (
    id                  BIGSERIAL PRIMARY KEY,
    content_id          VARCHAR(64) NOT NULL,
    report_type         VARCHAR(30) NOT NULL,          -- MONTHLY_SUMMARY / INCIDENT / DEEP_SYNTHESIS
    report_status       VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING / SUBMITTED / ACKNOWLEDGED / FAILED
    report_payload      JSONB NOT NULL,                -- 上报数据包
    external_ref        VARCHAR(128),                  -- 监管平台返回的回执号
    submitted_at        TIMESTAMPTZ,
    submitted_by        VARCHAR(64),                   -- 系统自动 / 操作人
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT chk_report_type CHECK (report_type IN ('MONTHLY_SUMMARY', 'INCIDENT', 'DEEP_SYNTHESIS')),
    CONSTRAINT chk_report_status CHECK (report_status IN ('PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'FAILED'))
);

CREATE INDEX idx_regulatory_content ON aigc_regulatory_report (content_id);
CREATE INDEX idx_regulatory_status ON aigc_regulatory_report (report_status, created_at DESC);
```

### 3.2 Redis 数据结构

#### 3.2.1 内容指纹索引

```
Key:    aigc:fingerprint:{content_hash}
Value:  {content_id, source_module, model_id, generated_at}
TTL:    90 天（7776000 秒）
用途:   快速反查内容是否为平台生成的 AIGC 内容
```

#### 3.2.2 水印嵌入幂等锁

```
Key:    aigc:watermark:lock:{content_id}
Value:  "embedding"
TTL:    30 秒
用途:   防止并发重复嵌入水印
```

#### 3.2.3 显式标识配置缓存

```
Key:    aigc:label:config:{source_module}
Value:  {label_text, label_position, label_color, enabled}
TTL:    300 秒
用途:   缓存各模块的显式标识展示配置（支持运营后台动态调整）
```

### 3.3 核心数据模型（Java）

```java
/**
 * AIGC 内容溯源记录
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Table(name = "aigc_content_records")
public class AigcContentRecord {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    /** 全局唯一内容ID */
    @Column(name = "content_id", nullable = false, unique = true, length = 64)
    private String contentId;
    
    /** 内容类型 */
    @Enumerated(EnumType.STRING)
    @Column(name = "content_type", nullable = false, length = 20)
    private ContentType contentType;
    
    /** 原始内容哈希 */
    @Column(name = "content_hash", nullable = false, length = 64)
    private String contentHash;
    
    /** 加水印后内容哈希 */
    @Column(name = "watermarked_hash", length = 64)
    private String watermarkedHash;
    
    /** 内容预览 */
    @Column(name = "content_preview")
    private String contentPreview;
    
    /** 图片/音频存储地址 */
    @Column(name = "content_storage_url", length = 512)
    private String contentStorageUrl;
    
    /** 来源模块 */
    @Column(name = "source_module", nullable = false, length = 50)
    private String sourceModule;
    
    /** 模型标识 */
    @Column(name = "model_id", nullable = false, length = 64)
    private String modelId;
    
    /** Prompt 模板ID */
    @Column(name = "prompt_template_id", length = 64)
    private String promptTemplateId;
    
    /** Prompt 哈希（脱敏后） */
    @Column(name = "prompt_hash", nullable = false, length = 64)
    private String promptHash;
    
    /** RAG 引用的知识条目ID */
    @Type(type = "jsonb")
    @Column(name = "rag_context_ids", columnDefinition = "jsonb")
    private List<String> ragContextIds;
    
    /** 会话ID */
    @Column(name = "conversation_id", length = 64)
    private String conversationId;
    
    /** 父内容ID（多轮对话链） */
    @Column(name = "parent_content_id", length = 64)
    private String parentContentId;
    
    /** 用户ID哈希 */
    @Column(name = "user_id_hash", nullable = false, length = 64)
    private String userIdHash;
    
    /** 用户年级 */
    @Column(name = "user_grade")
    private Short userGrade;
    
    /** 水印类型 */
    @Enumerated(EnumType.STRING)
    @Column(name = "watermark_type", nullable = false, length = 30)
    private WatermarkType watermarkType;
    
    /** 水印载荷 */
    @Type(type = "jsonb")
    @Column(name = "watermark_payload", columnDefinition = "jsonb")
    private WatermarkPayload watermarkPayload;
    
    /** 水印状态 */
    @Enumerated(EnumType.STRING)
    @Column(name = "watermark_status", nullable = false, length = 20)
    private WatermarkStatus watermarkStatus;
    
    /** 是否展示显式标识 */
    @Column(name = "aigc_label_shown", nullable = false)
    private Boolean aigcLabelShown = true;
    
    /** 是否为深度合成内容 */
    @Column(name = "deep_synthesis", nullable = false)
    private Boolean deepSynthesis = false;
    
    /** AI 内容生成时间 */
    @Column(name = "generated_at", nullable = false)
    private OffsetDateTime generatedAt;
    
    /** 水印嵌入时间 */
    @Column(name = "embedded_at")
    private OffsetDateTime embeddedAt;
    
    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;
    
    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
    
    public enum ContentType {
        TEXT, IMAGE, AUDIO, REPORT
    }
    
    public enum WatermarkType {
        ZWC,            // Zero-Width Character（零宽度字符文本水印）
        DCT,            // Discrete Cosine Transform（DCT频域图片水印）
        SPREAD_SPECTRUM,// 扩频音频水印
        METADATA_ONLY   // 仅元数据标识（无隐式水印）
    }
    
    public enum WatermarkStatus {
        EMBEDDED,   // 已嵌入
        FAILED,     // 嵌入失败
        EXTRACTED,  // 已提取验证
        TAMPERED    // 检测到篡改
    }
}
```

```java
/**
 * 水印载荷 — 嵌入到内容中的核心信息
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WatermarkPayload implements Serializable {
    
    /** 内容ID（压缩编码后的短版本） */
    private String cid;
    
    /** 生成时间戳（Unix epoch second） */
    private Long ts;
    
    /** 模型编号（内部映射表，非明文模型名） */
    private Integer mid;
    
    /** 用户ID哈希前8位 */
    private String uh;
    
    /** 校验位（CRC32 of cid+ts+mid+uh） */
    private Long crc;
    
    /**
     * 将载荷编码为二进制串（用于嵌入水印）
     * 总长度固定 48 bits = 6 bytes
     */
    public byte[] toBinary() {
        ByteBuffer buf = ByteBuffer.allocate(6);
        // cid 取前16bit
        buf.putShort((short) (Integer.parseInt(cid, 36) & 0xFFFF));
        // ts 取后16bit（分钟级时间戳的低16位）
        buf.putShort((short) ((ts / 60) & 0xFFFF));
        // mid 8bit
        buf.put((byte) (mid & 0xFF));
        // uh 8bit（用户哈希第1字节）
        buf.put((byte) (Integer.parseInt(uh.substring(0, 2), 16) & 0xFF));
        return buf.array();
    }
    
    /**
     * 校验 CRC 是否匹配
     */
    public boolean validate() {
        long computed = crc32(cid + ts + mid + uh);
        return computed == crc;
    }
    
    private long crc32(String input) {
        CRC32 crc = new CRC32();
        crc.update(input.getBytes(StandardCharsets.UTF_8));
        return crc.getValue();
    }
}
```

---

## 4. 文本水印嵌入与提取

### 4.1 方案选型

采用 **零宽度字符(Zero-Width Character)水印** 方案：

| 维度 | 方案 | 说明 |
|------|------|------|
| 载体 | ZWSP(U+200B) + ZWNJ(U+200C) + ZWJ(U+200D) | 三种零宽度字符表示三进制 0/1/分隔 |
| 嵌入位置 | 段落末尾 + 每句话的标点前 | 对显示无影响，复制粘贴可保留 |
| 容量 | 48 bits / 段落 | 可编码 contentId(16) + 时间(16) + 模型(8) + 用户(8) |
| 鲁棒性 | 抗复制粘贴、抗富文本转换 | 不抗截图 OCR（需配合语义指纹） |
| 检测速度 | < 2ms / 段落 | 正则提取零宽度字符即可 |

### 4.2 文本水印嵌入流程

```
输入: 原始文本 + WatermarkPayload
  │
  ├─ 1. 将 payload.toBinary() 转为 48 bit 二进制串
  │
  ├─ 2. 将二进制串按 2 bit 分组 → 24 组 → 映射为三进制
  │     00 → ZWSP(U+200B)
  │     01 → ZWNJ(U+200C)
  │     10 → ZWJ (U+200D)
  │     11 → ZWSP+ZWJ (U+200B + U+200D)
  │
  ├─ 3. 添加起始标记: ZWNJ + ZWSP + ZWNJ (U+200C U+200B U+200C)
  │    添加结束标记: ZWJ + ZWNJ + ZWJ (U+200D U+200C U+200D)
  │
  ├─ 4. 将水印字符序列插入文本段落末尾（最后一个标点符号之前）
  │     多段落时在每个段落末尾都嵌入（冗余编码）
  │
  └─ 5. 返回带水印文本
```

### 4.3 关键代码

```java
/**
 * 文本水印嵌入器 — 零宽度字符方案
 */
@Component
@Slf4j
public class TextWatermarker {
    
    // 零宽度字符定义
    private static final String ZWSP = "\u200B"; // Zero Width Space
    private static final String ZWNJ = "\u200C"; // Zero Width Non-Joiner
    private static final String ZWJ  = "\u200D"; // Zero Width Joiner
    
    // 水印起始/结束标记
    private static final String START_MARKER = ZWNJ + ZWSP + ZWNJ;
    private static final String END_MARKER   = ZWJ + ZWNJ + ZWJ;
    
    // 2-bit → 零宽度字符映射
    private static final String[] BIT_MAP = {ZWSP, ZWNJ, ZWJ, ZWSP + ZWJ};
    
    // 匹配段落末尾标点的正则
    private static final Pattern SENTENCE_END = 
        Pattern.compile("([。！？!?；;\\n])");
    
    /**
     * 嵌入文本水印
     * 
     * @param originalText 原始文本
     * @param payload      水印载荷（48 bits）
     * @return 带水印的文本
     */
    public String embed(String originalText, WatermarkPayload payload) {
        if (originalText == null || originalText.isEmpty()) {
            return originalText;
        }
        
        try {
            // 1. 载荷 → 二进制
            byte[] binary = payload.toBinary();
            
            // 2. 编码为零宽度字符序列
            String watermarkChars = encodeToZeroWidthChars(binary);
            
            // 3. 拼接完整水印串
            String watermarkString = START_MARKER + watermarkChars + END_MARKER;
            
            // 4. 在段落末尾插入水印
            String result = insertWatermark(originalText, watermarkString);
            
            log.debug("Text watermark embedded, length={}, payload={}", 
                result.length() - originalText.length(), payload);
            
            return result;
            
        } catch (Exception e) {
            log.error("Failed to embed text watermark", e);
            // 水印嵌入失败不影响正常业务，返回原文
            return originalText;
        }
    }
    
    /**
     * 提取文本水印
     * 
     * @param watermarkedText 可能含水印的文本
     * @return 提取到的载荷，提取失败返回 null
     */
    public Optional<WatermarkPayload> extract(String watermarkedText) {
        if (watermarkedText == null || watermarkedText.isEmpty()) {
            return Optional.empty();
        }
        
        try {
            // 1. 提取所有零宽度字符序列
            String zwChars = extractZeroWidthChars(watermarkedText);
            if (zwChars == null || zwChars.isEmpty()) {
                return Optional.empty();
            }
            
            // 2. 定位起始/结束标记
            int start = zwChars.indexOf(START_MARKER);
            int end = zwChars.indexOf(END_MARKER);
            if (start < 0 || end < 0 || end <= start + START_MARKER.length()) {
                return Optional.empty();
            }
            
            // 3. 提取编码区段
            String encoded = zwChars.substring(start + START_MARKER.length(), end);
            
            // 4. 解码为二进制
            byte[] binary = decodeFromZeroWidthChars(encoded);
            if (binary == null || binary.length != 6) {
                return Optional.empty();
            }
            
            // 5. 还原 payload
            WatermarkPayload payload = WatermarkPayload.fromBinary(binary);
            
            // 6. CRC 校验
            if (payload.validate()) {
                return Optional.of(payload);
            } else {
                log.warn("Watermark CRC mismatch, possible tampering detected");
                return Optional.empty();
            }
            
        } catch (Exception e) {
            log.error("Failed to extract text watermark", e);
            return Optional.empty();
        }
    }
    
    /**
     * 将二进制数据编码为零宽度字符序列
     */
    private String encodeToZeroWidthChars(byte[] data) {
        StringBuilder sb = new StringBuilder();
        for (byte b : data) {
            // 每个 byte 拆成 4 个 2-bit 组
            for (int i = 6; i >= 0; i -= 2) {
                int idx = (b >> i) & 0x03;
                sb.append(BIT_MAP[idx]);
            }
        }
        return sb.toString();
    }
    
    /**
     * 将零宽度字符序列解码为二进制数据
     */
    private byte[] decodeFromZeroWidthChars(String encoded) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int bitPos = 0;
        int currentByte = 0;
        
        int i = 0;
        while (i < encoded.length()) {
            char c = encoded.charAt(i);
            int bits = -1;
            
            if (c == ZWSP.charAt(0)) {
                // 检查下一个字符判断是 "00"(ZWSP) 还是 "11"(ZWSP+ZWJ)
                if (i + 1 < encoded.length() && encoded.charAt(i + 1) == ZWJ.charAt(0)) {
                    bits = 3; // 11
                    i += 2;
                } else {
                    bits = 0; // 00
                    i += 1;
                }
            } else if (c == ZWNJ.charAt(0)) {
                bits = 1; // 01
                i += 1;
            } else if (c == ZWJ.charAt(0)) {
                bits = 2; // 10
                i += 1;
            } else {
                i += 1;
                continue;
            }
            
            currentByte = (currentByte << 2) | bits;
            bitPos += 2;
            
            if (bitPos == 8) {
                out.write(currentByte);
                currentByte = 0;
                bitPos = 0;
            }
        }
        
        return out.toByteArray();
    }
    
    /**
     * 在文本段落末尾插入水印
     * 策略：在最后一个标点符号前插入；如无标点则追加到末尾
     */
    private String insertWatermark(String text, String watermark) {
        // 按段落分割
        String[] paragraphs = text.split("(?<=\\n)", -1);
        StringBuilder result = new StringBuilder();
        
        for (int i = 0; i < paragraphs.length; i++) {
            String para = paragraphs[i];
            if (para.trim().isEmpty()) {
                result.append(para);
                continue;
            }
            
            // 只在最后一个有实质内容的段落嵌入
            if (i == paragraphs.length - 1 || 
                (i < paragraphs.length - 1 && paragraphs[i + 1].trim().isEmpty())) {
                
                // 找最后一个标点位置
                Matcher m = SENTENCE_END.matcher(para);
                int lastPunctPos = -1;
                while (m.find()) {
                    lastPunctPos = m.end() - 1;
                }
                
                if (lastPunctPos >= 0) {
                    result.append(para, 0, lastPunctPos);
                    result.append(watermark);
                    result.append(para.substring(lastPunctPos));
                } else {
                    result.append(para).append(watermark);
                }
            } else {
                result.append(para);
            }
        }
        
        return result.toString();
    }
    
    /**
     * 提取文本中的零宽度字符序列
     */
    private String extractZeroWidthChars(String text) {
        StringBuilder sb = new StringBuilder();
        for (char c : text.toCharArray()) {
            if (c == '\u200B' || c == '\u200C' || c == '\u200D') {
                sb.append(c);
            }
        }
        return sb.toString();
    }
}
```

### 4.4 语义指纹（辅助追溯）

当文本被截图 OCR 后零宽度字符丢失，需依赖语义指纹进行模糊匹配：

```java
/**
 * 文本语义指纹生成器
 * 用于在零宽度水印丢失时进行模糊溯源匹配
 */
@Component
public class TextSemanticFingerprint {
    
    /**
     * 生成文本的 SimHash 指纹（64 bit）
     * 特征: 分词后的词频向量 → SimHash
     */
    public String generateSimHash(String text) {
        // 1. 预处理：去除标点、空白
        String cleaned = text.replaceAll("[\\p{Punct}\\s]", "");
        
        // 2. 分词（使用 IK Analyzer 或 HanLP）
        List<String> tokens = tokenize(cleaned);
        
        // 3. 计算 SimHash
        int[] hashBits = new int[64];
        Map<String, Integer> freq = tokens.stream()
            .collect(Collectors.groupingBy(t -> t, Collectors.summingInt(t -> 1)));
        
        for (Map.Entry<String, Integer> entry : freq.entrySet()) {
            long hash = MurmurHash.hash64A(entry.getKey().getBytes(StandardCharsets.UTF_8), 0);
            int weight = entry.getValue();
            for (int i = 0; i < 64; i++) {
                if ((hash & (1L << i)) != 0) {
                    hashBits[i] += weight;
                } else {
                    hashBits[i] -= weight;
                }
            }
        }
        
        // 4. 生成最终指纹
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 64; i++) {
            sb.append(hashBits[i] > 0 ? "1" : "0");
        }
        return sb.toString(); // 64-bit 二进制串
    }
    
    /**
     * 计算两个 SimHash 的汉明距离
     * 距离 ≤ 3 认为是相似内容
     */
    public int hammingDistance(String hash1, String hash2) {
        int distance = 0;
        for (int i = 0; i < Math.min(hash1.length(), hash2.length()); i++) {
            if (hash1.charAt(i) != hash2.charAt(i)) {
                distance++;
            }
        }
        return distance;
    }
    
    private List<String> tokenize(String text) {
        // 实际实现使用项目集成的分词器
        return Arrays.asList(text.split("(?<=\\p{IsHan})|(?=\\p{IsHan})|[a-zA-Z]+|\\d+"));
    }
}
```

---

## 5. 图片水印嵌入与提取

### 5.1 方案选型

采用 **DCT(离散余弦变换)频域水印** 方案：

| 维度 | 说明 |
|------|------|
| 原理 | 将水印信息嵌入到图片 DCT 变换的中频系数中 |
| 不可见性 | 修改幅度控制在 ±2 以内，人眼不可察觉 |
| 容量 | 48 bits（与文本水印载荷一致） |
| 鲁棒性 | 抗 JPEG 压缩(质量≥60)、抗裁剪(保留 60%+ 区域)、抗缩放 |
| 限制 | 不抗极端裁剪(<50%)、不抗强模糊处理 |

### 5.2 关键代码

```java
/**
 * 图片水印嵌入器 — DCT 频域方案
 */
@Component
@Slf4j
public class ImageWatermarker {
    
    private static final int BLOCK_SIZE = 8;          // DCT 块大小
    private static final int WATERMARK_BITS = 48;     // 水印比特数
    private static final double ALPHA = 12.0;         // 水印强度因子
    
    /**
     * 嵌入图片水印
     * 
     * @param imageBytes 原始图片字节数组（PNG/JPEG）
     * @param payload    水印载荷
     * @return 带水印的图片字节数组（PNG 格式）
     */
    public byte[] embed(byte[] imageBytes, WatermarkPayload payload) {
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (image == null) {
                log.warn("Cannot read image, skip watermark");
                return imageBytes;
            }
            
            // 转为 YCbCr，只对亮度通道 Y 嵌入水印
            BufferedImage yImage = convertToYChannel(image);
            
            // 获取像素数据
            int width = yImage.getWidth();
            int height = yImage.getHeight();
            double[][] pixels = getPixelMatrix(yImage, width, height);
            
            // 将 payload 转为 bit 数组
            byte[] watermarkBits = payload.toBinary();
            
            // 在中频区域嵌入水印
            embedWatermarkIntoDCT(pixels, watermarkBits, width, height);
            
            // 逆 DCT 变换，重建图片
            putPixelMatrix(yImage, pixels, width, height);
            
            // 合并回原色彩图片
            BufferedImage result = mergeYChannel(image, yImage);
            
            // 输出为 PNG（避免 JPEG 压缩损坏水印）
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(result, "PNG", out);
            return out.toByteArray();
            
        } catch (Exception e) {
            log.error("Failed to embed image watermark", e);
            return imageBytes; // 失败返回原图
        }
    }
    
    /**
     * 提取图片水印
     */
    public Optional<WatermarkPayload> extract(byte[] imageBytes) {
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (image == null) return Optional.empty();
            
            BufferedImage yImage = convertToYChannel(image);
            int width = yImage.getWidth();
            int height = yImage.getHeight();
            double[][] pixels = getPixelMatrix(yImage, width, height);
            
            byte[] extractedBits = extractWatermarkFromDCT(pixels, width, height);
            if (extractedBits == null) return Optional.empty();
            
            WatermarkPayload payload = WatermarkPayload.fromBinary(extractedBits);
            if (payload.validate()) {
                return Optional.of(payload);
            }
            return Optional.empty();
            
        } catch (Exception e) {
            log.error("Failed to extract image watermark", e);
            return Optional.empty();
        }
    }
    
    /**
     * 在 DCT 中频系数中嵌入水印
     * 使用 8×8 分块 DCT，选择每个块的中频位置 (3,4) 和 (4,3) 嵌入 1 bit
     */
    private void embedWatermarkIntoDCT(double[][] pixels, byte[] watermarkBits, 
                                        int width, int height) {
        int bitIndex = 0;
        int totalBits = watermarkBits.length * 8;
        
        for (int y = 0; y + BLOCK_SIZE <= height && bitIndex < totalBits; y += BLOCK_SIZE) {
            for (int x = 0; x + BLOCK_SIZE <= width && bitIndex < totalBits; x += BLOCK_SIZE) {
                // 提取 8×8 块
                double[][] block = extractBlock(pixels, x, y, BLOCK_SIZE);
                
                // DCT 变换
                double[][] dctBlock = dct2d(block);
                
                // 嵌入 1 bit 到中频位置
                int byteIdx = bitIndex / 8;
                int bitOffset = 7 - (bitIndex % 8);
                int bit = (watermarkBits[byteIdx] >> bitOffset) & 1;
                
                // QIM (Quantization Index Modulation) 方式嵌入
                double pos1 = dctBlock[3][4];
                double pos2 = dctBlock[4][3];
                double diff = pos1 - pos2;
                
                if (bit == 1) {
                    // 使 diff > 0
                    if (diff <= 0) {
                        double adjust = ALPHA;
                        dctBlock[3][4] += adjust / 2;
                        dctBlock[4][3] -= adjust / 2;
                    }
                } else {
                    // 使 diff < 0
                    if (diff >= 0) {
                        double adjust = ALPHA;
                        dctBlock[3][4] -= adjust / 2;
                        dctBlock[4][3] += adjust / 2;
                    }
                }
                
                bitIndex++;
                
                // 逆 DCT 变换
                double[][] idctBlock = idct2d(dctBlock);
                
                // 写回像素
                writeBlock(pixels, idctBlock, x, y, BLOCK_SIZE);
            }
        }
    }
    
    /**
     * 从 DCT 系数中提取水印
     */
    private byte[] extractWatermarkFromDCT(double[][] pixels, int width, int height) {
        int totalBits = WATERMARK_BITS;
        byte[] result = new byte[totalBits / 8];
        int bitIndex = 0;
        
        for (int y = 0; y + BLOCK_SIZE <= height && bitIndex < totalBits; y += BLOCK_SIZE) {
            for (int x = 0; x + BLOCK_SIZE <= width && bitIndex < totalBits; x += BLOCK_SIZE) {
                double[][] block = extractBlock(pixels, x, y, BLOCK_SIZE);
                double[][] dctBlock = dct2d(block);
                
                // 从中频位置提取
                double diff = dctBlock[3][4] - dctBlock[4][3];
                int bit = diff > 0 ? 1 : 0;
                
                int byteIdx = bitIndex / 8;
                int bitOffset = 7 - (bitIndex % 8);
                result[byteIdx] |= (bit << bitOffset);
                
                bitIndex++;
            }
        }
        
        return bitIndex == totalBits ? result : null;
    }
    
    // === DCT 变换核心 ===
    
    private static final double[][] DCT_MATRIX = computeDCTMatrix(BLOCK_SIZE);
    
    private static double[][] computeDCTMatrix(int n) {
        double[][] m = new double[n][n];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (i == 0) {
                    m[i][j] = Math.sqrt(1.0 / n);
                } else {
                    m[i][j] = Math.sqrt(2.0 / n) * Math.cos(
                        (2 * j + 1) * i * Math.PI / (2.0 * n));
                }
            }
        }
        return m;
    }
    
    /** 2D DCT: D = M × P × M^T */
    private double[][] dct2d(double[][] block) {
        return matMul(matMul(DCT_MATRIX, block), transpose(DCT_MATRIX));
    }
    
    /** 2D IDCT: P' = M^T × D × M */
    private double[][] idct2d(double[][] dctBlock) {
        return matMul(matMul(transpose(DCT_MATRIX), dctBlock), DCT_MATRIX);
    }
    
    private double[][] matMul(double[][] a, double[][] b) {
        int n = a.length;
        double[][] c = new double[n][n];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                for (int k = 0; k < n; k++) {
                    c[i][j] += a[i][k] * b[k][j];
                }
            }
        }
        return c;
    }
    
    private double[][] transpose(double[][] m) {
        int n = m.length;
        double[][] t = new double[n][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < n; j++)
                t[i][j] = m[j][i];
        return t;
    }
    
    // === 图像辅助方法省略（convertToYChannel, mergeYChannel, etc.） ===
}
```

---

## 6. API 接口设计

### 6.1 水印嵌入接口（内部调用）

**POST** `/api/internal/aigc/watermark/embed`

> 由 AI 服务在生成内容后调用，嵌入水印并记录溯源信息。

#### 请求体

```json
{
  "content_type": "TEXT",
  "content": "这是一段AI生成的数学解析内容...",
  "content_storage_url": null,
  "source_module": "PHOTO_SOLVE",
  "model_id": "glm-4-flash",
  "prompt_template_id": "math-solve-v2",
  "prompt_hash": "a1b2c3d4e5f6...",
  "rag_context_ids": ["kp-12345", "kp-67890"],
  "conversation_id": "conv-abc123",
  "parent_content_id": null,
  "user_id_hash": "f7e8d9c0b1a2...",
  "user_grade": 8,
  "user_stage": "JUNIOR",
  "deep_synthesis": false
}
```

#### 响应体

```json
{
  "code": 0,
  "data": {
    "content_id": "aigc-20260614-abc123def456",
    "watermarked_content": "这是一段AI生成的数学解析内容...\u200C\u200B\u200C...",
    "watermarked_hash": "e3b0c44298fc1c149afbf4c8996fb924...",
    "watermark_type": "ZWC",
    "watermark_status": "EMBEDDED",
    "aigc_label": {
      "text": "此内容由AI生成",
      "icon_url": "https://cdn.primetop.edu/icons/aigc-label.png",
      "position": "BOTTOM_RIGHT"
    }
  }
}
```

### 6.2 水印验证接口

**POST** `/api/internal/aigc/watermark/verify`

> 用于内容审核、监管验证、用户举报时溯源。

#### 请求体

```json
{
  "content_type": "TEXT",
  "content": "需要验证的文本内容...",
  "verifier": "INTERNAL",
  "verifier_note": "用户举报内容排查"
}
```

#### 响应体

```json
{
  "code": 0,
  "data": {
    "verification_result": "VERIFIED",
    "content_id": "aigc-20260614-abc123def456",
    "extracted_payload": {
      "cid": "abc123",
      "ts": 1718356800,
      "mid": 7,
      "uh": "f7e8d9c0"
    },
    "confidence_score": 0.9875,
    "original_record": {
      "source_module": "PHOTO_SOLVE",
      "model_id": "glm-4-flash",
      "generated_at": "2026-06-14T10:00:00Z",
      "user_id_hash": "f7e8d9c0b1a2..."
    }
  }
}
```

### 6.3 内容溯源查询接口

**GET** `/api/internal/aigc/provenance/{contentId}`

> 根据 contentId 查询完整的生成链路信息。

#### 响应体

```json
{
  "code": 0,
  "data": {
    "content_id": "aigc-20260614-abc123def456",
    "content_type": "TEXT",
    "content_preview": "设二次函数 f(x) = ax² + bx + c，已知...",
    "source_module": "PHOTO_SOLVE",
    "model_id": "glm-4-flash",
    "prompt_template_id": "math-solve-v2",
    "rag_context_ids": ["kp-12345", "kp-67890"],
    "conversation_id": "conv-abc123",
    "parent_content_id": null,
    "watermark_type": "ZWC",
    "watermark_status": "EMBEDDED",
    "generated_at": "2026-06-14T10:00:00Z",
    "embedded_at": "2026-06-14T10:00:00.003Z",
    "chain": [
      {
        "content_id": "aigc-20260614-abc123def456",
        "model_id": "glm-4-flash",
        "generated_at": "2026-06-14T10:00:00Z"
      },
      {
        "content_id": "aigc-20260614-parent789",
        "model_id": "glm-4-flash",
        "generated_at": "2026-06-14T09:58:00Z"
      }
    ]
  }
}
```

### 6.4 显式标识配置查询接口

**GET** `/api/internal/aigc/label-config?sourceModule={module}`

> 客户端或 BFF 层获取显式标识的展示配置。

#### 响应体

```json
{
  "code": 0,
  "data": {
    "source_module": "AI_TUTOR",
    "enabled": true,
    "label_text": "AI 生成",
    "label_position": "CONTENT_END",
    "label_color": "#999999",
    "label_font_size": 11,
    "icon_url": "https://cdn.primetop.edu/icons/aigc-badge.png",
    "deep_synthesis_label": {
      "enabled": true,
      "text": "该内容经过AI深度合成",
      "show_on_audio": true,
      "show_on_image": true
    }
  }
}
```

### 6.5 监管上报接口

**POST** `/api/internal/aigc/regulatory/report`

> 定时任务或手动触发，向监管平台批量上报 AIGC 内容。

#### 请求体

```json
{
  "report_type": "MONTHLY_SUMMARY",
  "period_start": "2026-06-01T00:00:00Z",
  "period_end": "2026-06-30T23:59:59Z"
}
```

---

## 7. BFF 层显式标识注入

### 7.1 AigcLabelInterceptor 设计

在 BFF（Backend For Frontend）层增加响应拦截器，自动为 AI 生成内容注入显式标识：

```java
/**
 * BFF 层 AIGC 显式标识拦截器
 * 拦截所有返回 AI 内容的接口，自动添加显式标识字段
 */
@Component
@Order(50)
public class AigcLabelInterceptor implements ResponseBodyAdvice<Object> {
    
    @Autowired
    private AigcLabelConfigCache labelConfigCache;
    
    /** 需要拦截的路径模式 */
    private static final List<AntPathMatcher> AIGC_PATHS = List.of(
        new AntPathMatcher("/api/v1/ai-tutor/**"),
        new AntPathMatcher("/api/v1/photo-solve/**"),
        new AntPathMatcher("/api/v1/essay/**"),
        new AntPathMatcher("/api/v1/recite/**"),
        new AntPathMatcher("/api/v1/study-report/**")
    );
    
    @Override
    public boolean supports(MethodParameter returnType, Class converterType) {
        String path = RequestContextHolder.getRequestAttributes()
            .getAttribute("requestPath", RequestAttributes.SCOPE_REQUEST)
            .toString();
        return AIGC_PATHS.stream().anyMatch(p -> p.match(path));
    }
    
    @Override
    @SuppressWarnings({"unchecked", "rawtypes"})
    public Object beforeBodyWrite(Object body, MethodParameter returnType, 
                                   MediaType selectedContentType,
                                   Class selectedConverterType,
                                   ServerHttpRequest request,
                                   ServerHttpResponse response) {
        
        if (!(body instanceof Map)) return body;
        
        Map<String, Object> responseMap = (Map<String, Object>) body;
        Map<String, Object> data = (Map<String, Object>) responseMap.get("data");
        if (data == null) return body;
        
        // 从 AI 服务返回的响应中获取 content_id 和 source_module
        String contentId = (String) data.get("aigc_content_id");
        String sourceModule = (String) data.get("aigc_source_module");
        
        if (contentId != null) {
            // 注入显式标识配置
            AigcLabelConfig labelConfig = labelConfigCache.getConfig(sourceModule);
            if (labelConfig != null && labelConfig.getEnabled()) {
                data.put("aigc_label", Map.of(
                    "text", labelConfig.getLabelText(),
                    "icon_url", labelConfig.getIconUrl(),
                    "position", labelConfig.getLabelPosition().name(),
                    "color", labelConfig.getLabelColor(),
                    "content_id", contentId
                ));
            }
            
            // 添加响应头
            response.getHeaders().add("X-AIGC-Content-Id", contentId);
            response.getHeaders().add("X-AIGC-Source-Module", sourceModule);
        }
        
        return body;
    }
}
```

### 7.2 客户端展示规范

| 内容展示场景 | 标识位置 | 样式规范 |
|-------------|---------|---------|
| AI 对话气泡 | 气泡右下角 | 11px 灰色文字 "AI 生成" + 16x16 小图标 |
| 解题解析卡片 | 卡片底部居中 | 12px 灰色文字 + 下划线 |
| 作文批改报告 | 报告顶部右侧 | 带背景色的小标签 |
| 学情分析报告 | 报告封面底部 | 居中文字标注 |
| TTS 语音播放 | 播放控件旁 | 小图标 + tooltip |
| 图片/图形内容 | 图片右下角水印 | 半透明小标识 |

---

## 8. 状态流转

### 8.1 内容水印状态机

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
                    ▼                                              │
              ┌──────────┐    嵌入成功     ┌──────────┐           │
  AI内容生成  │ PENDING  │ ──────────▶   │ EMBEDDED │           │
   ───────▶  └────┬─────┘                └────┬─────┘           │
                  │                           │                   │
                  │ 嵌入失败                   │ 验证请求          │
                  ▼                           ▼                   │
             ┌──────────┐              ┌──────────┐              │
             │  FAILED  │              │ EXTRACTED│              │
             └──────────┘              └────┬─────┘              │
                                             │                    │
                                             │ CRC校验失败         │
                                             ▼                    │
                                       ┌──────────┐              │
                                       │ TAMPERED │ ─────────────┘
                                       └──────────┘   触发安全告警
```

### 8.2 状态转换规则

| 当前状态 | 事件 | 目标状态 | 动作 |
|---------|------|---------|------|
| PENDING | 水印嵌入成功 | EMBEDDED | 记录 embedded_at，写入 Redis 索引 |
| PENDING | 水印嵌入失败 | FAILED | 记录失败原因，仅保留元数据 |
| EMBEDDED | 收到验证请求，水印提取成功且 CRC 通过 | EXTRACTED | 记录验证信息 |
| EMBEDDED | 收到验证请求，水印提取失败或 CRC 不通过 | TAMPERED | 触发安全告警 |
| FAILED | 收到验证请求 | NOT_FOUND（验证记录） | 记录为无水印内容 |

---

## 9. 与现有系统集成方案

### 9.1 AI 服务层集成

在 AI 服务编排层的后处理管线中增加水印嵌入步骤：

```java
/**
 * AI 回答后处理管线 — 增加水印嵌入步骤
 */
@Component
public class AiResponsePostProcessor {
    
    @Autowired
    private TextWatermarker textWatermarker;
    
    @Autowired
    private ImageWatermarker imageWatermarker;
    
    @Autowired
    private ProvenanceTracker provenanceTracker;
    
    @Autowired
    private MetadataSigner metadataSigner;
    
    /**
     * AI 回答后处理入口
     */
    public AiResponse process(AiResponse rawResponse, AiRequestContext context) {
        
        // 1. 生成内容ID和元数据签名
        String contentId = generateContentId(context);
        WatermarkPayload payload = metadataSigner.createPayload(contentId, context);
        
        // 2. 根据内容类型嵌入水印
        AiResponse watermarked = switch (rawResponse.getContentType()) {
            case TEXT -> processText(rawResponse, payload);
            case IMAGE -> processImage(rawResponse, payload);
            case MIXED -> processMixed(rawResponse, payload);
            default -> rawResponse;
        };
        
        // 3. 记录溯源信息
        provenanceTracker.record(
            ProvenanceRecord.builder()
                .contentId(contentId)
                .contentType(rawResponse.getContentType())
                .contentHash(sha256(rawResponse.getRawContent()))
                .watermarkedHash(sha256(watermarked.getRawContent()))
                .sourceModule(context.getSourceModule())
                .modelId(context.getModelId())
                .promptHash(context.getPromptHash())
                .conversationId(context.getConversationId())
                .userIdHash(context.getUserIdHash())
                .watermarkType(rawResponse.getContentType() == ContentType.IMAGE 
                    ? WatermarkType.DCT : WatermarkType.ZWC)
                .payload(payload)
                .generatedAt(rawResponse.getGeneratedAt())
                .build()
        );
        
        // 4. 设置 content_id 供 BFF 层使用
        watermarked.setAigcContentId(contentId);
        watermarked.setAigcSourceModule(context.getSourceModule());
        
        return watermarked;
    }
    
    private AiResponse processText(AiResponse response, WatermarkPayload payload) {
        String watermarked = textWatermarker.embed(response.getContent(), payload);
        return response.toBuilder()
            .content(watermarked)
            .build();
    }
    
    private AiResponse processImage(AiResponse response, WatermarkPayload payload) {
        byte[] watermarked = imageWatermarker.embed(
            response.getImageBytes(), payload);
        return response.toBuilder()
            .imageBytes(watermarked)
            .build();
    }
    
    private AiResponse processMixed(AiResponse response, WatermarkPayload payload) {
        // 先处理图片部分
        List<ContentBlock> blocks = response.getBlocks().stream()
            .map(block -> {
                if (block.getType() == ContentBlock.Type.IMAGE) {
                    byte[] wm = imageWatermarker.embed(block.getImageBytes(), payload);
                    return block.toBuilder().imageBytes(wm).build();
                } else if (block.getType() == ContentBlock.Type.TEXT) {
                    String wm = textWatermarker.embed(block.getText(), payload);
                    return block.toBuilder().text(wm).build();
                }
                return block;
            })
            .collect(Collectors.toList());
        
        return response.toBuilder().blocks(blocks).build();
    }
}
```

### 9.2 SSE 流式响应水印处理

对于 SSE 流式 AI 回答，需在**流结束后对完整文本**嵌入水印：

```java
/**
 * SSE 流式回答水印后处理器
 * 在流式传输完成后，对最终完整文本进行水印嵌入
 */
@Component
public class SseWatermarkPostProcessor {
    
    @Autowired
    private TextWatermarker textWatermarker;
    
    /**
     * 在 SSE 流结束时调用，发送包含水印的完整版本
     */
    public void postProcess(SseEmitter emitter, String accumulatedText, 
                            WatermarkPayload payload) {
        try {
            // 生成带水印的完整文本
            String watermarked = textWatermarker.embed(accumulatedText, payload);
            
            // 发送一个特殊事件，让客户端用带水印版本替换流式累积的内容
            emitter.send(SseEmitter.event()
                .name("aigc-final")
                .data(Map.of(
                    "watermarked_text", watermarked,
                    "aigc_content_id", payload.getCid(),
                    "aigc_label", true
                ))
            );
            
        } catch (Exception e) {
            log.error("Failed to post-process SSE watermark", e);
            // 发送不带水印的版本，不影响用户体验
            emitter.send(SseEmitter.event()
                .name("aigc-final")
                .data(Map.of("aigc_label", true))
            );
        }
    }
}
```

---

## 10. 错误处理与降级策略

### 10.1 错误分级与处理

| 错误场景 | 严重级别 | 处理策略 | 用户影响 |
|---------|---------|---------|---------|
| 文本水印嵌入失败 | WARN | 返回原文（仅元数据标识），记录 FAILED 状态 | 无感知，仍展示"AI生成"标识 |
| 图片水印嵌入失败 | WARN | 返回原图（仅元数据标识），记录 FAILED 状态 | 无感知 |
| 水印服务超时（>500ms） | ERROR | 跳过水印，直接返回内容 + 元数据标识 | 无感知 |
| 溯源记录写入数据库失败 | ERROR | 异步重试（3次），重试失败写入死信队列 | 无感知 |
| Redis 指纹索引写入失败 | WARN | 仅日志告警，不阻塞主流程 | 无感知 |
| 水印验证时服务不可用 | ERROR | 返回 NOT_FOUND，通知人工排查 | 验证方可能需要等待 |
| 监管上报失败 | CRITICAL | 重试 + 告警值班人员，人工补报 | 合规风险 |

### 10.2 降级链路

```
水印嵌入正常流程
  │
  ├─ 水印服务超时/不可用？
  │   └─ 降级为 METADATA_ONLY（仅元数据记录，不嵌入隐式水印）
  │       └─ 客户端仍展示显式标识 ✅
  │
  ├─ 数据库写入失败？
  │   └─ 写入 Redis 临时缓存，异步 Worker 重试写入
  │       └─ 不影响用户正常使用 ✅
  │
  └─ Redis 不可用？
      └─ 直接写数据库（跳过缓存层）
          └─ 性能略降，功能正常 ✅
```

### 10.3 监控告警

| 监控指标 | 告警阈值 | 处理方式 |
|---------|---------|---------|
| 水印嵌入成功率 | < 99.5% | P2 告警，检查水印服务健康状态 |
| 水印嵌入平均耗时 | > 10ms（文本）/ 100ms（图片） | P3 告警，排查性能瓶颈 |
| 水印验证 TAMPERED 率 | > 0.1% | P1 告警，可能存在内容篡改攻击 |
| 监管上报失败次数 | > 0 | P0 告警，合规风险，立即处理 |
| 溯源记录写入失败率 | > 0.5% | P2 告警，检查数据库连接 |

---

## 11. 安全考量

### 11.1 防水印擦除攻击

| 攻击方式 | 防御措施 |
|---------|---------|
| 手动删除零宽度字符 | 语义指纹 SimHash 作为辅助溯源手段 |
| 截图 OCR 重新输入 | SimHash 模糊匹配（汉明距离 ≤ 3） |
| 图片裁剪/压缩 | DCT 水印对 JPEG ≥ 60 质量、裁剪 ≤ 40% 具备鲁棒性 |
| 图片极端后处理（高斯模糊等） | 接受水印可能丢失，依靠显式标识和元数据溯源 |
| 批量请求获取无水印内容 | 水印嵌入在 AI 服务后处理层，不可绕过 |

### 11.2 用户隐私保护

1. **不存储明文用户ID**：溯源记录中仅存储 `user_id_hash`（HMAC-SHA256）
2. **Prompt 脱敏哈希**：仅存储 Prompt 的 SHA-256 哈希，不存储完整 Prompt
3. **内容预览截断**：仅存储前 200 字符预览
4. **数据保留期限**：溯源记录保留 2 年，超过后归档到冷存储
5. **访问控制**：溯源查询接口需要 `AIGC_PROVENANCE_QUERY` 权限

### 11.3 合规对齐检查清单

| 合规要求 | 实现状态 | 说明 |
|---------|---------|------|
| AIGC 内容显式标识 | ✅ 已实现 | 客户端展示"AI 生成"标识 |
| 隐式水印嵌入 | ✅ 已实现 | 文本 ZWC + 图片 DCT |
| 内容溯源链路 | ✅ 已实现 | content_id → 完整生成链路查询 |
| 深度合成特殊标识 | ✅ 已实现 | TTS/图像生成额外标识 |
| 监管数据上报 | ✅ 已设计 | 月度汇总上报 + 事件驱动上报 |
| 用户可辨识 AI 内容 | ✅ 已实现 | 显式标识 + 教育引导 |

---

## 12. 性能预估

### 12.1 资源消耗

| 操作 | 平均耗时 | CPU 开销 | 内存开销 |
|------|---------|---------|---------|
| 文本水印嵌入（500字） | ~1.5ms | 极低 | < 10KB |
| 文本水印提取（500字） | ~0.8ms | 极低 | < 10KB |
| 图片水印嵌入（1024×768） | ~35ms | 中等 | ~6MB（临时） |
| 图片水印提取（1024×768） | ~30ms | 中等 | ~6MB（临时） |
| SimHash 生成（500字） | ~2ms | 低 | < 20KB |
| 元数据签名 | ~0.1ms | 极低 | < 1KB |
| 溯源记录写入（含索引） | ~3ms | 低 | < 4KB |

### 12.2 容量规划

| 指标 | 估算值 | 说明 |
|------|-------|------|
| 日均 AIGC 内容量 | ~500万条 | 基于百万 DAU × 日均 5 次 AI 交互 |
| 单条溯源记录大小 | ~1.5 KB | 含元数据、水印载荷 |
| 日均存储增长 | ~7.5 GB | 500万 × 1.5KB |
| 年存储量 | ~2.7 TB | 365天 × 7.5GB |
| Redis 缓存（90天） | ~675 GB | 90天 × 7.5GB |
| 水印嵌入 QPS | ~600 | 峰值约 5000 QPS（秒级） |

### 12.3 扩展建议

1. **水印服务独立部署**：当 QPS > 2000 时，将 TextWatermarker / ImageWatermarker 拆分为独立微服务，支持水平扩展
2. **异步溯源写入**：溯源记录通过消息队列异步写入数据库，避免阻塞 AI 回复主链路
3. **冷热数据分离**：90 天内的溯源记录在 Redis + PostgreSQL 热库，超过的归档到对象存储冷存储
4. **按月分区表**：`aigc_content_records` 表按月分区，加速按时间范围查询

---

## 13. 部署配置

### 13.1 水印服务部署

```yaml
# docker-compose.yml（水印服务部分）
version: '3.8'
services:
  aigc-watermark-service:
    image: primetop/aigc-watermark:1.0.0
    deploy:
      replicas: 4
      resources:
        limits:
          cpu: '2'
          memory: 4G
        reservations:
          cpu: '1'
          memory: 2G
      restart_policy:
        condition: any
        max_attempts: 3
    environment:
      - DB_URL=jdbc:postgresql://pg-primary:5432/primetop
      - REDIS_HOST=redis-cluster
      - MINIO_ENDPOINT=http://minio:9000
      - WATERMARK_TEXT_ALPHA=0        # 文本水印是否启用调试模式
      - WATERMARK_IMAGE_QUALITY=0.95  # 图片水印输出质量
      - MONITORING_ENABLED=true
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    networks:
      - primetop-backend
    logging:
      driver: json-file
      options:
        max-size: "100m"
        max-file: "5"
```

### 13.2 监控埋点

```java
/**
 * 水印服务监控指标
 */
@Component
public class WatermarkMetrics {
    
    private final MeterRegistry meterRegistry;
    
    private final Counter textEmbedCounter;
    private final Counter imageEmbedCounter;
    private final Counter embedFailCounter;
    private final Counter extractCounter;
    private final Counter tamperedCounter;
    
    private final Timer textEmbedTimer;
    private final Timer imageEmbedTimer;
    
    public WatermarkMetrics(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        
        this.textEmbedCounter = Counter.builder("aigc.watermark.text.embed")
            .description("Text watermark embed count")
            .tag("result", "success")
            .register(meterRegistry);
            
        this.imageEmbedCounter = Counter.builder("aigc.watermark.image.embed")
            .description("Image watermark embed count")
            .register(meterRegistry);
            
        this.embedFailCounter = Counter.builder("aigc.watermark.embed.fail")
            .description("Watermark embed failure count")
            .register(meterRegistry);
            
        this.extractCounter = Counter.builder("aigc.watermark.extract")
            .description("Watermark extract/verify count")
            .register(meterRegistry);
            
        this.tamperedCounter = Counter.builder("aigc.watermark.tampered")
            .description("Watermark tampering detected count")
            .register(meterRegistry);
            
        this.textEmbedTimer = Timer.builder("aigc.watermark.text.embed.duration")
            .description("Text watermark embed duration")
            .register(meterRegistry);
            
        this.imageEmbedTimer = Timer.builder("aigc.watermark.image.embed.duration")
            .description("Image watermark embed duration")
            .register(meterRegistry);
    }
    
    public void recordTextEmbed(long durationMs, boolean success) {
        if (success) {
            textEmbedCounter.increment();
        } else {
            embedFailCounter.increment();
        }
        textEmbedTimer.record(durationMs, TimeUnit.MILLISECONDS);
    }
    
    public void recordImageEmbed(long durationMs, boolean success) {
        if (success) {
            imageEmbedCounter.increment();
        } else {
            embedFailCounter.increment();
        }
        imageEmbedTimer.record(durationMs, TimeUnit.MILLISECONDS);
    }
    
    public void recordTampered() {
        tamperedCounter.increment();
    }
}
```

---

## 14. 附录

### 14.1 术语表

| 术语 | 说明 |
|------|------|
| AIGC | AI Generated Content，人工智能生成内容 |
| ZWC | Zero-Width Character，零宽度字符 |
| DCT | Discrete Cosine Transform，离散余弦变换 |
| QIM | Quantization Index Modulation，量化索引调制 |
| SimHash | 局部敏感哈希，用于文本相似度比较 |
| 深度合成 | 利用AI生成或显著修改音频、图像、视频内容 |
| 显式标识 | 用户可感知的 AI 内容标注 |
| 隐式水印 | 不可感知的内容标识信息 |

### 14.2 参考标准

1. 《生成式人工智能服务管理暂行办法》（国家网信办等七部门联合发布，2023.8.15 施行）
2. 《互联网信息服务深度合成管理规定》（2023.1.10 施行）
3. GB/T 42888-2023《信息安全技术 机器生成文本内容标识技术规范》
4. 《生成式人工智能服务安全基本要求》（TC260-003，2024.2）

### 14.3 后续演进方向

| 方向 | 说明 | 优先级 |
|------|------|--------|
| 音频水印 | AI 语音合成(TTS)内容嵌入扩频音频水印 | P1（TTS 功能上线前） |
| 视频水印 | 如后续支持视频生成/处理，嵌入视频帧水印 | P3 |
| 水印强度自适应 | 根据内容长度/图片尺寸动态调整水印强度 | P2 |
| AI 内容检测模型 | 训练专门的 AI 生成文本检测器，作为水印补充 | P3 |
| 区块链溯源 | 关键内容上链，实现不可篡改的溯源链 | P3 |
| 跨平台水印联盟 | 加入行业 AIGC 水印互认标准（如 C2PA） | P3 |
