#!/usr/bin/env node
/* 检查小地图代表点：① 是否落在"赛道环"的环带内 ② 是否落在深色面板矩形内。
   几何完全复刻 index.html 小地图那一段。 */
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', 'sim.js'));

const L = 2000, W = 1100;
const geo = S.trackGeometry(L);
const { R, S: St } = geo;
const dir = '左回';

const mmScale = Math.min(150 / (St / 2 + R + 10), 88 / (R + 10));
const mmHalfW = (St / 2 + R + 10) * mmScale, mmHalfH = (R + 10) * mmScale;
const mmCx = W - 14 - mmHalfW, mmCy = 14 + mmHalfH;
const mmx = (x) => mmCx + x * mmScale, mmy = (y) => mmCy - y * mmScale;
const ohw2 = St / 2 + 10, ohh2 = R + 10, ihw2 = St / 2 - 10, ihh2 = R - 10;
const DOT_R = 2.5;

/* 到圆角矩形边界的有符号距离：正=在外，负=在内 */
function sdRound(x, y, hw, hh, r) {
  const cs = Math.min(r, Math.min(hw, hh));
  const qx = Math.abs(x) - (hw - cs), qy = Math.abs(y) - (hh - cs);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - cs;
}

/* 页面用到的小地图参数（用于判断点是否落在面板矩形内） */
const panelL = mmx(-ohw2) - 4, panelR = mmx(ohw2) + 4;
const panelT = mmy(ohh2) - 16, panelB = mmy(-ohh2) + 12;

console.log('赛道 R=%s St=%s', R.toFixed(1), St.toFixed(1));
console.log('mmScale=%s  外环半尺寸(%s,%s)  内环半尺寸(%s,%s)',
  mmScale.toFixed(4), ohw2.toFixed(1), ohh2.toFixed(1), ihw2.toFixed(1), ihh2.toFixed(1));
console.log('面板矩形 x∈[%s,%s] y∈[%s,%s]', panelL.toFixed(0), panelR.toFixed(0), panelT.toFixed(0), panelB.toFixed(0));
console.log('绿环矩形 x∈[%s,%s] y∈[%s,%s]', mmx(-ohw2).toFixed(0), mmx(ohw2).toFixed(0), mmy(ohh2).toFixed(0), mmy(-ohh2).toFixed(0));
console.log();

const field = S.makeField(S.mulberry32(186), { n: 8, strongIndex: 2, playerIndex: 2, level: 70 });
const r = S.createRace(field, { length: L, surface: '草地', state: '良', profile: '缓坂',
  styleCoefs: 'balanced', rng: S.mulberry32((186 ^ 0x9e3779b9) >>> 0) });
const snapNow = () => r.state().horses.filter((h) => !h.dnf).map((h) => ({ name: h.name, s: h.s, t: h.t }));

function check(label, horses) {
  console.log('【' + label + '】   (不夹取，按自然位置绘制)');
  let bad = 0;
  horses.forEach((h) => {
    const q = S.trackPoint(Math.max(0, Math.min(L, h.s)), h.t, geo, dir);
    const sx = mmx(q.x), sy = mmy(q.y);
    const dOut = sdRound(q.x, q.y, ohw2, ohh2, R + 10);      // 环外沿
    const dIn = sdRound(q.x, q.y, ihw2, ihh2, Math.max(1 / mmScale, R - 10)); // 环内沿
    const fitOut = -dOut * mmScale >= DOT_R;   // 点完全在外沿之内
    const fitIn = dIn * mmScale >= DOT_R;      // 点完全在内沿之外
    const inPanel = sx >= panelL && sx <= panelR && sy >= panelT && sy <= panelB;
    const ok = fitOut && fitIn && inPanel;
    if (!ok) bad++;
    console.log('  %s 轨迹(%s,%s) 屏幕(%s,%s)  外沿余量%spx 内沿余量%spx 面板内:%s  %s',
      h.name.padEnd(6), q.x.toFixed(0).padStart(5), q.y.toFixed(0).padStart(5),
      sx.toFixed(0).padStart(4), sy.toFixed(0).padStart(4),
      (-dOut * mmScale).toFixed(1).padStart(6), (dIn * mmScale).toFixed(1).padStart(5),
      inPanel ? '是' : '否', ok ? '✅' : '❌');
  });
  console.log('  → ' + (bad === 0 ? '全部在环带内且完整可见' : bad + ' 个点有问题'));
  console.log();
  return bad;
}

r.step(1 / 30);
let bad = check('发车', snapNow());
for (let i = 0; i < 3930; i++) r.step(1 / 30);
bad += check('冲线', snapNow());
console.log(bad === 0 ? '✅ 结论：自然位置本来就落在环带内，不需要夹取' : '❌ 仍有 ' + bad + ' 个点有问题');
process.exit(bad === 0 ? 0 : 1);
