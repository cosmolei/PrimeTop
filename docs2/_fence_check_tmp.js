// CommonMark-aware fence balance check (temporary tool)
const fs = require('fs');
const path = require('path');
const dir = 'D:/Workspace/individual/PrimeTop/docs2/';
const files = process.argv.slice(2);
for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
  let open = null, openLine = 0, opens = 0, closes = 0;
  lines.forEach((l, i) => {
    const m = l.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!m) return;
    const fence = m[2], ch = fence[0], len = fence.length, info = m[3];
    if (open === null) {
      if (ch === '~' || !info.includes('`')) { open = { ch, len }; openLine = i + 1; opens++; }
    } else if (ch === open.ch && len >= open.len && info.trim() === '') {
      open = null; closes++;
    }
  });
  const status = open === null ? 'BALANCED' : 'UNCLOSED@line' + openLine + '(fence=' + open.ch.repeat(open.len) + ')';
  console.log(status + ' | ' + f + ' | opens=' + opens + ' closes=' + closes + ' lines=' + lines.length);
}
