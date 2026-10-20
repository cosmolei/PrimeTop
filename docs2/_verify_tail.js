const fs = require('fs');
const files = process.argv.slice(2);
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const lines = t.split('\n');
  // CommonMark fence matching: opening fence ``` or more, closing must be same char run, no info string
  let open = null; // {len, line}
  let count = 0, opens = 0, closes = 0;
  lines.forEach((l, i) => {
    const m = l.match(/^( {0,3})(`{3,}|~{3,})/);
    if (!m) return;
    const fence = m[2];
    const info = l.slice(m[0].length);
    if (!open) {
      opens++;
      open = { len: fence.length, ch: fence[0], line: i + 1 };
    } else {
      // closing fence: same char, at least as long, no info string
      const infoTrim = info.trim();
      if (fence[0] === open.ch && fence.length >= open.len && infoTrim === '') {
        closes++;
        open = null;
      }
      // else: treat as content
    }
  });
  const tail = lines.slice(-8).join('\n');
  console.log('==== ' + f.split('\\').pop() + ' ====');
  console.log('lines=' + lines.length + ' opens=' + opens + ' closes=' + closes + (open ? ' UNCLOSED@L' + open.line : ' BALANCED'));
  console.log('--- tail ---');
  console.log(tail);
  console.log('');
}
