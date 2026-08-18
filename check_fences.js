// 诊断 docs2 文档围栏配平问题
const fs = require('fs');
const files = process.argv.slice(2);
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let state = 0, lastOpen = 0;
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,3}```/.test(lines[i])) {
      if (state === 0) { state = 1; lastOpen = i + 1; }
      else { state = 0; events.push([lastOpen, i + 1]); }
    }
  }
  console.log('FILE:', f);
  console.log('total lines:', lines.length, '| fences:', events.length * 2 + (state === 1 ? 1 : 0), '| endsOpen:', state === 1, '| lastOpenLine:', lastOpen);
  // 找跨章节的块（块内包含 ## 或 ### 标题行）
  for (const [s, e] of events) {
    for (let j = s; j < e - 1; j++) {
      if (/^#{1,4}\s/.test(lines[j])) { console.log('  block', s, '-', e, 'spans heading at line', j + 1, ':', lines[j].slice(0, 60)); break; }
    }
  }
  // 若未闭合，输出最后打开点上下文
  if (state === 1) {
    console.log('  unclosed block opens at line', lastOpen, ':', lines[lastOpen - 1].slice(0, 80));
    console.log('  ... lines after open:', lines.length - lastOpen);
  }
}
