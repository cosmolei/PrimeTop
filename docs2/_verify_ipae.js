const fs = require('fs');
const file = process.argv[2];
const s = fs.readFileSync(file, 'utf8');
const lines = s.split(/\r?\n/);
let opens = [], bad = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
  if (!m) continue;
  const fence = m[1][0], len = m[1].length;
  if (opens.length === 0) {
    opens.push({ line: i + 1, fence, len });
  } else {
    const top = opens[opens.length - 1];
    if (fence === top.fence && len >= top.len) opens.pop();
    else bad.push(i + 1);
  }
}
console.log('lines:', lines.length);
console.log('unclosed:', opens.map(o => o.line));
console.log('mismatched:', bad);
console.log('BALANCED:', opens.length === 0 && bad.length === 0);
console.log('has BOM:', s.charCodeAt(0) === 0xFEFF);
console.log('TODO count:', (s.match(/TODO/g) || []).length);
