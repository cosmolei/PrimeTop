// 内容级零覆盖候选确认（文件名未覆盖的词 -> 全文扫描 docs2）
const fs = require('fs');
const path = require('path');
const docs2 = 'D:/Workspace/individual/PrimeTop/docs2';
const files = fs.readdirSync(docs2).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const groups = {
  '晨读晚读': ['晨读','晚读','朗读打卡'],
  '绘本': ['绘本'],
  '国学启蒙': ['三字经','弟子规','千字文','论语','国学','弟子规'],
  '应用文写作': ['读后感','观后感','日记','书信','请假条','通知便条','演讲稿'],
  '竖式脱式': ['竖式','脱式','解方程','递等式'],
  '奥数思维': ['鸡兔同笼','奥数','数列规律','找规律','举一反三'],
  '珠心算': ['珠心算'],
  '冥想哄睡': ['冥想','白噪音','睡前故事','哄睡'],
  '坐姿健康': ['坐姿','脊柱','近视防控'],
  '请假班牌': ['请假','电子班牌'],
  '听力设备': ['听力宝','复读机'],
  'ARVR': ['AR教学','VR教学'],
  '绕口令朗诵': ['绕口令','朗诵'],
  '谜语急转弯': ['谜语','脑筋急转弯'],
};
for (const [g, words] of Object.entries(groups)) {
  const hits = new Set();
  for (const f of files) {
    const t = fs.readFileSync(path.join(docs2, f), 'utf8');
    for (const w of words) if (t.includes(w)) hits.add(f.split('-详细设计')[0] + '<<' + w);
  }
  console.log(`== ${g}: ${hits.size === 0 ? 'ZERO COVERAGE' : [...hits].slice(0,10).join(' | ')}`);
}
