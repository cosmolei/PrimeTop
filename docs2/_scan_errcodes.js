const fs = require('fs');
const path = require('path');
const dir = 'D:/Workspace/individual/PrimeTop/docs2';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
const pat = /42[0-9]{3}/g;
const hits = new Map();
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  const found = t.match(pat);
  if (found) {
    for (const h of found) {
      if (!hits.has(h)) hits.set(h, f);
    }
  }
}
// print sorted unique codes 42000-42999 with the file that uses them
const keys = [...hits.keys()].sort();
console.log(keys.join(' '));
console.log('---');
for (const k of keys) console.log(k, '->', hits.get(k));
