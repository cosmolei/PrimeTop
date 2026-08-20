#!/usr/bin/env node
// 单文件核验：CommonMark 围栏感知配对 + 尾部抽查
// 用法: node _verify_one.js <file.md>
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('usage: node _verify_one.js <file.md>'); process.exit(2); }
const text = fs.readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);
let inFence = false, opens = 0, closes = 0, fenceChar = '', fenceLen = 0;
let firstUnclosedAt = -1;
const BT = String.fromCharCode(96); // backtick
const TL = String.fromCharCode(126); // tilde
lines.forEach((l, i) => {
  const m = l.match(/^(\t| {0,3})(`{3,}|~{3,})(.*)$/);
  if (!m) return;
  const info = m[3].trim();
  const ch = m[2][0];
  const len = m[2].length;
  if (!inFence) {
    if (ch === BT[0] && info.includes(BT)) return; // info string containing backticks cannot open (CommonMark)
    inFence = true; fenceChar = ch; fenceLen = len; opens++;
    if (firstUnclosedAt < 0) firstUnclosedAt = i + 1;
  } else {
    if (ch === fenceChar && len >= fenceLen && info === '') {
      inFence = false; closes++; firstUnclosedAt = -1;
    }
  }
});
console.log('file:', file);
console.log('lines:', lines.length);
console.log('fences: open=' + opens + ' close=' + closes + ' => ' + (opens === closes ? 'BALANCED' : 'UNBALANCED(diff=' + (opens - closes) + ', last unclosed opens at line ' + firstUnclosedAt + ')'));
console.log('--- TAIL 25 ---');
console.log(lines.slice(-25).join('\n'));
