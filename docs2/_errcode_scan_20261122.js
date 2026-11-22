const fs = require('fs');
const path = require('path');
const docs2 = 'D:/Workspace/individual/PrimeTop/docs2';
const files = fs.readdirSync(docs2).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const used = new Map();
for (const f of files) {
  const t = fs.readFileSync(path.join(docs2, f), 'utf8');
  const ms = t.match(/(?<![0-9])[45][0-9]{4}(?![0-9])/g) || [];
  for (const m of ms) {
    const blk = m.slice(0, 3) + 'xx'; // 百位段, e.g. 47400 -> 474xx
    if (!used.has(blk)) used.set(blk, new Set());
    used.get(blk).add(f.split('-详细设计')[0].slice(0, 36));
  }
}
const free = [];
for (let n = 40000; n <= 59999; n += 100) {
  const blk = String(n).slice(0, 3) + 'xx';
  if (!used.has(blk)) free.push(blk);
}
console.log('FREE 百位段 (' + free.length + '):');
console.log(free.join(' '));
console.log('\nUSED 百位段 (' + used.size + '):');
console.log([...used.keys()].sort().join(' '));
