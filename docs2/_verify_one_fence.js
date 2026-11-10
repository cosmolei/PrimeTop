// CommonMark-correct fence checker for a single file.
// Correct rule: outside a block, ` ```info ` opens; inside a block ONLY a bare
// fence line (3+ backticks, nothing else) closes. Info-string lines inside a
// block are literal content, NOT nested opens.
// Usage: node _verify_one_fence.js <file.md>
const fs = require('fs');
const f = process.argv[2];
const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
let openLine = 0; // 0 = outside
lines.forEach((ln, i) => {
  const m = ln.match(/^\s*(`{3,})(.*)$/);
  if (!m) return;
  const rest = m[2].trim();
  const n = i + 1;
  if (openLine === 0) {
    openLine = n; // open (info string allowed)
  } else if (rest === '') {
    openLine = 0; // bare fence inside block = close
  }
  // else: content line inside block, ignore
});
if (openLine !== 0) {
  console.log('UNCLOSED: opened at L' + openLine);
  process.exit(1);
}
console.log('BALANCED');
