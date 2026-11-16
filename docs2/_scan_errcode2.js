const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const used = new Set();
// match 5-digit numbers 30000-69999 and 0-prefixed 040000-069999 style (0[3-6]\d{4})
const re = /\b([3-6]\d{4}|0[3-6]\d{4})\b/g;
const usage = {};
for (const f of files) {
  const c = fs.readFileSync(path.join(dir, f), 'utf8');
  let m;
  while ((m = re.exec(c))) {
    used.add(m[1]);
    const b = m[1].slice(0, 3) + '00';
    if (!usage[b]) usage[b] = new Set();
    usage[b].add(f.slice(0, 40));
  }
}
// report blocks 400-699 (both plain and 0-prefixed normalized)
console.log('=== used 3xx-6xx hundred blocks ===');
for (const b of Object.keys(usage).sort()) {
  console.log(b, [...usage[b]].slice(0, 3).join(' | '));
}
console.log('=== candidates for 学习规划域 (51x) ===');
for (let n = 51000; n <= 51999; n += 100) {
  const key = String(n).slice(0, 3) + '00';
  console.log(n, usage[key] ? 'USED: ' + [...usage[key]][0] : 'FREE');
}
