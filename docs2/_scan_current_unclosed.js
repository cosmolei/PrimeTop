// Scan docs2 for unclosed code fences (same logic as _tail_triage.js)
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md');
const bad = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
  let open = null, openLine = 0;
  lines.forEach((l, i) => {
    const m = l.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!m) return;
    const fence = m[2], ch = fence[0], len = fence.length, info = m[3];
    if (open === null) {
      if (ch === '~' || !info.includes('`')) { open = { ch, len }; openLine = i + 1; }
    } else if (ch === open.ch && len >= open.len && info.trim() === '') {
      open = null;
    }
  });
  if (open !== null) bad.push({ f, openLine, total: lines.length });
}
console.log('BAD COUNT:', bad.length);
bad.forEach(b => console.log(b.f, '|', b.total, 'lines | unclosed@L' + b.openLine));
fs.writeFileSync('_scan_unclosed_current.txt', bad.map(b => `${b.f} | ${b.total} | L${b.openLine}`).join('\n'), 'utf8');
