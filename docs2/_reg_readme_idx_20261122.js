const fs = require('fs');
const f = 'README.md';
let text = fs.readFileSync(f, 'utf8');
const nl = text.includes('\r\n') ? '\r\n' : '\n';

const inserts = [
  {
    anchor: '- AI输出质量校验与多模型复核引擎',
    line: '- 服务端-AI教育回答教材版本方法一致性校验与术语自适应修正引擎 (2026-11-22,索引补登记:AI 回答教材版本/课标方法一致性校验与术语自动修正域服务端权威--朴素奇偶围栏计数误报复核,CommonMark 严格状态机 BALANCED;偏差严重度三级/一致性评分公式/并行检测器配置矩阵,§1-§14+附录 A-D 完整)'
  },
  {
    anchor: '- 服务端-学生作业全生命周期管理与智能催交提醒调度引擎',
    line: '- 服务端-学生作业AI生成内容检测与AI辅助学习比例分析引擎 (2026-11-22,索引补登记:作业 AI 生成内容检测与 AI 辅助比例分析域服务端权威--朴素奇偶围栏计数误报复核,CommonMark 严格状态机 BALANCED;多维度检测策略/融合决策引擎/AI 辅助比例评分,§1-§14 完整)'
  },
  {
    anchor: '- 服务端-多题型统一判题引擎与答案评估策略框架',
    line: '- 服务端-练习答题实时自适应难度调节与动态选题引擎 (2026-11-22,索引补登记:练习答题实时自适应难度调节与动态选题(RTAQS)域服务端权威--朴素奇偶围栏计数误报复核,CommonMark 严格状态机 BALANCED;练习会话上下文/初始难度裁决/逐题决策日志,§1-§14+关键代码完整)'
  }
];

let lines = text.split(nl);
let done = 0;
for (const ins of inserts) {
  const idx = lines.findIndex(l => l.startsWith(ins.anchor));
  if (idx === -1) { console.error('ANCHOR NOT FOUND: ' + ins.anchor); process.exit(1); }
  if (lines.some(l => l.includes(ins.line.slice(0, 30)))) { console.error('ALREADY EXISTS: ' + ins.anchor); process.exit(1); }
  lines.splice(idx + 1, 0, ins.line);
  done++;
}
text = lines.join(nl);
fs.writeFileSync(f, text, 'utf8');
console.log('inserted ' + done + ' index entries');
