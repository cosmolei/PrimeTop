const fs = require('fs');
const path = require('path');
const dir = 'D:\\Workspace\\individual\\PrimeTop\\docs2';
const targets = process.argv.slice(2);
const files = targets.length ? targets : fs.readdirSync(dir).filter(f => f.endsWith('.md'));
let bad = 0;
for (const f of files) {
  const b = fs.readFileSync(path.join(dir, f));
  const lines = b.toString('utf8').split(/\r?\n/);
  let open = null, count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!m) continue;
    const len = m[1].length, ch = m[1][0];
    if (!open) { open = { len, ch, line: i + 1 }; count++; }
    else if (ch === open.ch && len >= open.len && !m[2].includes(ch)) { open = null; count++; }
  }
  const bom = b[0] === 0xEF && b[1] === 0xBB;
  const ok = !open && !bom;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${f} | fences=${count} | unclosed=${open ? open.line : 'none'} | BOM=${bom} | lines=${lines.length}`);
}
console.log(`TOTAL ${files.length}, bad: ${bad}`);
