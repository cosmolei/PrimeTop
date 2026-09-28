// CommonMark fence-aware scan: fence length aware, closing fence must have no info string.
const fs = require('fs');
const path = require('path');
const dir = 'D:\\Workspace\\individual\\PrimeTop\\docs2';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
const results = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
  let open = null; // {len, line}
  const unclosed = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!m) continue;
    const len = m[1].length, ch = m[1][0], info = m[2];
    if (!open) {
      open = { len, ch, line: i + 1 };
    } else {
      // closing: same char, len >= open.len, info (rest) must not contain the char (non-space)
      if (ch === open.ch && len >= open.len && !info.includes(ch)) {
        open = null;
      }
      // else: it's content inside the fence, ignore
    }
  }
  if (open) unclosed.push(open);
  if (unclosed.length) results.push({ f, lines: lines.length, unclosed: unclosed.map(u => u.line) });
}
results.sort((a, b) => a.lines - b.lines);
for (const r of results) {
  console.log(`${r.f} | ${r.lines} lines | unclosed@L${r.unclosed.join(',L')}`);
}
console.log(`TOTAL ${files.length} md, unbalanced: ${results.length}`);
