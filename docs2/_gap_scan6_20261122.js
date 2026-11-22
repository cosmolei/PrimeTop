// 第四轮：设计文档特征词提取 + docs2 覆盖计数（弱覆盖检测）
const fs = require('fs');
const path = require('path');
const root = 'D:/Workspace/individual/PrimeTop';
const design = fs.readFileSync(path.join(root, 'docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md'), 'utf8');
const docs2 = path.join(root, 'docs2');
const files = fs.readdirSync(docs2).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const corpus = files.map(f => fs.readFileSync(path.join(docs2, f), 'utf8'));

// 提取设计文档中的 2-6 字中文词（连续汉字串），统计词频
const freq = new Map();
for (const m of design.matchAll(/[\u4e00-\u9fff]{2,6}/g)) {
  const w = m[0];
  freq.set(w, (freq.get(w) || 0) + 1);
}
// 仅保留设计文档中出现>=3次、且不含通用后缀/前缀噪音的词
const stop = /^(功能|学习|学生|用户|内容|系统|数据|支持|提供|模块|设计|进行|通过|以及|可以|相关|不同|需要|情况|问题|记录|展示|管理|使用|包括|基于|实现|产品|平台|服务|信息|需求|开发|分析|目标|章节|知识点|教材|科目|学科|题目|错题|家长|教师|会员|账号|报告|任务|能力|阶段|版本|计划|效果|水平|方式|界面|交互|模式|结果|流程|策略|测试|运营|上线|方案|标准|规范|原则|建议|注意|时间|每日|每周|每次|如果|其中|对于|同时|此外|并且)$/;

const candidates = [];
for (const [w, c] of freq) {
  if (c >= 3 && !stop.test(w)) candidates.push([w, c]);
}
// 按设计文档词频降序，检查覆盖
const weak = [];
for (const [w, c] of candidates) {
  let hits = 0;
  for (const t of corpus) { if (t.includes(w)) { hits++; if (hits > 2) break; } }
  if (hits <= 1) weak.push({ w, designFreq: c, hits });
}
weak.sort((a, b) => b.designFreq - a.designFreq);
for (const x of weak.slice(0, 60)) console.log(`${x.w} | 设计文档x${x.designFreq} | docs2命中${x.hits}`);
console.log('TOTAL weak:', weak.length);
