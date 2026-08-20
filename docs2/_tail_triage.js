// Dump last 14 lines of each unclosed-fence file for truncation triage
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
  if (open !== null) bad.push({ f, openLine, total: lines.length, tail: lines.slice(-14) });
}
const out = bad.map(b => {
  return '==== ' + b.f + ' | unclosed@' + b.openLine + '/' + b.total + ' ====\n' + b.tail.join('\n');
});
fs.writeFileSync('_tail_triage_20260820.txt', out.join('\n\n'), 'utf8');
console.log('written', bad.length, 'entries');
