#!/usr/bin/env node
const fs = require('fs');
const t = fs.readFileSync('客户端-学科上下文与学习环境管理-详细设计.md', 'utf8');
const lines = t.split('\n');
console.log('lines:', lines.length);
lines.forEach(l => { if (/^## /.test(l)) console.log('  ' + l.slice(0, 50)); });
console.log('--- TAIL 12 ---');
console.log(lines.slice(-12).join('\n'));
const checks = {
  'F6 fields': '补齐 v1.0 未声明却被引用的字段',
  'F6 ctor': 'EventBus? eventBus, // v1.1(F6)',
  'F2 engine': 'v1.1(F2)修复：v1.0 的 PhotoQuestionEvent',
  'F4 sec4.5': '### 4.5 上下文生命周期与启动恢复（F4）',
  'F6 sec4.6': '### 4.6 深链接上下文注入（F6）',
  'F5 sec4.7': '### 4.7 多孩子切换流程（F5/G10）',
  'G14 table': '| G14 持久化容忍 |',
  'R14': '| R14 | 日志码注册 |',
  'accept18': '| 18 | 压测：窗口内 1000 次章节导航 |',
  'cmt fix': '同样清空回落学科级（切换器语义）；携带章节 → 显式定位',
  'old 4.3 gone': 'PhotoQuestionEvent>).listen',  // should be FAIL(not present) => inverted check below
};
for (const [k, v] of Object.entries(checks)) {
  if (k === 'old 4.3 gone') { console.log(!t.includes(v) ? 'PASS' : 'FAIL', k); }
  else console.log(t.includes(v) ? 'PASS' : 'FAIL', k);
}
