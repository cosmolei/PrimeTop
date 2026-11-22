// CommonMark strict fence state machine check for a single file.
// Usage: node _verify_pge_client.js <file.md>
const fs = require('fs');
const file = process.argv[2] || 'D:/Workspace/individual/PrimeTop/docs2/客户端-诗词飞花令与诗词竞技页面架构与交互设计-详细设计.md';
const buf = fs.readFileSync(file);
// BOM check
if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) { console.log('FAIL: UTF-8 BOM present'); process.exit(1); }
const text = buf.toString('utf8');
const lines = text.split(/\r?\n/);
let open = null; // {char, len}
let count = 0;
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  const m = L.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) continue;
  const fence = m[1];
  if (!open) {
    open = { char: fence[0], len: fence.length, line: i + 1 };
    count++;
  } else {
    // closing rule: same char, len >= open.len, rest only whitespace
    if (fence[0] === open.char && fence.length >= open.len && /^\s*$/.test(m[2])) {
      open = null;
      count++;
    }
    // otherwise: content inside fence, ignore
  }
}
if (open) { console.log(`FAIL: unclosed fence opened at line ${open.line}`); process.exit(1); }
// TODO check (word-boundary, exclude code substrings)
const todos = [];
lines.forEach((L, i) => { if (/\bTODO\b|待补充|待实现|待完善/.test(L)) todos.push(i + 1); });
console.log(`fences: ${count} (balanced: ${count % 2 === 0 ? 'YES' : 'NO'})`);
console.log(`utf8-no-bom: YES`);
console.log(`todo-hits: ${todos.length ? todos.join(',') : 'none'}`);
console.log(`lines: ${lines.length}`);
process.exit(count % 2 === 0 && todos.length === 0 ? 0 : 1);
