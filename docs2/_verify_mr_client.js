const fs = require('fs');
const path = 'D:/Workspace/individual/PrimeTop/docs2/客户端-晨读打卡页面架构与交互设计-详细设计.md';
const buf = fs.readFileSync(path);
const text = buf.toString('utf8');
const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
// CommonMark strict fence state machine
let open = null, opens = 0, closes = 0;
const lines = text.split(/\r?\n/);
lines.forEach((l, i) => {
  const m = l.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return;
  const fence = m[1];
  if (!open) {
    if (fence[0] === '`' && m[2].includes('`')) return; // info string cannot contain `
    open = fence; opens++; return;
  }
  if (fence[0] === open[0] && fence.length >= open.length && /^[\s]*$/.test(m[2])) {
    open = null; closes++;
  }
});
const todos = (text.match(/TODO|todo:|待补|占位符/g) || []).length;
console.log('BOM:', bom, '| fences open/close:', opens, '/', closes, '| unclosed:', open, '| lines:', lines.length, '| TODO-ish:', todos);
