const fs = require('fs');
const path = require('path');
const docs2 = 'D:/Workspace/individual/PrimeTop/docs2';
const files = fs.readdirSync(docs2).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const groups = {
  '棋类': ['围棋','象棋','五子棋','跳棋','军棋'],
  '手工美育': ['折纸','剪纸','黏土','简笔画','涂色','儿童画','手工课'],
  '体育体测': ['跳绳','坐位体前屈','肺活量','体测','眼保健操','视力测试'],
  '珠心算': ['珠心算','算盘'],
  '晨读': ['晨读打卡','朗读打卡','每日朗读'],
  '配音': ['配音'],
  '课堂笔记': ['课堂笔记','随堂笔记','记笔记'],
  '预习单': ['预习单','导学案'],
  '口算': ['口算'],
};
for (const [g, words] of Object.entries(groups)) {
  const hits = new Set();
  for (const f of files) {
    const t = fs.readFileSync(path.join(docs2, f), 'utf8');
    for (const w of words) if (t.includes(w)) hits.add(f.split('-详细设计')[0]);
  }
  console.log(`== ${g}: ${hits.size === 0 ? 'ZERO COVERAGE' : [...hits].slice(0,8).join(' | ')}`);
}
