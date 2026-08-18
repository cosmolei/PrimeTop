const fs = require('fs');
const p = 'D:/Workspace/individual/PrimeTop/docs2/AI教育辅导策略引擎与启发式引导系统-详细设计.md';
const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/);
const FENCE = '```';
lines.forEach((l, i) => {
  const t = l.trim();
  if (t.startsWith(FENCE)) {
    const extra = t.length > 3 ? '  <<< EXTRA: ' + JSON.stringify(t) : '';
    console.log((i + 1) + ': ' + t.slice(0, 40) + extra);
  }
});
