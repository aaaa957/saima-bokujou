#!/usr/bin/env node
/* ============================================================
 * 可跑距离模型验证：耐力 × 32 米，是否真的在比赛中兑现？
 * ------------------------------------------------------------
 * 设计约定（见 sim.js 的"可跑距离模型"注释）：
 *     可跑距离 = 耐力 × 32 × (场地 × 力量 × 疲劳)
 * 即"这匹马能跑多远"是确定的、与赛程无关的——这是"距离适性"的基础。
 *
 * 测量方式：跑真实 8 匹马比赛（骑手行为与实战一致），
 * 记录每匹马离开"耐力阶段"时的里程，与名义可跑距离对比。
 * 不用单马独跑：独跑时 AI 全程"收力"(×0.7)，动作构成与实战不同。
 *
 * 用法：node tests/stamina-range.js [每档场次]
 * ============================================================ */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const N = Number(process.argv[2]) || 24;
const RUN_LEN = 4000;          // 跑道放长，避免"跑到终点还没耗尽"
const BASE_RANGE = S.STAMINA_RANGE_PER_POINT;

/* 让目标马带指定耐力/力量参赛，其余 7 匹为基准值 */
function measure(targetStamina, targetPower, state, fatigue) {
  const depletes = [];
  for (let n = 0; n < N; n++) {
    const fld = [];
    for (let i = 0; i < 8; i++) {
      const h = S.makeHorse(S.mulberry32(31000 + n * 977 + i * 131),
        { style: ['逃', '先', '差', '追'][i % 4], level: 70, id: 'h' + i });
      if (i === 0) {
        h.stats['耐力'] = targetStamina;
        h.stats['力量'] = targetPower;
        h['疲劳'] = fatigue || 0;
      }
      fld.push(h);
    }
    const rc = S.createRace(fld, {
      length: RUN_LEN, surface: '草地', state: state || '良', profile: '平坦',
      styleCoefs: 'balanced', rng: S.mulberry32((n * 7919 + 11) >>> 0),
    });
    const H = rc.race.horses[0];
    let g = 0;
    while (!rc.race.finished && g++ < 400000) {
      rc.step(1 / 30);
      if (H.stage !== '耐力') { depletes.push(H.s); break; }
    }
  }
  if (!depletes.length) return null;
  depletes.sort((a, b) => a - b);
  return depletes[Math.floor(depletes.length / 2)];   // 中位数
}

const rule = () => console.log('─'.repeat(72));
const pcErr = (got, nom) => ((got - nom) / nom * 100);

console.log('');
console.log('可跑距离模型验证：耐力 × ' + BASE_RANGE + ' 米（真实 8 匹马比赛）');
rule();
console.log('条件：平坦赛道、其余 7 匹为基准值、记录耐力耗尽的里程中位数');
console.log('');

let pass1 = true;
console.log('【① 基础标定（良地 / 力量70 / 无疲劳）】');
console.log('  耐力   名义可跑   实测耗尽点   误差');
[50, 70, 80, 90, 100].forEach((v) => {
  const nom = v * BASE_RANGE;
  const got = measure(v, 70, '良', 0);
  if (got === null) { console.log('  ' + String(v).padStart(3) + '   ' + String(nom).padStart(6) + 'm   未耗尽'); pass1 = false; return; }
  const e = pcErr(got, nom);
  if (Math.abs(e) > 12) pass1 = false;
  console.log('  ' + String(v).padStart(3) + '   ' + String(nom).padStart(6) + 'm   ' +
    String(Math.round(got)).padStart(6) + 'm   ' + (e >= 0 ? '+' : '') + e.toFixed(1) + '%');
});
console.log('');

let pass2 = true;
console.log('【② 场地影响（耐力70 / 力量70）】');
console.log('  场地    修正     名义可跑   实测耗尽点   误差');
['良', '稍重', '重', '不良'].forEach((st) => {
  const coef = S.rangeCoef(st, 70, 0);
  const nom = 70 * BASE_RANGE * coef;
  const got = measure(70, 70, st, 0);
  if (got === null) { console.log('  ' + st.padEnd(4) + '  ' + coef.toFixed(3) + '   ' + String(Math.round(nom)).padStart(6) + 'm   未耗尽'); pass2 = false; return; }
  const e = pcErr(got, nom);
  if (Math.abs(e) > 12) pass2 = false;
  console.log('  ' + st.padEnd(4) + '  ' + coef.toFixed(3) + '   ' + String(Math.round(nom)).padStart(6) + 'm   ' +
    String(Math.round(got)).padStart(6) + 'm   ' + (e >= 0 ? '+' : '') + e.toFixed(1) + '%');
});
console.log('');

let pass3 = true;
console.log('【③ 力量影响（耐力70）—— 良地应无差别、烂地应拉开】');
console.log('  场地    力量50     力量70     力量90    极差');
['良', '重', '不良'].forEach((st) => {
  const g = [50, 70, 90].map((p) => measure(70, p, st, 0));
  if (g.some((x) => x === null)) { console.log('  ' + st.padEnd(4) + '  有未耗尽样本'); pass3 = false; return; }
  const spread = Math.max.apply(null, g) - Math.min.apply(null, g);
  if (st === '良' && spread > 120) pass3 = false;
  if (st === '不良' && spread < 50) pass3 = false;
  console.log('  ' + st.padEnd(4) + '  ' + g.map((x) => String(Math.round(x)).padStart(6) + 'm').join('  ') +
    '  ' + String(Math.round(spread)).padStart(4) + 'm');
});
console.log('');

console.log('【④ 疲劳影响（耐力70 / 力量70 / 良地）】');
console.log('  疲劳    修正     名义可跑   实测耗尽点');
[0, 50, 100].forEach((f) => {
  const coef = S.rangeCoef('良', 70, f);
  const nom = 70 * BASE_RANGE * coef;
  const got = measure(70, 70, '良', f);
  console.log('  ' + String(f).padStart(3) + '   ' + coef.toFixed(3) + '   ' + String(Math.round(nom)).padStart(6) +
    'm   ' + (got === null ? '  未耗尽' : String(Math.round(got)).padStart(6) + 'm'));
});
console.log('');

rule();
console.log('结论');
rule();
console.log('  ① 基础标定  ' + (pass1 ? '✅ 实测耗尽点与 耐力×32 一致' : '❌ 偏差超过 12%'));
console.log('  ② 场地修正  ' + (pass2 ? '✅ 实际生效' : '❌ 偏差超过 12%'));
console.log('  ③ 力量影响  ' + (pass3 ? '✅ 良地无差别、烂地拉开' : '❌ 未按预期'));
console.log('');
console.log('注：名次与碰撞会带来个体差异，故取中位数；' +
  '未耗尽指该马跑完 ' + RUN_LEN + 'm 仍有耐力。');
console.log('');
