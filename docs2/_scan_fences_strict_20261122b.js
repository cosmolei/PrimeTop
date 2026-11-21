// 批次(三十一)围栏严格状态机核验
const fs = require('fs');
const file = process.argv[2];
const buf = fs.readFileSync(file);
const t = buf.toString('utf8');
const lines = t.split(/\r?\n/);
let open = false, opener = '', openLine = 0, count = 0;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^ {0,3}(`{3,})/);
  if (!m) continue;
  const fence = m[1];
  if (!open) { open = true; opener = fence; openLine = i + 1; count++; continue; }
  // 闭合条件:同字符且长度 >= 开启长度
  if (fence[0] === opener[0] && fence.length >= opener.length) { open = false; opener = ''; }
  // 否则视为被包含的文本行,状态不变
}
console.log(JSON.stringify({ file, fences: count, balanced: !open, openLine: open ? openLine : 0, lines: lines.length, bom: buf.slice(0,3).toString('hex'), todo: (t.match(/TODO/g) || []).length }));
