const fs = require('fs');
const path = require('path');
const dir = 'D:/Workspace/individual/PrimeTop/docs2';
const out = [];
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8');
  const m = t.match(/^```/gm) || [];
  if (m.length % 2 !== 0) {
    const lines = t.split(/\r?\n/);
    let last = -1;
    lines.forEach((l, i) => { if (/^```/.test(l)) last = i + 1; });
    out.push({ f, lines: lines.length, unclosed: 'fence@L' + last });
  }
}
out.sort((a, b) => a.lines - b.lines);
console.log(JSON.stringify(out, null, 1));
