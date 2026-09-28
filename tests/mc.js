#!/usr/bin/env node
/* ============================================================
 * 赛马牧场物语 · 数值验证脚本 (Monte Carlo)
 * ------------------------------------------------------------
 * 目的：为作品集中两条数值结论提供可复现的证据
 *   ① 跑法系数失衡：文档原版系数下，追马/差马胜率被逃马压制
 *   ② 马身差距放大：文档原版下冠军-亚军着差远大于真实赛马量级
 *
 * 用法：
 *   node tests/mc.js              # 默认 200 场 / 2000 场
 *   node tests/mc.js 500 5000     # 自定义：跑法对比场次、马身对比场次
 *
 * 变量控制说明（很重要，否则跑出来的数字说明不了问题）：
 *   - 两组对比使用**完全相同**的马匹阵容（同一 field 对象）
 *     与**完全相同**的随机种子序列，唯一差异是 styleCoefs 档位。
 *   - 骑手等级固定为「普通」(JOCKEY_BONUS = 0)，排除骑手加成干扰。
 *   - 马匹疲劳固定为 0，排除疲劳影响。
 *   - 每场用 seed 派生的独立 rng，因此同一场次下两档的马匹抖动、
 *     出闸噪声完全一致，差异只来自跑法系数与平衡档的三个修正
 *     (styleCoefs / burstFactor / 属性向均值回归 0.55)。
 * ============================================================ */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

/* ---------------- 配置 ---------------- */
const STYLE_RACE_TRIALS = Number(process.argv[2]) || 200;  // 跑法对比场次
const GAP_TRIALS = Number(process.argv[3]) || 2000;        // 马身对比场次
const TIER_TRIALS = Number(process.argv[4]) || 200;        // 强马轮转：每闸位场次
const FIELD_SIZE = 8;        // 每场出马数（makeField 内部把 4 种跑法各排 2 匹）
const RACE_LENGTH = 2000;    // 比赛距离(米)
const SURFACE = '草地';
const STATE = '良';
const PROFILE = '缓坂';
const M_PER_LENGTH = 2.4;    // 1 马身 = 2.4 米（与引擎内换算一致）
const MAX_STEPS = 300000;    // 与 index.html 的守卫值一致
const DT = 1 / 30;

/* ---------------- 工具 ---------------- */
function median(arr) {
  if (!arr.length) return NaN;
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function mean(arr) {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN;
}
function pct(x, d) { return (x * 100).toFixed(d === undefined ? 1 : d) + '%'; }
function fx(x, d) { return Number(x).toFixed(d === undefined ? 2 : d); }

/* 生成一场比赛的阵容：同一 seed、同一 strongIdx，确保两档拿到同一批马。
   strongIdx 固定为 2，避免「强马随机落在某个跑法上」污染跑法胜率统计。 */
function buildField(seed) {
  return S.makeField(S.mulberry32(seed), {
    n: FIELD_SIZE,
    strongIndex: 2,
    playerIndex: 2,
    level: 70,
  });
}

/* 跑完一整场：返回 {race, dnf, winner, second, gapLengths, winnerStyle, order} */
function runRace(field, coefMode, seed) {
  const r = S.createRace(field, {
    length: RACE_LENGTH,
    surface: SURFACE,
    state: STATE,
    profile: PROFILE,
    styleCoefs: coefMode,           // 'doc' = 文档原版；'balanced' = 平衡档
    rng: S.mulberry32((seed ^ 0x9e3779b9) >>> 0),
  });
  let g = 0;
  while (!r.race.finished && g++ < MAX_STEPS) r.step(DT);
  if (!r.race.finished) return { aborted: true, steps: g };

  const order = r.race.order;                 // 按冲线顺序
  const winner = order[0] || null;
  const second = order[1] || null;
  let gapLengths = null;
  if (winner && second && second.gapAtWin !== null) {
    gapLengths = Math.max(0, second.gapAtWin) / M_PER_LENGTH;
  }
  return {
    aborted: false,
    steps: g,
    order,
    winner,
    second,
    gapLengths,
    winnerStyle: winner ? winner.style : null,
    finishers: order.length,
    dnf: r.race.dnf.length,
    winnerTime: r.race.winnerTime,
  };
}

/* ---------------- 主流程 ---------------- */

/* 1) 跑法胜率对比：n 场，每场列出四种跑法的胜率 */
function winRateByStyle(coefMode, trials) {
  const win = { 逃: 0, 先: 0, 差: 0, 追: 0 };
  const fieldCount = { 逃: 0, 先: 0, 差: 0, 追: 0 };  // 该跑法实际出马次数
  let aborted = 0, dnfRaces = 0, finishers = 0, timeSum = 0, timeN = 0;

  for (let i = 0; i < trials; i++) {
    // 固定 seed 基准 + 场次序号：与系数档位无关，两档拿到完全相同的马与噪声
    const seed = 1000 + i * 31;
    const field = buildField(seed);
    for (const h of field) fieldCount[h.style]++;

    const res = runRace(field, coefMode, seed + 7);
    if (res.aborted) { aborted++; continue; }
    if (res.dnf > 0) dnfRaces++;
    finishers += res.finishers;
    if (res.winnerTime) { timeSum += res.winnerTime; timeN++; }
    if (res.winnerStyle) win[res.winnerStyle]++;
  }

  const n = trials - aborted;
  return { win, fieldCount, n, aborted, dnfRaces, avgFinishers: finishers / Math.max(1, n), avgWinnerTime: timeSum / Math.max(1, timeN) };
}

/* 2) 马身差对比：同一批比赛在两种系数下的冠军-亚军着差中位数 */
function gapAnalysis(trials) {
  const doc = [], bal = [];
  let docDnf = 0, balDnf = 0, docAbort = 0, balAbort = 0;
  let docWinnerT = [], balWinnerT = [];

  for (let i = 0; i < trials; i++) {
    const seed = 50000 + i * 17;
    const fieldA = buildField(seed);
    const fieldB = buildField(seed);       // 同一 seed → 与 fieldA 逐项相同

    const a = runRace(fieldA, 'doc', seed + 3);
    const b = runRace(fieldB, 'balanced', seed + 3);

    if (a.aborted) docAbort++; else {
      if (a.dnf > 0) docDnf++;
      if (a.gapLengths !== null) doc.push(a.gapLengths);
      if (a.winnerTime) docWinnerT.push(a.winnerTime);
    }
    if (b.aborted) balAbort++; else {
      if (b.dnf > 0) balDnf++;
      if (b.gapLengths !== null) bal.push(b.gapLengths);
      if (b.winnerTime) balWinnerT.push(b.winnerTime);
    }
  }

  return {
    doc: { gaps: doc, dnf: docDnf, aborted: docAbort, median: median(doc), mean: mean(doc), max: Math.max.apply(null, doc), min: Math.min.apply(null, doc), times: docWinnerT },
    bal: { gaps: bal, dnf: balDnf, aborted: balAbort, median: median(bal), mean: mean(bal), max: Math.max.apply(null, bal), min: Math.min.apply(null, bal), times: balWinnerT },
  };
}

/* 3) 强马落点影响：strongIndex 轮转覆盖全部 8 个闸位。
   第 1、2 节把 strongIndex 固定在第 3 闸位，是为了把"跑法系数"这一个变量
   单独隔离出来；但真实比赛里那匹 +5 属性的强马会落在随机闸位上，而闸位本身
   又对应不同跑法（makeField 按 逃/先/差/追/先/差/追/随机 排列）。所以这一节
   让强马轮转，测的是"跑法系数 + 强马落点"共同作用后的端到端结果。 */
function tierRotation(trialsPerSlot) {
  const out = {};
  for (const mode of ['doc', 'balanced']) {
    const win = { 逃: 0, 先: 0, 差: 0, 追: 0 };
    let total = 0, aborted = 0;
    for (let si = 0; si < FIELD_SIZE; si++) {
      for (let i = 0; i < trialsPerSlot; i++) {
        const seed = 2000 + si * 100000 + i * 31;
        const field = S.makeField(S.mulberry32(seed), {
          n: FIELD_SIZE, strongIndex: si, level: 70,
        });
        const res = runRace(field, mode, seed + 7);
        if (res.aborted) { aborted++; continue; }
        if (res.winnerStyle) { win[res.winnerStyle]++; total++; }
      }
    }
    out[mode] = { win, total, aborted };
  }
  return out;
}

/* ---------------- 输出 ---------------- */
const line = (s) => console.log(s);
const rule = () => line('─'.repeat(72));

line('');
line('赛马牧场物语 · 数值验证（Monte Carlo）');
rule();
line('引擎版本  : sim.js (赛马牧场物语 Demo · 比赛模拟引擎 v0.1)');
line('对比变量  : styleCoefs = "doc"（文档原版） vs "balanced"（平衡档）');
line('控制变量  : 相同马匹阵容 / 相同随机种子 / 骑手固定「普通」/ 疲劳 0');
line('比赛设定  : ' + RACE_LENGTH + 'm ' + SURFACE + '・' + STATE + '・' + PROFILE + '・8 匹出马（4 种跑法各 2 匹）');
line('');

/* ── ① 跑法胜率 ── */
line('【① 跑法胜率对比】每个档位 ' + STYLE_RACE_TRIALS + ' 场');
rule();
const A = winRateByStyle('doc', STYLE_RACE_TRIALS);
const B = winRateByStyle('balanced', STYLE_RACE_TRIALS);

line('跑法    文档原版胜率        平衡档胜率        理想值');
for (const st of ['逃', '先', '差', '追']) {
  line(
    st + '      ' +
    pct(A.win[st] / Math.max(1, A.n)).padEnd(20) +
    pct(B.win[st] / Math.max(1, B.n)).padEnd(18) +
    '25.0%'
  );
}
line('');
line('（有效场次：文档原版 ' + A.n + ' / 平衡档 ' + B.n + '，异常中断 ' + (A.aborted + B.aborted) + ' 场）');
line('  文档原版：胜率极差 ' + pct((Math.max.apply(null, Object.values(A.win)) - Math.min.apply(null, Object.values(A.win))) / Math.max(1, A.n)));
line('  平衡档  ：胜率极差 ' + pct((Math.max.apply(null, Object.values(B.win)) - Math.min.apply(null, Object.values(B.win))) / Math.max(1, B.n)));
line('  完赛率  ：文档原版 ' + fx(A.avgFinishers, 2) + '/8，竞走中止 ' + A.dnfRaces + ' 场；平衡档 ' + fx(B.avgFinishers, 2) + '/8，竞走中止 ' + B.dnfRaces + ' 场');
line('  冠军均时：文档原版 ' + fx(A.avgWinnerTime, 2) + 's；平衡档 ' + fx(B.avgWinnerTime, 2) + 's');
line('');

/* ── ② 马身差 ── */
line('【② 冠军-亚军 着差（马身）对比】' + GAP_TRIALS + ' 场配对比赛（同一批马、同一随机种子）');
rule();
const G = gapAnalysis(GAP_TRIALS);

function gapBlock(label, d) {
  line(label + '（n = ' + d.gaps.length + ' 场有效着差）');
  line('  中位数 : ' + fx(d.median, 2) + ' 马身');
  line('  平均值 : ' + fx(d.mean, 2) + ' 马身');
  line('  最大/最小 : ' + fx(d.max, 2) + ' / ' + fx(d.min, 2) + ' 马身');
  line('  冠军均时 : ' + fx(mean(d.times), 2) + 's');
  line('  竞走中止 : ' + d.dnf + ' 场；异常中断 : ' + d.aborted + ' 场');
}
gapBlock('▸ 文档原版系数', G.doc);
line('');
gapBlock('▸ 平衡档系数', G.bal);
line('');
line('  中位数变化：' + fx(G.doc.median, 2) + ' → ' + fx(G.bal.median, 2) + ' 马身（' +
  (G.bal.median < G.doc.median ? '收敛' : '放大') + ' ' +
  fx(Math.abs(G.doc.median - G.bal.median) / Math.max(0.01, G.doc.median) * 100, 1) + '%）');
line('');

/* ── ③ 强马落点影响 ── */
line('【③ 强马（tier +5）落点影响】strongIndex 轮转 0~7，每档每闸位 ' + TIER_TRIALS + ' 场');
rule();
const T = tierRotation(TIER_TRIALS);
for (const mode of ['doc', 'balanced']) {
  const t = T[mode];
  const wins = Object.values(t.win);
  const spread = (Math.max.apply(null, wins) - Math.min.apply(null, wins)) / Math.max(1, t.total);
  line((mode === 'doc' ? '文档原版' : '平衡档  ') + '（n = ' + t.total + '）');
  line('  胜率：' + ['逃', '先', '差', '追'].map(st => st + ' ' + pct(t.win[st] / Math.max(1, t.total))).join('   ') +
    '   极差 ' + pct(spread));
}
line('');
line('  ※ 第①②节把强马固定在第 3 闸位（= 逃），用于隔离"跑法系数"这一个变量；');
line('    本节让强马轮转，测的是"跑法系数 + 强马落点"共同作用后的端到端结果。');
line('');

/* ── 结论 ── */
rule();
line('结论摘要');
rule();
line('① 跑法平衡（隔离变量）：文档原版胜率极差 ' +
  pct((Math.max.apply(null, Object.values(A.win)) - Math.min.apply(null, Object.values(A.win))) / Math.max(1, A.n)) +
  ' → 平衡档 ' +
  pct((Math.max.apply(null, Object.values(B.win)) - Math.min.apply(null, Object.values(B.win))) / Math.max(1, B.n)));
line('② 着差量级（配对对比）：文档原版冠军-亚军着差中位数 ' + fx(G.doc.median, 2) +
  ' 马身 → 平衡档 ' + fx(G.bal.median, 2) + ' 马身，收敛 ' +
  fx((G.doc.median - G.bal.median) / Math.max(0.01, G.doc.median) * 100, 1) + '%');
line('③ 端到端（强马轮转）：文档原版极差 ' +
  pct((Math.max.apply(null, Object.values(T.doc.win)) - Math.min.apply(null, Object.values(T.doc.win))) / Math.max(1, T.doc.total)) +
  ' → 平衡档 ' +
  pct((Math.max.apply(null, Object.values(T.balanced.win)) - Math.min.apply(null, Object.values(T.balanced.win))) / Math.max(1, T.balanced.total)));
line('');
line('复现方式：node tests/mc.js ' + STYLE_RACE_TRIALS + ' ' + GAP_TRIALS + ' ' + TIER_TRIALS);
line('（脚本与本目录同级，引擎依赖 ../sim.js，Node 端通过 module.exports 引入）');
line('');
