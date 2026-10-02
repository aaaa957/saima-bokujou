#!/usr/bin/env node
/* 逐场比对：页面内 mcRace/mcMerge 与 tests/mc.js 的着差取样是否一致 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const S = require(path.join(repo, 'sim.js'));

const start = html.indexOf('/* ---------- 多场模拟（蒙特卡洛验证） ----------');
const end = html.indexOf('/* ---------- 事件绑定 ---------- */');
const mcCode = html.slice(start, end);

/* --- 页面侧实现 --- */
const els = {};
const mk = (id) => ({ id, value: '200', innerHTML: '', textContent: '', disabled: false, style: {},
  classList: { toggle() {} }, addEventListener() {}, width: 1100, height: 200,
  getContext: () => ({ fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }) });
const c = { S, console, document: { getElementById: (id) => els[id] || (els[id] = mk(id)) },
  performance: { now: () => Date.now() }, setTimeout: () => 0, clearTimeout() {},
  Math, Date, Number, String, Array, Object, JSON, parseInt, parseFloat, isNaN, isFinite };
c.$ = (id) => c.document.getElementById(id);
c.globalThis = c; c.window = c;
vm.createContext(c);
vm.runInContext(mcCode + ';globalThis.__mcRace=mcRace;globalThis.__mcField=mcField;globalThis.__mcMerge=mcMerge;' +
  'globalThis.__blank=mcBlankAcc;globalThis.__mc=mc;', c, { filename: 'mc.js' });

c.__mc.L = 2000; c.__mc.surface = '草地';

/* --- 逐场比对前 30 对 --- */
const N = Math.max(30, Number(process.argv[2]) || 30);
let diff = 0;
console.log('逐场比对（doc 档，gap 取样）：');
console.log(' i │ seed   │ 页面 gap │ mc.js gap │ 页面冠军 │ mc.js 冠军');
for (let i = 0; i < N; i++) {
  const seed = 50000 + i * 17;

  // 页面侧
  const pr = c.__mcRace(c.__mcField(seed), 'doc', seed + 3);
  let pageGap = null, pageWin = null;
  if (pr.race.finished && pr.race.order[0]) {
    pageWin = pr.race.order[0].name + ':' + (pr.race.order[0].observedStyle || pr.race.order[0].style);
    const sec = pr.race.order[1];
    if (sec && sec.gapAtWin !== null) pageGap = Math.max(0, sec.gapAtWin) / 2.4;
  }

  // CLI 侧（tests/mc.js 的 runRace 逻辑）
  const field = S.makeField(S.mulberry32(seed), { n: 8, strongIndex: 2, playerIndex: 2, level: 70 });
  const r = S.createRace(field, {
    length: 2000, surface: '草地', state: '良', profile: '缓坂',
    styleCoefs: 'doc', rng: S.mulberry32((seed + 3) ^ 0x9e3779b9),
  });
  let g = 0;
  while (!r.race.finished && g++ < 300000) r.step(1 / 30);
  let cliGap = null, cliWin = null;
  if (r.race.finished && r.race.order[0]) {
    cliWin = r.race.order[0].name + ':' + (r.race.order[0].observedStyle || r.race.order[0].style);
    const sec = r.race.order[1];
    if (sec && sec.gapAtWin !== null) cliGap = Math.max(0, sec.gapAtWin) / 2.4;
  }

  const same = (pageGap === null && cliGap === null) ||
    (pageGap !== null && cliGap !== null && Math.abs(pageGap - cliGap) < 1e-9);
  const sameWin = pageWin === cliWin;
  if (!same || !sameWin) diff++;
  if (i < 12 || !same || !sameWin) {
    console.log(' %s │ %s │ %s │ %s │ %s │ %s %s',
      String(i).padStart(2), String(seed).padEnd(6),
      (pageGap === null ? 'null' : pageGap.toFixed(6)).padStart(8),
      (cliGap === null ? 'null' : cliGap.toFixed(6)).padStart(9),
      String(pageWin).padEnd(10), String(cliWin).padEnd(10),
      (same && sameWin) ? '' : '  <<< 不一致');
  }
}
console.log('\n前 ' + N + ' 对中不一致：' + diff + ' 场');

/* 全量 200 对统计对比 */
function stats(label, gaps) {
  const a = gaps.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  const med = a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  console.log('  ' + label + ': n=' + a.length + ' 中位数=' + med.toFixed(4) +
    ' 均值=' + (a.reduce((s, x) => s + x, 0) / a.length).toFixed(4));
}
const pg = [], cg = [];
for (let i = 0; i < 200; i++) {
  const seed = 50000 + i * 17;
  const pr = c.__mcRace(c.__mcField(seed), 'doc', seed + 3);
  if (pr.race.finished && pr.race.order[0] && pr.race.order[1] && pr.race.order[1].gapAtWin !== null) {
    pg.push(Math.max(0, pr.race.order[1].gapAtWin) / 2.4);
  }
  const field = S.makeField(S.mulberry32(seed), { n: 8, strongIndex: 2, playerIndex: 2, level: 70 });
  const r = S.createRace(field, { length: 2000, surface: '草地', state: '良', profile: '缓坂',
    styleCoefs: 'doc', rng: S.mulberry32((seed + 3) ^ 0x9e3779b9) });
  let g = 0; while (!r.race.finished && g++ < 300000) r.step(1 / 30);
  if (r.race.finished && r.race.order[0] && r.race.order[1] && r.race.order[1].gapAtWin !== null) {
    cg.push(Math.max(0, r.race.order[1].gapAtWin) / 2.4);
  }
}
console.log('\n200 对全量对比：');
stats('页面 mcRace ', pg);
stats('tests/mc.js', cg);
process.exit(diff === 0 ? 0 : 1);
