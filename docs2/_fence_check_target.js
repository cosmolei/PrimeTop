const fs = require('fs');
const f = process.argv[2];
const c = fs.readFileSync(f, 'utf8');
const lines = c.split(/\r?\n/);
let n = 0;
const openers = [];
lines.forEach((l, i) => {
  if (/^\s*```/.test(l)) { n++; openers.push(i + 1); }
});
console.log('lines:', lines.length, 'fences:', n, n % 2 === 0 ? 'BALANCED' : 'UNBALANCED last@L' + openers[openers.length - 1]);
console.log('hasBOM:', c.charCodeAt(0) === 0xFEFF);
console.log('TODO:', /TODO/.test(c));
