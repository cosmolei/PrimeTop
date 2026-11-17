const fs = require('fs');
for (const f of process.argv.slice(2)) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let inBlock = false, openLine = -1, openLen = 0, ch = '';
  const openRe = /^\s{0,3}(`{3,}|~{3,})/;
  console.log('########## ' + f.split(/[\\/]/).pop());
  lines.forEach((l, i) => {
    const m = l.match(openRe);
    if (m) {
      const fence = m[1];
      if (!inBlock) {
        inBlock = true; openLine = i + 1; openLen = fence.length; ch = fence[0];
        // suspicious open: previous non-blank line is prose (not heading/list/blank)?
        let j = i - 1; while (j >= 0 && lines[j].trim() === '') j--;
        const prev = j >= 0 ? lines[j].trim() : '';
        const prevIsProse = prev !== '' && !prev.match(/^#{1,6}\s/) && !prev.match(/^[-*+]\s/) && !prev.match(/^\d+\.\s/) && !prev.match(/^\|/) && !prev.match(/^[:>]/);
        if (prevIsProse) console.log('  ?OPEN@L' + (i + 1) + ' after prose: "' + prev.substring(0, 60) + '"');
      } else if (fence[0] === ch && fence.length >= openLen) {
        inBlock = false;
      }
    } else if (inBlock && /^\s{0,3}#{1,6}\s/.test(l)) {
      console.log('  !!HEADING INSIDE BLOCK@L' + (i + 1) + ' (block opened @L' + openLine + '): ' + l.trim().substring(0, 60));
    }
  });
}
