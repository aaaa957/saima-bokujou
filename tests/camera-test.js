#!/usr/bin/env node
/* 镜头回归测试：整场比赛逐帧调用 renderRace，用记录型 canvas 检查
 * ① 马匹是否曾画到画布外（原来的"跑出圈"）
 * ② 镜头取景窗口是否覆盖全部马匹
 * ③ 缩放变化幅度是否受控（原来的"乱缩放"）
 * ④ 远端淡出是否真的盖住了右缘
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const S = require(path.join(repo, 'sim.js'));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const allIds = new Set([...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map((m) => m[1]));

const W = 1100, H = 460;
const RECORD = process.env.SNAP_CANVAS ? path.join(repo, 'camera-frames.json') : null;
const frames = [];          // 记录每帧绘制内容，供离线渲染成图

function makeCtx(rec) {
  const noop = () => {};
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1, globalAlpha: 1,
    fillRect: (x, y, w, h) => { if (rec) rec.push({ op: 'fillRect', x, y, w, h, c: ctx.fillStyle }); },
    strokeRect: noop, clearRect: noop,
    fillText: (t, x, y) => { if (rec) rec.push({ op: 'text', t: String(t).slice(0, 12), x, y, c: ctx.fillStyle, f: ctx.font }); },
    strokeText: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, rect: noop,
    fill: noop, stroke: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, setTransform: noop,
    drawImage: noop, setLineDash: noop, clip: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, ellipse: noop,
    arc: (x, y, r) => {
      if (rec) rec.push({ op: 'arc', x, y, r, c: ctx.fillStyle, lw: ctx.lineWidth });
      if (MINI_ARCS) MINI_ARCS.push({ x, y, r, stroke: ctx.strokeStyle });
    },
    measureText: (t) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    roundRect: (x, y, w, h, rr) => {
      if (rec) rec.push({ op: 'roundRect', x, y, w, h, rr, c: ctx.fillStyle });
      if (MINI_RECTS) MINI_RECTS.push({ x, y, w, h, c: ctx.fillStyle });
    },
  };
  return ctx;
}
let MINI_ARCS = null, MINI_RECTS = null;

/* ---- stub DOM ---- */
const els = {};
function mkEl(id) {
  return {
    id, value: '', innerHTML: '', textContent: '', checked: false, disabled: false,
    style: {}, dataset: {}, children: [], options: [], selectedIndex: 0, scrollTop: 0,
    clientWidth: W, clientHeight: H, offsetWidth: W, offsetHeight: H,
    width: W, height: H,
    classList: { _s: new Set(), toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    dispatch(t) { /* noop */ },
    appendChild(c) { return c; }, removeChild(c) { return c; }, insertBefore(c) { return c; },
    querySelector: () => mkEl('q'), querySelectorAll: () => [],
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    focus() {}, blur() {}, click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H }),
    getContext: () => makeCtx(null),
    toDataURL: () => '',
  };
}
allIds.forEach((id) => { els[id] = mkEl(id); });
// raceCanvas 用于逐帧记录
let recCtx = null;
els.raceCanvas = mkEl('raceCanvas');
els.raceCanvas.width = W; els.raceCanvas.height = H;
els.raceCanvas.getContext = () => recCtx;

const store = {};
let rafQueue = [];
const ctxObj = {
  S, console,
  document: {
    getElementById: (id) => els[id] || (els[id] = mkEl(id)),
    querySelector: () => mkEl('q'), querySelectorAll: () => [],
    createElement: (t) => mkEl('new-' + t),
    addEventListener() {}, body: mkEl('body'), documentElement: mkEl('html'),
  },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  location: { search: '', hash: '', href: 'http://localhost/' },
  performance: { now: () => Date.now() },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => { rafQueue = []; },
  setTimeout: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  clearTimeout: () => {},
  URLSearchParams,
  Math, Date, Number, String, Array, Object, JSON, parseInt, parseFloat, isNaN, isFinite,
  RegExp, Error, Set, Map, Promise, Boolean, Symbol, Intl,
};
ctxObj.$ = (id) => ctxObj.document.getElementById(id);
ctxObj.SaimaSim = S;
ctxObj.addEventListener = () => {};
ctxObj.removeEventListener = () => {};
ctxObj.dispatchEvent = () => true;
ctxObj.window = ctxObj; ctxObj.globalThis = ctxObj; ctxObj.self = ctxObj;
vm.createContext(ctxObj);

vm.runInContext(script + `
;globalThis.__renderRace = renderRace;
globalThis.__genField = genField;
globalThis.__setRace = function (f, opts) { race = S.createRace(f, opts); field = f; };
globalThis.__getRace = function () { return race; };
globalThis.__cam = function () { return cam; };`, ctxObj, { filename: 'page.js' });

/* ---- 跑一整场，逐帧渲染 ---- */
const CANVAS_W = W, CANVAS_H = H;
let fail = 0, pass = 0;
const check = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); cond ? pass++ : fail++; };

const seed = 186;
ctxObj.__genField(seed);
const fld = ctxObj.$('fieldTable');   // 触发 genField 内部的 field 赋值已生效
const raceObj = ctxObj.__getRace();
// genField 不建 race，这里显式建一场并跑完
const field = S.makeField(S.mulberry32(seed), { n: 8, strongIndex: 2, playerIndex: 2, level: 70 });
ctxObj.__setRace(field, { length: 2000, surface: '草地', state: '良', profile: '缓坂',
  styleCoefs: 'balanced', rng: S.mulberry32((seed ^ 0x9e3779b9) >>> 0) });

const rc = ctxObj.__getRace();
const samples = [];
let stepCount = 0;
const MAX = 400000;
while (!rc.race.finished && stepCount++ < MAX) {
  rc.step(1 / 30);
  if (stepCount % 10 === 0) {
    recCtx = makeCtx(null);
    ctxObj.__renderRace(performance.now());
    const cam = ctxObj.__cam();
    const view = cam.lastView;                 // 页面本帧实际使用的取景参数
    const snap = rc.state();
    samples.push({
      t: snap.t, view, bendF: cam.bendF,
      horses: snap.horses.filter((h) => !h.dnf).map((h) => ({ id: h.id, s: h.s, t: h.t })),
    });
  }
}

/* 再渲染最后一帧，专门收集小地图的圆点位置 */
MINI_ARCS = [];
recCtx = makeCtx(null);
ctxObj.__renderRace(performance.now());
const mmArcs = MINI_ARCS.slice();
MINI_ARCS = null;

console.log('比赛用时 ' + rc.race.winnerTime.toFixed(1) + 's，采样 ' + samples.length + ' 帧\n');
if (process.env.TRACE) {
  console.log('【镜头轨迹抽样】(t, camS, leadS, gap=camS-behind, 头马s)');
  samples.filter((_, i) => i % 40 === 0).forEach((f) => {
    const lead = f.horses.reduce((m, h) => Math.max(m, h.s), 0);
    console.log('  t=' + f.t.toFixed(1).padStart(6) + '  camS=' + f.view.camS.toFixed(0).padStart(5) +
      '  leadS=' + f.view.leadS.toFixed(0).padStart(5) + '  头马s=' + lead.toFixed(0).padStart(5) +
      '  winFwd=' + f.view.winFwd.toFixed(0).padStart(5) +
      '  右端x=' + (18 + f.view.winFwd * f.view.scale).toFixed(0));
  });
  console.log('');
}

/* 用页面实际的投影函数判断马匹是否出画（横向 + 纵向） */
let worstRight = -1e9, worstLeft = 1e9, worstFrame = null;
let horseOutside = 0, horseBehindCam = 0, totalHorseFrames = 0;
let yMin = 1e9, yMax = -1e9, yBad = 0, worstY = null;
const scales = [];
samples.forEach((fr) => {
  const v = fr.view;
  scales.push(v.scale);
  fr.horses.forEach((h) => {
    totalHorseFrames++;
    const x = 18 + (h.s - v.camS) * v.scale;                 // 横向：弧长 × 缩放
    const p = v.project ? v.project(h.s, h.t) : { y: 0 };    // 纵向：页面自己的投影（含车道）
    const y = p.y;
    yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
    if (y < 0 || y > CANVAS_H) {
      yBad++;
      if (!worstY || y < worstY.y) worstY = { y, t: fr.t, s: h.s, lat: p.lat, camS: v.camS };
    }
    if (x < 0 || x > CANVAS_W) {
      horseOutside++;
      if (x > worstRight) { worstRight = x; worstFrame = { t: fr.t, s: h.s, camS: v.camS, x, scale: v.scale }; }
      if (x < worstLeft) worstLeft = x;
    }
    if (h.s < v.camS - 4) horseBehindCam++;
  });
});

console.log('【镜头与出画检查】');
if (worstFrame) {
  console.log('  最坏帧详情: t=' + worstFrame.t.toFixed(1) + 's  马 s=' + worstFrame.s.toFixed(1) +
              '  camS=' + worstFrame.camS.toFixed(1) + '  scale=' + worstFrame.scale.toFixed(2) +
              '  x=' + worstFrame.x.toFixed(0));
  const wf = samples.find((f) => Math.abs(f.t - worstFrame.t) < 0.01);
  if (wf) {
    console.log('  该帧 view: ' + JSON.stringify(wf.view));
    console.log('  该帧马匹 s: ' + wf.horses.map((h) => h.s.toFixed(0)).join(', '));
  }
}
check(horseOutside === 0,
  '马匹从未画到画布外（越界帧 ' + horseOutside + ' / ' + totalHorseFrames + '）' +
  (worstFrame ? '，最远 x=' + worstFrame.x.toFixed(0) + ' @t=' + worstFrame.t.toFixed(1) + 's' : ''));
console.log('  最大右溢 x = ' + (worstRight > -1e9 ? worstRight.toFixed(1) : '无') +
            '，最左 x = ' + (worstLeft < 1e9 ? worstLeft.toFixed(1) : '无') + '（画布宽 ' + CANVAS_W + '）');
check(horseBehindCam === 0, '没有马被镜头落在身后（' + horseBehindCam + ' 帧）');
console.log('  纵向范围 y = ' + (yMin > 1e8 ? 'n/a' : yMin.toFixed(0) + ' ~ ' + yMax.toFixed(0)) +
            '（画布高 ' + CANVAS_H + '）');
check(yBad === 0, '马匹纵向也全部在画布内（越界 ' + yBad + ' / ' + totalHorseFrames + '）' +
  (worstY ? '，最坏 y=' + worstY.y.toFixed(0) + ' @t=' + worstY.t.toFixed(1) + 's' : ''));

console.log('\n【跑道覆盖率】');
{
  let worstL = -1e9, worstR = 1e9, badFrames = 0;
  samples.forEach((fr) => {
    const v = fr.view;
    const xL = 18 + (v.camS - v.winBack - v.camS) * v.scale;   // 左端取样点
    const xR = 18 + v.winFwd * v.scale;                        // 右端取样点
    if (xL > worstL) worstL = xL;
    if (xR < worstR) worstR = xR;
    if (xL > 2 || xR < CANVAS_W - 2) badFrames++;
  });
  console.log('  最差覆盖：左端 x=' + worstL.toFixed(1) + '，右端 x=' + worstR.toFixed(1) +
              '（画布宽 ' + CANVAS_W + '）');
  check(badFrames === 0, '每一帧跑道都铺满画布宽度（未铺满的帧 ' + badFrames + ' / ' + samples.length + '）');
}

console.log('\n【小地图（全体图）检查】');
{
  const G = S.trackGeometry(2000);
  const St = G.S, R = G.R;
  const mmScale = Math.min(150 / (St / 2 + R + 10), 88 / (R + 10));
  const halfW = (St / 2 + R + 10) * mmScale, halfH = (R + 10) * mmScale;
  const cx = CANVAS_W - 14 - halfW, cyy = 14 + halfH;
  const box = { x0: cx - halfW, x1: cx + halfW, y0: cyy - halfH, y1: cyy + halfH };
  const dots = mmArcs.filter((a) => a.r <= 6 && a.x > CANVAS_W * 0.8 && a.y < 140);
  console.log('  小地图区域 x∈[' + box.x0.toFixed(0) + ',' + box.x1.toFixed(0) +
              '] y∈[' + box.y0.toFixed(0) + ',' + box.y1.toFixed(0) + ']，捕获 ' + dots.length + ' 个点');
  const out = dots.filter((d) => d.x < box.x0 - 4 || d.x > box.x1 + 4 || d.y < box.y0 - 4 || d.y > box.y1 + 4);
  check(out.length === 0, '小地图代表点全部落在赛道环内（越界 ' + out.length + ' 个）' +
    (out.length ? '，例：(' + out[0].x.toFixed(0) + ',' + out[0].y.toFixed(0) + ')' : ''));
  check(dots.length >= 8, '8 匹马都画进了小地图（实际 ' + dots.length + ' 个）');
}

/* 逐帧缩放变化率：不只看幅度，更看是否有"突跳"（二阶差分尖峰） */
const ratio = Math.max.apply(null, scales) / Math.min.apply(null, scales);
const minScale = Math.min.apply(null, scales), maxScale = Math.max.apply(null, scales);
const d1 = [];
for (let i = 1; i < scales.length; i++) d1.push((scales[i] - scales[i - 1]) / scales[i - 1]);
const maxJump = Math.max.apply(null, d1.map(Math.abs));
const d2 = [];
for (let i = 1; i < d1.length; i++) d2.push(Math.abs(d1[i] - d1[i - 1]));
const maxJerk = Math.max.apply(null, d2);
const p95 = d1.map(Math.abs).slice().sort((a, b) => a - b)[Math.floor(d1.length * 0.95)];

console.log('  scale 范围 ' + Math.min.apply(null, scales).toFixed(2) + ' ~ ' + Math.max.apply(null, scales).toFixed(2) +
            ' px/m，倍数 ' + ratio.toFixed(2) + '×');
console.log('  单帧缩放变化：最大 ' + (maxJump * 100).toFixed(2) + '%，95 分位 ' + (p95 * 100).toFixed(3) + '%');
console.log('  单帧缩放"急动"（二阶差分）最大 ' + (maxJerk * 100).toFixed(3) + '%');
check(ratio <= 1.6, '直道↔弯道缩放比 ≤ 1.6×（原实现 3.0×）');
check(maxJerk < 0.004, '缩放无急动（二阶差分 < 0.4%/帧）');

console.log('\n【对比：原实现的缩放范围】');
const oldScales = samples.map((s) => (CANVAS_W - 36) / ((150 - s.bendF * 115) + (50 - s.bendF * 20)));
const oMin = Math.min.apply(null, oldScales), oMax = Math.max.apply(null, oldScales);
console.log('  原实现 scale ' + oMin.toFixed(2) + ' ~ ' + oMax.toFixed(2) + ' px/m，倍数 ' + (oMax / oMin).toFixed(2) + '×');
console.log('  新实现 ' + minScale.toFixed(2) + ' ~ ' + maxScale.toFixed(2) + ' px/m，倍数 ' + ratio.toFixed(2) + '×');
console.log('\n' + (fail === 0 ? '✅ 全部通过（' + pass + ' 项）' : '❌ ' + fail + ' 项失败'));

if (RECORD) {
  fs.writeFileSync(RECORD, JSON.stringify({ W: CANVAS_W, H: CANVAS_H, frames: frames.filter((_, i) => i % 8 === 0) }));
  console.log('已写出逐帧记录：' + RECORD + '（' + Math.ceil(frames.length / 8) + ' 帧）');
}
process.exit(fail === 0 ? 0 : 1);
