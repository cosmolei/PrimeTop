const fs = require('fs');
const p = 'D:/Workspace/individual/PrimeTop/docs2/AI教育辅导策略引擎与启发式引导系统-详细设计.md';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
let open = false, first = null, count = 0;
lines.forEach((l, i) => {
  if (!/^```/.test(l)) return;
  if (!open) { open = true; first = i + 1; count++; }
  else if (l.trim() === '```') { open = false; }
  else console.log('WARN line ' + (i + 1) + ' fence-with-infostring inside block opened@' + first + ': [' + l + ']');
});
console.log('blocks opened: ' + count + ', final open=' + open + (open ? ' (opened@' + first + ')' : ''));
// BOM check
const buf = fs.readFileSync(p);
console.log('BOM: ' + (buf[0] === 0xEF && buf[1] === 0xBB ? 'YES(BAD)' : 'no'));
// TODO check
const body = buf.toString('utf8');
console.log('TODO count: ' + (body.match(/TODO/g) || []).length);
console.log('total lines: ' + lines.length);
