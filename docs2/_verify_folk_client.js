const fs = require('fs');
const path = require('path');
const file = process.argv[2];
const buf = fs.readFileSync(file);
const text = buf.toString('utf8');
// BOM check
const hasBom = buf.length > 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
// strict fence count: lines starting with ``` at col 0
const lines = text.split(/\r?\n/);
let fences = 0;
let inFence = false;
let firstOpen = -1;
const unclosed = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^```/.test(l)) {
    fences++;
    if (!inFence) { inFence = true; firstOpen = i + 1; }
    else { inFence = false; }
  }
}
if (inFence) unclosed.push(firstOpen);
// TODO placeholder check
const todoCount = (text.match(/TODO|TBD|待补/g) || []).length;
console.log('file:', path.basename(file));
console.log('BOM:', hasBom ? 'YES(BAD)' : 'no(ok)');
console.log('fences:', fences, fences % 2 === 0 ? 'BALANCED' : 'ODD(BAD)');
console.log('unclosedOpenAt:', unclosed.join(',') || 'none');
console.log('lines:', lines.length);
console.log('TODO/TBD:', todoCount);
process.exit((hasBom || fences % 2 !== 0 || unclosed.length || todoCount) ? 1 : 0);
