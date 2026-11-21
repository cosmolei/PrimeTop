const fs = require('fs');
const f = process.argv[2];
const buf = fs.readFileSync(f);
const txt = buf.toString('utf8');
// BOM check
console.log('BOM:', buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF ? 'YES(BAD)' : 'no');
let open = false, count = 0, badLines = [];
const lines = txt.split('\n');
lines.forEach((l, i) => {
  const t = l.trimStart();
  if (t.startsWith('```')) {
    count++;
    if (open && t.length > 3 && !/^```\s*$/.test(t)) badLines.push(i + 1);
    open = !open;
  }
});
console.log('fence lines:', count, 'balanced:', !open ? 'YES' : 'NO(OPEN)');
if (badLines.length) console.log('suspect close lines:', badLines.join(','));
const todos = txt.match(/TODO|待补|占位|PLACEHOLDER/g);
console.log('TODO-like:', todos ? todos.length : 0);
console.log('lines:', lines.length);
