#!/usr/bin/env node
// CommonMark 围栏校验:围栏长度感知(开启围栏可被 >= 其长度的闭合围栏关闭)
// 闭合围栏须无 info string。4反引号外层包裹3反引号示例为合法写法,不误报。
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const bad = [];

for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
  const stack = []; // 每项: {len, lineNo}
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (!m) continue;
    const fence = m[1];
    const info = m[2].trim();
    const len = fence.length;
    const ch = fence[0];
    if (stack.length && stack[stack.length - 1].ch === ch && info === '' && len >= stack[stack.length - 1].len) {
      stack.pop(); // 合法闭合
    } else if (!info || /^\{|\=|^\S/.test(info) === true) {
      // 有 info string(或为空)则为开启围栏;无 info 才可能是闭合,上面已处理
      if (!(stack.length && stack[stack.length - 1].ch === ch && info === '')) {
        stack.push({ len, lineNo: i + 1, ch });
      }
    } else {
      // 无 info 且不匹配栈顶 → 视为新开围栏
      stack.push({ len, lineNo: i + 1, ch });
    }
  }
  if (stack.length) {
    bad.push({ f, lines: lines.length, unclosed: stack.map(s => `${s.ch.repeat(3)}@L${s.lineNo}`).join(',') });
  }
}

console.log(`共 ${files.length} 个 md 文件,CommonMark 校验未配对 ${bad.length} 个`);
bad.sort((a, b) => a.lines - b.lines);
let out = [];
for (const b of bad) {
  console.log(`${b.f} | ${b.lines} lines | unclosed: ${b.unclosed}`);
  const lines = fs.readFileSync(path.join(dir, b.f), 'utf8').split(/\r?\n/);
  const tail = lines.slice(-10).map(l => l.length > 110 ? l.slice(0, 110) + '…' : l);
  out.push(`==== ${b.f} | ${b.lines} lines | unclosed: ${b.unclosed} ====`, ...tail, '');
}
fs.writeFileSync(path.join(dir, '_cm_bad_tails.txt'), out.join('\n'), 'utf8');
