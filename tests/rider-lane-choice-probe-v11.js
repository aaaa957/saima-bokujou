// 骑手车道选择探针：把某一匹马在某段时间内的【全部候选及其得分分项】打出来，
// 看清"回内栏"这条路到底输在哪里（被挡死？还是算下来不划算？预测是否提前中止？）。
// 做法：给 sim.js 打补丁写到临时文件，不改仓库文件。
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const root = path.join(__dirname, '..');
let src = fs.readFileSync(path.join(root, 'sim.js'), 'utf8');
function sub(a, b, tag) { if (!src.includes(a)) throw new Error('锚点缺失: ' + tag); src = src.replace(a, b); }

// 1) 候选评分后记录分项，并把全体候选落盘
sub(
  `        if(c.conflict||!f.energyFeasible)c.score=-Infinity;
      }
      const viable=candidates.filter(c=>Number.isFinite(c.score));
      let chosen=viable.sort((a,b)=>b.score-a.score)[0]||baseline;`,
  `        if(c.conflict||!f.energyFeasible)c.score=-Infinity;
        c.diag={routeBenefit,positionGain,changeCost,netEnergy,refEnergy,
          endpointS:f.endpoint.s,refS:ref.endpoint.s,conflict:!!c.conflict,
          energyOK:!!f.energyFeasible,complete:!!f.complete,steps:f.steps};
      }
      const viable=candidates.filter(c=>Number.isFinite(c.score));
      let chosen=viable.sort((a,b)=>b.score-a.score)[0]||baseline;
      if(globalThis.__CAND&&H.gate===globalThis.__GATE&&race.t>=globalThis.__T0&&race.t<=globalThis.__T1){
        globalThis.__CAND.push({t:+race.t.toFixed(2),at:+H.t.toFixed(2),holdT:+holdT.toFixed(2),
          cands:candidates.map(c=>({mode:c.mode,targetT:+(c.t??0).toFixed(2),score:+c.score.toFixed(2),...(c.diag||{})})),
          chosen:chosen.mode,chosenT:+(chosen.t??0).toFixed(2)});
      }`, 'candidate-dump');

// 2) 冲突来源计数
sub(
  `          if(!result.trafficFeasible){trafficFeasible=false;pathConflict=true;}`,
  `          if(!result.trafficFeasible){trafficFeasible=false;pathConflict=true;if(globalThis.__WHY)globalThis.__WHY.traffic=(globalThis.__WHY.traffic||0)+1;}`,
  'why-traffic');
sub(
  `if(projectionBodySweep(local,observed.h,result.before,observed.before,result.move,observed.move))pathConflict=true;`,
  `if(projectionBodySweep(local,observed.h,result.before,observed.before,result.move,observed.move)){pathConflict=true;if(globalThis.__WHY)globalThis.__WHY.sweep=(globalThis.__WHY.sweep||0)+1;}`,
  'why-sweep');

const f = path.join(os.tmpdir(), 'lane_choice_probe.js');
fs.writeFileSync(f, src);
const S = require(f);

const DT = 1 / 30, N = 14, SEED = 20261005;
const GATE = Number(process.env.PROBE_GATE || 14);

const field = [];
for (let i = 0; i < N; i++) field.push(S.makeHorse(S.mulberry32(SEED + i * 7919), {
  id: 'h' + i, name: 'h' + i, level: 86, surface: '草地', special: '左右皆可',
  jockeyGrade: '优秀', '斗志': 50, '疲劳': 0, bodyMass: 480, carriedWeight: 57,
  physiology: S.neutralPhysiology(),
}));

const race = S.createRace(field, { length: 1200, profile: '平坦', rng: S.mulberry32(SEED) });
globalThis.__CAND = []; globalThis.__WHY = {};
globalThis.__GATE = GATE; globalThis.__T0 = 2; globalThis.__T1 = 16;
let g = 0;
while (!race.race.finished && g++ < 600000) race.step(DT);

const zh = { start: '起步', 'start-position': '起步抢位', settle: '稳态', route: '变道', position: '抢位', attack: '发力', follow: '跟跑', 'wait-route': '收力让路' };
console.log(`=== 闸位 ${GATE}（最外）的骑手决策 @1200m ===`);
console.log(`冲突来源计数（本次比赛全程）：trafficFeasible=false ${globalThis.__WHY.traffic || 0} 次，身体扫掠相交 ${globalThis.__WHY.sweep || 0} 次`);
const rows = globalThis.__CAND;
console.log(`决策样本 ${rows.length} 次（t=2..16s）\n`);
for (const r of rows.slice(0, 6)) {
  console.log(` t=${r.t}s  本马车道 ${r.at}  → 选中【${zh[r.chosen] || r.chosen}】目标 ${r.chosenT}`);
  for (const c of r.cands) {
    const gain = (c.endpointS ?? 0) - (c.refS ?? 0);
    console.log(`    ${(zh[c.mode] || c.mode).padEnd(6)} 车道${String(c.targetT).padStart(6)} 总分${String(c.score).padStart(10)}` +
      ` | 进度差${gain.toFixed(1).padStart(8)} 车道收益${(c.routeBenefit ?? 0).toFixed(2).padStart(6)}` +
      ` 位置收益${(c.positionGain ?? 0).toFixed(2).padStart(6)} 变更${(c.changeCost ?? 0).toFixed(2)}` +
      ` | 预测完成=${c.complete} 步数=${c.steps} 冲突=${c.conflict} 能量可行=${c.energyOK}`);
  }
}
