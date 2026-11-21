const fs = require('fs');
const f = 'docs2/README.md';
let text = fs.readFileSync(f, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';
let lines = text.split(nl);

// 1) index entry after 通用词典 line
const anchor = '- 服务端-通用词典与汉字字典查询服务';
const idx = lines.findIndex(l => l.startsWith(anchor));
if (idx === -1) { console.error('ANCHOR NOT FOUND'); process.exit(1); }
const newLine = '- 服务端-语文词语辨析专项训练引擎 ? (2026-11-22,新增初版:补齐"近义词/反义词/多音字/形近字"词语辨析训练全库零覆盖缺口——词典服务仅存词条关系数据、语文素养系统(LIT)不含此子域、听写默写仅事后形近字归因;本文定义四子域枚举/wd_item·wd_session·wd_answer_log·wd_profile 四表+Redis键族/三集合装配护栏(review<=0.4)/四题型确定性判题(AI零参与判分)/Group粒度EMA掌握度/SSE讲解管线(WD_EXPLAIN_V1模板)/45500-45599错误码段(全库扫描确认空闲)/G1-G10守卫/C1-C7合规红线(审音表为读音唯一权威)/M1-M10监控与日终对账三项/听写归因visually_similar事件反向加练联动)';
if (lines.some(l => l.includes('服务端-语文词语辨析专项训练引擎'))) { console.error('ALREADY EXISTS'); process.exit(1); }
lines.splice(idx + 1, 0, newLine);

// 2) maintenance log batch entry at end
const logLine = '- 2026-11-22 批次(三十三):新开细化点--新建 **服务端-语文词语辨析专项训练引擎(WD)** v1.0(1090 行,CommonMark 严格状态机围栏 34/34 BALANCED,UTF-8 无 BOM,零 TODO):填补近义词/反义词/多音字/形近字辨析训练域零覆盖(关键词+内容双重扫描确认:反义词/谜语等零覆盖清单中"反义词/多音字/形近字"内容级无训练链路;词典服务 47700 段仅查询权威、LIT 语文素养四子域不含辨析、听写默写仅形近字事后归因);错误码 45500-45599 段经 942 份全库正则扫描确认空闲后注册;画像/复习/事件/合规/监控均与既有文档契约对齐,未发明重复权威';
lines.push(logLine);
lines.push('');

text = lines.join(nl);
fs.writeFileSync(f, text, 'utf8');
console.log('README updated: index entry + batch log');
