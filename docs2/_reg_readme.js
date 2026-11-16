const fs = require('fs');
let s = fs.readFileSync('docs2/README.md', 'utf8');

const entry = '- 客户端-安全教育页面架构与交互设计 ? (2026-11-17,新建,685 行,CommonMark 围栏 24/24 BALANCED+UTF-8 无 BOM+零 TODO,node 围栏计数核验)。安全教育域客户端呈现层权威(服务端《安全教育内容模块-详细设计》2026-10-21 就绪后客户端页面层零覆盖,本次补齐):七大页面单元(主题广场/内容学习页(情景动画+图文课件+儿歌三分发)/情景测验页/演练任务列表/安全徽章墙/家长端安全报告+适龄拦截页)与路由表 /safety/*(深链接先过适龄闸 G1/G8,命中 SAFETY_003 拦截页不回显内容任何字段);Dart 模型与服务端响应 1:1(SafetyCategory/SafetyContent/SafetyQuizQuestion(无答案)/SafetyQuizResult/SafetyDrillTask)+SafetyRepository 八方法+UUID v7 幂等键策略(会话级 clientRequestId/提交级 idempotencyKey 重试复用);学习心跳 15s 节流+离开必报 G9+离线队列 48h 补报;测验页(选项服务端乱序不二次乱序/提交双击门控+幂等双保险/SAFETY_005 限次隐藏入口至次日/草稿 30min 恢复)与学习会话/测验会话/演练镜像三套状态机(mermaid×3)+守卫 G1-G12(适龄闸 fail-closed 含缓存豁免裁决/答案不落端/紧急电话白名单端侧守卫 G3 非白名单整段不渲染/AIGC 标识不可关闭 G4/零商业植入 CI 静态检查 G5/埋点不采作答内容 G12);分龄参数矩阵 12 参×5 档(K 档语音朗读+星星进度+88dp 触达);关键代码四段(SafetyContentGate.canRender(与服务端 §6.4 同龄或低龄一档语义一致)/SafetyAgeGatePage/EmergencyNumberText 白名单渲染守卫/QuizSessionController 提交幂等);错误码映射 SAFE_001~011 符号码(零新增数字段位,SAFE_005 为 G3 诊断码不透传用户)+降级 D1-D10(D10 总红线:适龄闸/电话白名单/AIGC 标识/零商业植入/答案不落端无降级路径)+合规 C1-C8(不恐吓配色/成长型话术白名单/危机让位)+埋点 8 事件 module=safety(与服务端 §15 对齐,AIGC 标识曝光用于合规审计)+契约 R1-R12(判分与答案权威服务端/播放器委托多媒体引擎/徽章委托成就组件/防误触委托全局机制/错误文案归 ErrorMessageFactory/MotionTokens 消费不定义)+验收 AC01-AC16。README 索引登记';

const maint = '- 2026-11-17 批次(二十五):烂尾队列清零后新开细化点--新建 **客户端-安全教育页面架构与交互设计** v1.0(685 行,CommonMark 围栏 24/24 BALANCED+UTF-8 无 BOM+零 TODO,node 围栏计数核验)。安全教育域客户端呈现层权威:服务端《安全教育内容模块》(2026-10-21)创建时已登记后续可选细化--客户端安全教育页面架构与交互设计(服务端已就绪,客户端页面层零覆盖),本次兑现。覆盖:七大页面单元+路由 /safety/*(深链接适龄闸)/数据模型与服务端 1:1/三套状态机/守卫 G1-G12(适龄闸 fail-closed/紧急电话白名单端侧守卫/AIGC 标识不可关闭/零商业植入 CI 检查)/SAFE_001~011 符号码零新增数字段位/降级 D1-D10(D10 总红线)/合规 C1-C8/埋点 8 事件/契约 R1-R12/验收 AC01-AC16。README 索引登记。附交核验脚本 _verify_safe_client.js。';

const anchor1 = '### 客户端模块\r\n';
if (!s.includes(anchor1)) { console.error('anchor1 missing'); process.exit(1); }
s = s.replace(anchor1, anchor1 + entry + '\r\n');

const anchor2 = '- 若在 docs\\design 中发现未在以上清单的模块,应在 docs2 下新增对应细化文档。';
if (!s.includes(anchor2)) { console.error('anchor2 missing'); process.exit(1); }
s = s.replace(anchor2, maint + '\r\n\r\n' + anchor2);

fs.writeFileSync('docs2/README.md', s);
console.log('OK, new length', s.length);
