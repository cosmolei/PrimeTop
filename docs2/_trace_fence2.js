const fs = require('fs');
for (const f of process.argv.slice(2)) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let inBlock = false, openLine = -1, openLen = 0, ch = '';
  const openRe = /^\s{0,3}(`{3,}|~{3,})/;
  console.log('########## ' + f.split(/[\\/]/).pop());
  lines.forEach((l, i) => {
    const m = l.match(openRe);
    if (!m) return;
    const fence = m[1];
    let action;
    if (!inBlock) { action = 'OPEN'; inBlock = true; openLine = i + 1; openLen = fence.length; ch = fence[0]; }
    else if (fence[0] === ch && fence.length >= openLen) { action = 'CLOSE'; inBlock = false; }
    else return; // fence inside block, not closing (part of code content)
    // context: prev non-blank and next non-blank
    let p = i - 1; while (p >= 0 && lines[p].trim() === '') p--;
    let n = i + 1; while (n < lines.length && lines[n].trim() === '') n++;
    const prev = p >= 0 ? lines[p].trim().slice(0, 45) : '<<BOF>>';
    const next = n < lines.length ? lines[n].trim().slice(0, 45) : '<<EOF>>';
    const nextIsHeading = n < lines.length && /^#{2,6}\s/.test(lines[n].trim());
    const prevLooksCodeEnd = /[}\)`;>\]]$/.test(prev) || prev === '<<BOF>>';
    // suspicious: OPEN whose prev looks like code end, or CLOSE whose next is heading
    if ((action === 'OPEN' && prevLooksCodeEnd && prev !== '<<BOF>>') || (action === 'CLOSE' && nextIsHeading)) {
      console.log('  *' + action + ' @L' + (i + 1) + ' prev=["' + prev + '"] next=["' + next + '"]');
    }
  });
}
