// Verify the new craft engine doc: BOM, balanced fences, no TODO. Usage: node _verify_craft_engine.js
const fs = require('fs');
const f = 'D:/Workspace/individual/PrimeTop/docs2/服务端-手工美育创作引导引擎-详细设计.md';
const buf = fs.readFileSync(f);
const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
const t = buf.toString('utf8');
const lines = t.split(/\r?\n/);
let open = 0, opens = 0, closes = 0;
lines.forEach((ln, i) => {
  const m = ln.match(/^(`{3,})(.*)$/);
  if (!m) return;
  if (open === 0) { open = i + 1; opens++; }
  else if (m[2].trim() === '') { open = 0; closes++; }
});
console.log('BOM:', bom, '| fences:', opens, '/', closes, open === 0 ? 'BALANCED' : 'UNCLOSED@L' + open);
console.log('TODO:', (t.match(/TODO/g) || []).length, '| lines:', lines.length);
