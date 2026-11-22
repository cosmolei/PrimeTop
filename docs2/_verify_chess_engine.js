// 核验《服务端-棋类对弈训练引擎-详细设计.md》
const fs = require('fs');
const p = 'D:/Workspace/individual/PrimeTop/docs2/服务端-棋类对弈训练引擎-详细设计.md';
const buf = fs.readFileSync(p);
const t = buf.toString('utf8');

// 1. BOM
const hasBom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
console.log('UTF-8 BOM:', hasBom ? 'FAIL' : 'NONE (ok)');

// 2. 围栏配对(按行精确匹配 ``` 开头,计数开/闭)
const lines = t.split(/\r?\n/);
let open = false, count = 0, firstBad = -1, fenceTotal = 0;
lines.forEach((l, i) => {
  if (/^```/.test(l)) {
    fenceTotal++;
    if (!open) { open = true; count++; }
    else {
      // 闭合:此行要么恰好 ``` 要么是 ``` 后无语言
      if (l.trim() === '```') { open = false; }
      else { firstBad = i + 1; }
    }
  }
});
console.log('围栏总数:', fenceTotal, fenceTotal % 2 === 0 ? '(偶数 ok)' : '(奇数 FAIL)');
console.log('未闭合:', open ? `FAIL (opened at block #${count})` : '无 (ok)');
if (firstBad > 0) console.log('疑似异常围栏行:', firstBad);

// 3. TODO 占位
const todos = (t.match(/TODO|待补|占位符|\?\?\?/g) || []).length;
console.log('TODO/占位:', todos === 0 ? '零 (ok)' : `FAIL x${todos}`);

// 4. mermaid 语法粗检
const mermaids = t.split('```mermaid').length - 1;
console.log('mermaid 块:', mermaids, '(应为 3)');
['sequenceDiagram', 'stateDiagram-v2', 'flowchart TD'].forEach(k => {
  console.log(`  含 ${k}:`, t.includes(k) ? 'ok' : 'MISSING');
});

// 5. 尾部维护记录
console.log('维护记录:', t.includes('## 维护记录') ? 'ok' : 'MISSING');
console.log('总行数:', lines.length);
