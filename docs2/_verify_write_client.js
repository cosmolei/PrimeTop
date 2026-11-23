const fs = require('fs');
const fname = process.argv[2];
const lines = fs.readFileSync(fname, 'utf8').split(/\r?\n/);
let open = null, pairs = 0, openLine = -1;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(`{3,}|~{3,})(.*)$/);
  if (!m) continue;
  const fence = m[1], info = m[2].trim();
  if (!open) { open = { ch: fence[0], len: fence.length }; openLine = i + 1; }
  else if (fence[0] === open.ch && fence.length >= open.len && info === '') { open = null; pairs++; }
}
if (open) console.log('UNCLOSED, last open fence at line', openLine);
else console.log('BALANCED, pairs:', pairs);
console.log('total lines:', lines.length);
