const fs = require('fs');
const path = require('path');
const dir = 'D:/Workspace/individual/PrimeTop/docs2';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
const blocks = new Map(); // hundred-block -> count
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  const found = t.match(/\b([1-5][0-9])([0-9]{3})\b/g) || [];
  for (const h of found) {
    const block = h.slice(0, 3) + 'xx';
    blocks.set(block, (blocks.get(block) || 0) + 1);
  }
}
const used = [...blocks.keys()].sort();
console.log('USED BLOCKS (' + used.length + '):');
console.log(used.join(' '));
console.log('---FREE 100-blocks in 10000-59999:---');
const free = [];
for (let b = 100; b <= 599; b++) {
  const key = b + 'xx';
  if (!blocks.has(key)) free.push(key);
}
console.log(free.join(' '));
