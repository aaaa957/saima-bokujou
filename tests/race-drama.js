#!/usr/bin/env node
/* ============================================================
 * 比赛观赏性体检：比赛是"展开的"还是"注定的"？
 * ------------------------------------------------------------
 * 真实赛马之所以好看，靠三件事：
 *   ① 领先交替：中途领跑者会换人
 *   ② 末段逆转：冠军常来自中后段位置，而不是全程领放
 *   ③ 悬念保留：到末段才分出名次，不是开局就定死
 * 这三条都能量化。若"开局领先者"几乎总是冠军，比赛就是游行而非竞赛。
 *
 * 用法：node tests/race-drama.js [场次] [距离]
 * ============================================================ */
'use strict';

const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const N = Number(process.argv[2]) || 200;
const DIST = Number(process.argv[3]) || 2000;
const STYLES = ['逃', '先', '差', '追'];

function runRace(seed, dist) {
  const rng = S.mulberry32(seed);
  const field = [];
  for (let i = 0; i < 8; i++) {
    const h = S.makeHorse(rng, { style: STYLES[i % 4], level: 62 + (i % 3) * 4, id: 'h' + i });
    field.push(h);
  }
  const rc = S.createRace(field, {
    length: dist, surface: '草地', state: '良', profile: '缓坂',
    styleCoefs: 'balanced', rng: S.mulberry32((seed * 31 + 7) >>> 0),
  });
  const frames = [];
  let g = 0;
  while (!rc.race.finished && g++ < 300000) {
    rc.step(1 / 30);
    if (g % 15 === 0) {
      const snap = rc.state();
      const act = snap.horses.filter((h) => !h.dnf);
      const lead = act.reduce((m, h) => (m === null || h.s > m.s ? h : m), null);
      const prog = act.length ? Math.max.apply(null, act.map((h) => h.s)) / dist : 0;
      frames.push({ prog, leadId: lead ? lead.id : null,
                    pos: snap.horses.map((h) => ({ id: h.id, s: h.s })).sort((a, b) => b.s - a.s) });
    }
  }
  return { rc, frames, dist };
}

const rule = () => console.log('─'.repeat(70));
console.log('');
console.log('比赛观赏性体检：' + DIST + 'm  ·  ' + N + ' 场');
rule();

let leadChanges = 0, changesTotal = 0;
let wireToWire = 0, winnerFromBack = 0, winnerEarlyLead = 0;
let decidedEarly = 0;      // 半程时的领先者 = 冠军
let decidedLateCount = 0;  // 末段(80%处)才确定冠军
const posAtHalf = [];      // 冠军在半程时的名次
const posAt80 = [];
let maxGapEarly = 0, maxGapLate = 0;
let finishers = 0;
let frontRunWin = [0, 0, 0, 0];
const styleIdx = { '逃': 0, '先': 1, '差': 2, '追': 3 };

for (let n = 0; n < N; n++) {
  const { rc, frames } = runRace(900001 + n * 7919, DIST);
  if (!rc.race.order.length) continue;
  finishers++;
  const winner = rc.race.order[0];
  frontRunWin[styleIdx[winner.style]]++;

  /* 领先交替次数 */
  let changes = 0, prev = null;
  frames.forEach((f) => {
    if (prev !== null && f.leadId !== prev) changes++;
    prev = f.leadId;
  });
  changesTotal += changes;
  if (changes > 0) leadChanges++;

  /* 冠军在各阶段的位置 */
  const posOf = (f, id) => {
    const i = f.pos.findIndex((p) => p.id === id);
    return i < 0 ? 99 : i + 1;
  };
  const half = frames.find((f) => f.prog >= 0.5);
  const p80 = frames.find((f) => f.prog >= 0.8);
  if (half) {
    posAtHalf.push(posOf(half, winner.id));
    if (half.leadId === winner.id) decidedEarly++;
  }
  if (p80) {
    posAt80.push(posOf(p80, winner.id));
    if (p80.leadId === winner.id) decidedLateCount++;
  }
  /* 冠军是否全程领放 */
  const firstLead = frames.length ? frames[0].leadId : null;
  if (firstLead === winner.id) winnerEarlyLead++;
  if (frames.length && frames[0].leadId === winner.id &&
      frames[frames.length - 1].leadId === winner.id && changes === 0) wireToWire++;
  /* 冠军半程时在第 4 名或更后 → 末段逆转 */
  if (half && posOf(half, winner.id) >= 4) winnerFromBack++;
}

const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pc = (x) => (x / finishers * 100).toFixed(1) + '%';

console.log('【领先交替】');
console.log('  平均每场更换领跑者 ' + (changesTotal / finishers).toFixed(1) + ' 次');
console.log('  至少换过一次领跑者的场次占比 ' + pc(leadChanges));
console.log('  全程领放（从未被超越）占比 ' + pc(wireToWire));
console.log('');
console.log('【冠军的来路】');
console.log('  发车即领跑并夺冠 ' + pc(winnerEarlyLead));
console.log('  半程时排在第 4 名或更后、最终夺冠 ' + pc(winnerFromBack));
console.log('  冠军半程名次：中位数 ' + med(posAtHalf) + '，平均 ' + avg(posAtHalf).toFixed(2));
console.log('  冠军 80% 处名次：中位数 ' + med(posAt80) + '，平均 ' + avg(posAt80).toFixed(2));
console.log('');
console.log('【悬念保留程度】');
console.log('  半程领先者就是冠军的场次 ' + pc(decidedEarly) + '  ← 越低越有悬念');
console.log('  80% 处领先者就是冠军的场次 ' + pc(decidedLateCount));
console.log('');
console.log('【跑法胜率（本场设定）】');
STYLES.forEach((s, i) => {
  console.log('  ' + s + '  ' + (frontRunWin[i] / finishers * 100).toFixed(1) + '%');
});
console.log('');
rule();
console.log('判读');
rule();
const chg = changesTotal / finishers;
const e = decidedEarly / finishers;
console.log(chg >= 1.5 ? '  ✅ 领先交替频繁，比赛是展开的' : chg >= 0.6 ? '  ⚠️ 领先交替偏少' : '  ❌ 几乎不换领跑者，像游行');
console.log(e <= 0.4 ? '  ✅ 半程领先者多数不是冠军，悬念保留到后段'
  : e <= 0.6 ? '  ⚠️ 悬念保留一般' : '  ❌ 半程就能看出冠军，缺乏悬念');
console.log('');
console.log('复现：node tests/race-drama.js ' + N + ' ' + DIST);
console.log('');
