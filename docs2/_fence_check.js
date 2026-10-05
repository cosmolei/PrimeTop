const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
let bad = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const fences = (text.match(/^```/gm) || []).length;
  if (fences % 2 !== 0) { bad++; console.log('UNBALANCED', f, fences); }
}
console.log('checked', files.length, 'files, unbalanced:', bad);
