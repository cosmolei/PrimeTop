const fs = require('fs');
const path = 'D:\\Workspace\\individual\\PrimeTop\\docs2\\客户端-手工美育创作引导页面架构与交互设计-详细设计.md';
const buf = fs.readFileSync(path);
// BOM check
const hasBom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
const text = buf.toString('utf8');
const lines = text.split(/\r?\n/);
// CommonMark strict fence state machine
let inFence = false, fenceChar = '', fenceLen = 0, openLine = 0, bad = 0;
lines.forEach((ln, i) => {
  const m = ln.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return;
  const tok = m[1];
  if (!inFence) {
    // opening: info string for backtick fence must not contain backticks
    inFence = true; fenceChar = tok[0]; fenceLen = tok.length; openLine = i + 1;
  } else {
    // closing: same char, length >= open length, rest only whitespace
    if (tok[0] === fenceChar && tok.length >= fenceLen && /^\s*$/.test(m[2])) {
      inFence = false;
    }
    // else: content line inside fence
  }
});
const todoMatches = text.match(/TODO|todo(?!\.mapToDouble)/g) || [];
// count occurrences properly excluding .mapToDouble
const realTodo = (text.match(/TODO/gi) || []).filter((_,i)=>true).length;
console.log(JSON.stringify({
  file: path.split('\\').pop(),
  bytes: buf.length,
  lines: lines.length,
  hasBom,
  fenceBalanced: !inFence,
  openFenceLine: inFence ? openLine : null,
  badClosures: bad,
  todoHits: (text.match(/TODO/gi)||[]).length,
  done: !hasBom && !inFence
}, null, 2));
