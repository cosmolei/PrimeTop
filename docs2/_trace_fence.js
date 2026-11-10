const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const stack = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) continue;
  const fence = m[1], info = m[2].trim(), len = fence.length, ch = fence[0];
  if (stack.length && stack[stack.length-1].ch === ch && info === '' && len >= stack[stack.length-1].len) {
    const top = stack.pop();
    console.log('CLOSE@' + (i+1) + ' (opened@' + top.lineNo + ')');
  } else if (!info || /^\{|\=|^\S/.test(info) === true) {
    if (!(stack.length && stack[stack.length-1].ch === ch && info === '')) {
      stack.push({ len, lineNo: i+1, ch });
      console.log('OPEN@' + (i+1) + ' [' + fence + '] info=[' + info.slice(0,30) + '] stack=' + stack.length);
    }
  } else {
    stack.push({ len, lineNo: i+1, ch });
    console.log('OPEN2@' + (i+1) + ' [' + fence + '] stack=' + stack.length);
  }
}
console.log('FINAL STACK:', JSON.stringify(stack));
