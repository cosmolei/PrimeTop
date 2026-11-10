// Re-check the head N entries of _cm_bad_tails.txt with the CommonMark-correct
// fence rule. Usage: node _recheck_queue.js [N]
const fs = require('fs');
const path = require('path');
const N = parseInt(process.argv[2] || '10', 10);
const queue = fs.readFileSync('_cm_bad_tails.txt', 'utf8').split(/\r?\n/);
let checked = 0;
for (const line of queue) {
  const m = line.match(/====\s*(.+?\.md)\s*\|/);
  if (!m) continue;
  const fn = m[1];
  const lines = fs.readFileSync(fn, 'utf8').split(/\r?\n/);
  let openLine = 0;
  lines.forEach((ln, i) => {
    const fm = ln.match(/^\s*(`{3,})(.*)$/);
    if (!fm) return;
    const rest = fm[2].trim();
    if (openLine === 0) openLine = i + 1;
    else if (rest === '') openLine = 0;
  });
  const tail = lines.slice(-14).join(' | ');
  console.log((openLine === 0 ? 'BALANCED ' : 'UNCLOSED@L' + openLine + ' ') + fn + '  ||TAIL|| ' + tail.slice(0, 120));
  if (++checked >= N) break;
}
