const fs = require('fs');
const f = 'D:/Workspace/individual/PrimeTop/docs2/服务端-英语配音练习引擎-详细设计.md';
const buf = fs.readFileSync(f);
const t = buf.toString('utf8');
let fences = 0;
for (const l of t.split(/\r?\n/)) if (/^```/.test(l)) fences++;
console.log('fences:', fences, fences % 2 === 0 ? 'BALANCED' : 'UNBALANCED',
  '| BOM:', buf[0] === 0xEF, '| TODO:', (t.match(/TODO|待补|占位/g) || []).length);
