const fs = require('fs');
const f = 'D:\\Workspace\\individual\\PrimeTop\\docs2\\服务端-教育平台搜索智能联想与实时热搜推荐引擎-详细设计.md';
const lines = fs.readFileSync(f, 'utf8').split('\n');
// 1-based line patches
const patch = {
  1183: '│  (持久化)    │  │  (热搜榜单)          │',
  1185: '```',
  1189: '```python',
  1258: '```',
  1274: '```python',
  1346: '```',
  1365: '```python',
  1399: '```',
  1428: '```python',
  1461: '```',
  1465: '```python',
  1525: '```',
  1578: '```python',
  1632: '```',
  1561: '| redis.trie.memory_mb | Trie 占用 Redis 内存 | > 512MB |',
  1562: null, // delete
  1563: '| redis.trie.key_count | Trie 桶数量 | - |',
  1564: null,
  1565: '| redis.hot.zset_members | 热搜 ZSet 成员数 | - |',
  1566: null,
};
const out = [];
for (let i = 1; i <= lines.length; i++) {
  if (patch[i] === null) continue;
  out.push(patch[i] !== undefined ? patch[i] : lines[i - 1]);
}
fs.writeFileSync(f, out.join('\n'), 'utf8');
// verify fences
const l2 = fs.readFileSync(f, 'utf8').split('\n');
let inFence = false, count = 0, bad = [];
l2.forEach((l, idx) => {
  if (/^\s*```/.test(l)) { inFence = !inFence; count++; }
  if (/^\s*`[^`]/.test(l) || l.trim() === '`') bad.push(idx + 1);
});
console.log('fences:', count, 'balanced:', !inFence, 'residual single-backtick lines:', JSON.stringify(bad));
console.log('total lines:', l2.length);
