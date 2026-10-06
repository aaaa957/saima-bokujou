// 解析 --cpu-prof 产物：给出 self time 排名，以及指定函数的**调用者分解**（inclusive 归属）。
//
// 用法：node tests/perf-analyze-v11.js [.cprof 目录] [要追踪的函数名(逗号分隔)]
// 例：  node tests/perf-analyze-v11.js .cprof routeTablePoint,routeArcState
//
// 为什么需要它：self time 只知道「谁耗 CPU」，不知道「谁把 CPU 花在这里」。
// 例如 routeTablePoint 的 self 时间其实来自好几个上层函数，优化对象完全不同。
'use strict';
const fs = require('node:fs'), path = require('node:path');

const dir = process.argv[2] || '.cprof';
const track = (process.argv[3] || '').split(',').map(s => s.trim()).filter(Boolean);

const file = fs.readdirSync(dir).find(x => x.endsWith('.cpuprofile'));
if (!file) { console.error('未找到 .cpuprofile'); process.exit(1); }
const prof = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

const byId = new Map(prof.nodes.map(n => [n.id, n]));
const nameOf = n => (n.callFrame.functionName || '(anon)') + ' @' + (n.callFrame.lineNumber + 1);

// 自底向上重建每个样本的调用栈
const parent = new Map();
for (const n of prof.nodes) for (const c of (n.children || [])) parent.set(c, n.id);

function stackOf(id) { const st = []; let cur = id; while (cur !== undefined) { st.push(cur); cur = parent.get(cur); } return st.reverse(); }

const fnOf = k => k.split(' @')[0];
// 同一函数名可能因内联/多副本对应多个 profile 节点，按函数名聚合。
const self = new Map(), incl = new Map(), callersOf = new Map(), nodesOf = new Map();
for (let i = 0; i < prof.samples.length; i++) {
  const id = prof.samples[i], dt = prof.timeDeltas[i] || 0;
  if (!byId.has(id)) continue;
  const key = nameOf(byId.get(id));
  self.set(key, (self.get(key) || 0) + dt);
  nodesOf.set(fnOf(key), (nodesOf.get(fnOf(key)) || 0) + 1);
  const st = stackOf(id), seen = new Set();
  for (let k = 0; k < st.length; k++) {
    const name = fnOf(nameOf(byId.get(st[k])));
    if (!seen.has(name)) { seen.add(name); incl.set(name, (incl.get(name) || 0) + dt); }
    if (k > 0 && track.includes(name)) {
      if (!callersOf.has(name)) callersOf.set(name, new Map());
      const m = callersOf.get(name), par = fnOf(nameOf(byId.get(st[k - 1])));
      m.set(par, (m.get(par) || 0) + dt);
    }
  }
}

const sum = [...self.values()].reduce((a, b) => a + b, 0);
const pct = v => (100 * v / sum).toFixed(2).padStart(6) + '%';
const ms = v => (v / 1000).toFixed(0).padStart(6) + 'ms';

console.log(`样本 ${prof.samples.length}  总采样 ${(sum / 1000).toFixed(0)}ms`);
console.log('\n--- self time 前 30 ---');
const selfArr = [...self.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of selfArr.slice(0, 30)) console.log(`${pct(v)} ${ms(v)}  ${k}`);

if (track.length) {
  console.log('\n--- 被追踪函数的 inclusive 时间与调用者分解 ---');
  for (const fn of track) {
    if (!incl.has(fn)) { console.log(`\n  ${fn}: 未出现在 profile 中`); continue; }
    const tot = incl.get(fn);
    console.log(`\n  ${fn}  inclusive=${ms(tot)} (${pct(tot)})  self=${ms(self.get([...self.keys()].find(k => fnOf(k) === fn)) || 0)}  profile节点数=${nodesOf.get(fn) || 0}`);
    const m = callersOf.get(fn) || new Map();
    for (const [p, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))
      console.log(`      ${pct(v)} ${ms(v)}  ← ${p}`);
  }
}
