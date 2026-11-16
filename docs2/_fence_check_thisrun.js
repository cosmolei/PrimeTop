const fs = require('fs');
const f = process.argv[2];
const b = fs.readFileSync(f);
const s = b.toString('utf8');
const lines = s.split(/\r?\n/);
const FENCE = String.fromCharCode(96).repeat(3);
let n = 0;
const opens = [];
lines.forEach((l, i) => {
  if (l.startsWith(FENCE)) { n++; if (n % 2 === 1) opens.push('OPEN @L' + (i + 1) + ': ' + l.trim().substring(0, 60)); }
});
console.log('lines:', lines.length, 'fences:', n, n % 2 === 0 ? 'BALANCED' : 'UNBALANCED');
console.log('BOM:', (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) ? 'YES' : 'NO');
console.log('TODO:', /TODO/.test(s) ? 'FOUND' : 'none');
if (n % 2 !== 0) console.log(opens.join('\n'));
