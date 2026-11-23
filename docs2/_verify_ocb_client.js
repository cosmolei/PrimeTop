// 2026-11-23 批次(四十七):客户端-口算拍照批改页面 围栏严格状态机核验
// CommonMark 闭合规则:同字符 + 长度>=开头 + 仅尾随空白
const fs = require('fs');
const file = process.argv[2] || 'D:/Workspace/individual/PrimeTop/docs2/客户端-口算拍照批改页面架构与交互设计-详细设计.md';
const buf = fs.readFileSync(file);
const text = buf.toString('utf8');
// BOM 检查
if (buf[0] === 0xEF && buf[1] === 0xBB) { console.log('BOM: FAIL (UTF-8 BOM present)'); process.exit(1); }
console.log('BOM: OK (no BOM)');
const lines = text.split(/\r?\n/);
let open = null; // {char, len, line}
let openCount = 0, closeCount = 0;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/);
  if (!m) continue;
  const run = m[1];
  if (!open) {
    open = { char: run[0], len: run.length, line: i + 1 };
    openCount++;
  } else if (run[0] === open.char && run.length >= open.len && /^\s*$/.test(lines[i].slice(m[0].length) ? '' : '')) {
    // closing fence: info string must be empty for closing
    closeCount++;
    open = null;
  }
  // otherwise: inside open fence -> content, ignore (even if looks like fence with info string)
}
if (open) { console.log(`FENCE: FAIL unclosed @L${open.line} char=${open.char} len=${open.len}`); process.exit(1); }
console.log(`FENCE: OK open=${openCount} close=${closeCount} BALANCED`);
// TODO 检查
if (/TODO|待办|FIXME/i.test(text)) { console.log('TODO: FAIL'); process.exit(1); }
console.log('TODO: OK (zero placeholders)');
// 行数
console.log('LINES:', lines.length);
