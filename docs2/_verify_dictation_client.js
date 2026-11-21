const fs = require('fs');
const path = 'D:/Workspace/individual/PrimeTop/docs2/客户端-AI听写默写页面架构与交互设计-详细设计.md';
const buf = fs.readFileSync(path);
const text = buf.toString('utf8');
const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
const lines = text.split(/\r?\n/);
let count = 0;
for (const l of lines) { if (/^\s*```/.test(l)) count++; }
const todos = [];
lines.forEach((l, i) => { if (/\bTODO\b|\bFIXME\b|待补|待完善/.test(l)) todos.push((i+1)+': '+l.trim().slice(0,60)); });
console.log('lines:', lines.length);
console.log('BOM:', bom);
console.log('fence lines:', count, count % 2 === 0 ? 'BALANCED' : 'UNBALANCED');
console.log('todo hits:', todos.length);
todos.slice(0,5).forEach(t => console.log('  ', t));
