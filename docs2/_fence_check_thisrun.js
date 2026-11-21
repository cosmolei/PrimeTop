const fs = require('fs');
const f = process.argv[2];
const lines = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
let inFence = false, fenceChar = '', fenceLen = 0, openLine = 0;
let bad = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!inFence) {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (m) { inFence = true; fenceChar = m[1][0]; fenceLen = m[1].length; openLine = i + 1; }
  } else {
    const re = new RegExp('^ {0,3}' + (fenceChar === '`' ? '`' : '~') + '{' + fenceLen + ',}\\s*$');
    if (re.test(line)) { inFence = false; }
  }
}
if (inFence) {
  console.log('UNCLOSED: opened at line ' + openLine + ' (' + fenceChar.repeat(fenceLen) + ')');
  for (let i = Math.max(0, openLine - 3); i < Math.min(lines.length, openLine + 8); i++) {
    console.log((i + 1) + ': ' + lines[i]);
  }
} else {
  console.log('BALANCED');
}
