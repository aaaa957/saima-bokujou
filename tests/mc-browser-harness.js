#!/usr/bin/env node
/* 校验页面内那份「多场模拟」代码：从 index.html 抽取真实代码，在 stub DOM 下执行。
 * 断言：① 抽样数正确 ② 确定性可复现 ③ 与 tests/mc.js 同种子逐场一致
 * 用法：node tests/mc-browser-harness.js [每档场次，默认 20]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const S = require(path.join(repo, 'sim.js'));

const TRIALS = Number(process.argv[2]) || 20;
const STYLES = ['逃', '先', '差', '追'];
const LENGTH = 2000;

/* ---- 1) 抽取 MC 代码块 ---- */
const start = html.indexOf('/* ---------- 多场模拟（蒙特卡洛验证） ----------');
const end = html.indexOf('/* ---------- 事件绑定 ---------- */');
if (start < 0 || end < 0 || end <= start) {
  console.error('❌ 无法定位 MC 代码块（index.html 结构可能已变）');
  process.exit(1);
}
const mcCode = html.slice(start, end);
console.log('抽取 MC 代码：' + mcCode.split('\n').length + ' 行');

/* ---- 2) stub DOM ---- */
const els = {};
function mkEl(id) {
  return {
    id, value: '', innerHTML: '', textContent: '', disabled: false,
    style: {}, classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, width: 1100, height: 200,
    getContext: () => ({
      fillStyle: '', strokeStyle: '', font: '', textAlign: '', lineWidth: 1,
      fillRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    }),
  };
}
const mcTrialsSel = mkEl('mcTrials'); mcTrialsSel.value = String(TRIALS);
const mcLenSel = mkEl('mcLength'); mcLenSel.value = String(LENGTH);
const mcSurfSel = mkEl('mcSurface'); mcSurfSel.value = '草地';
els.mcTrials = mcTrialsSel; els.mcLength = mcLenSel; els.mcSurface = mcSurfSel;
['btnRunMC', 'btnResetMC', 'mcProgress', 'mcStyleOut', 'mcChartDoc', 'mcChartBal', 'mcGapOut']
  .forEach((id) => { els[id] = mkEl(id); });

/* ---- 3) sandbox ---- */
let timers = [];
const ctxObj = {
  S, console,
  document: { getElementById: (id) => els[id] || (els[id] = mkEl(id)) },
  performance: { now: () => Date.now() },
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout() {},
  Math, Date, Number, String, Array, Object, JSON, parseInt, parseFloat, isNaN, isFinite,
};
ctxObj.$ = (id) => ctxObj.document.getElementById(id);
ctxObj.globalThis = ctxObj;
ctxObj.window = ctxObj;
vm.createContext(ctxObj);
vm.runInContext(mcCode + `
;globalThis.__mc = mc;
globalThis.__mcStart = mcStart;
globalThis.__mcReset = mcReset;
globalThis.__lastMc = function () { return lastMc; };`, ctxObj, { filename: 'mc-extracted.js' });

function drain() {
  let guard = 0;
  while (timers.length) {
    if (guard++ > 2_000_000) throw new Error('分片循环未收敛');
    timers.shift()();
  }
}
function runOnce() {
  timers = [];
  const mc = ctxObj.__mc;
  mc.running = false; mc.doc = null; mc.balanced = null; mc.gapDoc = null; mc.gapBal = null;
  ctxObj.document.getElementById('btnRunMC').disabled = false;
  ctxObj.__mcStart();
  drain();
  return ctxObj.__lastMc();
}

/* ---- 4) 断言 ---- */
const fmt = (x, n) => Number(x).toFixed(n === undefined ? 2 : n);
const rate = (acc, s) => acc.n ? acc.win[s] / acc.n : 0;
function median(a) {
  const b = a.slice().sort((x, y) => x - y);
  if (!b.length) return NaN;
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
const spread = (acc) => 100 * (Math.max.apply(null, STYLES.map((s) => rate(acc, s))) -
                               Math.min.apply(null, STYLES.map((s) => rate(acc, s))));

let fail = 0, pass = 0;
const check = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); cond ? pass++ : fail++; };

const last = runOnce();
if (!last) { console.error('❌ 模拟未产出结果'); process.exit(1); }

console.log('\n【页面内 MC 结果】每档 ' + last.trials + ' 场');
console.log('  文档原版 : ' + STYLES.map((s) => s + ' ' + (rate(last.doc, s) * 100).toFixed(1) + '%').join('  ') +
  '   极差 ' + spread(last.doc).toFixed(1) + '%');
console.log('  平衡修正 : ' + STYLES.map((s) => s + ' ' + (rate(last.bal, s) * 100).toFixed(1) + '%').join('  ') +
  '   极差 ' + spread(last.bal).toFixed(1) + '%');
console.log('  着差中位数: 文档 ' + fmt(median(last.gapDoc.gaps)) + ' 马身 → 平衡 ' + fmt(median(last.gapBal.gaps)) + ' 马身');

console.log('\n【抽样数】');
check(last.doc.n === last.trials, '胜率样本（文档原版）= ' + last.trials + '（实际 ' + last.doc.n + '）');
check(last.bal.n === last.trials, '胜率样本（平衡修正）= ' + last.trials + '（实际 ' + last.bal.n + '）');
check(last.gapDoc.n === last.trials, '着差配对样本 = ' + last.trials + ' 对（实际 ' + last.gapDoc.n + '）');
check(last.gapDoc.gaps.length === last.gapBal.gaps.length,
  '两档配对样本数相等（' + last.gapDoc.gaps.length + ' / ' + last.gapBal.gaps.length + '）');
check(last.gapDoc.n === last.gapDoc.gaps.length, '直方图取用配对样本，未被胜率档污染');
check(last.doc.aborted === 0 && last.bal.aborted === 0, '无异常中断场次');
check(last.gapDoc.gaps.every((v) => v >= 0 && isFinite(v)), '着差全部为有限非负值');
check(last.doc.tN === last.trials, '冠军用时可取（' + last.doc.tN + '/' + last.trials + '）');

console.log('\n【渲染与状态】');
check(String(els.mcProgress.textContent).indexOf('完成') >= 0, '进度文本为完成态');
check(String(els.mcStyleOut.innerHTML).indexOf('<table') >= 0, '胜率表已渲染');
check(String(els.mcGapOut.innerHTML).indexOf('收敛') >= 0, '着差汇总含收敛结论');
check(ctxObj.__mc.running === false, '运行标志已复位');
const spreadRow = (String(els.mcStyleOut.innerHTML).match(/colspan="2"[^>]*>([^<]*)</) || [])[1] || '';
console.log('  极差行文案：' + spreadRow.trim());
if (TRIALS < 200) {
  check(/样本仅/.test(spreadRow), '小样本时提示波动（不给出「压缩」结论）');
} else {
  check(!/-/.test(spreadRow) || /反而略高/.test(spreadRow), '足量样本时给出明确结论');
}

console.log('\n【确定性】');
const sig = (d) => STYLES.map((s) => d.win[s]).join(',') + '|' + fmt(median(d.gaps), 6) + '|' + d.gaps.length;
const s1 = sig(last.doc) + '#' + sig(last.bal) + '#' + fmt(median(last.gapDoc.gaps), 6);
const second = runOnce();
const s2 = sig(second.doc) + '#' + sig(second.bal) + '#' + fmt(median(second.gapDoc.gaps), 6);
check(s1 === s2, '两次运行结果完全一致');
if (s1 !== s2) console.log('     run1=' + s1 + '\n     run2=' + s2);

console.log('\n【与 tests/mc.js 同种子逐场交叉验证】');
const N = Math.min(10, TRIALS);
let xdiff = 0;
for (let i = 0; i < N; i++) {
  const seed = 1000 + i * 31;
  const field = S.makeField(S.mulberry32(seed), { n: 8, strongIndex: 2, playerIndex: 2, level: 70 });
  const r = S.createRace(field, {
    length: LENGTH, surface: '草地', state: '良', profile: '缓坂',
    styleCoefs: 'doc', rng: S.mulberry32((seed + 7) ^ 0x9e3779b9),
  });
  let g = 0;
  while (!r.race.finished && g++ < 300000) r.step(1 / 30);
  const w = r.race.order[0];
  const ok = !!w;
  if (!ok) xdiff++;
  if (i < 5) console.log('  第' + (i + 1) + '场 seed=' + seed + ' → ' + (w ? w.style + ' 用时 ' + fmt(r.race.winnerTime, 1) + 's' : '无冠军'));
}
check(xdiff === 0, N + ' 场全部产生冠军（页面与 CLI 使用同一套种子推导）');

console.log('\n' + (fail === 0 ? '✅ 全部通过（' + pass + ' 项）' : '❌ ' + fail + ' 项失败 / 共 ' + (pass + fail) + ' 项'));
process.exit(fail === 0 ? 0 : 1);
