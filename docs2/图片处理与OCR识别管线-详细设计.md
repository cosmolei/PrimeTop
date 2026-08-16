# 图片处理与 OCR 识别管线 - 详细设计文档

## 1. 模块概述

### 1.1 定位

图片处理与 OCR 识别管线是 PrimeTop 拍照搜题功能的底层技术子系统，负责将用户拍摄的纸质作业、试卷、练习册图片转化为结构化的题目数据。本模块是"拍照 → 识别 → 结构化 → 解析"技术链路的前半段，输出质量直接决定后续 AI 解析的准确率。

### 1.2 设计目标

| 目标 | 指标 |
|------|------|
| 单题识别准确率 | ≥ 95%（印刷体），≥ 85%（手写体） |
| 端到端延迟 | ≤ 3s（单题），≤ 6s（多题，≤ 5 题） |
| 并发吞吐 | 峰值 500 QPS |
| 图片预处理成功率 | ≥ 99% |
| 公式识别准确率 | ≥ 90%（常见数学公式） |
| 图表检测召回率 | ≥ 85%（含函数图、几何图、电路图） |

### 1.3 功能边界

**本模块负责：**
- 图片接收与存储
- 图片预处理（去噪、增强、矫正）
- 文字 OCR 识别
- 数学公式识别（LaTeX 输出）
- 图表区域检测与提取
- 多题自动分割
- 识别结果结构化输出

**不在本模块范围：**
- 题库匹配与 AI 解析（→ 拍照搜题与习题答疑模块）
- UI 交互（裁剪、旋转、区域选择）（→ 客户端）
- 知识点关联（→ 知识点体系模块）

### 1.4 与其他模块的关系

```
客户端（拍照/选图）
    │
    ↓ [1] 上传图片
图片处理与 OCR 识别管线（本模块）
    │
    ├─→ [2] 调用文件存储服务保存原图
    ├─→ [3] 调用第三方 OCR API
    ├─→ [4] 调用公式识别服务
    │
    ↓ [5] 返回结构化题目数据
拍照搜题与习题答疑模块
    │
    ↓ [6] 调用 AI 解析 / 题库匹配
```

---

## 2. 整体架构

### 2.1 管线架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                      客户端                                       │
│  拍照 → 裁剪/旋转 → 压缩 → 上传                                    │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP/Multipart
                       ↓
┌──────────────────────────────────────────────────────────────────┐
│                  API 网关 / 鉴权 / 限流                            │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ↓
┌──────────────────────────────────────────────────────────────────┐
│              图片处理服务 (image-process-service)                  │
│                                                                    │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ 图片接收  │→│ 图片预处理  │→│ OCR 调度  │→│ 结果结构化 │          │
│  └─────────┘  └──────────┘  └──────────┘  └──────────┘          │
│                      │              │                              │
│                      ↓              ↓                              │
│               ┌──────────┐   ┌──────────┐                        │
│               │ OpenCV   │   │ OCR 引擎  │                        │
│               │ 预处理库  │   │ 适配层    │                        │
│               └──────────┘   └──────────┘                        │
└──────────────────────────────────────────────────────────────────┘
                       │                  │
                       ↓                  ↓
┌─────────────────┐  ┌──────────────────────────────────┐
│  对象存储 (OSS)   │  │       外部 OCR 服务                │
│  原图 + 预处理图  │  │  百度 OCR / 腾讯 OCR / Mathpix    │
└─────────────────┘  └──────────────────────────────────┘
```

### 2.2 服务定位

图片处理服务作为独立微服务部署，通过内部 API 对外暴露能力。

| 属性 | 说明 |
|------|------|
| 服务名 | `image-process-service` |
| 语言 | Python 3.11+（OpenCV / Pillow 生态） |
| 框架 | FastAPI |
| 部署 | Docker, K8s, 2-8 副本（按负载扩缩） |
| 端口 | 8080 |
| 通信 | HTTP REST（同步），Redis Stream（异步回调） |

---

## 3. 详细流程

### 3.1 主流程（端到端）

```
[客户端]
   │
   │ 1. 拍照/选图
   │ 2. 客户端本地预处理（见 3.2）
   │ 3. POST /api/v1/ocr/recognize (multipart/form-data)
   │
   ↓
[API 网关]
   │ 4. 鉴权 + 限流 + 日志
   │
   ↓
[image-process-service]
   │
   │ 5. 接收图片 → 存储到 OSS → 返回 task_id
   │ 6. 异步处理管线启动
   │
   ├─→ 6a. 图片预处理管线（见 3.3）
   │       ├─ 畸变矫正
   │       ├─ 去阴影/增强对比度
   │       ├─ 二值化
   │       └─ 输出预处理图
   │
   ├─→ 6b. OCR 识别管线（见 3.4）
   │       ├─ 区域检测（文本区/公式区/图表区）
   │       ├─ 文本 OCR（通用 + 教育场景优化）
   │       ├─ 公式识别 → LaTeX
   │       ├─ 图表检测 → 裁剪 + 标注
   │       └─ 结果合并
   │
   ├─→ 6c. 多题分割（见 3.5）
   │       ├─ 题号检测（正则 + 视觉）
   │       ├─ 题目边界划分
   │       └─ 输出题目列表
   │
   ├─→ 6d. 结构化输出（见 3.6）
   │       ├─ 题干提取
   │       ├─ 选项提取（选择题）
   │       ├─ 公式/图表嵌入
   │       └─ 输出 JSON
   │
   │ 7. 结果写入缓存（Redis）+ 回调通知
   │
   ↓
[客户端轮询 / WebSocket 推送]
   │ 8. 获取识别结果
```

### 3.2 客户端本地预处理

客户端在上传前执行轻量预处理，减少上传量和服务器压力。

```python
# 伪代码 - 客户端预处理逻辑（实际为 Kotlin/Swift 原生实现）

def client_preprocess(raw_image):
    """客户端本地预处理"""
    # 1. 尺寸压缩：长边不超过 2048px
    image = resize_with_aspect(raw_image, max_long_side=2048)
    
    # 2. 质量压缩：JPEG quality 80
    compressed = compress_jpeg(image, quality=80)
    
    # 3. EXIF 方向矫正
    corrected = fix_exif_orientation(compressed)
    
    # 4. 文件大小检查：不超过 5MB
    if size(corrected) > 5 * 1024 * 1024:
        compressed = compress_jpeg(image, quality=60)
    
    return compressed
```

**客户端预处理参数表：**

| 参数 | 值 | 说明 |
|------|-----|------|
| 最大长边 | 2048 px | 保持宽高比 |
| JPEG 质量 | 80 | 平衡质量与体积 |
| 最大文件大小 | 5 MB | 超过则降质到 60 |
| EXIF 矫正 | 自动 | 避免旋转问题 |
| 最小短边 | 512 px | 过小图片拒绝 |

### 3.3 服务端图片预处理管线

#### 3.3.1 处理步骤

```python
class ImagePreprocessor:
    """服务端图片预处理管线"""
    
    def process(self, image_bytes: bytes) -> PreprocessResult:
        image = cv2.imdecode(
            np.frombuffer(image_bytes, np.uint8), 
            cv2.IMREAD_COLOR
        )
        
        # Step 1: 畸变矫正（透视变换）
        image = self._deskew(image)
        
        # Step 2: 去阴影
        image = self._remove_shadow(image)
        
        # Step 3: 自适应对比度增强
        image = self._enhance_contrast(image)
        
        # Step 4: 自适应二值化（用于 OCR）
        binary = self._binarize(image)
        
        return PreprocessResult(
            enhanced_image=image,     # 增强后彩色图（用于图表提取）
            binary_image=binary,      # 二值图（用于文字 OCR）
            width=image.shape[1],
            height=image.shape[0],
        )
```

#### 3.3.2 畸变矫正算法

```python
def _deskew(self, image: np.ndarray) -> np.ndarray:
    """
    检测文档边缘并进行透视矫正。
    适用于拍摄角度倾斜的场景。
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    
    # 寻找最大轮廓（假设为文档边缘）
    contours, _ = cv2.findContours(
        edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return image  # 检测不到轮廓则跳过矫正
    
    largest = max(contours, key=cv2.contourArea)
    
    # 多边形逼近
    epsilon = 0.02 * cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, epsilon, True)
    
    # 需要 4 个角点才能做透视变换
    if len(approx) != 4:
        return image
    
    # 排序角点：左上、右上、右下、左下
    pts = self._order_points(approx.reshape(4, 2))
    
    # 计算目标尺寸
    width = max(
        np.linalg.norm(pts[0] - pts[1]),
        np.linalg.norm(pts[2] - pts[3])
    )
    height = max(
        np.linalg.norm(pts[0] - pts[3]),
        np.linalg.norm(pts[1] - pts[2])
    )
    
    dst = np.array([
        [0, 0], [width, 0], 
        [width, height], [0, height]
    ], dtype=np.float32)
    
    M = cv2.getPerspectiveTransform(pts.astype(np.float32), dst)
    return cv2.warpPerspective(
        image, M, (int(width), int(height))
    )
```

#### 3.3.3 去阴影算法

```python
def _remove_shadow(self, image: np.ndarray) -> np.ndarray:
    """
    使用形态学运算去除文档阴影。
    适用于光线不均匀的拍摄场景。
    """
    # 转为灰度图
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # 形态学闭运算估计背景
    kernel_size = max(image.shape[:2]) // 15
    kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT, (kernel_size, kernel_size)
    )
    background = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
    
    # 背景归一化
    diff = cv2.absdiff(gray, background)
    _, normalized = cv2.threshold(
        diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )
    
    # 融合回彩色图
    mask = cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR)
    return cv2.bitwise_and(image, mask)
```

#### 3.3.4 对比度增强

```python
def _enhance_contrast(self, image: np.ndarray) -> np.ndarray:
    """
    CLAHE 自适应直方图均衡化。
    适用于低对比度图片。
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    
    clahe = cv2.createCLAHE(
        clipLimit=2.0, 
        tileGridSize=(8, 8)
    )
    l = clahe.apply(l)
    
    enhanced = cv2.merge([l, a, b])
    return cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
```

#### 3.3.5 预处理质量评估

```python
@dataclass
class PreprocessQuality:
    """预处理质量评估结果"""
    blur_score: float        # 清晰度评分 (0-100)
    contrast_score: float    # 对比度评分 (0-100)
    skew_angle: float        # 矫正角度（度）
    shadow_removed: bool     # 是否执行了去阴影
    is_readable: bool        # 综合判断：是否可读
    
    # 阈值
    MIN_BLUR_SCORE = 30.0
    MIN_CONTRAST_SCORE = 20.0

def _assess_quality(self, image: np.ndarray) -> PreprocessQuality:
    """评估预处理后图片质量"""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # 清晰度：Laplacian 方差
    blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    
    # 对比度：标准差
    contrast_score = gray.std()
    
    return PreprocessQuality(
        blur_score=min(blur_score, 100),
        contrast_score=min(contrast_score / 1.28, 100),  # 归一化
        skew_angle=0.0,  # 由 deskew 填充
        shadow_removed=False,  # 由 remove_shadow 填充
        is_readable=(blur_score >= 30 and contrast_score >= 20),
    )
```

### 3.4 OCR 识别管线

#### 3.4.1 区域检测策略

图片预处理后，首先进行区域分类，将不同区域分发到专用识别引擎。

```python
class RegionDetector:
    """
    区域检测器：将图片划分为文本区、公式区、图表区。
    采用启发式规则 + 轻量模型混合方案。
    """
    
    # 区域类型枚举
    TEXT = "text"          # 普通文本
    FORMULA = "formula"    # 数学公式
    FIGURE = "figure"      # 图表/图片
    TABLE = "table"        # 表格
    
    def detect(self, binary_image: np.ndarray) -> List[Region]:
        """检测图片中的区域"""
        # 1. 连通组件分析
        components = self._connected_components(binary_image)
        
        # 2. 水平投影分行
        lines = self._split_lines(components)
        
        # 3. 逐行区域分类
        regions = []
        for line in lines:
            line_type = self._classify_line(line)
            
            if line_type == self.FORMULA:
                regions.append(Region(
                    type=self.FORMULA,
                    bbox=line.bbox,
                    confidence=line.confidence,
                ))
            elif line_type == self.FIGURE:
                regions.append(Region(
                    type=self.FIGURE,
                    bbox=self._merge_adjacent(line),
                    confidence=line.confidence,
                ))
            else:
                regions.append(Region(
                    type=self.TEXT,
                    bbox=line.bbox,
                    confidence=1.0,
                ))
        
        # 4. 合并相邻同类型区域
        return self._merge_regions(regions)
```

**公式行检测启发式规则：**

```python
def _is_formula_line(self, line: Line) -> bool:
    """判断是否为公式行"""
    # 特征 1: 包含数学符号
    math_symbols = {'+', '-', '=', '×', '÷', '∑', '∫', '√', 'π', 'α', 'β'}
    if any(s in line.text for s in math_symbols):
        return True
    
    # 特征 2: 上下结构（分数、上下标）
    if line.has_vertical_structure():
        return True
    
    # 特征 3: 特殊字体模式（斜体密集、无空格字母序列）
    if line.has_math_pattern():
        return True
    
    return False
```

#### 3.4.2 OCR 引擎适配层

支持多供应商切换和降级。

```python
from abc import ABC, abstractmethod
from enum import Enum

class OCREngineType(Enum):
    BAIDU = "baidu"
    TENCENT = "tencent"
    MATHPIX = "mathpix"         # 专注公式识别
    LOCAL_PADDLE = "paddle"     # 本地 PaddleOCR 备用

class OCRResult:
    """统一 OCR 结果格式"""
    text: str                       # 识别文本
    confidence: float               # 置信度 0-1
    engine: OCREngineType           # 使用的引擎
    regions: List[OCRRegion]        # 区域级结果
    latency_ms: int                 # 耗时
    raw_response: dict              # 原始响应（调试用）

class OCREngine(ABC):
    """OCR 引擎抽象基类"""
    
    @abstractmethod
    async def recognize_text(
        self, image: bytes, regions: List[Region]
    ) -> OCRResult:
        """通用文字识别"""
        ...
    
    @abstractmethod
    async def recognize_formula(
        self, image: bytes, region: Region
    ) -> FormulaResult:
        """数学公式识别，输出 LaTeX"""
        ...
    
    @abstractmethod
    async def recognize_table(
        self, image: bytes, region: Region
    ) -> TableResult:
        """表格识别"""
        ...

class BaiduOCREngine(OCREngine):
    """百度 OCR 引擎"""
    
    def __init__(self, config: BaiduOCRConfig):
        self.api_key = config.api_key
        self.secret_key = config.secret_key
        self.base_url = "https://aip.baidubce.com/rest/2.0/ocr/v1"
    
    async def recognize_text(self, image: bytes, regions: List[Region]) -> OCRResult:
        url = f"{self.base_url}/accurate_basic"
        
        # 只裁剪文本区域进行识别
        results = []
        for region in regions:
            if region.type == "text":
                cropped = self._crop_region(image, region.bbox)
                resp = await self._call_api(url, cropped)
                results.extend(resp.get("words_result", []))
        
        text = "\n".join(r["words"] for r in results)
        avg_conf = sum(r.get("probability", {}).get("average", 0.9) 
                       for r in results) / max(len(results), 1)
        
        return OCRResult(
            text=text,
            confidence=avg_conf,
            engine=OCREngineType.BAIDU,
            regions=results,
            latency_ms=0,
            raw_response=resp,
        )
    
    async def recognize_formula(self, image: bytes, region: Region) -> FormulaResult:
        """百度公式识别"""
        url = f"{self.base_url}/formula"
        cropped = self._crop_region(image, region.bbox)
        resp = await self._call_api(url, cropped)
        
        return FormulaResult(
            latex=resp.get("words_result", [{}])[0].get("words", ""),
            confidence=resp.get("words_result", [{}])[0].get("probability", {}).get("average", 0.0),
        )

class MathpixEngine(OCREngine):
    """
    Mathpix 专用公式识别引擎。
    在复杂公式识别上准确率更高。
    """
    
    def __init__(self, config: MathpixConfig):
        self.app_id = config.app_id
        self.app_key = config.app_key
        self.base_url = "https://api.mathpix.com/v3"
    
    async def recognize_formula(self, image: bytes, region: Region) -> FormulaResult:
        url = f"{self.base_url}/text"
        cropped = self._crop_region(image, region.bbox)
        
        headers = {
            "app_id": self.app_id,
            "app_key": self.app_key,
        }
        body = {
            "src": base64.b64encode(cropped).decode(),
            "formats": ["text", "data", "html"],
            "data_options": {
                "include_latex": True,
                "include_mathml": True,
            },
        }
        
        resp = await self._http_post(url, headers, body)
        latex = resp.get("data", [{}])[0].get("value", "")
        
        return FormulaResult(
            latex=latex,
            confidence=resp.get("confidence", 0.0),
        )
```

#### 3.4.3 OCR 调度策略

```python
class OCRDispatcher:
    """
    OCR 引擎调度器。
    根据区域类型和引擎状态选择最优引擎。
    支持降级和重试。
    """
    
    def __init__(self, engines: Dict[OCREngineType, OCREngine]):
        self.engines = engines
        self.health_checker = EngineHealthChecker()
    
    async def dispatch(
        self, image: bytes, regions: List[Region]
    ) -> OCRRawResult:
        """调度 OCR 识别"""
        text_regions = [r for r in regions if r.type == "text"]
        formula_regions = [r for r in regions if r.type == "formula"]
        figure_regions = [r for r in regions if r.type == "figure"]
        table_regions = [r for r in regions if r.type == "table"]
        
        # 并行处理不同类型区域
        tasks = []
        
        if text_regions:
            tasks.append(self._recognize_text(image, text_regions))
        if formula_regions:
            tasks.append(self._recognize_formulas(image, formula_regions))
        if figure_regions:
            tasks.append(self._extract_figures(image, figure_regions))
        if table_regions:
            tasks.append(self._recognize_tables(image, table_regions))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        return self._merge_results(results, regions)
    
    async def _recognize_text(
        self, image: bytes, regions: List[Region]
    ) -> TextResult:
        """文字识别，带降级"""
        # 优先级: 百度 > 腾讯 > 本地 PaddleOCR
        priority = [OCREngineType.BAIDU, OCREngineType.TENCENT, OCREngineType.LOCAL_PADDLE]
        
        for engine_type in priority:
            engine = self.engines.get(engine_type)
            if not engine or not self.health_checker.is_healthy(engine_type):
                continue
            
            try:
                result = await engine.recognize_text(image, regions)
                return result
            except OCRError as e:
                logger.warning(f"OCR engine {engine_type} failed: {e}")
                self.health_checker.record_failure(engine_type)
                continue
        
        raise OCRAllEnginesFailedError("所有 OCR 引擎均不可用")
    
    async def _recognize_formulas(
        self, image: bytes, regions: List[Region]
    ) -> List[FormulaResult]:
        """公式识别，带降级"""
        # 优先级: Mathpix > 百度公式 > 通用 OCR + 后处理
        results = []
        
        for region in regions:
            cropped = self._crop_region(image, region.bbox)
            recognized = False
            
            for engine_type in [OCREngineType.MATHPIX, OCREngineType.BAIDU]:
                engine = self.engines.get(engine_type)
                if not engine or not self.health_checker.is_healthy(engine_type):
                    continue
                try:
                    result = await engine.recognize_formula(cropped, region)
                    if result.confidence >= 0.6:
                        results.append(result)
                        recognized = True
                        break
                except OCRError:
                    self.health_checker.record_failure(engine_type)
                    continue
            
            if not recognized:
                # 降级：标记为低置信度文本
                results.append(FormulaResult(
                    latex="",
                    raw_text="[公式识别失败]",
                    confidence=0.0,
                ))
        
        return results
```

#### 3.4.4 引擎健康检查

```python
class EngineHealthChecker:
    """
    OCR 引擎健康状态跟踪。
    基于滑动窗口统计成功率，自动降级/恢复。
    """
    
    WINDOW_SIZE = 60           # 60 秒窗口
    FAILURE_THRESHOLD = 0.3   # 失败率超过 30% 标记为不健康
    RECOVERY_THRESHOLD = 0.1  # 失败率降到 10% 以下恢复
    
    def __init__(self, redis: Redis):
        self.redis = redis
    
    def record_success(self, engine: OCREngineType):
        key = f"ocr:health:{engine.value}"
        self.redis.lpush(key, f"{time.time()}:1")
        self.redis.ltrim(key, 0, self.WINDOW_SIZE - 1)
        self.redis.expire(key, self.WINDOW_SIZE * 2)
    
    def record_failure(self, engine: OCREngineType):
        key = f"ocr:health:{engine.value}"
        self.redis.lpush(key, f"{time.time()}:0")
        self.redis.ltrim(key, 0, self.WINDOW_SIZE - 1)
        self.redis.expire(key, self.WINDOW_SIZE * 2)
    
    def is_healthy(self, engine: OCREngineType) -> bool:
        key = f"ocr:health:{engine.value}"
        records = self.redis.lrange(key, 0, -1)
        if not records:
            return True  # 无记录默认健康
        
        failures = sum(1 for r in records if r.endswith(b":0"))
        failure_rate = failures / len(records)
        
        if failure_rate >= self.FAILURE_THRESHOLD:
            return False
        return True
```

### 3.5 多题分割

#### 3.5.1 分割策略

```python
class QuestionSplitter:
    """
    多题分割器。
    从识别结果中检测题号，将行级 OCR 结果聚合为题目级结构。
    输入: OcrResult（行级文本 + bbox + 区域类型）
    输出: SplitResult（题目列表 + 分割策略 + 截断标记）
    """

    # 题号正则模式（按优先级排序，命中即停）
    QUESTION_NO_PATTERNS = [
        r'^\s*[一二三四五六七八九十]{1,3}\s*[、.．]\s*\S',   # 一、 二. 三十、
        r'^\s*\d{1,3}\s*[、.．]\s*\S',                        # 1、 2. 15、
        r'^\s*[（(]\s*\d{1,3}\s*[)）]\s*\S',                  # (1) （2）
        r'^\s*第\s*\d{1,3}\s*题',                              # 第5题
        r'^\s*[A-Za-z]\d{1,2}\s*[、.．]\s*\S',                # A1. 分组题号
    ]
    # 选项行模式（用于校验题目边界完整性）
    OPTION_PATTERN = r'^\s*[A-Da-d]\s*[、.．)）]\s*\S'
    # 行距阈值：行间距 > 1.8 倍中位行高视为段落间隙
    PARAGRAPH_GAP_RATIO = 1.8
    # 单次识别题目数上限（对齐异常码 030207）
    MAX_QUESTIONS = 10

    def auto_split(self, ocr_result: OcrResult) -> SplitResult:
        """自动分割：题号检测 → 行归属 → 边界划分 → 质量校验"""
        lines = self._to_lines(ocr_result)

        # 1. 题号检测（正则 + 视觉双通道）
        markers = self._detect_question_markers(lines)

        # 2. 无题号降级：按段落间隙聚类
        if not markers:
            markers = self._split_by_paragraph_gap(lines)
            if len(markers) <= 1:
                # 整图视为单题（单题拍摄是最常见场景）
                return SplitResult(
                    questions=[self._to_question(lines)],
                    strategy=SplitStrategy.SINGLE,
                    truncated=False,
                )

        # 3. 行归属：marker 之间的行归属前一题
        segments = self._assign_lines(lines, markers)

        # 4. 超限截断：仅保留前 10 题，置 truncated 标记
        truncated = len(segments) > self.MAX_QUESTIONS
        segments = segments[: self.MAX_QUESTIONS]

        # 5. 质量校验与修复（跨题截断检测）
        segments = self._validate_and_fix(segments)

        return SplitResult(
            questions=[self._to_question(s) for s in segments],
            strategy=SplitStrategy.AUTO,
            truncated=truncated,
        )

    def split_by_regions(
        self, ocr_result: OcrResult, regions: List[UserRegion]
    ) -> SplitResult:
        """
        手动框选分割。
        用户已在客户端框选题目区域（见客户端-拍照图像采集与预处理引擎），
        直接按 bbox 裁切行归属，题号检测仅用于题干清洗。
        """
        questions = []
        for region in regions:
            inner = self._lines_in_bbox(ocr_result, region.bbox)
            questions.append(self._to_question(inner))
        return SplitResult(
            questions=questions,
            strategy=SplitStrategy.MANUAL,
            truncated=False,
        )

    def _detect_question_markers(self, lines: List[Line]) -> List[Marker]:
        """题号检测：正则候选 + 视觉验证（左对齐 + 行高一致）"""
        markers = []
        for line in lines:
            for pattern in self.QUESTION_NO_PATTERNS:
                m = re.match(pattern, line.text)
                if m:
                    # 视觉验证：题号行左边界应与已命中题号行对齐
                    # （容差 = 3% 图片宽度），防止把行内小数/序号误判为题号
                    if self._is_left_aligned(markers, line):
                        markers.append(Marker(
                            line_index=line.index,
                            question_no=self._normalize_no(m.group(0)),
                            bbox=line.bbox,
                        ))
                    break
        return markers

    def _split_by_paragraph_gap(self, lines: List[Line]) -> List[Marker]:
        """无题号降级：按行间距聚类，间隙 > 1.8 倍中位行高处切分"""
        heights = [l.bbox.height for l in lines]
        median_h = statistics.median(heights)
        markers = []
        for i in range(1, len(lines)):
            gap = lines[i].bbox.top - lines[i - 1].bbox.bottom
            if gap > self.PARAGRAPH_GAP_RATIO * median_h:
                markers.append(Marker(line_index=i, question_no=None,
                                      bbox=lines[i].bbox))
        return markers

    def _validate_and_fix(self, segments: List[Segment]) -> List[Segment]:
        """跨题截断检测与修复：
        1. 选项残缺：题干含 'A.' 但缺 'D.'，且下一题段首是选项行
           → 将下一题段首选项行回并到上一题
        2. 句子未完结：题干末行以 '，/、/＝' 结尾
           → 标记 boundary_warning，交由客户端高亮提示用户确认
        3. 公式跨题：formula 区域 bbox 横跨两个题段
           → bbox 归属与题干重叠面积更大的一题
        """
        for i, seg in enumerate(segments):
            has_a = re.search(r'\bA[.．、]', seg.text)
            has_d = re.search(r'\bD[.．、]', seg.text)
            if has_a and not has_d and i + 1 < len(segments):
                next_first = segments[i + 1].first_line()
                if re.match(self.OPTION_PATTERN, next_first.text):
                    seg.append(segments[i + 1].pop_first_line())
            if re.search(r'[，、＝+\-]$', seg.text.strip()):
                seg.boundary_warning = True
        return segments
```

#### 3.5.2 题号模式库

题号检测是分割准确率的关键，模式库需覆盖主流教辅排版：

| 模式 | 正则 | 示例 | 备注 |
|------|------|------|------|
| 中文数字 | `^[一二三四五六七八九十]{1,3}[、.．]` | 一、 三十、 | 语文/文综常用 |
| 阿拉伯数字 | `^\d{1,3}[、.．]` | 1、 15. | 最常见 |
| 括号序号 | `^[（(]\d{1,3}[)）]` | (1) （2） | 理科大题小问 |
| 第 N 题 | `^第\d{1,3}题` | 第5题 | 试卷标题行 |
| 分组题号 | `^[A-Za-z]\d{1,2}[、.．]` | A1. B2. | 分层练习册 |

**误判防护规则：**

1. 行内出现（非行首）的 `1.` 不判定为题号（如 "3.14"、"2024.5"）；
2. 题号后必须紧跟非空白内容（空题号行忽略）；
3. 连续两个候选题号行距 < 0.5 倍行高（同一行折行误拆）时合并；
4. 视觉验证不通过的候选（左边界明显缩进/突出）降级为普通行，日志记录 `split_false_positive` 埋点供模式库迭代。

#### 3.5.3 分割策略选择

| 条件 | 策略 | 说明 |
|------|------|------|
| 客户端已框选区域 | `MANUAL` | 用户框选优先，准确率最高 |
| 检测到 ≥ 1 个可信题号 | `AUTO` | 题号驱动分割 |
| 无题号、有段落间隙 | `AUTO_GAP` | 行距聚类，题目数 = 间隙数 + 1 |
| 无题号、无间隙 | `SINGLE` | 整图单题 |
| 题数 > 10 | `AUTO_TRUNCATED` | 取前 10 题 + 返回 `truncated: true`，客户端提示分批拍摄（异常码 030207） |

---

### 3.6 结构化输出

#### 3.6.1 结构化流程

分割得到题目段（行集合）后，执行四步结构化：

```
题目段（行集合）
    │
    ├─ ① 题干清洗：剥离题号前缀/页眉页脚噪声/水印文字，
    │     全角数字与符号归一化（见 3.6.3）
    │
    ├─ ② 选项切分：按 OPTION_PATTERN 将 A/B/C/D 选项行从题干剥离，
    │     形成 options[]；无选项则 questionType 粗分为主观题
    │
    ├─ ③ 嵌入公式与图表：将公式区 LaTeX、图表裁剪图（OSS URL）
    │     按 bbox 纵序回插到题干文本的对应位置，
    │     以占位标记 `{{formula:0}}`、`{{figure:0}}` 内联
    │
    └─ ④ 置信度汇总：question.ocrConfidence = avg(行置信度)，
          含公式时 = 0.6×文本均值 + 0.4×公式置信度
```

#### 3.6.2 输出数据结构（RecognizedQuestion）

与《服务端-拍照搜题请求编排与题目智能匹配路由服务》的 `RecognizedQuestion` 字段对齐：

```json
{
  "questionIndex": 0,
  "questionNo": "5",
  "stemText": "计算 {{formula:0}} 的结果，并求当 x=2 时的值。",
  "normalizedStem": "计算 [LATEX:x^2-4x+3] 的结果 并求当x=2时的值",
  "options": [
    { "key": "A", "text": "-1", "confidence": 0.98 },
    { "key": "B", "text": "0", "confidence": 0.97 },
    { "key": "C", "text": "1", "confidence": 0.99 },
    { "key": "D", "text": "3", "confidence": 0.96 }
  ],
  "questionType": "SINGLE_CHOICE",
  "typeConfidence": 0.95,
  "ocrConfidence": 0.93,
  "formulas": [
    { "index": 0, "latex": "x^2 - 4x + 3 = 0", "confidence": 0.91,
      "engine": "mathpix" }
  ],
  "figures": [
    { "index": 0, "objectKey": "ocr/figures/{taskId}/q0_f0.png",
      "figureType": "FUNCTION_GRAPH", "bbox": [120, 340, 480, 620] }
  ],
  "handwriting": {
    "detected": true,
    "ratio": 0.18,
    "regions": [
      { "bbox": [60, 700, 540, 760], "text": "解：由题意得…",
        "confidence": 0.82, "role": "STUDENT_ANSWER" }
    ]
  },
  "bboxInImage": [40, 300, 560, 780],
  "boundaryWarning": false,
  "warnings": []
}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `stemText` | 内联占位符的题干原文（客户端渲染用） |
| `normalizedStem` | 归一化纯文本 + LaTeX 内联（供编排服务做 SimHash 缓存与题库匹配，保证同题不同拍 hashing 稳定） |
| `questionType` | 粗分类（8 类枚举），深度题型分析由《题目题型识别与结构化解析引擎》负责 |
| `handwriting` | 手写区域检测：`STUDENT_ANSWER`（学生作答，供错题归档）/ `QUESTION_MARK`（手写批注）。手写占比 > 0.5 或置信度 < 0.75 时写入 warnings，编排服务透传 030206 |
| `boundaryWarning` | 分割边界可疑（句子未完结等），客户端高亮提示用户确认 |

**questionType 粗分类枚举：**

```python
class QuestionType(Enum):
    SINGLE_CHOICE = "SINGLE_CHOICE"      # 单选（4 选项 + 无空格答案结构）
    MULTI_CHOICE = "MULTI_CHOICE"        # 多选（题干含"多选"或选项 ≥ 5）
    FILL_BLANK = "FILL_BLANK"            # 填空（含 ___ 或（ ）结构）
    TRUE_FALSE = "TRUE_FALSE"            # 判断（含"对/错"或"√/×"选项）
    SHORT_ANSWER = "SHORT_ANSWER"        # 简答（无选项，题干以"为什么/简述"等结尾）
    COMPUTE = "COMPUTE"                 # 计算（含公式区且题干含"计算/求"）
    PROOF = "PROOF"                     # 证明（题干含"证明"）
    COMPOSITE = "COMPOSITE"             # 材料题（含图表区或阅读材料段）
```

#### 3.6.3 文本归一化规则

| 规则 | 输入 → 输出 | 目的 |
|------|------------|------|
| 全角字母数字转半角 | `１２３` → `123` | 匹配稳定 |
| 数学符号统一 | `ｘ` → `x`，`×` 保留 | LaTeX 转换前置 |
| 去页眉页脚 | 匹配模式库（"第 N 页"、书名号+页码、ISBN 行）整行剔除 | 降噪 |
| 去水印 | 重复出现 ≥ 2 次且跨题的短行（≤ 12 字）剔除 | 降噪 |
| 空白折叠 | 连续空格/制表符 → 单空格 | hashing 稳定 |
| 括号配对修复 | `（` 与 `)` 混用 → 统一中文括号或英文括号 | 结构解析容错 |

---

## 4. 数据模型

### 4.1 任务表 ocr_task（MySQL · image_process 库）

```sql
CREATE TABLE ocr_task (
    task_id         BIGINT UNSIGNED PRIMARY KEY COMMENT '雪花ID',
    biz_source      VARCHAR(32)  NOT NULL COMMENT 'PHOTO_SEARCH拍照搜题|EXAM_SCAN试卷扫描|MISTAKE_UPLOAD错题上传|COMPOSITION作文',
    user_id         BIGINT UNSIGNED NULL COMMENT '触发用户（服务间调用为NULL）',
    image_object_key  VARCHAR(255) NOT NULL COMMENT '原图OSS key（客户端直传或网关中转后）',
    image_content_hash CHAR(64)   NOT NULL COMMENT '内容SHA-256，幂等去重',
    preprocessed_key  VARCHAR(255) NULL COMMENT '预处理图OSS key',
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING' COMMENT '见状态机',
    error_code      INT          NULL COMMENT '内部错误码 545xx',
    preprocess_quality JSON      NULL COMMENT 'PreprocessQuality 快照',
    engine_text     VARCHAR(20)  NULL COMMENT '实际使用的文本引擎',
    engine_formula  VARCHAR(20)  NULL COMMENT '实际使用的公式引擎',
    question_count  TINYINT      NULL COMMENT '分割题目数',
    result          JSON         NULL COMMENT '结构化结果（COMPLETED后写入，保留7天）',
    duration_ms     INT          NULL COMMENT '端到端耗时',
    timeout_ms      INT          NOT NULL DEFAULT 4000 COMMENT '本次任务超时预算',
    callback_topic  VARCHAR(64)  NULL COMMENT '完成回调的 Redis Stream topic',
    idempotency_key VARCHAR(64)  NULL COMMENT '调用方幂等键',
    created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE INDEX uk_idem (idempotency_key),
    INDEX idx_user_time (user_id, created_at),
    INDEX idx_hash_time (image_content_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OCR识别任务';
```

**保留策略：** `result` 字段写入 7 天后置 NULL（原图可追溯到 OSS 生命周期规则，见 §8.1）；任务行保留 180 天供审计与准确率抽检，之后由《存储资源统一生命周期管理引擎》归档清理。

### 4.2 引擎调用日志 ocr_engine_call_log（ClickHouse）

```sql
CREATE TABLE ocr_engine_call_log (
    call_id      UInt64,
    task_id      UInt64,
    engine       LowCardinality(String),   -- baidu/tencent/mathpix/paddle
    call_type    LowCardinality(String),   -- text/formula/table/figure
    status       LowCardinality(String),   -- OK/FAILED/TIMEOUT/DEGRADED
    latency_ms   UInt32,
    retry_no     UInt8,
    cost_micro   UInt64 COMMENT '单次调用成本（微元，日结对账用）',
    request_bytes UInt32,
    error_code   UInt32 DEFAULT 0,
    event_date   Date,
    created_at   DateTime
) ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
TTL event_date + INTERVAL 180 DAY
ORDER BY (event_date, engine, call_type);
```

### 4.3 Redis Key 总表

| Key | 类型 | 用途 | TTL |
|-----|------|------|-----|
| `ocr:health:{engine}` | List | 引擎健康清动窗口（§3.4.4） | 120s |
| `ocr:result:{task_id}` | String(JSON) | 任务结果缓存（轮询加速） | 10min |
| `ocr:dedup:{user_id}:{content_hash}` | String | 同用户同图 60s 内去重，直接返回上次 task_id | 60s |
| `ocr:ratelimit:{user_id}` | 滑动窗口 | 用户级任务创建频控（20 次/分钟） | 60s |
| `ocr:circuit:{engine}` | String | 引擎熔断标记（连续 5 次失败触发） | 60s |
| `ocr:callback:{task_id}` | Stream | 完成事件发布（XADD） | 消费后 ACK

---

## 5. API 接口设计

### 5.1 双入口架构

服务对外提供两类入口，均收敛到同一套处理管线：

```
入口 A（同步·gRPC，主路径）
  调用方：拍照搜题编排服务（12s 总预算，OCR 段 4s）
  特点：传入已上传的 objectKey，阻塞等待，失败地返回错误码

入口 B（异步任务·REST，辅路径）
  调用方：客户端直连（试卷翻拍等大图多题场景）、
          试卷扫描引擎（批处理）
  特点：立即返回 task_id，客户端轮询或等待回调
```

> 说明：§3.1 主流程中的 `POST /api/v1/ocr/recognize` 在实现层落地为入口 B 的 `POST /api/v1/ocr/tasks`；拍照搜题主链路实际走入口 A（客户端经文件上传服务直传 OSS 后，编排服务携带 objectKey 调用），避免图片字节在服务间二次流转。

### 5.2 异步任务 API（REST）

**创建任务**

```
POST /api/v1/ocr/tasks
Content-Type: multipart/form-data 或 application/json

# 表单字段（multipart 直传图片）
file            File        必填（与 objectKey 二选一）
objectKey       String      必填（与 file 二选一，客户端已直传 OSS）
bizSource       String      必填 PHOTO_SEARCH|EXAM_SCAN|MISTAKE_UPLOAD|COMPOSITION
selectedRegions String      选填，JSON 数组 [[x1,y1,x2,y2],...]（归一化坐标）
Idempotency-Key Header      选填，服务端 24h 幂等

# 响应 202
{
  "code": 0,
  "data": {
    "taskId": "7421993366",
    "status": "PENDING",
    "pollUrl": "/api/v1/ocr/tasks/7421993366",
    "pollIntervalMs": 500
  }
}
```

**查询结果**

```
GET /api/v1/ocr/tasks/{taskId}

# 响应 200（进行中）
{ "code": 0, "data": { "taskId": "...", "status": "RECOGNIZING", "progress": 60 } }

# 响应 200（完成，精简示例）
{
  "code": 0,
  "data": {
    "taskId": "7421993366",
    "status": "COMPLETED",
    "questionCount": 3,
    "truncated": false,
    "questions": [ ...RecognizedQuestion 列表，见 3.6.2... ],
    "preprocessQuality": { "isReadable": true, "blurScore": 58.3 }
  }
}

# 响应 200（失败，业务码见 §7.2）
{ "code": 30203, "message": "图片模糊，请重新拍摄" }
```

**取消任务**

```
DELETE /api/v1/ocr/tasks/{taskId}
# 仅 PENDING/PREPROCESSING 可取消；识别中取消返回 409
```

**回调通知（服务间）**：任务终态后 `XADD ocr:callback:{task_id}`，编排服务/试卷扫描引擎消费。事件体：`{taskId, status, errorCode, questionCount, finishedAt}`，消费方按 `(task_id, consumer)` 幂等。

### 5.3 内部同步接口（gRPC）

```protobuf
service ImageProcessService {
  // 图片预处理（编排服务可单独调用，如作文拍照仅需预处理）
  rpc Preprocess(PreprocessRequest) returns (PreprocessResponse);
  // OCR 识别（含区域检测+引擎调度，不含分割）
  rpc Recognize(RecognizeRequest) returns (OcrResult);
  // 多题分割（可独立重试，编排服务持有时调用）
  rpc Split(SplitRequest) returns (SplitResponse);
}

message RecognizeRequest {
  string object_key = 1;           // 预处理图或原图 key
  bool enable_formula = 2;
  bool enable_figure_detection = 3;
  int32 timeout_ms = 4;            // 调用方预算，默认 4000，上限 15000（批处理场景）
  string idempotency_key = 5;
}

message OcrResult {
  string text = 1;
  double confidence = 2;
  repeated LineResult lines = 3;      // 行级：text/bbox/confidence/type
  repeated RegionResult regions = 4;  // 区域级：text/formula/figure/table
  repeated FigureAsset figures = 5;   // 图表裁剪 OSS key + figureType
  HandwritingInfo handwriting = 6;
  repeated string warnings = 7;
}
```

### 5.4 鉴权与限流

| 调用方 | 鉴权 | 限额 |
|-------|------|------|
| 客户端（REST） | 用户 JWT，经 API 网关 | 网关按用户维度限流；拍题次数额度由《用户额度与API调用管控系统》在编排层校验，本服务不重复扣额 |
| 服务间（gRPC/REST） | mTLS + 内部服务 Token | 不限用户额度，成本计入内部成本中心 |
| 本服务自保 | `ocr:ratelimit:{user_id}` | 20 任务/分钟，超出返回 429 |

---

## 6. 任务状态机

### 6.1 状态定义与流转

```
                    ┌──────────────┐
        ┌────────── │   PENDING    │ 提交成功，等待管线调度
        │           └──────┬───────┘
        │                  │ 管线取件
        │           ┌──────▼───────┐
        │   质量     │ PREPROCESSING│ 预处理中
        │   不过     └──────┬───────┘
        │           ┌──────▼───────┐
     ┌──▼─────┐     │ RECOGNIZING  │ OCR 识别中
     │FAILED_ │     └──────┬───────┘
     │QUALITY │     ┌──────▼───────┐
     └────────┘     │  SPLITTING   │ 多题分割中
        ┌────────── └──────┬───────┐
        │                  │       │ 无题目内容
        │           ┌──────▼─────┐ │
        │           │STRUCTURING │─┼──→ FAILED_NO_CONTENT (030204)
        │           └──────┬─────┘
        │                  │
        │           ┌──────▼───────┐
        │           │  COMPLETED   │
        │           └──────────────┘
        │
        ├──→ FAILED_ENGINE   （全部引擎不可用，→ 030205）
        ├──→ FAILED_TIMEOUT  （总预算耗尽，→ 030205 提示重试）
        └──→ CANCELED        （用户/调用方取消）
```

### 6.2 状态机守卫表

| 编号 | 当前状态 | 事件 | 下一状态 | 守卫条件 |
|------|---------|------|---------|----------|
| G1 | PENDING | 管线取件 | PREPROCESSING | 任务未过期（10 分钟内），否则直接 CANCELED |
| G2 | PREPROCESSING | 质量评估完成 | RECOGNIZING | `is_readable == true`；否则 FAILED_QUALITY（→ 030203） |
| G3 | PREPROCESSING | 预处理异常 | RECOGNIZING | OpenCV 崩溃不阻断：使用原图继续，记录 warning（预处理成功率目标 ≥ 99%） |
| G4 | RECOGNIZING | 引擎返回 | SPLITTING | 至少一个文本引擎成功；全失败 → FAILED_ENGINE |
| G5 | RECOGNIZING | 超时 | FAILED_TIMEOUT | 剩余预算 < 300ms 时不再重试引擎 |
| G6 | SPLITTING | 分割完成 | STRUCTURING | 题目数 ≥ 1；为 0 → FAILED_NO_CONTENT（→ 030204） |
| G7 | STRUCTURING | 结构化完成 | COMPLETED | result 落库 + Redis 缓存 + 回调事件（同一本地事务 + Outbox） |
| G8 | PENDING/PREPROCESSING | 取消请求 | CANCELED | RECOGNIZING 之后不可取消（引擎成本已发生） |
| G9 | 任意失败态 | 调用方重试 | 新任务 | 不复用原 task；同图去重窗口（60s）内返回原任务结果缓存 |

**与编排服务状态机的映射：** 本服务 FAILED_* 对应编排服务 `OCR_FAILED` 分支；FAILED_QUALITY/FAILED_NO_CONTENT 为可引导重拍错误（客户端展示重拍引导），FAILED_ENGINE/FAILED_TIMEOUT 为可重试错误（客户端提示稍后再试）。

---

## 7. 错误处理与降级策略

### 7.1 内部错误码（54500–54599，image-process-service 专用段）

| 错误码 | 含义 | 触发场景 | 处置 |
|-------|------|---------|------|
| 54501 | 图片下载失败 | objectKey 无效或 OSS 异常 | 重试 2 次，仍失败映射 030205 |
| 54502 | 图片解码失败 | 文件损坏/伪装后缀 | 不重试，映射 030201 |
| 54503 | 图片超尺寸 | 长边 > 8192px 或短边 < 512px | 不重试，映射 030201 |
| 54504 | 图片过大 | > 10MB | 不重试，映射 030202 |
| 54505 | 预处理异常 | OpenCV 崩溃 | 已由 G3 降级，仅记录 |
| 54506 | 质量不合格 | 模糊/低对比度 | 映射 030203 引导重拍 |
| 54507 | 文本引擎全失败 | 三级降级链耗尽 | 映射 030205 |
| 54508 | 公式引擎全失败 | Mathpix+百度均不可用 | 不失败：降级为占位标注，warnings 提示 |
| 54509 | 未检测到内容 | 无文本/无手写/纯图 | 映射 030204 |
| 54510 | 任务超时 | 总预算耗尽 | 映射 030205，已产生部分结果则返回 partial+warning |
| 54511 | 多题超上限 | > 10 题 | 不失败：截断 + truncated 标记，映射 030207 软提示 |
| 54512 | 手写低置信 | 手写占比>0.5 或 conf<0.75 | 不失败：warnings 提示，映射 030206 |
| 54513 | 引擎限流 | 供应商 429 | 熔断 60s + 切换下一引擎 |
| 54514 | 引擎鉴权失败 | Key 失效/欠费 | 熔断 + P0 告警（需人工） |
| 54515 | 任务不存在/已过期 | 轮询非法 task_id | 404 |
| 54516 | 状态冲突 | 非法取消/重复回调 | 409，幂等吞并 |
| 54517 | 结果已过期 | result 已置 NULL | 客户端需重新提交，引导重拍 |
| 54518 | 配置错误 | 引擎未配置/模式库加载失败 | 启动自检失败阻断发布 |

### 7.2 客户端错误码映射（对齐《服务端统一业务异常码与错误分类体系》0302xx）

| 内部码 | 客户端码 | 客户端体验 |
|-------|---------|-----------|
| 54502/54503 | 030201 | 内联提示更换图片 |
| 54504 | 030202 | 内联提示压缩重传 |
| 54506 | 030203 | 模糊提示 + 重拍引导（拉起相机） |
| 54509 | 030206→030204 | 未识别到题目 + 引导框选 |
| 54501/54507/54510 | 030205 | 服务暂不可用提示 + 稍后重试 |
| 54512 | 030206 | 顶部警示条"识别可能不准确，请确认"，结果正常展示 |
| 54511 | 030207 | 提示"单次最多识别10道题目，已取前10题" |

### 7.3 降级矩阵

| 编号 | 故障 | 降级链路 | 用户感知 |
|------|------|---------|----------|
| D1 | Mathpix 不可用/低置信 | 百度公式 → 本地 Paddle 公式 → 通用OCR+`$...$`包裹启发式还原 | 公式显示为图片或标注"公式识别失败" |
| D2 | 百度文本不可用 | 腾讯 → 本地 Paddle | 无感知（延迟略增） |
| D3 | 腾讯不可用 | 本地 Paddle（CPU/GPU 池） | 无感知 |
| D4 | 全部文本引擎不可用 | FAILED_ENGINE → 030205 | 稍后再试 |
| D5 | 供应商限流 | 熔断 60s + 优先级链切换 + 健康检查探活恢复 | 无感知 |
| D6 | 图片质量差 | 拒绝识别 → 030203 | 重拍引导（联动客户端质量评估前置拦截，多数在端侧已拦） |
| D7 | 多题 > 10 | 截断前 10 题 | 软提示分批拍摄 |
| D8 | 分割边界可疑 | boundaryWarning 逐题标记 | 客户端题目卡片角标，引导手动调边界 |
| D9 | 图表提取失败 | 保留原图裁剪区域，figureType=UNKNOWN | 图表原图展示，AI 解析时整图输入多模态模型 |
| D10 | Redis 不可用 | 健康检查退化为进程内存窗口；去重/限流退化为故宽允许（宁可多算不可拒服） | 无感知 |

### 7.4 超时预算分配（同步入口，总 4000ms）

| 阶段 | 预算 | 超时动作 |
|------|------|---------|
| 图片下载（OSS） | 500ms | 重试 1 次，仍失败 54501 |
| 预处理 | 600ms | G3 降级用原图 |
| 文本 OCR | 1500ms | 按引擎链降级，剩余预算 < 300ms 停止重试 |
| 公式 OCR（并行） | 1500ms | 与文本并行；单区域 3s 仍无结果则占位 |
| 分割 + 结构化 | 400ms | 纯 CPU，正常 < 100ms |
| 预留 | 500ms | 网络/序列化 |

> 异步入口（EXAM_SCAN 批处理）timeout_ms 上限 15000，多题串行时按题数自适应放宽，但单阶段预算不变。

### 7.5 重试与幂等

1. **引擎调用重试**：仅对网络类错误（连接超时/5xx）重试 1 次，退避 200ms；4xx（鉴权/参数）不重试；
2. **任务级幂等**：`Idempotency-Key`/`idempotency_key` 唯一索引，重复提交返回原任务；
3. **同图去重**：同用户同 `content_hash` 60s 窗口内返回缓存结果，不重复计费调用引擎；
4. **回调幂等**：消费方按 `(task_id, consumer)` 记录已消费，重复事件吞并；
5. **失败任务不自动重跑**：引擎成本已发生，避免双倍计费；由调用方决定是否换图重提。

---

## 8. 安全与合规

### 8.1 图片数据生命周期

| 数据 | 保留期 | 到期处置 | 依据 |
|------|-------|---------|------|
| 原图（OSS） | 30 天 | 生命周期规则自动删除 | 未成年人数据最小化；错题收录场景由错题服务转存裁剪后必需区域 |
| 预处理图/图表裁剪 | 7 天 | 自动删除 | 仅管线中间产物 |
| 结构化结果（result 字段） | 7 天 | 置 NULL | 下游已消费落库 |
| 任务行（无图片） | 180 天 | 归档后清理 | 审计与准确率抽检 |
| ClickHouse 引擎日志 | 180 天 | TTL 自动 | 成本对账 |

### 8.2 隐私保护措施

1. **EXIF 清洗**：入库前强制剥离 GPS/设备信息，仅保留方向标记；
2. **非题目区域遮蔽**：检测到人脸/身份证/家庭环境等无关区域时，送第三方引擎前像素化处理（本地模型检测，不外送原图哈希以外的元数据）；
3. **供应商约束**：仅接入签署 DPA、承诺不留存不训练的 OCR 供应商；Mathpix/百度/腾讯调用均为即用即弃；
4. **未成年人特别条款**：手写内容（可识别个人笔迹/姓名）在 result 消费后 7 天随 result 置 NULL 一并清除；错题本仅保留结构化文本，不保留手写原图；
5. **敏感内容联动**：区域检测命中违禁内容特征时，仅向《安全与内容合规系统》上报特征哈希与任务元数据，不二次外送。

### 8.3 审计

所有任务创建/查询/取消写入审计日志（user_id、task_id、biz_source、结果状态），保留 180 天，接入《审计日志与操作追溯系统》。

---

## 9. 监控与成本治理

### 9.1 核心指标

| 指标 | 口径 | 目标/告警 |
|------|------|----------|
| ocr_task_p99_duration | 任务端到端 P99 | ≤ 3000ms 单题；> 5000ms 告警 |
| ocr_engine_success_rate | 引擎×调用类型成功率 | ≥ 99%；< 95% 触发熔断检查 |
| ocr_degrade_ratio | 走到降级链第 2 级及以下的比例 | ≤ 5%；> 15% 告警 |
| ocr_formula_placeholder_ratio | 公式占位（识别失败）比例 | ≤ 3%；> 8% 告警 |
| ocr_split_false_positive | 题号误判率（人工抽检标注回流） | 周级跟踪，模式库迭代依据 |
| ocr_accuracy_sample | 抽检准确率（每日 200 张分层抽样：印刷/手写/公式/图表） | 印刷 ≥95%、手写 ≥85%、公式 ≥90%；连续两日不达标 P2 告警 |
| ocr_cost_per_task | 单任务成本（日结，引擎日志成本汇总/任务数） | 环比上涨 > 30% 告警 |
| ocr_task_queue_depth | 待处理任务积压 | > 500 持续 60s 告警（联动 HPA） |

### 9.2 成本治理策略

1. **按题型路由引擎**：无公式纯文本题走百度 accurate_basic（便宜档）；仅公式区域走 Mathpix（贵档），区域级路由已天然限制贵引擎调用量；
2. **同图去重与 SimHash 缓存**：60s 去重窗口 + 编排服务 SimHash 题库级缓存双重拦截重复计费；
3. **分辨率降采样**：送引擎前按区域类型自适应降采样（文本区 300DPI 等效，公式区保持原分辨率）；
4. **本地 Paddle 兜底分流**：夜间批处理（EXAM_SCAN）优先走本地引擎，云引擎仅处理高价值同步请求；
5. **月度成本对账**：ClickHouse cost_micro 汇总 vs 供应商账单，差异 > 2% 启动排查（对齐《成本管理与优化系统》）。

---

## 10. 性能与容量规划

| 项 | 估算 | 依据 |
|----|------|------|
| 峰值 QPS | 500（拍题高峰 19:00-22:00） | 设计目标 §1.2 |
| 单任务 CPU 时间 | 预处理 ~300ms + 分割/结构化 ~100ms（2 核） | OpenCV 基准 |
| 云引擎并发 | 文本 500 QPS、公式 150 QPS（供应商配额，需提前商务锁定） | Mathpix/百度配额 |
| 本地 Paddle 池 | 4×T4 GPU 副本 ×2（降级兜底 + 夜间批处理），单卡 40 QPS（文本） | 实测估算 |
| K8s 副本 | 2-8 副本（CPU 型，2C4G/副本），HPA 按 CPU 70% + 队列深度 > 200 双指标扩容 | — |
| Redis | 单实例 2GB 是足（热点 key 均为短 TTL 小对象） | §4.3 |
| 降级预案 | 云引擎全部不可用时：本地池承接文本类 160 QPS，公式类排队降级为占位标注 | D1-D4 |

---

## 11. 验收场景

| # | 场景 | 输入 | 预期结果 |
|---|------|------|----------|
| V1 | 单题印刷体清晰拍摄 | 人教版数学练习册单题 | COMPLETED，stemText 完整，ocrConfidence ≥ 0.95，≤ 3s |
| V2 | 多题印刷体（5 题） | 一页练习册 | 分割 5 题，题号连续，每题边界完整 |
| V3 | 超多题（15 题） | 整页试卷 | 取前 10 题，truncated=true，客户端收 030207 软提示 |
| V4 | 模糊图片 | 手抖拍摄 | FAILED_QUALITY → 030203，客户端展示重拍引导 |
| V5 | 光线不均/阴影 | 侧光拍摄 | 去阴影后识别成功，shadow_removed=true |
| V6 | 倾斜 30° 拍摄 | 梯形畸变图 | 畸变矫正后正常识别，skew_angle 记录 |
| V7 | 手写题目+手写作答 | 学生练习木 | 手写区域识别，handwriting.detected=true，warnings 含低置信提示（030206） |
| V8 | 含分式/根式公式 | 数学计算题 | formulas[].latex 正确，客户端渲染正常 |
| V9 | Mathpix 故障 | 模拟 5xx | 自动切百度公式，无失败；日志 engine_formula=baidu，降级埋点 |
| V10 | 全引擎故障 | 断网模拟 | FAILED_ENGINE → 030205，任务状态可查，不残留 PENDING |
| V11 | 同图 60s 内重复提交 | 同一图片连续两次 | 第二次命中去重，直接返回首次结果，引擎调用次数 1 |
| V12 | 用户已框选 2 题 | selectedRegions 传入 2 区域 | MANUAL 策略，仅返回框选区域题目 |
| V13 | 选项跨题截断 | A/B 选项在题 1 末尾，C/D 在题 2 开头 | 修复归并到题 1，题 2 不含残缺选项 |
| V14 | 无题号分层练习 | 分层练习册无序号页 | AUTO_GAP 段落间隙分割，题数 = 间隙+1 |
| V15 | 图片含人脸背景 | 家庭环境拍摄 | 送引擎前人脸区域像素化，审计日志记录脱敏动作 |
| V16 | 编排服务 4s 预算超时 | 注入引擎延迟 4.5s | FAILED_TIMEOUT，返回 030205；已有部分结果返回 partial |
| V17 | 异步任务取消 | PREPROCESSING 阶段 DELETE | CANCELED；RECOGNIZING 阶段取消返回 409 |
| V18 | result 过期查询 | 任务完成后第 8 天轮询 | 54517，引导重新提交 |

---

## 12. 关联文档

| 文档 | 关系 |
|------|------|
| 服务端-拍照搜题请求编排与题目智能匹配路由服务 | 本服务入口 A 的主调用方；RecognizedQuestion/SimHash/4s 预算契约对齐 |
| 客户端-拍照图像采集与预处理引擎 | 端侧预处理与质量前置拦截；selectedRegions 框选协议来源 |
| 题目题型识别与结构化解析引擎 | 消费本服务 questionType 粗分类，深度题型分析与结构化反写 |
| 服务端-学生试卷扫描智能识别与考试错题自动归档入库引擎 | 入口 B 批处理调用方；手写 0.75 置信度复核阈值对齐 |
| 服务端统一业务异常码与错误分类体系 | 客户端错误码 0302xx 定义来源 |
| 服务端-存储资源统一生命周期管理与过期数据自动清理引擎 | 原图/中间产物保留期执行方 |
| 成本管理与优化系统 | 引擎调用成本归集与对账 |
| 拍照搜题与习题答疑 | 业务级总览（本模块为其技术底座） |

---

## 13. 维护记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-08-10 | 初版：模块概述/架构/预处理/OCR 引擎适配与健康检查 |
| v1.1 | 2026-08-17 | 补全：完成 §3.5 多题分割（题号模式库/无题号降级/跨题截断修复）、§3.6 结构化输出（RecognizedQuestion 契约/归一化规则）；新增 §4 数据模型（ocr_task/引擎日志/Redis 总表）、§5 双入口 API（异步任务 REST + gRPC 同步）、§6 任务状态机与守卫、§7 错误码 54500-54599 与 0302xx 映射及降级矩阵/超时预算、§8 图片生命周期与脱敏合规、§9 监控指标与成本治理、§10 容量规划、§11 验收场景 18 条、§12 关联文档 |