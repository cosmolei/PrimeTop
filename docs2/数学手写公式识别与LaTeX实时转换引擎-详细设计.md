# 数学手写公式识别与LaTeX实时转换引擎 - 详细设计

## 1. 概述

### 1.1 目的
为移动端提供数学手写公式到LaTeX的实时识别与转换能力，支持学生在公式书写过程中获得结构化反馈、实时渲染与编辑提示，降低手写公式在答题、拍题、错题标注中的输入成本。

### 1.2 范围
- 支持常见中小学数学符号与表达式的手写识别
- 实时将笔迹转为LaTeX语义串
- 提供编辑提示、校正建议与字符级反馈
- 支持导出图片、文本（LaTeX/MathML）与交互式公式结构
- 对接答题卡、错题标注、草稿纸等模块

### 1.3 适用学段
- 小学：数字与基础符号、四则运算、简单方程
- 初中：代数、几何符号、函数符号、方程组
- 高中：微积分符号、矩阵、高级函数、复杂表达式

---

## 2. 核心需求

### 2.1 功能性需求
- FR1. 支持数字（阿拉伯/中文数字）、运算符（+、-、×、÷、=、≠、≈、<、>、≤、≥）、括号、分数、根号、指数、上下标、希腊字母、函数名（sin, cos, tan, log, ln等）。
- FR2. 笔迹实时采集与坐标平滑预处理。
- FR3. 字符级识别与上下文增强。
- FR4. 结构化解析与LaTeX输出。
- FR5. 支持笔画撤销/重做与局部编辑修正。
- FR6. 支持导入已有图片进行公式识别（可选）。
- FR7. 提供识别置信度与用户反馈纠错闭环。
- FR8. 学段感知，优先展示适龄符号建议。

### 2.2 非功能性需求
- NFR1. 实时性：首笔至初次结果 < 300ms；增量笔迹结果更新 < 100ms。
- NFR2. 准确率：字符级识别准确率 ≥ 95%；整体公式结构化准确率 ≥ 90%。
- NFR3. 离线可用：基础算符与常用符号识别可在端侧离线运行。
- NFR4. 资源占用：端模型包体积 ≤ 20MB；内存占用 ≤ 80MB。
- NFR5. 可观测：采集识别延迟、置信度分布、纠正反馈率。

---

## 3. 技术方案

### 3.1 总体流程
1. 笔迹采集（多触点坐标流、压强、速度、时间戳）
2. 笔迹预处理（重采样、平滑、归一化）
3. 字符级识别（端侧小模型/云端大模型）
4. 结构化解析（版式分析、运算符优先、嵌套推断）
5. LaTeX生成与实时渲染（MathJax/KaTeX预览）
6. 校正与反馈（高亮低置信区、提供候选集、用户纠错回流）
7. 导出与存储（图片/文本/结构化数据）

### 3.2 技术选型
- 端侧识别：ONNX/TFLite；轻量CNN+Transformer
- 云端识别：OCR+NLP模型；支持复杂版式与多符号组合
- 渲染：KaTeX（前端） + Flutter渲染桥接
- 存储与传输：JSON结构化数据（笔画点集、识别结果、LaTeX）

### 3.3 架构边界
- 本设计关注“识别+转换+渲染”，不涉及“公式语义求解”与“逻辑校验”（属于AI辅导或理科解题引擎）。
- 与“拍题识题多题检测与选择交互引擎”解耦，通过统一API接口复用识别管线。

---

## 4. 数据结构设计

### 4.1 笔迹采集数据
```typescript
interface Stroke {
  id: string;                   // 笔画ID，全局唯一
  points: Point[];              // 笔画点集
  startTime: number;            // 笔画开始时间戳（毫秒）
  endTime: number;              // 笔画结束时间戳
  pressure?: number;            // 平均压强（可选）
}

interface Point {
  x: number;                    // 相对画布坐标（0-1归一化）
  y: number;
  t: number;                    // 点时间戳
}

interface FormulaSession {
  sessionId: string;
  strokes: Stroke[];
  userId: string;
  grade: string;                // 学段年级
  subject: string;              // 学科（数学/物理）
  createdAt: number;
  updatedAt: number;
}
```

### 4.2 识别结果数据
```typescript
interface RecognitionResult {
  sessionId: string;
  rawText: string;              // 识别原始文本
  latex: string;                // LaTeX源码
  mathML?: string;              // MathML（可选）
  structure: FormulaNode;       // 公式结构树
  confidence: number;           // 全局置信度 [0,1]
  charConfidences?: CharConfidence[]; // 字符级置信度
  candidates?: string[];        // 候选LaTeX串（Top-K）
  latencyMs: number;            // 识别耗时
  modelVersion: string;         // 模型版本
  source: "local" | "cloud";    // 识别来源
}

interface CharConfidence {
  index: number;
  char: string;
  confidence: number;
  bbox?: BBox;                  // 该字符边界框（归一化坐标）
}

interface BBox {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

interface FormulaNode {
  type: "leaf" | "operator" | "group";
  value?: string;
  children?: FormulaNode[];
  bbox?: BBox;
}
```

### 4.3 请求与响应结构
```typescript
// 请求
interface RecognizeRequest {
  sessionId: string;
  strokes: Stroke[];
  grade: string;
  incremental: boolean;         // 增量识别标记
  lastKnownResultId?: string;   // 用于差量更新
}

// 响应
interface RecognizeResponse {
  resultId: string;
  result: RecognitionResult;
  suggestions?: string[];       // 校正建议（可选）
  editHints?: EditHint[];       // 编辑提示（低置信位、候选位）
}

interface EditHint {
  type: "low_confidence" | "ambiguous";
  index: number;
  candidates?: string[];
  bbox?: BBox;
}
```

---

## 5. API接口设计

### 5.1 客户端-云端识别API
- `POST /api/v1/formula/recognize`
  - Body: `RecognizeRequest`
  - Response: `RecognizeResponse`
  - 超时: 5s
  - 错误码: 400/401/429/500

### 5.2 增量识别（WebSocket）
- 建立 `wss://api.formula.recognize/stream`
- 消息格式JSON，同 `RecognizeRequest`/`RecognizeResponse`
- 服务端推送识别结果与增量更新

### 5.3 反馈纠错API
- `POST /api/v1/formula/feedback`
  - Body: `{ sessionId, originalLaTeX, correctedLaTeX, charConfidences, source }`
  - 用于数据回流与模型持续优化

### 5.4 模型版本查询
- `GET /api/v1/formula/model/info`
  - 返回当前推荐模型版本、端侧包下载地址、变更日志

---

## 6. 客户端实现要点

### 6.1 画布与笔迹采集
- Flutter `CustomPainter` 绘制路径
- 监听 `onPanStart`/`onPanUpdate`/`onPanEnd`
- 采样策略：按时间窗口/距离阈值重采样，控制点密度（建议 1-2ms 或 2-3像素）

### 6.2 预处理管线
- 平滑：Savitzky-Golay 或 移动平均
- 坐标归一化：对笔画包围盒做等比例缩放到固定尺寸（如 128x128）
- 离群点过滤：去除异常跳点

### 6.3 端侧识别调用
- 使用 `flutter_tflite` 或 `onnxruntime_flutter`
- 模型输入：归一化笔迹序列（或笔画图像）
- 模型输出：字符概率分布 + 结构标签

### 6.4 LaTeX实时渲染
- Flutter侧通过 `webview_flutter` 加载含KaTeX的H5渲染容器
- 或使用 `flutter_tex` 组件直接渲染
- 增量更新时仅替换表达式文本，避免全量重绘

### 6.5 用户交互
- 支持手势：撤销、清除、缩放、拖动
- 低置信区高亮显示，点击显示候选列表
- 点击字符后出现替换候选列表或编辑引导

### 6.6 离线策略
- 首次启动下载端侧模型包
- 网络可用时后台静默更新模型
- 离线时仅使用本地模型，禁用云端增强

---

## 7. 服务端实现要点

### 7.1 识别引擎
- 模型编排：根据笔画复杂度选择本地轻量模型或云端大模型
- 并发控制：限制每用户每分钟请求频次
- 缓存：相同笔迹（指纹hash）复用识别结果

### 7.2 结构化解析
- 先做版式分析（水平、垂直、下标、上标、分数）
- 根据运算符优先构建AST
- 生成规范化LaTeX

### 7.3 质量评估
- 基于置信度阈值判定是否进入人工复核队列（可选）
- 对低置信结果标记并请求用户确认

### 7.4 数据回流与标注
- 收集用户纠错样本
- 定期生成训练增量集，进行模型微调
- 监控错误分布，针对性优化低识别率字符/结构

---

## 8. 状态流转

### 8.1 会话生命周期
1. `Init` -> `Collecting`（用户开始绘制）
2. `Collecting` -> `Recognizing`（首次识别请求）
3. `Recognizing` -> `Rendered`（返回LaTeX并渲染）
4. `Rendered` -> `Editing`（用户选择编辑或校正）
5. `Editing` -> `Rendered`（重新识别或修正后渲染）
6. `Rendered` -> `Exported`（导出图片/文本）
7. 会话结束（应用切后台或主动关闭）

### 8.2 错误状态处理
- 网络超时/失败 -> 切到本地模型并提示“使用离线识别”
- 模型返回异常结构 -> 降级为纯字符序列并提示“请检查手写”
- 笔迹过短或过稀 -> 提示“请完整书写符号”

---

## 9. 错误处理

### 9.1 客户端错误
| 错误码 | 含义 | 处理策略 |
|--------|------|----------|
| E4001 | 笔迹为空 | 提示“请绘制内容” |
| E4002 | 笔画过多（>200） | 提示“公式过长，请分段书写” |
| E4003 | 离线模型未安装 | 引导下载或联网使用 |
| E5001 | 渲染异常 | 回退显示原始LaTeX文本 |
| E5002 | 导出失败 | 重试或提示“稍后再试” |

### 9.2 服务端错误
| 错误码 | 含义 | 处理策略 |
|--------|------|----------|
| 400 | 请求格式非法 | 校验参数并返回提示 |
| 401 | 未授权 | 检查token，引导重新登录 |
| 429 | 请求过频 | 立即返回并延迟重试 |
| 500 | 模型服务异常 | 切到本地模型并记录监控 |
| 503 | 服务降级 | 返回缓存结果或降级提示 |

### 9.3 监控与告警
- 识别延迟P99 > 1s 触发告警
- 错误率 > 5% 持续5分钟告警
- 端侧模型加载失败率 > 1% 告警

---

## 10. 安全与隐私

### 10.1 数据安全
- 笔迹传输加密（TLS）
- 用户敏感元数据脱敏
- 禁止留存原始笔迹图片（如需留存需明确告知并获得授权）

### 10.2 未成年人保护
- 识别日志不包含可识别个人信息
- 支持家长管控，可关闭云端识别以减少网络传输
- 定期清理历史会话数据（默认保留30天）

---

## 11. 性能与成本

### 11.1 性能指标
- 端侧首次推理延迟 < 300ms（单笔画）
- 云端增量识别延迟 < 200ms
- 渲染首帧 < 50ms
- 内存峰值 < 80MB（端侧）

### 11.2 成本估算
- 端侧模型包体积约15-20MB，含压缩后
- 云端模型调用成本约每次识别0.005-0.01元（按Token计费或按次计费）
- 预计每用户日均识别次数50-200次，需结合会员权益调用限制与缓存策略控制成本

---

## 12. 测试要点

### 12.1 单元测试
- 笔迹重采样与平滑算法正确性
- 笔画包围盒计算与坐标归一化
- 字符级识别Top-K候选排序

### 12.2 集成测试
- 端侧模型加载与推理
- 云端识别接口与WebSocket流式识别
- LaTeX渲染与多平台渲染一致性

### 12.3 端到端测试
- 常用符号与表达式识别准确率
- 增量笔画识别与实时更新
- 用户纠正反馈回流与模型微调流程
- 离线模式与弱网场景表现

### 12.4 性能测试
- 并发识别吞吐量与响应时间分布
- 端侧内存与CPU占用监控
- 不同设备档位（低端/中端/高端）表现对比

### 12.5 数据集与评估指标
- 内置测试集覆盖学段、学科、难度与常用符号
- 指标：字符准确率、表达式准确率、编辑距离、Levenshtein相似度

---

## 13. 发布与灰度

### 13.1 阶段性目标
- P0：基础符号识别、实时LaTeX渲染、导出图片/文本
- P1：增量识别、编辑提示、云端识别与纠错反馈
- P2：图片公式识别、复杂版式解析、多模型切换

### 13.2 灰度策略
- 首次上线开启10%用户，观察识别准确率与用户反馈
- 按设备性能分批次开放云端识别
- 监控错误率与用户修正率，动态调整模型阈值

---

## 14. 版本历史

| 版本 | 日期 | 变更说明 |
|------|------|----------|
| v1.0 | 2026-07-01 | 初始版本 |

---

## 15. 参考资料
- KaTeX文档: https://katex.org/docs/
- TFLite移动端部署指南
- 手写公式识别相关论文（HMER）
- 笔迹预处理常见算法（Douglas-Peucker, Savitzky-Golay）