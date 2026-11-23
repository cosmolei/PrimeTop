// 核验 服务端-规范汉字书写训练引擎-详细设计.md
// 1) CommonMark 严格围栏状态机（同字符+长度>=开头+仅尾随空白）
// 2) UTF-8 无 BOM  3) 零 TODO/待办占位  4) 关键章节齐全
const fs = require('fs');
const path = 'docs2/服务端-规范汉字书写训练引擎-详细设计.md';
const buf = fs.readFileSync(path);
const text = buf.toString('utf8');

let fail = 0;
// BOM
if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) { console.log('FAIL: UTF-8 BOM'); fail++; }
else console.log('OK: UTF-8 no BOM');

// 严格围栏状态机
const lines = text.split(/\r?\n/);
let open = null, count = 0, bad = 0, firstBad = -1;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) continue;
  if (!open) { open = m[1][0]; openLen = m[1].length; count++; continue; }
  if (m[1][0] === open && m[1].length >= openLen && m[2].trim() === '') { open = null; count++; continue; }
}
function checkRest(i){}
// re-run properly
open = null; count = 0;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) continue;
  if (!open) { open = { ch: m[1][0], len: m[1].length }; count++; }
  else if (m[1][0] === open.ch && m[1].length >= open.len && m[2].trim() === '') { open = null; count++; }
  else if (open.ch === '`' && m[2].includes('`')) { bad++; if (firstBad < 0) firstBad = i + 1; }
}
if (open) { console.log('FAIL: fence unclosed at EOF'); fail++; }
if (bad) { console.log('FAIL: bad fence tails=' + bad + ' first@L' + firstBad); fail++; }
if (!open && !bad) console.log('OK: fences ' + count + '/' + count + ' BALANCED');
console.log('lines=' + lines.length);

// TODO
const todo = text.match(/TODO|待办|占位待补|\.\.\.\s*待/g);
if (todo) { console.log('FAIL: TODO hits=' + todo.length); fail++; }
else console.log('OK: zero TODO');

// 关键章节
const need = ['## 3. 核心数据结构', '## 4. 评分引擎', '## 6. API 接口设计', '## 7. 关键代码示例',
  '## 8. 状态流转', '## 11. 错误处理', '## 13. 安全与合规', '48500', '48530',
  'G1', 'G12', 'D10', 'C1', 'R1', 'AC', 'mermaid'];
const missing = need.filter(k => !text.includes(k));
if (missing.length) { console.log('FAIL: missing ' + missing.join(',')); fail++; }
else console.log('OK: sections/codes present');

process.exit(fail ? 1 : 0);
