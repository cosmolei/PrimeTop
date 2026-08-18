const fs = require('fs'), path = require('path');
const d = 'D:/Workspace/individual/PrimeTop/docs2';
const files = fs.readdirSync(d).filter(f => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md');
const issues = [];
const FENCE = '```';
for (const fn of files) {
  const p = path.join(d, fn);
  let txt;
  try { txt = fs.readFileSync(p, 'utf-8'); } catch (e) { issues.push([fn, 'READ_ERROR', String(e)]); continue; }
  const lines = txt.split(/\r?\n/);
  const fenceCount = lines.filter(l => l.trim().startsWith(FENCE)).length;
  const nonempty = lines.filter(l => l.trim());
  if (nonempty.length === 0) { issues.push([fn, 'EMPTY', '']); continue; }
  const last = nonempty[nonempty.length - 1];
  const flags = [];
  if (fenceCount % 2 === 1) flags.push('ODD_FENCE(' + fenceCount + ')');
  if (/[(\{,,、：:|=>`]\s*$/.test(last) && !last.trim().startsWith('#')) flags.push('ENDS_PUNCT');
  if (last.trim().startsWith('#')) flags.push('ENDS_HEADING');
  if (/\.\.\.$|……$/.test(txt.trimEnd())) flags.push('ENDS_ELLIPSIS');
  if (/TO BE CONTINUED|待补充|待完成|TODO/.test(txt)) flags.push('TODO_MARK');
  if (flags.length) issues.push([fn, flags.join(';'), 'last=' + JSON.stringify(last.slice(0, 70)) + ' lines=' + lines.length]);
}
console.log('total_files', files.length);
console.log('issue_files', issues.length);
for (const it of issues) console.log(JSON.stringify(it));
