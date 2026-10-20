const fs = require('fs');
const p = 'D:/Workspace/individual/PrimeTop/docs2/README.md';
const t = fs.readFileSync(p, 'utf8');
const lines = t.split('\n');
// find section '## 待修复烂尾文档清单'
const idx = lines.findIndex(l => l.startsWith('## 待修复'));
const end = lines.findIndex((l, i) => i > idx && l.startsWith('## ') && !l.startsWith('###'));
console.log('section from line', idx, 'to', end);
console.log(lines.slice(idx, Math.min(end, idx + 200)).join('\n'));
