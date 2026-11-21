// 2026-11-22 批次(三十四)核验:客户端-思维训练与益智游戏页面架构与交互设计
// CommonMark 严格围栏状态机:同字符+长度>=开头行+仅尾随空白才闭合
const fs = require('fs');
const path = 'D:/Workspace/individual/PrimeTop/docs2/客户端-思维训练与益智游戏页面架构与交互设计-详细设计.md';
const buf = fs.readFileSync(path);
const text = buf.toString('utf8');

// 1. UTF-8 无 BOM
const bom = buf.length > 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

// 2. 围栏状态机
const lines = text.split('\n');
let open = null, bad = [], count = 0;
lines.forEach((l, i) => {
  const m = l.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return;
  const fence = m[1], info = m[2];
  if (!open) {
    if (fence[0] === '`' && info.trim().startsWith('`')) return; // info string 不能以 ` 开头,该行不是围栏
    open = { ch: fence[0], len: fence.length };
    count++;
  } else {
    if (fence[0] === open.ch && fence.length >= open.len && info.trim() === '') open = null;
  }
});
if (open) bad.push('EOF unclosed @' + open.len + open.ch);

// 3. 零真实 TODO(排除代码子串误报)
const todoHits = lines.map((l, i) => [i + 1, l]).filter(([i, l]) => /TODO|FIXME|待补|占位待/i.test(l) && !l.includes('.mapToDouble('));

// 4. 章节完整性
const must = ['## 1. 概述', '## 4. 页面详细设计', '## 6. 状态机与守卫', '## 8. 错误处理与降级', '## 13. 验收场景', '## 15. 维护记录'];
const missing = must.filter(h => !text.includes(h));

console.log('BOM:', bom ? 'FAIL' : 'OK(no BOM)');
console.log('FENCES: ' + count + ' opened, ' + (bad.length ? 'FAIL ' + bad.join(';') : 'BALANCED'));
console.log('TODO: ' + (todoHits.length ? 'FAIL ' + JSON.stringify(todoHits) : 'OK(zero)'));
console.log('HEADINGS: ' + (missing.length ? 'MISSING ' + missing.join(',') : 'OK(all present)'));
console.log('LINES: ' + lines.length);
console.log(bad.length === 0 && !bom && todoHits.length === 0 && missing.length === 0 ? 'VERIFY PASS' : 'VERIFY FAIL');
