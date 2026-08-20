#!/usr/bin/env node
// 针对单文件的 CommonMark 围栏校验 + 关键章节锚点检查（2026-08-20 午后批次）
const fs = require('fs');
const f = process.argv[2];
const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
const stack = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) continue;
  const fence = m[1], info = m[2].trim(), len = fence.length, ch = fence[0];
  if (stack.length && stack[stack.length - 1].ch === ch && info === '' && len >= stack[stack.length - 1].len) {
    stack.pop();
  } else {
    stack.push({ len, lineNo: i + 1, ch });
  }
}
console.log('lines=' + lines.length, stack.length === 0 ? 'BALANCED(CommonMark)' : 'UNCLOSED@' + stack.map(s => s.lineNo).join(','));
const txt = lines.join('\n');
const must = ['## 6. 状态机与守卫总表', '## 7. 幂等与并发场景', '## 8. 错误处理与降级', '## 9. 埋点事件与监控指标', '## 12. 契约对齐', '## 13. 验收场景', '## 维护记录'];
for (const k of must) console.log(txt.includes(k) ? 'OK  ' + k : 'MISS ' + k);
