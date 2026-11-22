const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '客户端-英语配音练习页面架构与交互设计-详细设计.md');
const buf = fs.readFileSync(file);

// 1. BOM check
const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
console.log('BOM:', hasBom ? 'FAIL (has BOM)' : 'OK (no BOM)');

// 2. UTF-8 validity
const text = buf.toString('utf8');
console.log('UTF-8 decode roundtrip:', Buffer.from(text, 'utf8').equals(buf) ? 'OK' : 'FAIL');
console.log('Replacement chars:', (text.match(/\uFFFD/g) || []).length);

// 3. Strict CommonMark fence state machine
// Rules: fence = >=3 backticks or >=3 tildes, optional info string;
// closing fence must be same char, length >= opener, info string empty (only trailing spaces)
const lines = text.split(/\r?\n/);
let inFence = false, fenceChar = '', fenceLen = 0, openLine = 0, count = 0;
let bad = 0;
lines.forEach((line, i) => {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return;
  const marker = m[1], rest = m[2] || '';
  if (!inFence) {
    // opening: info string for backtick fence must not contain backticks
    if (marker[0] === '`' && rest.includes('`')) { console.log(`L${i+1}: bad info string`); bad++; return; }
    inFence = true; fenceChar = marker[0]; fenceLen = marker.length; openLine = i + 1; count++;
  } else {
    // potential closing: same char, len >= opener, rest only whitespace
    if (marker[0] === fenceChar && marker.length >= fenceLen && /^\s*$/.test(rest)) {
      inFence = false; count++;
    }
    // otherwise it's literal content inside fence
  }
});
console.log('Fence count:', count, count % 2 === 0 ? '(even)' : '(ODD - FAIL)');
console.log('Unclosed at EOF:', inFence ? `FAIL (opened L${openLine})` : 'OK');
console.log('Bad fences:', bad);

// 4. TODO placeholders
const todos = text.match(/TODO|todo|待补|待完善|占位/g) || [];
console.log('TODO-like tokens:', todos.length, todos.length ? todos.slice(0,5) : '');

// 5. Maintenance record present
console.log('维护记录:', text.includes('## 维护记录') ? 'OK' : 'MISSING');
console.log('Total lines:', lines.length);
