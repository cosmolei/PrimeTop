const fs = require('fs');
const path = 'D:/Workspace/individual/PrimeTop/docs2/客户端-棋类对弈训练页面架构与交互设计-详细设计.md';
const buf = fs.readFileSync(path);
const text = buf.toString('utf8');
const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
let open = null, opens = 0, closes = 0, bad = [];
const lines = text.split(/\r?\n/);
lines.forEach((l, i) => {
  const m = l.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return;
  const fence = m[1];
  if (!open) {
    if (fence[0] === '`' && m[2].includes('`')) return;
    open = fence; opens++; return;
  }
  if (fence[0] === open[0] && fence.length >= open.length && /^[\s]*$/.test(m[2])) {
    open = null; closes++;
  }
});
lines.forEach((l, i) => { if (/\bTODO\b/i.test(l)) bad.push(`TODO @L${i+1}`); });
console.log(`BOM=${bom} opens=${opens} closes=${closes} ${open ? 'UNCLOSED ' + open : 'BALANCED'} lines=${lines.length} todo=${bad.length}`);
bad.forEach(b => console.log(b));
