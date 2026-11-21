// CommonMark 严格围栏状态机全库扫描（烂尾队列清零核验）
// 规则: 开头围栏 `^ {0,3}(```+|~~~+)` 可带 info string; 闭合围栏同字符、长度>=开头、仅尾随空白
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('README'));
let bad = [];
let total = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  let inFence = false, ch = '', len = 0, openLine = 0;
  total++;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (m) { inFence = true; ch = m[1][0]; len = m[1].length; openLine = i + 1; }
    } else {
      const re = new RegExp('^ {0,3}' + ch + '{' + len + ',}\\s*$');
      if (re.test(line)) inFence = false;
    }
  }
  if (inFence) bad.push(f + ' (unclosed @L' + openLine + '; ' + lines.length + ' 行)');
}
console.log('SCAN strict-commonmark-fence dir=docs2 files=' + total);
console.log('BAD COUNT = ' + bad.length);
bad.forEach(b => console.log('  BAD: ' + b));
