const fs = require('fs');
const files = process.argv.slice(2);
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let inFence = false, start = 0;
  const opens = [];
  lines.forEach((l, i) => {
    if (l.trim().startsWith('```')) {
      if (!inFence) { inFence = true; start = i + 1; }
      else inFence = false;
    }
  });
  const m = fs.readFileSync(f, 'utf8').match(/^```/gm);
  console.log(`${f} | lines=${lines.length} | fences=${m ? m.length : 0} | finalInFence=${inFence}${inFence ? ' @L' + start : ''}`);
}
