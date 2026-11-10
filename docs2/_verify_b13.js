const fs = require('fs');
const files = [
  'README.md',
  '_cm_bad_tails.txt',
  '服务端-学习行为预测与学习需求智能预判引擎-详细设计.md'
];
for (const p of files) {
  const fp = 'D:\\Workspace\\individual\\PrimeTop\\docs2\\' + p;
  const b = fs.readFileSync(fp);
  const bom = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
  const s = b.toString('utf8');
  const lines = s.split(/\r?\n/);
  let c = 0;
  lines.forEach(l => { if (l.trim().startsWith('```')) c++; });
  console.log(p, '| BOM:', bom, '| fences:', c, c % 2 === 0 ? 'BALANCED' : 'UNBALANCED', '| lines:', lines.length);
}
