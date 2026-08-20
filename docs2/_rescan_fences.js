// 独立围栏复扫脚本（node，避免 PowerShell 反引号转义误报）
// 统计行首恰好以 ``` 开头的围栏行数；奇数 => 可能截断
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_'));
const odd = [];

for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = text.split('\n');
  let fences = 0;
  for (const line of lines) {
    if (/^```/.test(line)) fences++;
  }
  if (fences % 2 !== 0) {
    odd.push({ file: f, lines: lines.length, fences });
  }
}

odd.sort((a, b) => a.lines - b.lines);
const out = odd.map(o => `${o.file} | ${o.lines} lines | ${o.fences} fences`).join('\n');
fs.writeFileSync(path.join(dir, '_rescan_fences_20260820b.txt'), `共 ${files.length} 个 md 文件，奇数围栏 ${odd.length} 个（按行数升序）\n\n${out}\n`, 'utf8');
console.log(`共 ${files.length} 个 md 文件，奇数围栏 ${odd.length} 个`);
console.log(out);
