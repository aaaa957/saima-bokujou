// 验证性能改动：① 逐位等价 —— 与指定基线（默认 HEAD）跑完整比赛比对全场结果
//              ② 性能 —— 同场次的 CPU 对比
// 只读：基线源码取自 git，写到临时文件，不改仓库。
//
// 用法：node tests/traffic-coef-equivalence-v11.js [baseline-ref]
//   例：node tests/traffic-coef-equivalence-v11.js 989e73a   # 与本轮优化前的基线比
//
// ⚠️ 两条实测教训（都曾导致误判，务必保留）：
//  1) 本脚本原先只跑「抽象场地」（profile:'平坦'），而真实赛场的几何走 route 路径
//     （routeTablePoint/routeArcState），二者热点完全不同。只测抽象场地**验证不到真正的瓶颈**。
//     现补上真实赛场场次，含带引入线（chute）的东京 2000/1600 两种分支。
//  2) 本脚本原先在**同一进程内**先后加载基线与被测引擎 —— 实测这会使测得 CPU
//     随加载顺序单调变慢（同进程堆/JIT 污染），把真实收益读成负收益。
//     现改为**每个引擎、每个场次各起一个独立子进程**（tests/perf-ab-one-v11.js）。
'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');

const BEFORE_REF = process.argv[2] || 'HEAD';
const before = spawnSync('git', ['show', `${BEFORE_REF}:sim.js`], { cwd: root, encoding: 'utf8' });
if (before.status !== 0) { console.error('取基线失败: ' + before.stderr); process.exit(1); }
const fBefore = path.join(os.tmpdir(), 'sim_before_perf.js');
fs.writeFileSync(fBefore, before.stdout);
console.log('基线: ' + BEFORE_REF);

const REPS = process.env.REPS || '1';
const ONE = path.join(__dirname, 'perf-ab-one-v11.js');
const after = path.join(root, 'sim.js');

function run(file, n, len, course) {
  const args = [ONE, file, '0', String(n), String(len), course || '-', REPS];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 3600000 });
  if (r.status !== 0) throw new Error('子进程失败: ' + (r.stderr || '').slice(0, 500));
  const m = /CPU ([\d.]+) DIGEST (\w+) RACE_T ([\d.]+)/.exec(r.stdout || '');
  if (!m) throw new Error('子进程输出异常: ' + (r.stdout || '').slice(0, 300));
  return { cpuSec: Number(m[1]), dig: m[2], raceT: Number(m[3]) };
}

// [马数, 距离, 赛场]；赛场为空 = 抽象场地（无 route），否则走真实路线几何
const cases = [
  [8, 1200, ''],
  [8, 2000, ''],
  [12, 2400, '京都芝外A'],
  [8, 2400, '東京芝A'],
  [8, 2000, '東京芝A'],   // 带 100m 直引入线（chute，angle=π/2）
  [8, 1600, '東京芝A'],   // 带引入线（straightChute，angle=0）
];
console.log('=== 逐位等价 + 性能（每个引擎/场次独立进程，避免同进程污染）===');
console.log('');
console.log('场次                      改前CPU   改后CPU   加速     改前摘要         改后摘要         等价');
let totB = 0, totA = 0;
for (const [n, len, course] of cases) {
  const a = run(fBefore, n, len, course);
  const b = run(after, n, len, course);
  totB += a.cpuSec; totA += b.cpuSec;
  const eq = a.dig === b.dig;
  const label = (n + '匹 @' + len + 'm ' + (course || '抽象')).padEnd(24);
  console.log(
    label +
    a.cpuSec.toFixed(2).padStart(8) + 's' + b.cpuSec.toFixed(2).padStart(9) + 's' +
    (a.cpuSec / b.cpuSec).toFixed(3).padStart(8) + '×  ' +
    a.dig.padEnd(16) + b.dig.padEnd(16) + (eq ? '✅ 相同' : '❌ 不同'));
  if (!eq) console.log('   ⚠️ 摘要不同 —— 该场次结果已改变，需逐马排查');
}
console.log('');
console.log('合计 CPU：改前 ' + totB.toFixed(1) + 's → 改后 ' + totA.toFixed(1) + 's   （' + (totB / totA).toFixed(3) + '×）');
