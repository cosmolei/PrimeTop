const fs = require('fs');
const files = process.argv.slice(2);
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let inBlock = false, openLine = -1, openLen = 0, ch = '';
  const openRe = /^\s{0,3}(`{3,}|~{3,})/;
  lines.forEach((l, i) => {
    const m = l.match(openRe);
    if (m) {
      const fence = m[1];
      if (!inBlock) {
        inBlock = true; openLine = i + 1; openLen = fence.length; ch = fence[0];
      } else if (fence[0] === ch && fence.length >= openLen) {
        inBlock = false;
      }
    }
  });
  console.log(f.split(/[\\/]/).pop(), '=>', inBlock ? ('UNCLOSED fence opened @L' + openLine + ' totalLines=' + lines.length) : 'BALANCED');
}
