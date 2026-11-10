const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const from = parseInt(process.argv[3]), to = parseInt(process.argv[4]);
for (let i = from - 1; i < Math.min(to, lines.length); i++) {
  console.log((i + 1) + ': ' + lines[i]);
}
