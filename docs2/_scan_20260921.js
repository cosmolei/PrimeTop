// CommonMark fence scan -> _scan_20260921.json (utf8)
const fs = require('fs');
const files = fs.readdirSync('.').filter(f => f.endsWith('.md') && !f.startsWith('_'));
const bad = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const stack = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (!m) continue;
    const fence = m[1], info = m[2].trim(), len = fence.length, ch = fence[0];
    if (stack.length && stack[stack.length - 1].ch === ch && info === '' && len >= stack[stack.length - 1].len) {
      stack.pop();
    } else {
      stack.push({ len, lineNo: i + 1, ch });
    }
  }
  if (stack.length) bad.push({ f, lines: lines.length, unclosed: stack.map(s => s.ch.repeat(3) + '@L' + s.lineNo).join(',') });
}
bad.sort((a, b) => a.lines - b.lines);
fs.writeFileSync('_scan_20260921.json', JSON.stringify(bad, null, 1), 'utf8');
console.log('total files:', files.length, 'unbalanced:', bad.length);
