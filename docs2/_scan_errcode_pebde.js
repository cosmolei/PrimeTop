const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const used = new Set();
const re = /\b([3456]\d{4})\b/g;
for (const f of files) {
  const c = fs.readFileSync(path.join(dir, f), 'utf8');
  let m;
  while ((m = re.exec(c))) {
    const n = parseInt(m[1]);
    if (n >= 30000 && n <= 69999) used.add(n);
  }
}
// summarize by hundred-block
const blocks = {};
for (const n of used) {
  const b = Math.floor(n / 100) * 100;
  blocks[b] = (blocks[b] || 0) + 1;
}
// find free blocks in 4xxxx and 5xxxx
const free = [];
for (let b = 40000; b <= 69999; b += 100) {
  if (!blocks[b]) free.push(b);
}
console.log('FREE blocks (4xxxx-6xxxx):');
console.log(free.join(' '));
// check specific candidates around 学习计划 domain (51xxx area, 57xxx, 58xxx are used)
for (const cand of [51500, 51500, 51550, 51580, 51650, 51750, 51850, 51950]) {
  console.log(cand, used.has(cand) ? 'USED' : 'free');
}
