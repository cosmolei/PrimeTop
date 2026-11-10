const fs = require('fs');
const file = process.argv[2];
const buf = fs.readFileSync(file);
const text = buf.toString('utf8');
const bom = buf[0] === 0xEF && buf[1] === 0xBB;
// strip code fences inside fenced blocks is overkill; simple CommonMark fence balance:
const lines = text.split(/\r?\n/);
let inFence = false, fenceMarker = '', openLine = 0, count = 0, errors = 0;
lines.forEach((l, i) => {
  const m = l.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
  if (m) {
    if (!inFence) { inFence = true; fenceMarker = m[2][0]; openLine = i + 1; }
    else if (m[2][0] === fenceMarker) { inFence = false; count++; }
  }
});
const todoCount = (text.match(/TODO|待补|占位待/g) || []).length;
console.log(JSON.stringify({ bom, fences: count, unclosed: inFence ? openLine : null, lines: lines.length, todoCount }));
