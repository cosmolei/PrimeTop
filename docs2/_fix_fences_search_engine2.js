const fs = require('fs');
const f = 'D:\\Workspace\\individual\\PrimeTop\\docs2\\服务端-教育平台搜索智能联想与实时热搜推荐引擎-详细设计.md';
let lines = fs.readFileSync(f, 'utf8').split('\n');

// sanity: locate anchors
const idxOf = (pred) => lines.findIndex(pred);
let log = [];

// 1) restore §12.1 docstring line clobbered by stray ```python
let i = idxOf(l => l.trim() === '```python' && lines[idxOf(x=>x==='class SearchSafetyFilter:')+1] === undefined);
// safer: find the stray ```python that sits between '"""' and '    确保联想和热搜不展示敏感内容'
for (let n = 0; n < lines.length; n++) {
  if (lines[n] === '```python' && lines[n+1] === '    确保联想和热搜不展示敏感内容') {
    lines[n] = '    搜索词安全过滤器';
    log.push('restored docstring @' + (n+1));
    break;
  }
}
// 2) §12.1 opening fence: `python -> ```python
for (let n = 0; n < lines.length; n++) {
  if (lines[n] === '`python' && lines[n+1] === 'class SearchSafetyFilter:') {
    lines[n] = '```python';
    log.push('fixed 12.1 open @' + (n+1));
    break;
  }
}
// 3) §12.1 closing fence: lone ` before '### 12.2'
for (let n = 0; n < lines.length; n++) {
  if (lines[n] === '`' && lines[n+2] !== undefined && lines[n+2].startsWith('### 12.2')) {
    lines[n] = '```';
    log.push('fixed 12.1 close @' + (n+1));
    break;
  }
}
// 4) stray ``` after '### 12.2 用户搜索隐私保护' -> blank
for (let n = 0; n < lines.length; n++) {
  if (lines[n] === '### 12.2 用户搜索隐私保护' && lines[n+2] === '```') {
    lines[n+2] = '';
    log.push('cleared stray fence after 12.2 @' + (n+3));
    break;
  }
}
// 5) restore mysql/kafka rows after hot.zset row if missing
if (!lines.some(l => l.includes('mysql.search_term_dict.count'))) {
  for (let n = 0; n < lines.length; n++) {
    if (lines[n].startsWith('| redis.hot.zset_members')) {
      lines.splice(n+1, 0,
        '| mysql.search_term_dict.count | 搜索词库总量 | - |',
        '| kafka.search_events.lag | 搜索事件消费延迟 | > 10,000 条 |');
      log.push('restored mysql/kafka rows @' + (n+2));
      break;
    }
  }
}
// 6) §14 diagram fences: lone ` before diagram start and at diagram end
for (let n = 0; n < lines.length; n++) {
  if (lines[n] === '## 14. 与其他模块的集成关系' && lines[n+2] === '`') {
    lines[n+2] = '```';
    log.push('fixed 14 open @' + (n+3));
    break;
  }
}
for (let n = 0; n < lines.length; n++) {
  if (lines[n] === '`' && lines[n+2] !== undefined && lines[n+2].startsWith('### 集成接口清单')) {
    lines[n] = '```';
    log.push('fixed 14 close @' + (n+1));
    break;
  }
}
fs.writeFileSync(f, lines.join('\n'), 'utf8');
console.log(log.join('\n'));

// verify
const l2 = fs.readFileSync(f, 'utf8').split('\n');
let inFence = false, count = 0, bad = [];
l2.forEach((l, i) => {
  if (/^\s*```/.test(l)) { inFence = !inFence; count++; }
  if (/^\s*`/.test(l)) bad.push(i + 1);
});
console.log('fences:', count, 'balanced:', !inFence, 'residual backtick-line starts:', JSON.stringify(bad));
console.log('has mysql row:', l2.some(l => l.includes('mysql.search_term_dict.count')), '| has kafka row:', l2.some(l => l.includes('kafka.search_events.lag')));
