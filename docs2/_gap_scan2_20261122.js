// 第二轮：仅保留设计文档中确实出现的候选词，并做 docs2 内容级覆盖扫描
const fs = require('fs');
const path = require('path');
const root = 'D:/Workspace/individual/PrimeTop';
const design = fs.readFileSync(path.join(root, 'docs/design/启硕-PrimeTop-全学段AI辅助学习软件项目设计文档.md'), 'utf8');
const docs2 = path.join(root, 'docs2');
const files = fs.readdirSync(docs2).filter(f => f.endsWith('.md') && !f.startsWith('_'));

const candidates = [
  '数独','24点','舒尔特','华容道','火柴棒','七巧板','魔方','拼图','迷宫',
  '绕口令','演讲','朗诵','书法','笔顺','部首','近义词','反义词','多音字','形近字',
  '谜语','脑筋急转弯','围棋','象棋','数列','鸡兔同笼','奥数','珠心算',
  '晨读','绘本','儿歌','三字经','弟子规','千字文','论语','国学',
  '读后感','观后感','日记','书信','演讲稿',
  '竖式','脱式','解方程','口算题卡',
  '配音','跟读',
  '生涯规划','电子班牌','请假','签到','徽章','砍价','海报','短视频','对战','连麦','弹幕','打赏','投票','奖状','公益','社团','论坛','圈子','私信','群聊','FAQ','冥想','白噪音','睡前故事','坐姿','睡眠','运动','AR','VR','仿真实验','点读笔','智能笔','错题打印机','分销','渠道商','地推','校园','企业微信','钉钉','飞书',
];

const inDesign = candidates.filter(c => design.includes(c));
console.log('设计文档出现:', inDesign.join(','));
console.log('---');
for (const c of inDesign) {
  const contentHits = [];
  for (const f of files) {
    const t = fs.readFileSync(path.join(docs2, f), 'utf8');
    if (t.includes(c)) contentHits.push(f);
  }
  const nameHits = files.filter(f => f.includes(c));
  const total = contentHits.length;
  console.log(`${c} | 文件名:${nameHits.length} 内容:${total}${total===0?' <<<< 零覆盖':''}${total>0&&total<=2?' 覆盖薄弱: '+contentHits.join('; '):''}`);
}
