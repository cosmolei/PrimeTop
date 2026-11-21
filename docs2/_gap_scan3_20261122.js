// 第三轮：内容级零覆盖候选确认
const fs = require('fs');
const path = require('path');
const root = 'D:/Workspace/individual/PrimeTop';
const docs2 = path.join(root, 'docs2');
const files = fs.readdirSync(docs2).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const groups = {
  '书法写字': ['书法','写字','硬笔','毛笔','字帖','练字'],
  '配音跟读': ['配音','跟读'],
  '智能硬件': ['点读笔','智能笔','错题打印机','硬件'],
  '办公IM集成': ['企业微信','钉钉','飞书'],
  '分销渠道': ['分销','渠道商','代理商'],
  '研学实践': ['研学','社会实践','劳动教育'],
  '听力设备': ['听力宝','复读机'],
  '家长课堂': ['家长课堂','家庭教育课程'],
  '电子墨水': ['墨水屏','电子纸'],
};
for (const [g, words] of Object.entries(groups)) {
  const hits = new Set();
  for (const f of files) {
    const t = fs.readFileSync(path.join(docs2, f), 'utf8');
    for (const w of words) if (t.includes(w)) hits.add(f + '<<' + w);
  }
  console.log(`== ${g}: ${hits.size === 0 ? 'ZERO COVERAGE' : [...hits].slice(0,8).join(' | ')}`);
}
