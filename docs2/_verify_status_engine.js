// 通用单文件核验：CommonMark 围栏感知配对 + 尾部抽查
// 用法: node _verify_one.js <file.md>
const fs = require('fs');
const p = process.argv[2];
if (!p) { console.error('usage: node _verify_one.js <file.md>'); process.exit(1); }
const t = fs.readFileSync(p, 'utf8');
const lines = t.split(/\r?\n/);
console.log('total lines:', lines.length);
// CommonMark: 围栏开启 = 3+ 个 ` 或 ~ (可缩进 0-3 空格)；代码块内长度>=开启长度且同字符的行关闭它（关闭围栏不能带 info string）
let stack = []; // {ch, len}
let bad = [];
lines.forEach((l, i) => {
  const m = l.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
  if (!m) return;
  const fence = m[2], ch = fence[0], len = fence.length, info = m[3];
  const top = stack[stack.length - 1];
  if (top && top.ch === ch && len >= top.len && info.trim() === '') {
    stack.pop();
  } else if (!top || ch !== '~' || true) {
    // 开新围栏（含嵌套长围栏）；~ 与 ` 不互相关闭
    stack.push({ ch, len, line: i + 1 });
  }
});
if (stack.length) {
  console.log('UNBALANCED: unclosed fences at lines:', stack.map(s => s.line).join(', '));
} else {
  console.log('FENCES: BALANCED');
}
console.log('--- TAIL 12 ---');
console.log(lines.slice(-12).join('\n'));
