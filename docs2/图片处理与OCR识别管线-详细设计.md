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
    从识别结果中检测