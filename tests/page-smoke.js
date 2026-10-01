#!/usr/bin/env node
/* 全页冒烟测试：用 stub DOM 加载 index.html 的完整内联脚本，
 * 验证 ① 启动不报错 ② 四个模式切换正常 ③ 多场模拟在完整页面里跑得通 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
const S = require(path.join(repo, 'sim.js'));

const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const allIds = new Set([...html.matchAll(/id="([A-Za-z0-9_]+)"/g)].map((m) => m[1]));

/* ---- stub DOM ---- */
const els = {};
function ctx2d() {
  const noop = () => {};
  return {
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '', lineWidth: 1,
    globalAlpha: 1, canvas: null,
    fillRect: noop, strokeRect: noop, clearRect: noop, fillText: noop, strokeText: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, rect: noop,
    fill: noop, stroke: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    scale: noop, setTransform: noop, drawImage: noop, measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: noop }), quadraticCurveTo: noop,
    bezierCurveTo: noop, ellipse: noop, setLineDash: noop, clip: noop,
  };
}
function mkEl(id) {
  const listeners = {};
  return {
    id, value: '', innerHTML: '', textContent: '', checked: false, disabled: false,
    style: new Proxy({}, { get: (t, k) => t[k] === undefined ? '' : t[k], set: (t, k, v) => (t[k] = v, true) }),
    dataset: {}, children: [], options: [], selectedIndex: 0, scrollTop: 0, scrollHeight: 0,
    clientWidth: 1100, clientHeight: 300, offsetWidth: 1100, offsetHeight: 300,
    width: 1100, height: 260,
    classList: {
      _s: new Set(),
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; },
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
    },
    _listeners: listeners,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatch(t, ev) { (listeners[t] || []).forEach((f) => f(ev || { target: this, preventDefault() {} })); },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    querySelector() { return mkEl('q'); }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    focus() {}, blur() {}, click() { this.dispatch('click'); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1100, height: 300, right: 1100, bottom: 300 }),
    getContext: () => { const c = ctx2d(); c.canvas = { width: 1100, height: 260 }; return c; },
    toDataURL: () => 'data:image/png;base64,',
  };
}
allIds.forEach((id) => { els[id] = mkEl(id); });

const store = {};
let rafQueue = [];
const ctxObj = {
  S, console,
  document: {
    getElementById: (id) => els[id] || (els[id] = mkEl(id)),
    querySelector: (sel) => mkEl(sel),
    querySelectorAll: () => [],
    createElement: (t) => mkEl('new-' + t),
    addEventListener() {},
    body: mkEl('body'),
    documentElement: mkEl('html'),
  },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  location: { search: '', hash: '', href: 'http://localhost/', reload() {} },
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
ctxObj.SaimaSim = S;          // 页面第 427 行：const S = window.SaimaSim
ctxObj.SaimaCareerSave = require(path.join(repo, 'career-save.js'));
ctxObj.addEventListener = () => {};
ctxObj.removeEventListener = () => {};
ctxObj.dispatchEvent = () => true;
ctxObj.window = ctxObj;
ctxObj.globalThis = ctxObj;
ctxObj.self = ctxObj;
vm.createContext(ctxObj);

let fail = 0, pass = 0;
const check = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); cond ? pass++ : fail++; };

/* ---- 1) 加载整段脚本 ---- */
console.log('【1】加载完整内联脚本');
let loadErr = null;
try {
  vm.runInContext(script + '\n;globalThis.__show = show; globalThis.__switchMode = switchMode;' +
    'globalThis.__mcStart = mcStart; globalThis.__mc = mc; globalThis.__newCareer = newCareer;' +
    'globalThis.__runAutotest = runAutotest;', ctxObj, { filename: 'page.js' });
} catch (e) { loadErr = e; }
check(!loadErr, '脚本加载无异常' + (loadErr ? ' → ' + loadErr.message : ''));
if (loadErr) { console.log(loadErr.stack); process.exit(1); }

/* 排空启动期排队的回调（requestAnimationFrame / setTimeout） */
function drain(maxRounds) {
  let rounds = 0;
  while (rafQueue.length && rounds++ < (maxRounds || 200)) {
    const q = rafQueue; rafQueue = [];
    q.forEach((fn) => { try { fn(Date.now()); } catch (e) { /* 渲染循环异常单独观察 */ } });
  }
}

/* ---- 2) 启动流程 ---- */
console.log('\n【2】启动（默认进入赌马生涯）');
let bootErr = null;
try { ctxObj.__switchMode('career'); drain(50); } catch (e) { bootErr = e; }
check(!bootErr, '启动无异常' + (bootErr ? ' → ' + bootErr.message : ''));
check(ctxObj.__mc !== undefined, 'mc 状态对象存在');
check(!!ctxObj.__mc, 'mc 已初始化');

/* ---- 3) 四个模式切换 ---- */
console.log('\n【3】四个模式切换');
for (const m of ['career', 'single', 'breed', 'multi', 'career', 'multi']) {
  let err = null;
  try { ctxObj.__switchMode(m); drain(30); } catch (e) { err = e; }
  check(!err, 'switchMode("' + m + '") 正常' + (err ? ' → ' + err.message : ''));
}

/* ---- 4) 多场模拟在完整页面里跑通 ---- */
console.log('\n【4】多场模拟（完整页面上下文，20 场/档）');
els.mcTrials.value = '20';
els.mcLength.value = '2000';
els.mcSurface.value = '草地';
let mcErr = null;
try {
  ctxObj.__mcStart();
  let guard = 0;
  while (rafQueue.length && guard++ < 200000) {
    const q = rafQueue; rafQueue = [];
    q.forEach((fn) => fn());
  }
} catch (e) { mcErr = e; }
check(!mcErr, '多场模拟全程无异常' + (mcErr ? ' → ' + mcErr.message : ''));
const mc = ctxObj.__mc;
check(mc.doc && mc.doc.n === 20, '文档原版样本 = 20（实际 ' + (mc.doc ? mc.doc.n : 'n/a') + '）');
check(mc.balanced && mc.balanced.n === 20, '平衡修正样本 = 20（实际 ' + (mc.balanced ? mc.balanced.n : 'n/a') + '）');
check(mc.gapDoc && mc.gapDoc.gaps.length === 20, '着差配对样本 = 20（实际 ' + (mc.gapDoc ? mc.gapDoc.gaps.length : 'n/a') + '）');
check(String(els.mcStyleOut.innerHTML).indexOf('<table') >= 0, '胜率表已渲染到页面');
check(String(els.mcGapOut.innerHTML).indexOf('马身') >= 0, '着差汇总已渲染到页面');
check(mc.running === false, '运行标志已复位');

/* ---- 5) 清空结果 ---- */
let resetErr = null;
try { els.btnResetMC.dispatch('click'); } catch (e) { resetErr = e; }
check(!resetErr, '「清空结果」无异常' + (resetErr ? ' → ' + resetErr.message : ''));

/* ---- 6) 引擎自检模式仍可用 ---- */
console.log('\n【5】引擎自检（原有功能未受影响）');
let atErr = null;
try { ctxObj.__runAutotest(); drain(50); } catch (e) { atErr = e; }
check(!atErr, 'runAutotest 无异常' + (atErr ? ' → ' + atErr.message : ''));
check(String(els.autotest.textContent).indexOf('自检通过') >= 0,
  '自检提示：' + String(els.autotest.textContent).slice(0, 60));

console.log('\n' + (fail === 0 ? '✅ 全部通过（' + pass + ' 项）' : '❌ ' + fail + ' 项失败 / 共 ' + (pass + fail) + ' 项'));
process.exit(fail === 0 ? 0 : 1);
