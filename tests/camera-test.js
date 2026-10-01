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
  let currentPath = [];
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'alphabetic', lineWidth: 1, globalAlpha: 1,
    fillRect: (x, y, w, h) => { if (rec) rec.push({ op: 'fillRect', x, y, w, h, c: ctx.fillStyle }); },
    strokeRect: noop, clearRect: noop,
    fillText: (t, x, y) => { if (rec) rec.push({ op: 'text', t: String(t).slice(0, 12), x, y, c: ctx.fillStyle, f: ctx.font }); },
    strokeText: noop,
    beginPath: () => { currentPath = []; },
    closePath: () => { currentPath.push({ op: 'closePath' }); },
    moveTo: (x, y) => { currentPath.push({ op: 'moveTo', x, y }); },
    lineTo: (x, y) => { currentPath.push({ op: 'lineTo', x, y }); },
    rect: noop,
    fill: noop, stroke: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, setTransform: noop,
    drawImage: noop, setLineDash: noop,
    clip: () => { if (rec) rec.push({ op: 'clip', path: currentPath.slice() }); },
    quadraticCurveTo: noop, bezierCurveTo: noop,
    ellipse: (x, y, rx, ry, rotation, start, end) => { currentPath.push({ op: 'ellipse', x, y, rx, ry, rotation, start, end }); },
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
ctxObj.SaimaCareerSave = require(path.join(repo, 'career-save.js'));
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
globalThis.__cam = function () { return cam; };
globalThis.__playerId = function () { return playerId; };
globalThis.__resetCamera = function () { cam = null; };`, ctxObj, { filename: 'page.js' });

/* ---- 跑一整场，逐帧渲染 ---- */
const CANVAS_W = W, CANVAS_H = H;
let fail = 0, pass = 0;
const check = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); cond ? pass++ : fail++; };

const seed = Number(process.env.CAMERA_SEED) || 186;
const distance = Number(process.env.CAMERA_DISTANCE) || 2000;
const direction = process.env.CAMERA_DIRECTION || '左回';
ctxObj.__genField(seed);
const fld = ctxObj.$('fieldTable');   // 触发 genField 内部的 field 赋值已生效
const raceObj = ctxObj.__getRace();
// genField 不建 race，这里显式建一场并跑完
const field = S.makeField(S.mulberry32(seed), { n: 8, strongIndex: 2, playerIndex: 2, level: 70 });
ctxObj.__setRace(field, { length: distance, dir: direction, surface: '草地', state: '良', profile: '缓坂',
  styleCoefs: 'balanced', rng: S.mulberry32((seed ^ 0x9e3779b9) >>> 0) });

const rc = ctxObj.__getRace();
const samples = [];
let stepCount = 0;
let stoppedAtWinner = false;
const MAX = 400000;
while (!rc.race.finished && stepCount++ < MAX) {
  rc.step(1 / 30);
  /* 冠军冲线后停止取样。
     原因是真实转播（以及本作镜头）在冠军冲线后就不再跟随后续马匹，
     落后 20 秒以上的马跑出画面属于设计预期，不是渲染缺陷。
     旧实现一直取样到"所有马都跑完"，于是把这部分算成越界帧。
     我们只对"比赛仍在进行中"的取景负责。 */
  if (rc.race.winnerTime !== null && !stoppedAtWinner) stoppedAtWinner = true;
  if (stoppedAtWinner) break;
  if (stepCount % 10 === 0) {
    const ops = [];
    recCtx = makeCtx(ops);
    ctxObj.__renderRace(performance.now());
    const cam = ctxObj.__cam();
    const view = cam.lastView;                 // 页面本帧实际使用的取景参数
    const snap = rc.state();
    samples.push({
      t: snap.t, view, bendF: cam.bendF, ops,
      horses: snap.horses.filter((h) => !h.dnf).map((h) => ({ id: h.id, s: h.s, t: h.t })),
    });
    if (RECORD) frames.push({ t: snap.t, ops });
  }
}

/* 再渲染最后一帧，专门收集小地图的圆点位置 */
MINI_ARCS = [];
recCtx = makeCtx(null);
ctxObj.__renderRace(performance.now());
const mmArcs = MINI_ARCS.slice();
MINI_ARCS = null;

console.log(distance + 'm · ' + direction + ' · seed ' + seed + ' · 比赛用时 ' + rc.race.winnerTime.toFixed(1) + 's，采样 ' + samples.length + ' 帧\n');
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

const playerId = ctxObj.__playerId();
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const close = (a, b) => Math.abs(a - b) < 1e-6;
let mainMissing = 0, glyphOutside = 0, miniOccluded = 0, labelOccluded = 0;
for (const fr of samples) {
  const arcs = fr.ops.filter((op) => op.op === 'arc');
  for (const h of fr.horses) {
    const q = fr.view.project(h.s, h.t), hs = Math.max(5.5, 8.5 * q.ps);
    const radius = h.id === playerId ? hs + 5.25 : hs;
    if (!arcs.some((a) => close(a.x, q.x) && close(a.y, q.y) && close(a.r, hs))) mainMissing++;
    const bounds = { left: q.x - radius, right: q.x + radius, top: q.y - radius, bottom: q.y + radius };
    if (bounds.left < 0 || bounds.right > W || bounds.top < 0 || bounds.bottom > H) glyphOutside++;
    if (overlaps(bounds, fr.view.miniPanel)) miniOccluded++;
  }
  for (const label of fr.ops.filter((op) => op.op === 'fillRect' && op.c === 'rgba(0,0,0,0.6)')) {
    if (overlaps({ left: label.x, right: label.x + label.w, top: label.y, bottom: label.y + label.h }, fr.view.miniPanel)) labelOccluded++;
  }
}
check(mainMissing === 0, '主镜头每帧实际绘制全部马匹圆点（缺失 ' + mainMissing + '）');
check(glyphOutside === 0, '完整圆点与玩家光圈都在画布内（越界 ' + glyphOutside + '）');
check(miniOccluded === 0 && labelOccluded === 0, '小地图不遮挡主镜头的马匹或马名（圆点 ' + miniOccluded + '，标签 ' + labelOccluded + '）');

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
  const G = S.trackGeometry(distance), halfWidth = S.TRACK_WIDTH / 2;
  const St = G.S, R = G.R, ao = St / 2 + R + halfWidth, bo = R + halfWidth;
  // 用页面自己暴露的小地图几何，避免两边各算一套导致误判
  const mv = samples[samples.length - 1].view.mini;
  if (!mv) { check(false, '页面未暴露小地图几何（cam.lastView.mini）'); }
  const mmScale = mv.mmScale, cx = mv.mmCx, cyy = mv.mmCy;
  const halfW = ao * mmScale, halfH = bo * mmScale;
  const box = { x0: cx - halfW, x1: cx + halfW, y0: cyy - halfH, y1: cyy + halfH };
  /* 只取小地图里的代表点。
     不能用"x > 画布宽*0.8"这类阈值筛选：主视图图例的圆点实测落在 x≈896，
     与小地图区域（中心 936、半宽 147）重叠，会被误当成小地图圆点，
     于是报出"代表点在赛道外"的假失败。
     也不能靠 strokeStyle 判别——mock 的 strokeStyle 初始值是 '#000000'（真值），
     判断 !a.stroke 会把所有点都排除掉。
     实测判别方式：小地图圆点满足 到中心距离≈95px 且 r<=3.5（马 2.5 / 玩家 3.5）；
     主视图图例是 r>=5.5 且距离>=101px。 */
  const dots = mmArcs.filter((a) => a.r > 0 && a.r <= 3.5 &&
    Math.hypot(a.x - cx, a.y - cyy) < 150);
  console.log('  小地图中心(' + cx.toFixed(0) + ',' + cyy.toFixed(0) + ') mmScale=' + mmScale.toFixed(4) +
              '，捕获 ' + dots.length + ' 个点');

  // 外沿直道与端部半圆使用相同的 R+半宽；检查完整圆，而非仅检查圆心。
  const inClip = (ux, uy, rPx) => {
    const sx = mv.clipStraight, Ho = mv.clipHalfH;
    const r = rPx / mv.mmScale;
    const outer = Math.abs(ux) <= sx
      ? Math.abs(uy) <= Ho - r
      : Math.hypot(Math.abs(ux) - sx, uy) <= Ho - r;
    return outer;
  };
  const outBand = [];
  console.log('  代表点是否完整落在赛道外轮廓内（使用各点实际半径）：');
  dots.forEach((d, i) => {
    const ux = (d.x - cx) / mmScale, uy = (cyy - d.y) / mmScale;
    const ok = inClip(ux, uy, d.r);
    if (!ok) outBand.push({ ...d, ux, uy });
    if (i < 9) {
      console.log('    #' + i + ' 赛道(' + ux.toFixed(1) + ',' + uy.toFixed(1) + ') ' + (ok ? '✅' : '❌'));
    }
  });
  check(outBand.length === 0, '代表点全部完整落在赛道轮廓内（越界 ' + outBand.length + ' 个）' +
    (outBand.length ? '，例：赛道(' + outBand[0].ux.toFixed(1) + ',' + outBand[0].uy.toFixed(1) + ')' : ''));
  check(dots.length >= 8, '8 匹马都画进了小地图（实际 ' + dots.length + ' 个）');
  check(!!mv.clipHalfH, '小地图已启用裁剪（clipHalfH=' + mv.clipHalfH + '）');
}

function completeMiniMarker(view, marker) {
  const m = view.mini;
  const ux = (marker.x - m.mmCx) / m.mmScale, uy = (m.mmCy - marker.y) / m.mmScale;
  const distanceToSpine = Math.hypot(Math.max(0, Math.abs(ux) - m.clipStraight), uy);
  return distanceToSpine + marker.markerR / m.mmScale <= m.clipHalfH + 1e-6;
}
function preciseMiniPath(ops, view) {
  const clip = ops.filter((op) => op.op === 'clip').pop();
  if (!clip || clip.path.length !== 5) return false;
  const [start, right, bottom, left, end] = clip.path, m = view.mini;
  return start.op === 'moveTo' && right.op === 'ellipse' && bottom.op === 'lineTo' && left.op === 'ellipse' && end.op === 'closePath' &&
    close(start.x, right.x) && close(start.y, right.y - right.ry) &&
    close(bottom.x, left.x) && close(bottom.y, left.y + left.ry) &&
    close(right.rx, m.clipHalfH * m.mmScale) && close(right.ry, right.rx) &&
    close(left.rx, right.rx) && close(left.ry, right.ry) &&
    close(right.start, -Math.PI / 2) && close(right.end, Math.PI / 2) &&
    close(left.start, Math.PI / 2) && close(left.end, -Math.PI / 2);
}
let miniMarkerBad = 0, miniMarkerMissing = 0, miniPathBad = 0;
for (const fr of samples) {
  if (!preciseMiniPath(fr.ops, fr.view)) miniPathBad++;
  for (const marker of fr.view.mini.markers) {
    if (!completeMiniMarker(fr.view, marker)) miniMarkerBad++;
    if (!fr.ops.some((op) => op.op === 'arc' && close(op.x, marker.x) && close(op.y, marker.y) && close(op.r, marker.r))) miniMarkerMissing++;
    if (marker.id === playerId && !fr.ops.some((op) => op.op === 'arc' && close(op.x, marker.x) && close(op.y, marker.y) && close(op.r, 5))) miniMarkerMissing++;
  }
}
check(miniMarkerBad === 0 && miniMarkerMissing === 0, '整场小地图实际绘制完整圆点及玩家光圈（裁剪 ' + miniMarkerBad + '，缺失 ' + miniMarkerMissing + '）');
check(miniPathBad === 0, '外沿直道与半圆精确连接，裁剪轮廓与真实几何一致（错误 ' + miniPathBad + '）');

// 强制最外道，并覆盖直道/弯道接点；避免仅测试终点附近的内道点。
const G = S.trackGeometry(distance);
let outerMarkerBad = 0;
for (const dir of ['左回', '右回']) {
  for (const s of [0, G.S, G.S + G.B, 2 * G.S + G.B, 2 * G.S + 2 * G.B, distance - 1]) {
    ctxObj.__setRace(field, { length: distance, dir, rng: S.mulberry32(seed) });
    const edgeRace = ctxObj.__getRace();
    edgeRace.race.horses.forEach((h, i) => { h.s = Math.min(distance - 0.01, Math.max(0, s + (i - 4) * 0.01)); h.t = S.TRACK_WIDTH - 0.7; });
    ctxObj.__resetCamera();
    const ops = []; recCtx = makeCtx(ops); ctxObj.__renderRace(performance.now());
    const view = ctxObj.__cam().lastView;
    if (!preciseMiniPath(ops, view)) outerMarkerBad++;
    for (const marker of view.mini.markers) {
      if (!completeMiniMarker(view, marker) || marker.actualLane !== S.TRACK_WIDTH - 0.7) outerMarkerBad++;
      if (!ops.some((op) => op.op === 'arc' && close(op.x, marker.x) && close(op.y, marker.y) && close(op.r, marker.r))) outerMarkerBad++;
      if (marker.id === playerId && !ops.some((op) => op.op === 'arc' && close(op.x, marker.x) && close(op.y, marker.y) && close(op.r, 5))) outerMarkerBad++;
    }
  }
}
check(outerMarkerBad === 0, '两回向与所有弯道接点的最外道圆点、玩家光圈完整可见（错误 ' + outerMarkerBad + '）');

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
