/* ============================================================
 * 赛马风云 · 连续比赛模拟引擎 v2026.10.04.1
 * 本轮预测、骑手、阵容与联合校准：docs/比赛系统重构与联合校准-v11.md
 * 模型结构、实赛约束与验证口径：docs/比赛系统-现实拟合-v2026.10.02.1.md
 * 情报误差机制来源：《游戏策划案》4.5 情报系统
 * 运行环境：浏览器(挂载到 window.SaimaSim) / Node(require)
 * 已简化的部分（碰撞/弯道/出闸噪声）见 README.md
 * ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- 随机数 ---------------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  function weightedPick(rng, entries) {
    let total = 0;
    for (const e of entries) total += e[1];
    let r = rng() * total;
    for (const e of entries) { r -= e[1]; if (r <= 0) return e[0]; }
    return entries[entries.length - 1][0];
  }

  /* ---------------- 赛道与阶段（3.10） ---------------- */
  /* 赛道宽度（米）：物理、主视图和小地图共用此值。
     原物理宽度 11 与画面宽度 20 不一致；走位空间与弧长惩罚应分别由
     TRACK_WIDTH 和 laneBias 控制，避免用收窄跑道调节胜率。 */
  const TRACK_WIDTH = 20;
  /* 历史默认路线接口；当前跑法不绑定横向位置。 */
  const STYLE_BASE_T = { '逃': 3, '先': 3, '差': 3, '追': 3 }; // 历史接口，默认路线不按跑法区分
  const STALL_SPEED = 2;
  /* 历史进程标签兼容入口；现版界面、运动与骑乘均不使用这些百分比分段。 */
  const PHASE_DEFS = [
    { key: 'break', name: '出闸', from: 0.00, to: 0.05 },
    { key: 'open',  name: '序盘', from: 0.05, to: 0.32 },
    { key: 'mid',   name: '中盘', from: 0.32, to: 0.62 },
    { key: 'late',  name: '后盘', from: 0.62, to: 0.70 },
    { key: 'final', name: '终盘', from: 0.70, to: 1.00 },
  ];
  function phaseAt(s, length) {
    const f = length > 0 ? s / length : 0;
    for (const p of PHASE_DEFS) if (f < p.to) return p;
    return PHASE_DEFS[PHASE_DEFS.length - 1];
  }

  /* 旧调用兼容入口已经中性化；历史数值只保留在历史报告，不再能误用于比赛。 */
  const STYLE_COEF = Object.fromEntries(['逃','先','差','追'].map(style =>
    [style, Object.freeze({break:1,open:1,mid:1,late:1,final:1})]));
  const STYLE_COEF_DOC = STYLE_COEF;
  const JOCKEY_BONUS = { '新人': 0, '普通': 0, '优秀': 0, '殿堂': 0 };
  const JOCKEY_CADENCE = { '新人': 4, '普通': 2, '优秀': 1.5, '殿堂': 1 };
  /* 场地修正 */
  const FIELD_STATE_COEF = { '良': 1, '稍重': 0.98, '重': 0.95, '不良': 0.9 };
  const SURFACE_COEF = {
    '草地': { '草地': 1, '泥地': 0.92, '泥草双刀': 0.97 },
    '泥地': { '草地': 0.92, '泥地': 1, '泥草双刀': 0.97 },
  };
  /* 赛前疲劳降低可持续供能与最高能力，幅度为游戏标定值。 */
  function fatigueMultiplier(f) {
    if (f <= 25) return 1; if (f <= 50) return 0.995; if (f <= 70) return 0.985;
    if (f <= 85) return 0.97; if (f <= 100) return 0.955; return 0.94;
  }

  // 官方 A 栏周长/终点直道/高差约束的代理几何；不冒称测绘复刻。
  // 官方幅员下界用作可用宽度；没有逐米测绘的部分仍为明确标注的代理。
  const COURSES = {
    '标准': { R:120, S:420 }, '长直道': { R:140, S:540 }, '小回り': { R:95, S:310 },
    '東京芝A': { lap:2083.1, S:525.9, elevation:2.7, hill:'tokyo', venue:'東京', direction:'左回', distances:[1400,1600,1800,2000,2300,2400,2500,2600,3400] },
    '東京泥': { lap:1899, S:501.6, elevation:2.5, hill:'tokyo', venue:'東京', direction:'左回', distances:[1200,1300,1400,1600,2100,2400] },
    '中山芝内A': { lap:1667.1, S:310, elevation:5.3, hill:'nakayama', venue:'中山', direction:'右回', distances:[1800,2000,2500,3600] },
    '中山芝外A': { lap:1839.7, S:310, elevation:5.3, hill:'nakayama', venue:'中山', direction:'右回', distances:[1200,1600,2200,2600,3200,4000] },
    '中山泥': { lap:1493, S:308, elevation:4.5, hill:'nakayama', venue:'中山', direction:'右回', distances:[1000,1200,1700,1800,2400,2500] },
    '京都芝内A': { lap:1782.8, S:328.4, elevation:3.1, hill:'kyoto', venue:'京都', direction:'右回', distances:[1100,1200,1400,1600,2000] },
    '京都芝外A': { lap:1894.3, S:403.7, elevation:4.3, hill:'kyoto', venue:'京都', direction:'右回', distances:[1400,1600,1800,2000,2200,2400,3000,3200] },
    '京都泥': { lap:1607.6, S:329.1, elevation:3, hill:'kyoto', venue:'京都', direction:'右回', distances:[1000,1100,1200,1400,1800,1900,2600] },
    '阪神芝内A': { lap:1689, S:356.5, elevation:1.9, hill:'hanshin', venue:'阪神', direction:'右回', distances:[1200,1400,2000,2200,3000] },
    '阪神芝外A': { lap:2089, S:473.6, elevation:2.4, hill:'hanshin', venue:'阪神', direction:'右回', distances:[1400,1600,1800,2400,2600,3200] },
    '阪神泥': { lap:1517.6, S:352.7, elevation:1.6, hill:'hanshin', venue:'阪神', direction:'右回', distances:[1200,1400,1800,2000,2600] },
    '新潟芝内A': { lap:1623, S:358.7, elevation:0.8, hill:'niigata', venue:'新潟', direction:'左回', distances:[1200,1400,2000,2200,2400] },
    '新潟芝外A': { lap:2223, S:658.7, elevation:2.2, hill:'niigata', venue:'新潟', direction:'左回', distances:[1400,1600,1800,2000,3000,3200] },
    '新潟泥': { lap:1472.5, S:353.9, elevation:0.6, hill:'niigata', venue:'新潟', direction:'左回', distances:[1000,1200,1700,1800,2500] },
  };
  const COURSE_WIDTHS = {
    '東京芝A':[31,41], '東京泥':[25,25],
    '中山芝内A':[20,32], '中山芝外A':[24,32], '中山泥':[20,25],
    '京都芝内A':[27,38], '京都芝外A':[24,38], '京都泥':[25,25],
    '阪神芝内A':[24,28], '阪神芝外A':[24,29], '阪神泥':[22,25],
    '新潟芝内A':[25,25], '新潟芝外A':[25,25], '新潟泥':[20,20],
  };
  const VENUE_COURSE = { '東京':'東京芝A', '东京':'東京芝A', '中山':'中山芝内A', '京都':'京都芝外A', '阪神':'阪神芝外A', '新潟':'新潟芝外A', '福島':'小回り', '小倉':'小回り' };
  const COURSE_SOURCES = { '東京':'tokyo', '中山':'nakayama', '京都':'kyoto', '阪神':'hanshin', '新潟':'niigata' };
  const mod = (x, n) => ((x % n) + n) % n;
  function venueCourseKey(length,course,surface) {
    if(COURSES[course]) return course;
    const venue=course==='东京'?'東京':course;
    if(surface==='泥地' && COURSE_SOURCES[venue]) return venue+'泥';
    if(venue==='中山') return [1200,1600,2200,2600,3200,4000].includes(length)?'中山芝外A':'中山芝内A';
    if(venue==='京都') return length<=1400 || length===2000 ?'京都芝内A':'京都芝外A';
    if(venue==='阪神') return [1200,1400,2000,2200,3000].includes(length)?'阪神芝内A':'阪神芝外A';
    if(venue==='新潟') return [1200,2200,2400].includes(length)?'新潟芝内A':'新潟芝外A';
    return VENUE_COURSE[venue] || '标准';
  }
  // Quintic end controls are collinear: both tangent and curvature meet the straight continuously.
  function bezierPoint(controls,u) {
    let p=controls.map(a=>({x:a.x,y:a.y}));
    for(let n=p.length-1;n>0;n--) for(let i=0;i<n;i++) p[i]={x:p[i].x+(p[i+1].x-p[i].x)*u,y:p[i].y+(p[i+1].y-p[i].y)*u};
    return p[0];
  }
  function bendControls(a,b,extent,sign) {
    return [a,{x:a.x+sign*extent*0.12,y:a.y},{x:a.x+sign*extent,y:a.y},
      {x:b.x+sign*extent,y:b.y},{x:b.x+sign*extent*0.12,y:b.y},b];
  }
  function bendArcTable(controls,n) {
    const table=[{q:0,u:0}],previous=bezierPoint(controls,0);let before=previous,q=0;
    for(let i=1;i<=n;i++) {const u=i/n,p=bezierPoint(controls,u);q+=Math.hypot(p.x-before.x,p.y-before.y);table.push({q,u});before=p;}
    return {table,length:q};
  }
  function makeRouteBend(a,b,length,sign) {
    let lo=0.001,hi=length*2;
    for(let i=0;i<28;i++) {const mid=(lo+hi)/2,n=bendArcTable(bendControls(a,b,mid,sign),240).length;if(n<length) lo=mid;else hi=mid;}
    let extent=(lo+hi)/2;
    // Refine against the same dense arc table used for coordinate lookup.
    for(let i=0;i<4;i++) {const a0=bendArcTable(bendControls(a,b,extent,sign),4800).length,a1=bendArcTable(bendControls(a,b,extent+0.05,sign),4800).length;extent+=(length-a0)/((a1-a0)/0.05);}
    const controls=bendControls(a,b,extent,sign),arc=bendArcTable(controls,4800);
    const first=controls.slice(1).map((p,i)=>({x:5*(p.x-controls[i].x),y:5*(p.y-controls[i].y)}));
    const second=first.slice(1).map((p,i)=>({x:4*(p.x-first[i].x),y:4*(p.y-first[i].y)}));
    return {length,controls,arc:arc.table,first,second};
  }
  function pointOnBend(at,bend) {
    const table=bend.arc;let lo=0,hi=table.length-1;
    while(hi-lo>1) {const m=(lo+hi)>>1;if(table[m].q<=at) lo=m;else hi=m;}
    const a=table[lo],b=table[hi],u=a.u+(b.u-a.u)*clamp((at-a.q)/(b.q-a.q),0,1);
    const p=bezierPoint(bend.controls,u),v=bezierPoint(bend.first,u),acc=bezierPoint(bend.second,u),speed=Math.hypot(v.x,v.y);
    return {x:p.x,y:p.y,tx:v.x/speed,ty:v.y/speed,k:Math.max(0,(v.x*acc.y-v.y*acc.x)/(speed*speed*speed)),metric:speed*(b.u-a.u)/(b.q-a.q)};
  }
  const ROUTE_LOOP_CACHE=new Map();
  function makeCourseLoop(key,def) {
    if(ROUTE_LOOP_CACHE.has(key)) return ROUTE_LOOP_CACHE.get(key);
    const F=def.S,lap=def.lap;
    // Published start-to-turn distances constrain these three layouts; remaining dimensions are proxies.
    let home=F,back=F,bend2=(lap-home-back)/2;
    if(key==='東京芝A') {home=559;back=450;bend2=532.1;}
    if(key==='中山芝外A') {home=310;back=310;bend2=630;}
    if(key==='京都芝外A') {home=463.7;back=463.7;bend2=502;}
    const bend1=lap-home-back-bend2,h=Math.min(bend1,bend2)/3.1;
    const A={x:-home/2,y:-h},B={x:home/2,y:-h},C={x:back/2,y:h},D={x:-back/2,y:h};
    const first=makeRouteBend(B,C,bend1,1),last=makeRouteBend(D,A,bend2,-1);
    function at(q) {
      if(q<=home) return {x:A.x+q,y:A.y,tx:1,ty:0,k:0};
      if(q<home+bend1) return pointOnBend(q-home,first);
      if(q<=home+bend1+back) return {x:C.x-(q-home-bend1),y:C.y,tx:-1,ty:0,k:0};
      return pointOnBend(q-home-bend1-back,last);
    }
    const n=Math.ceil(lap/0.5),step=lap/n,turns=[home,home+bend1,home+bend1+back,lap];
    const nodes=[...Array.from({length:n+1},(_,i)=>i*step),...turns].sort((a,b)=>a-b);
    const stations=nodes.filter((q,i)=>!i||q-nodes[i-1]>1e-9),samples=stations.map(at);
    samples[samples.length-1]={...samples[0]};
    const loop={lap,home,back,bend1,bend2,step,stations,samples,first,last,A,C,turns};
    ROUTE_LOOP_CACHE.set(key,loop);return loop;
  }
  // Exact bracket lookup on the same immutable route stations. The metre bin
  // supplies only a search seed; the original <= comparisons locate the exact
  // cell. No query coordinate, interpolation, or floating expression is rounded.
  const ROUTE_STATION_LOOKUP_CACHE=new WeakMap();
  function routeStationLowerIndex(stations,at) {
    const last=stations.length-1,first=stations[0],end=stations[last];
    if(!Number.isFinite(at)||last<1||!Number.isFinite(first)||!Number.isFinite(end)||at<first||at>=end) {
      let lo=0,hi=last;
      while(hi-lo>1){const mid=(lo+hi)>>1;if(stations[mid]<=at)lo=mid;else hi=mid;}
      return lo;
    }
    let lookup=ROUTE_STATION_LOOKUP_CACHE.get(stations);
    if(!lookup) {
      const bins=new Uint32Array(Math.ceil(end-first));let lo=0;
      for(let bin=0;bin<bins.length;bin++) {
        const seed=first+bin;
        while(lo<last-1&&stations[lo+1]<=seed)lo++;
        bins[bin]=lo;
      }
      lookup={first,bins};ROUTE_STATION_LOOKUP_CACHE.set(stations,lookup);
    }
    let lo=lookup.bins[Math.min(lookup.bins.length-1,Math.floor(at-lookup.first))];
    while(lo>0&&stations[lo]>at)lo--;
    while(lo<last-1&&stations[lo+1]<=at)lo++;
    return lo;
  }
  function routeTablePoint(samples,step,at) {
    let i,f;
    if(Array.isArray(step)) {
      const stations=step,lo=routeStationLowerIndex(stations,at),hi=stations.length>1?lo+1:stations.length-1;
      i=lo;step=stations[hi]-stations[lo];f=clamp((at-stations[lo])/step,0,1);
    } else {
      const z=clamp(at/step,0,samples.length-1);i=Math.min(Math.floor(z),samples.length-2);f=z-i;
    }
    const a=samples[i],b=samples[i+1];
    // Quintic Hermite positions and their derivatives share the same local curve. Linear position
    // interpolation with separately interpolated normals creates artificial offset-lane speed errors.
    function component(p0,p1,v0,v1,acc0,acc1) {
      const A=p0,B=step*v0,C=0.5*step*step*acc0,p=p1-A-B-C,v=step*v1-B-2*C,acc=step*step*acc1-2*C;
      const D=10*p-4*v+0.5*acc,E=-15*p+7*v-acc,F=6*p-3*v+0.5*acc;
      return {p:((((F*f+E)*f+D)*f+C)*f+B)*f+A,
        v:((((5*F*f+4*E)*f+3*D)*f+2*C)*f+B)/step,
        a:(((20*F*f+12*E)*f+6*D)*f+2*C)/(step*step)};
    }
    const x=component(a.x,b.x,a.tx,b.tx,-a.k*a.ty,-b.k*b.ty),y=component(a.y,b.y,a.ty,b.ty,a.k*a.tx,b.k*b.tx),n=Math.hypot(x.v,y.v);
    return {x:x.p,y:y.p,tx:x.v/n,ty:y.v/n,k:Math.max(0,(x.v*y.a-y.v*x.a)/(n*n*n)),metric:n};
  }
  function loopReferencePoint(q,loop) {
    const {home,bend1,back}=loop;
    if(q<=home) return {x:loop.A.x+q,y:loop.A.y,tx:1,ty:0,k:0};
    if(q>=home+bend1&&q<=home+bend1+back) return {x:loop.C.x-(q-home-bend1),y:loop.C.y,tx:-1,ty:0,k:0};
    return routeTablePoint(loop.samples,loop.stations,q);
  }
  function makeStartChute(loop,startOffset,straight,angle) {
    // First straight and turn count are sourced; turn shape and the pocket coordinates remain proxies.
    const merge=loop.home+loop.bend1,length=mod(merge-startOffset,loop.lap),bendLength=length-straight;
    const n=Math.ceil(length/0.5),step=length/n,samples=[];let x=0,y=0;
    function thetaAt(s) {if(!angle) return Math.PI;const z=clamp((s-straight)/bendLength,0,1);return Math.PI-angle+angle*(z-Math.sin(2*Math.PI*z)/(2*Math.PI));}
    function curvatureAt(s) {if(!angle) return 0;const z=(s-straight)/bendLength;return z>0&&z<1?angle/bendLength*(1-Math.cos(2*Math.PI*z)):0;}
    for(let i=0;i<=n;i++) {const s=i*step;if(i) {const theta=thetaAt(s-step/2);x+=Math.cos(theta)*step;y+=Math.sin(theta)*step;}const theta=thetaAt(s);samples.push({x,y,tx:Math.cos(theta),ty:Math.sin(theta),k:curvatureAt(s)});}
    const join=loopReferencePoint(merge,loop),dx=join.x-x,dy=join.y-y;
    samples.forEach(p=>{p.x+=dx;p.y+=dy;});samples[n]={...join};
    return {length,straight,angle,merge,step,samples};
  }
  function routeReferencePoint(s,geo) {
    const r=geo.route;
    if(r.chute && s<r.startLength) {
      if(s<0) {const p=r.chute.samples[0];return {...p,x:p.x+s*p.tx,y:p.y+s*p.ty,k:0};}
      return routeTablePoint(r.chute.samples,r.chute.step,s);
    }
    return loopReferencePoint(mod(s+geo.startOffset,geo.lap),r.loop);
  }
  function courseElevationProfile(def,S,B,lap,loop) {
    const h=def.elevation;
    if(!h) return null;
    // 坡段位置是官方文字说明约束的近似值，不是逐米测量数据。
    if(loop && def.hill==='tokyo' && def.venue==='東京' && def.S===525.9) {
      const {home,bend1,back,bend2}=loop,backStart=home+bend1;
      return [[0,0.7],[S-460,0],[S-300,2],[S,2],[home,2.7],
        [backStart+back*0.5,0.8],[backStart+back,2.3],[lap-bend2*0.75,2.3],[lap-80,0.5],[lap,0.7]];
    }
    if(loop && def.hill==='nakayama') {
      const {home,bend1,back}=loop,peak=home+bend1-40;
      const descending=def.lap===1839.7?[[mod(S-1200,lap),4.4],[home+bend1+back,3.3]]:[[home+bend1+back,Math.min(3,h)]];
      return [[0,0],[S-180,0],[S-70,2.2],[S,2.2],...(home>S?[[home,2.2]]:[]),[peak,h],...descending,[lap,0]];
    }
    if(def.hill==='tokyo') return [[0,0.7],[S-460,0],[S-300,2],[S,2],[S+B,1.2],[2*S+B-180,1.2],[2*S+B,h],[lap,0.7]];
    if(def.hill==='nakayama') return [[0,0],[S-180,0],[S-70,2.2],[S,2.2],[S+B-40,h],[2*S+B,Math.min(3,h)],[lap,0]];
    if(def.hill==='kyoto') return [[0,0],[S,0],[S+lap-1200,0],[S+lap-800,h],[S+lap-450,0],[lap,0]];
    if(def.hill==='hanshin') {
      const rise=Math.min(1.8,h);
      return [[0,0],[S-200,0],[S-80,rise],[S,rise],[S+B,h],[2*S+B,h],[lap,0]];
    }
    return [[0,h*0.27],[S,h*0.27],[S+B,0],[2*S+B,h],[lap,h*0.27]];
  }
  function trackGeometry(length, course, surface) {
    const key=venueCourseKey(length,course,surface), def=COURSES[key], S=def.S;
    const widthRange=COURSE_WIDTHS[key]||[TRACK_WIDTH,TRACK_WIDTH],width=widthRange[0];
    const referenceLane=1.4, referenceR=def.lap?(def.lap-2*S)/(2*Math.PI):def.R+referenceLane-TRACK_WIDTH/2;
    const R=referenceR-referenceLane+width/2, B=Math.PI*referenceR, lap=def.lap || 2*S+2*B;
    const startOffset = mod(S - length, lap), boundaries = [];
    const loop=def.lap?makeCourseLoop(key,def):null;
    const straightChute=(key==='東京芝A'&&length===1600)||(key.startsWith('京都芝')&&[1600,1800].includes(length));
    const chute=key==='東京芝A'&&length===2000?makeStartChute(loop,startOffset,100,Math.PI/2):
      straightChute?makeStartChute(loop,startOffset,mod(loop.home+loop.bend1-startOffset,lap),0):null;
    for (let loop = -1; loop <= Math.ceil(length / lap) + 1; loop++) {
      const turns=def.lap?makeCourseLoop(key,def).turns:[S,S+B,2*S+B,lap];
      for (const [i,at] of turns.entries()) {
        const kind=i%2?'bendEnd':'bendStart',label=i%2?'出弯':'入弯';
        const s = loop * lap + at - startOffset;
        if (s > 0 && s < length && (!chute||s>chute.length+1e-7||(chute.angle&&s>=chute.length-1e-7))) boundaries.push({ s, kind, label });
      }
    }
    if(chute) boundaries.push(chute.angle?{s:chute.straight,kind:'bendStart',label:'引入线入弯'}:{s:chute.length,kind:'chuteMerge',label:'引入线合流'});
    boundaries.sort((a,b) => a.s-b.s);
    const official=!!def.lap, source=def.venue ? 'https://www.jra.go.jp/facilities/race/'+COURSE_SOURCES[def.venue]+'/course/index.html':null;
    const mixed=length===3200 && (def.venue==='中山'||def.venue==='阪神');
    const startLength=chute?chute.length:0,loopRaceStart=startLength+mod(-startOffset-startLength,lap);
    const route=loop?{loop,chute,startLength,loopRaceStart}:null;
    const progressBounds=geometryProgressBounds(route,referenceLane,referenceR,width);
    const displaySegments=[{kind:'loop',from:loopRaceStart,to:loopRaceStart+lap,closed:true}];
    if(chute) displaySegments.push({kind:'chute',from:0,to:startLength,closed:false});
    return { length,R,referenceR,referenceLane,B,S,lap,startOffset,width,widthRange,route,displaySegments,...progressBounds,course:key,boundaries,finishStraight:Math.min(length,S),
      venue:def.venue||null,direction:def.direction||null,surface:surface||'草地',officialLap:official?lap:null,
      elevationRange:def.elevation||0,elevationProfile:courseElevationProfile(def,S,B,lap,loop),source,
      distanceSupported:official?def.distances.includes(length):true,
      simplification:official?'官方A栏周长、终直、高差与幅员下界约束；闭合变曲率代理，过渡/宽度空间分布非测绘；东京1600/2400、中山1200、京都3000/3200首弯距有资料约束'+(chute?(length===2000?'；东京2000使用独立100m直引入线及平滑转弯':'；本距离使用直线起跑引入线，口袋位置仍为代理'):'；本距离未验证的起跑引入线仍为单圈代理')+(mixed?'；本距离混合内外圈暂以单圈代理':''):'抽象机制对照场地' };
  }
  function trackPoint(s, t, geo, dir) {
    if(geo.route) {
      const p=routeReferencePoint(s,geo),d=t-geo.referenceLane,x=p.x+d*p.ty,y=p.y-d*p.tx;
      return {x:dir==='右回'?-x:x,y};
    }
    const { R, B, S } = geo, turnR=geo.referenceR||R, q = mod(s + (geo.startOffset || 0), geo.lap || (2*S+2*B));
    const d = t - TRACK_WIDTH / 2; let x,y;
    if(q < S) { x=-S/2+q; y=-R-d; }
    else if(q < S+B) { const a=-Math.PI/2+(q-S)/turnR; x=S/2+(R+d)*Math.cos(a); y=(R+d)*Math.sin(a); }
    else if(q < 2*S+B) { x=S/2-(q-S-B); y=R+d; }
    else { const a=Math.PI/2+(q-2*S-B)/turnR; x=-S/2+(R+d)*Math.cos(a); y=(R+d)*Math.sin(a); }
    if(dir==='右回') x=-x; return {x,y};
  }
  function kAt(s, geo) {
    if(geo.route) return routeReferencePoint(s,geo).k;
    const {S,B,R}=geo, q=mod(s+(geo.startOffset||0),geo.lap||2*S+2*B);
    return (q>=S && q<S+B) || q>=2*S+B ? 1/R : 0;
  }
  function laneProgressCoef(s,t,geo) {
    if(geo.route) {
      const p=routeReferencePoint(s,geo),raw=1/((p.metric??1)*(1+p.k*(t-geo.referenceLane)));
      return 1+(raw-1)*RACE_F.laneBias;
    }
    const raw=kAt(s,geo)>0?(geo.referenceR||geo.R)/(geo.R+t-TRACK_WIDTH/2):1;
    return 1+(raw-1)*RACE_F.laneBias;
  }
  function trackWidthAt(s,geo) {return geo.width||TRACK_WIDTH;}
  function laneCurvatureAt(s,t,geo) {
    const k=kAt(s,geo);
    if(geo.route) return k/(1+k*(t-geo.referenceLane));
    return k>0?1/(geo.R+t-TRACK_WIDTH/2):0;
  }
  function trackTangent(s,t,geo,dir) {
    if(geo.route) {const p=routeReferencePoint(s,geo);return {x:dir==='右回'?-p.tx:p.tx,y:p.ty};}
    const e=0.01,a=trackPoint(s-e,t,geo,dir),b=trackPoint(s+e,t,geo,dir),n=Math.hypot(b.x-a.x,b.y-a.y);
    return {x:(b.x-a.x)/n,y:(b.y-a.y)/n};
  }
  const ROUTE_ARC_CACHE=new WeakMap();
  const ARC_QUADRATURE=[[0.046910077030668,0.118463442528095],[0.230765344947158,0.239314335249683],
    [0.5,0.284444444444444],[0.769234655052842,0.239314335249683],[0.953089922969332,0.118463442528095]];
  function referenceArcIntegral(pointAt,a,b) {
    if(b<=a) return 0;
    return (b-a)*ARC_QUADRATURE.reduce((sum,[at,weight])=>sum+weight*(pointAt(a+(b-a)*at).metric??1),0);
  }
  function referenceArcTable(owner,length,step,pointAt,extra=[]) {
    if(ROUTE_ARC_CACHE.has(owner)) return ROUTE_ARC_CACHE.get(owner);
    const n=Math.round(length/step),nodes=Array.from({length:n+1},(_,i)=>i*step);
    nodes.push(...extra.filter(x=>x>0&&x<length));nodes.sort((a,b)=>a-b);
    const q=nodes.filter((x,i)=>!i||x-nodes[i-1]>1e-9),arc=[0];
    for(let i=1;i<q.length;i++) arc.push(arc[i-1]+referenceArcIntegral(pointAt,q[i-1],q[i]));
    const result={q,arc,total:arc.at(-1),pointAt};ROUTE_ARC_CACHE.set(owner,result);return result;
  }
  function loopArcTable(loop) {
    if(ROUTE_ARC_CACHE.has(loop)) return ROUTE_ARC_CACHE.get(loop);
    return referenceArcTable(loop,loop.lap,loop.step,q=>loopReferencePoint(q,loop),loop.stations);
  }
  function referenceArcAt(table,q) {
    if(q<=0) return q;if(q>=table.q.at(-1)) return table.total+q-table.q.at(-1);
    let lo=0,hi=table.q.length-1;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(table.q[mid]<=q)lo=mid;else hi=mid;}
    return table.arc[lo]+referenceArcIntegral(table.pointAt,table.q[lo],q);
  }
  function loopHeadingAt(q,loop) {
    if(q<=loop.home) return 0;
    if(q>=loop.home+loop.bend1&&q<=loop.home+loop.bend1+loop.back) return Math.PI;
    const p=loopReferencePoint(q,loop),angle=Math.atan2(p.ty,p.tx);
    // atan2 has a branch at ±π; rounding of a nearly horizontal tangent can
    // otherwise add a whole turn at a straight junction. Select the continuous
    // geometric bend branch, including tiny endpoint overshoots on either side.
    const lastStart=loop.home+loop.bend1+loop.back;
    const expected=q<loop.home+loop.bend1?Math.PI*(q-loop.home)/loop.bend1:
      Math.PI+Math.PI*(q-lastStart)/loop.bend2;
    return angle+2*Math.PI*Math.round((expected-angle)/(2*Math.PI));
  }
  // Exact-number keys: no station rounding or interpolation changes. Geometry
  // is immutable, as for ROUTE_ARC_CACHE; keep each geometry's cache bounded.
  const ROUTE_STATE_VALUE_CACHE=new WeakMap();
  function routeArcState(s,geo) {
    let cache=ROUTE_STATE_VALUE_CACHE.get(geo);
    if(!cache){cache=new Map();ROUTE_STATE_VALUE_CACHE.set(geo,cache);}
    if(cache.has(s))return cache.get(s);
    const r=geo.route,loop=r.loop,table=loopArcTable(loop),q0=s+geo.startOffset,circuit=Math.floor(q0/geo.lap),q=mod(q0,geo.lap);
    let arc=circuit*table.total+referenceArcAt(table,q),angle=circuit*2*Math.PI+loopHeadingAt(q,loop);
    if(r.chute&&s<r.startLength) {
      const chute=r.chute,ct=referenceArcTable(chute,chute.length,chute.step,q=>routeTablePoint(chute.samples,chute.step,q));
      const endQ=r.startLength+geo.startOffset,endCircuit=Math.floor(endQ/geo.lap),merge=mod(endQ,geo.lap);
      const endArc=endCircuit*table.total+referenceArcAt(table,merge),endAngle=endCircuit*2*Math.PI+loopHeadingAt(merge,loop);
      const p=routeReferencePoint(s,geo);
      arc=endArc-ct.total+referenceArcAt(ct,s);
      let chuteAngle=Math.atan2(p.ty,p.tx);if(chuteAngle<0)chuteAngle+=2*Math.PI;
      angle=endAngle+chuteAngle-Math.PI;
    }
    const value={arc,angle};
    if(cache.size>=4096)cache.clear();
    cache.set(s,value);return value;
  }
  function abstractArcState(s,geo) {
    const lap=geo.lap,{S,B}=geo,q0=s+(geo.startOffset||0),circuit=Math.floor(q0/lap),q=mod(q0,lap),radius=geo.referenceR||geo.R;
    const angle=q<S?0:q<S+B?(q-S)/radius:q<2*S+B?Math.PI:Math.PI+(q-2*S-B)/radius;
    return {arc:q0,angle:circuit*2*Math.PI+angle};
  }
  function laneArcDistance(s0,s1,t,geo) {
    if(!Number.isFinite(s0)||!Number.isFinite(s1)||!Number.isFinite(t)) throw new Error('无效车道弧长参数');
    if(s0===s1) return 0;
    const at=geo.route?routeArcState:abstractArcState,a=at(s0,geo),b=at(s1,geo);
    // Exact parallel-curve relation: L(offset)=L(reference)+offset * signed turning angle.
    return b.arc-a.arc+(t-(geo.referenceLane??(TRACK_WIDTH/2)))*(b.angle-a.angle);
  }
  function laneAdvance(s,physicalDistance,t,geo) {
    if(!Number.isFinite(s)||!Number.isFinite(physicalDistance)||!Number.isFinite(t)) throw new Error('无效车道推进参数');
    if(physicalDistance===0)return s;
    // Every inverse query has one immutable origin. Keep its exact arc/heading
    // and coefficient, while retaining the same quadrature and Newton steps.
    const stateAt=geo.route?routeArcState:abstractArcState,origin=stateAt(s,geo),initialCoef=laneProgressCoef(s,t,geo);
    const distanceTo=to=>{const end=stateAt(to,geo);return end.arc-origin.arc+
      (t-(geo.referenceLane??(TRACK_WIDTH/2)))*(end.angle-origin.angle);};
    let span=Math.max(1,Math.abs(physicalDistance*initialCoef)*1.2),lo=s,hi=s;
    if(physicalDistance>0){hi=s+span;while(distanceTo(hi)<physicalDistance){span*=2;hi=s+span;}}
    else {lo=s-span;while(distanceTo(lo)>physicalDistance){span*=2;lo=s-span;}}
    let at=clamp(s+physicalDistance*initialCoef,lo,hi);
    for(let i=0;i<18;i++) {
      const residual=distanceTo(at)-physicalDistance;
      if(Math.abs(residual)<1e-9)return at;
      if(residual>0)hi=at;else lo=at;
      const candidate=at-residual*laneProgressCoef(at,t,geo);
      at=candidate>lo&&candidate<hi?candidate:(lo+hi)/2;
    }
    return at;
  }
  function laneArcBreakpoints(s0,s1,geo) {
    if(!Number.isFinite(s0)||!Number.isFinite(s1)) throw new Error('无效车道结点参数');
    const from=Math.min(s0,s1),to=Math.max(s0,s1),points=[];
    const nodes=geo.route?loopArcTable(geo.route.loop).q:[geo.S,geo.S+geo.B,2*geo.S+geo.B,geo.lap];
    for(let loop=Math.floor((from+geo.startOffset)/geo.lap);loop<=Math.floor((to+geo.startOffset)/geo.lap);loop++) {
      const shift=loop*geo.lap-geo.startOffset;let lo=0,hi=nodes.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(nodes[mid]<=from-shift+1e-9)lo=mid+1;else hi=mid;}
      for(let i=lo;i<nodes.length&&nodes[i]<to-shift-1e-9;i++){const s=shift+nodes[i];if(!geo.route?.chute||s>geo.route.startLength)points.push(s);}
    }
    if(geo.route?.chute){const chute=geo.route.chute;for(let i=0;i<=Math.round(chute.length/chute.step);i++){const s=i*chute.step;if(s>from+1e-9&&s<to-1e-9)points.push(s);}}
    points.sort((a,b)=>a-b);return points.filter((x,i)=>!i||x-points[i-1]>1e-8);
  }
  const ROUTE_BOUND_CACHE=new WeakMap();
  function routeMetricBounds(owner,stations) {
    if(ROUTE_BOUND_CACHE.has(owner))return ROUTE_BOUND_CACHE.get(owner);
    const samples=owner.samples,cells=[];let minMetric=1,maxMetric=1,maxCurvature=0;
    for(let i=1;i<samples.length;i++) {
      const a=samples[i-1],b=samples[i],h=Array.isArray(stations)?stations[i]-stations[i-1]:stations;
      // Convert the same endpoint position/tangent/curvature quintic to Bezier.
      // Derivative control polygons enclose every velocity/acceleration vector.
      const p0={x:a.x,y:a.y},p5={x:b.x,y:b.y},p1={x:a.x+h*a.tx/5,y:a.y+h*a.ty/5},p4={x:b.x-h*b.tx/5,y:b.y-h*b.ty/5};
      const p2={x:2*p1.x-p0.x-h*h*a.k*a.ty/20,y:2*p1.y-p0.y+h*h*a.k*a.tx/20};
      const p3={x:2*p4.x-p5.x-h*h*b.k*b.ty/20,y:2*p4.y-p5.y+h*h*b.k*b.tx/20};
      const p=[p0,p1,p2,p3,p4,p5],v=p.slice(1).map((q,j)=>({x:5*(q.x-p[j].x)/h,y:5*(q.y-p[j].y)/h}));
      const accelerationVectors=v.slice(1).map((q,j)=>({x:4*(q.x-v[j].x)/h,y:4*(q.y-v[j].y)/h}));
      const acceleration=accelerationVectors.map(q=>Math.hypot(q.x,q.y));
      // Bernstein product controls enclose det(r',r'') across the entire cell.
      const choose4=[1,4,6,4,1],choose3=[1,3,3,1],choose7=[1,7,21,35,35,21,7,1],cross=[];
      for(let k=0;k<=7;k++) {
        let value=0;
        for(let i=Math.max(0,k-3);i<=Math.min(4,k);i++) {const j=k-i;value+=choose4[i]*choose3[j]/choose7[k]*(v[i].x*accelerationVectors[j].y-v[i].y*accelerationVectors[j].x);}
        cross.push(value);
      }
      // A positive projection lower bound also bounds the vector's norm.
      const lower=Math.min(...v.map(q=>q.x*a.tx+q.y*a.ty))-1e-6;
      const upper=Math.max(...v.map(q=>Math.hypot(q.x,q.y)))+1e-6,accUpper=Math.max(...acceleration)+1e-5;
      const crossMin=Math.min(...cross)-1e-5,crossMax=Math.max(...cross)+1e-5;
      const signedMin=lower>0?(crossMin<0?crossMin/(lower*lower*lower):crossMin/(upper*upper*upper)):-Infinity;
      const signedMax=lower>0?(crossMax>0?crossMax/(lower*lower*lower):crossMax/(upper*upper*upper)):Infinity;
      cells.push({minMetric:Math.min(1,lower),maxMetric:Math.max(1,upper),maxCurvature:lower>0?upper*accUpper/(lower*lower*lower):Infinity,signedMin,signedMax});
      if(!(lower>0)){minMetric=0;maxCurvature=Infinity;break;}
      maxMetric=Math.max(maxMetric,upper);minMetric=Math.min(minMetric,lower);maxCurvature=Math.max(maxCurvature,upper*accUpper/(lower*lower*lower));
    }
    const result={minMetric,maxMetric,maxCurvature,cells};ROUTE_BOUND_CACHE.set(owner,result);return result;
  }
  const ROUTE_RANGE_BOUND_CACHE=new WeakMap();
  function routeCellRangeBounds(owner,stations,from,to) {
    let table=ROUTE_RANGE_BOUND_CACHE.get(owner);
    if(!table) {
      const cells=routeMetricBounds(owner,stations).cells;
      if(cells.length!==owner.samples.length-1)return null;
      const min=[Float64Array.from(cells,c=>c.minMetric)],max=[Float64Array.from(cells,c=>c.maxMetric)],curvature=[Float64Array.from(cells,c=>c.maxCurvature)],signedMin=[Float64Array.from(cells,c=>c.signedMin)],signedMax=[Float64Array.from(cells,c=>c.signedMax)];
      for(let level=1;(1<<level)<=cells.length;level++) {
        const span=1<<(level-1),n=cells.length-(1<<level)+1;
        const mn=new Float64Array(n),mx=new Float64Array(n),cv=new Float64Array(n),smn=new Float64Array(n),smx=new Float64Array(n);
        for(let i=0;i<n;i++) {mn[i]=Math.min(min[level-1][i],min[level-1][i+span]);mx[i]=Math.max(max[level-1][i],max[level-1][i+span]);cv[i]=Math.max(curvature[level-1][i],curvature[level-1][i+span]);smn[i]=Math.min(signedMin[level-1][i],signedMin[level-1][i+span]);smx[i]=Math.max(signedMax[level-1][i],signedMax[level-1][i+span]);}
        min.push(mn);max.push(mx);curvature.push(cv);signedMin.push(smn);signedMax.push(smx);
      }
      table={min,max,curvature,signedMin,signedMax,n:cells.length};ROUTE_RANGE_BOUND_CACHE.set(owner,table);
    }
    function cellIndex(at) {
      if(!Array.isArray(stations))return clamp(Math.floor(at/stations),0,table.n-1);
      let lo=0,hi=stations.length-1;
      while(hi-lo>1){const mid=(lo+hi)>>1;if(stations[mid]<=at)lo=mid;else hi=mid;}
      return Math.min(lo,table.n-1);
    }
    // Include adjacent endpoint cells as a conservative floating-point guard.
    const low=Math.max(0,cellIndex(from)-1),high=Math.min(table.n-1,cellIndex(to)+1),count=high-low+1,level=Math.floor(Math.log2(count)),second=high-(1<<level)+1;
    return {minMetric:Math.min(table.min[level][low],table.min[level][second]),maxMetric:Math.max(table.max[level][low],table.max[level][second]),maxCurvature:Math.max(table.curvature[level][low],table.curvature[level][second]),signedMin:Math.min(table.signedMin[level][low],table.signedMin[level][second]),signedMax:Math.max(table.signedMax[level][low],table.signedMax[level][second])};
  }
  function trafficRouteIntervalBounds(from,to,geo) {
    if(!geo.route)return {minMetric:1,maxMetric:1,maxCurvature:1/(geo.referenceR||geo.R),signedMin:0,signedMax:1/(geo.referenceR||geo.R)};
    const route=geo.route,result={minMetric:1,maxMetric:1,maxCurvature:0,signedMin:Infinity,signedMax:-Infinity};
    function add(bound) {
      if(!bound)return false;
      result.minMetric=Math.min(result.minMetric,bound.minMetric);result.maxMetric=Math.max(result.maxMetric,bound.maxMetric);result.maxCurvature=Math.max(result.maxCurvature,bound.maxCurvature);result.signedMin=Math.min(result.signedMin,bound.signedMin);result.signedMax=Math.max(result.signedMax,bound.signedMax);return true;
    }
    if(from<0&&route.chute){result.signedMin=Math.min(result.signedMin,0);result.signedMax=Math.max(result.signedMax,0);}
    if(route.chute&&from<route.startLength) {
      if(to>0&&!add(routeCellRangeBounds(route.chute,route.chute.step,Math.max(0,from),Math.min(to,route.startLength))))return null;
      from=Math.max(from,route.startLength);
    }
    if(to>=from) {
      const start=from+geo.startOffset,end=to+geo.startOffset;
      for(let circuit=Math.floor(start/geo.lap);circuit<=Math.floor(end/geo.lap);circuit++) {
        if(!add(routeCellRangeBounds(route.loop,route.loop.stations,Math.max(0,start-circuit*geo.lap),Math.min(geo.lap,end-circuit*geo.lap))))return null;
      }
    }
    return result;
  }
  function geometryProgressBounds(route,referenceLane,referenceR,width) {
    const minLane=0.3;
    let minMetric=1,maxMetric=1,maxCurvature=1/referenceR;
    if(route) {
      const bounds=[routeMetricBounds(route.loop,route.loop.stations)];
      if(route.chute)bounds.push(routeMetricBounds(route.chute,route.chute.step));
      minMetric=Math.min(...bounds.map(b=>b.minMetric));maxMetric=Math.max(...bounds.map(b=>b.maxMetric));maxCurvature=Math.max(...bounds.map(b=>b.maxCurvature));
    }
    const denominator=minMetric*(1-(referenceLane-minLane)*maxCurvature);
    // Covers every legal t>=0.3 and laneBias in [0,1]. A failed proof disables
    // distant-pair early exits rather than substituting a sampled estimate.
    const metricUpper=maxMetric*(1+Math.max(Math.abs(minLane-referenceLane),Math.abs(width-referenceLane))*maxCurvature);
    return {progressCoefUpperBound:denominator>0?Math.max(1,1/denominator):Infinity,
      progressCoefLowerBound:Number.isFinite(metricUpper)&&metricUpper>0?Math.min(1,1/metricUpper):0,
      progressCoefBoundLaneMin:minLane,minReferenceMetric:minMetric,maxReferenceMetric:maxMetric,maxReferenceCurvature:maxCurvature};
  }
  function bendCoefFor(special,dir) {
    return special==='左右皆可' || special===dir ? 1 : 0.97;
  }
  const SLOPE_PROFILES = { '平坦':{g:0}, '缓坂':{g:0.010}, '中坂':{g:0.018}, '急坂':{g:0.025} };
  function gradientAt(s,geo,g) {
    if(geo.elevationProfile) {
      const q=mod(s+(geo.startOffset||0),geo.lap), p=geo.elevationProfile;
      for(let i=1;i<p.length;i++) if(q<p[i][0]) return (p[i][1]-p[i-1][1])/(p[i][0]-p[i-1][0]);
      return 0;
    }
    if(!g) return 0;
    // 周期高程的导数，积分一圈为零；坡度按赛道位置读取。
    const q=mod(s+(geo.startOffset||0),geo.lap), z=q/geo.lap;
    return g * (0.65*Math.sin(2*Math.PI*z+0.6)+0.35*Math.sin(4*Math.PI*z));
  }
  function elevationAt(s,geo,g) {
    const q=mod(s+(geo.startOffset||0),geo.lap);
    if(geo.elevationProfile) {
      const p=geo.elevationProfile;
      for(let i=1;i<p.length;i++) if(q<p[i][0]) {
        const a=p[i-1],b=p[i];return a[1]+(b[1]-a[1])*(q-a[0])/(b[0]-a[0]);
      }
      return p.at(-1)[1];
    }
    const z=q/geo.lap;
    return -g*geo.lap*(0.65*Math.cos(2*Math.PI*z+0.6)/(2*Math.PI)+0.35*Math.cos(4*Math.PI*z)/(4*Math.PI));
  }

  // 历史动作解释接口。当前动作由目标配速/走位产生，不叠加这些旧加成或税率。
  const ACTION_DEF = {
    '推骑':    { coef: 0, stamina: 1 },
    '打鞭':    { coef: 0, stamina: 1 },
    '收力':    { coef: 0, stamina: 1 },
    '减速':    { coef: 0, stamina: 1 },
    '斜行in':  { coef: 0, stamina: 1 },
    '斜行out': { coef: 0, stamina: 1 },
  };
  function actionBonus(a) { return ACTION_DEF[a] || { coef: 0, stamina: 1 }; }
  function actionCoef(H) { return 0; } // 历史调用兼容；动作不凭空产生速度或能耗倍率。

  // 机械等价的比功率 W/kg、储备 J/kg。不是马的直接代谢测量值。
  // 结构参考 Mercier & Aftalion (2020)，映射/尾流/恢复参数再用公开赛时约束。
  const RACE_F = {
    // 距离专精再平衡（2026-10-05，见 docs/距离专精诊断-2026-10-05.md）：
    // 原配置下「耐力」双重计入（既给有氧供给又给无氧储备）且无氧储备在每个距离都成为
    // 紧约束，导致【速度/爆发力】几乎无效、任何距离都由耐力单轴支配，不存在距离专精。
    // 现实的能量结构是：有氧=可持续基线（无时限），无氧=有限加成（有总量）。
    // 短距离时加成够用 ⇒ 由功率上限（速度）决定；长距离时加成不够 ⇒ 由氧气供给决定。
    // 因此这里抬高有氧基线、参数化其上限、并同步下调速度上限与储备容量以保住绝对用时。
    baseSpeed:{a:0.020,b:15.30,min:1,max:115}, // 70点=16.70m/s参考速度
    staminaPer:33, gutsPer:60, energyScale:1,
    aerobicBase:0.86, aerobicStaminaK:0.0020, // 旧展示兼容；物理用下列有单位参数
    // aerobicCeiling 原为代码里写死的 68，会把"抬高有氧基线"静默截断（隐藏陷阱）。
    aerobicPower:58, aerobicPerPoint:0.24, aerobicTau:10, aerobicCeiling:76,
    resistanceK:0.250215, airK:0.001365, recoveryRate:0.12, recoveryMax:2.0,
    fatigueLoss:0.08, fatigueWork:0.11, fatigueExcess:0.45,
    reservePower:75, reserveFade:0.10, efficiencyPerPoint:0.0025,
    peakExtra:1.55, burstSpeedK:0.010,
    maxAccel:5.75, runningAccel:2.75, braking:3.5,
    responseTime:1.12, lateralSpeed:0.8, laneBias:1,
    // 骑手对「车道经济性」的计价权重。真实节能 = 横向内移量 × 剩余转角（单位即米），
    // 故 1.0 才对应真实距离节省；原为 0.35 的魔数，未说明依据。
    laneRouteWeight:0.35,
    // 跑法/位置意图对配速请求的最大偏置（±比例）。现实里马群出闸后不久即拉开，
    // 靠的是各骑手选择的配速不同；此前引擎里所有人跑同一条"最大可支付恒速"，
    // 马群长时间并排，变道因此在赛程前 36% 都不合法。
    // 取值依据（docs/早期展开与战术配速-2026-10-06.md）：现实里逃马与追马的早期速度差
    // 约 5–10%，而 frontBias 的实际分布集中在 ±0.3 附近，故 0.15 对应约 5% 的分化。
    // 归因实测（14 匹 / 5 seeds）：0.05→0.15 使闸位依赖 0.97–0.99→0.82–0.94、
    // 冠军后 1s 内比例 43–57%→57–71%、完赛时间 CV 全线收窄，且冠军用时不变。
    // ⚠️ 现实里"起跑强度"还有一条直接作用于【加速阶段】的通道（推马/拉缰），
    //    本引擎的加速段恒为 min(maxA, kineticBudget)，该通道不存在，列为后续缺口。
    paceIntentSpan:0.15,
    draftRange:12, draftSave:0.72, leadCost:1, // 只减少空气阻力项，不给全部做功打折
    curveLateral:3.6, turnCost:0.045,
    // 以下只用于赛前公开预测/历史辅助接口，不反馈给比赛物理。
    paceRef:1.72, paceSizeFix:0.03, paceSlowGate:1, paceHighGate:1.5,
    actionReserveFloor:0.35,
  };
  function baseSpeed(spd) { const F=RACE_F.baseSpeed; return F.a*clamp(spd,F.min,F.max)+F.b; }
  const STAMINA_RANGE_PER_POINT=32; // 历史展示尺度；不再保证固定里程耗尽。
  const GROUND_RANGE_COEF={'良':1,'稍重':0.95,'重':0.88,'不良':0.80};
  function powerDrainCoef(power,state) {
    const badness=1-(GROUND_RANGE_COEF[state] || 1);
    return clamp(1+(power-70)*0.0015*badness/0.20,0.8,1.2);
  }
  function rangeCoef(state,power) { return (GROUND_RANGE_COEF[state]||1)*powerDrainCoef(power,state); }
  function drainDistanceCoef() { return 1; }
  function staminaBudget(length) { return length*RACE_F.energyScale/baseSpeed(70); } // 历史接口
  function horseLen(H) { return 2.25+0.55*(H.adj['体格']/100); }
  // 运动碰撞包络与避让余量分开。95cm净宽发走箱给出包络上界，
  // 此处0.65–0.825m为运动体宽代理，不宣称是实测肩宽；避让另加0.10m。
  function horseWid(H) { return 0.65+0.15*(H.adj['体格']/100); }

  /* ---------------- 评语表（策划案 4.5 情报系统） ---------------- */
  const TIER_LABELS = ['95-100', '85-94', '75-84', '65-74', '55-64', '45-54', '35-44', '25-34', '0-24'];
  function tierIdx(v) {
    if (v >= 95) return 0; if (v >= 85) return 1; if (v >= 75) return 2; if (v >= 65) return 3;
    if (v >= 55) return 4; if (v >= 45) return 5; if (v >= 35) return 6; if (v >= 25) return 7;
    return 8;
  }
  const COMMENT_TABLES = {
    '速度': [
      '世界级别的速度，放眼全球也罕见敌手',
      '很少见到这么快的马',
      '速度不错，重赏级别也很有竞争力',
      '重赏级别速度，可以期待',
      '速度还可以，有希望能赢一两场比赛',
      '速度中规中矩，不太能期待速度致胜',
      '速度很普通，冲刺阶段基本跟不上其他马',
      '速度是严重短板，经常被拉开距离',
      '速度严重不足，基本没有速度',
    ],
    '爆发力': [
      '瞬间爆发力惊人，一给指令就像弹射出去一样',
      '爆发力非常出色，反应极快，说加速立刻就提起来了',
      '加速能力不错，冲刺阶段的衔接很流畅',
      '重赏级别的爆发力，需要发力的时候能及时响应',
      '加速中规中矩，不算快但也不算慢',
      '反应有点慢，从指令到全速需要一段过渡',
      '提速比较迟钝，等提到全速比赛都快结束了',
      '爆发力明显不足，末段加速总是慢半拍',
      '几乎没有爆发力可言，踩下油门也提不起来',
    ],
    '出闸能力': [
      '出闸如电，闸门一开就弹出去，几乎次次都能抢到最前面',
      '起跑反应极快，很少在出闸阶段吃亏',
      '出闸很利索，基本每次都能占到不错的位置',
      '出闸还算稳，大部分时候不会落后太多',
      '起跑中规中矩，不好不坏，看运气',
      '出闸偶尔会慢半拍，需要骑手多注意',
      '出闸偏慢，经常一开门就被甩在后面',
      '起跑明显迟钝，几乎次次出闸都吃亏',
      '出闸极差，闸门开了它还在原地愣一下',
    ],
    '耐力': [
      '堪称铁肺，跑多久都不见疲态，长距离也能全程高速',
      '体力非常充沛，大长途也完全不在话下',
      '耐力相当好，足以应付绝大多数比赛距离',
      '体力还算够用，正常比赛不会因为耐力拖后腿',
      '耐力一般，距离拉长了末段可能会吃力',
      '体能方面不算突出，需要合理分配体力',
      '耐力是短板，后半段经常出现体力不支的情况',
      '体力严重不足，比赛中后段基本就跟不住了',
      '几乎没有持久力可言，跑几步就喘',
    ],
    '力量': [
      '力量极其惊人，马群里随便挤，什么重场坡道都如履平地',
      '力量非常足，重马场和坡道对它影响很小',
      '力量不错，被包在群里也能挤出来，坡道也能对付',
      '重赏级别的力量，大多数情况够用，重场也不会太吃亏',
      '力量还算可以，一般马场没问题，重场会稍微吃力',
      '力量一般，马群密的时候不太能挤开空间',
      '力量偏弱，下雨天或者坡道赛马场表现明显下降',
      '力量明显不足，稍微重点的场地就迈不开腿',
      '力量极差，马群里一碰就歪，重场完全跑不动',
    ],
    '毅力': [
      '意志力惊人，即使体力耗尽也能咬紧牙关硬撑到底，绝不轻言放弃',
      '精神力极强，越是逆境越能激发斗志，末段拼起来很可怕',
      '毅力不错，体力耗光后不会立刻崩掉，能撑一阵子',
      '精神层面还算扎实，末段不会被轻易甩开',
      '毅力中规中矩，体力没了就没了，没什么后劲',
      '精神上不算特别坚韧，对抗激烈时容易退缩',
      '毅力比较薄弱，体力耗空后就基本放弃了',
      '意志力明显不足，稍微拼一下就泄气了',
      '精神面完全不行，遇到困难第一个放弃的就是它',
    ],
    '智力': [
      '绝顶聪明，同样的训练，别的马要磨几周，它几天就掌握了',
      '非常聪明，学得快悟性高，训练效果事半功倍',
      '头脑不错，训练效率明显比一般马高',
      '有些脑子，偶尔会给调教师惊喜',
      '不笨，教什么学什么',
      '稍微有点迟钝',
      '学东西比较慢，调教师需要更多耐心',
      '明显有些笨拙，训练进度落后',
      '就是个木头，真让人生气',
    ],
    '体格': [
      '怪兽级别的马',
      '好魁梧的马，骨架结实宽广',
      '身材比别的马大了一圈',
      '中等偏上的体型，不会轻易被欺负',
      '标准尺寸，不多也不少',
      '有些紧凑，身子很轻',
      '小号马，和其他马并排跑的时候感觉都看不见它',
      '好矮的马，吃奶得踮脚',
      '感觉一匹矮种马混进来了',
    ],
  };
  function tierText(stat, v) {
    const t = COMMENT_TABLES[stat];
    return t ? t[tierIdx(v)] : '';
  }

  /* ---------------- 员工误差（策划案 4.5 + 系统文档第二章） ---------------- */
  const STAFF = {
    '相马眼': { S: 0, A: 2, B: 5, C: 10, D: 15, E: 20 },      // 程度型绝对误差
    '洞察力': { S: 0, A: 5, B: 10, C: 15, D: 20, E: 25 },     // 程度型百分比误差
    '正确率': { S: 100, A: 90, B: 75, C: 60, D: 40, E: 25 },  // 类别型判断正确率
  };
  const CAT_ERROR_POOL = {
    '场地适性': {
      '草地': ['泥草双刀', '泥地'],
      '泥地': ['泥草双刀', '草地'],
      '泥草双刀': ['草地', '泥地'],
    },
    '特殊适性': {
      '左回': ['右回', '左右皆可'],
      '右回': ['左回', '左右皆可'],
      '左右皆可': ['左回', '右回', '左右皆不可'],
      '左右皆不可': ['左回', '右回', '左右皆可'],
    },
  };
  function catText(cat, v) {
    if (cat === '场地适性') {
      return '这匹马看起来是' + ({ '草地': '草地马', '泥地': '泥地马', '泥草双刀': '泥草双刀马' }[v] || v);
    }
    return ({
      '左回': '左回赛道似乎不利', '右回': '右回赛道似乎不利',
      '左右皆可': '左右弯道都没问题', '左右皆不可': '弯道表现都不太理想',
    }[v] || v);
  }
  function fatigueBand(f) {
    if (f <= 25) return 0; if (f <= 50) return 1; if (f <= 70) return 2; return 3;
  }
  function fatigueText(f) {
    if (f <= 25) return '状态很轻松，随时可以出赛';
    if (f <= 50) return '有点累了，注意安排休息';
    if (f <= 70) return '明显疲劳，建议放牧调整';
    return '已经到极限了，千万别勉强';
  }

  /* ---------------- 马匹生成（虚构） ---------------- */
  const NAME_A = ['星', '月', '風', '雷', '雲', '桜', '雪', '光', '疾', '蒼', '紅', '銀', '暁', '天', '嵐', '翔', '白', '黑'];
  const NAME_B = ['野', '影', '天馬', '吹雪', '鳴', '波', '富士', '曜', '海人', '蓮', '翼', '駒', '王', '帝', '刃', '風花', '疾風', '白波', '紅葉', '流星'];
  const COATS = ['鹿毛', '栗毛', '黑鹿毛', '青鹿毛', '芦毛', '青毛'];
  function makeName(rng, used) {
    for (let i = 0; i < 60; i++) {
      const n = pick(rng, NAME_A) + pick(rng, NAME_B);
      if (!used.has(n)) { used.add(n); return n; }
    }
    return pick(rng, NAME_A) + pick(rng, NAME_B) + '号';
  }
  // 能力先生成，跑法不再选择属性模板。生涯、初始种马和演示马共用此分布。
  const HORSE_STATS = { '速度':[66,90], '耐力':[65,87], '出闸能力':[51,81],
    '爆发力':[61,85], '力量':[50,84], '毅力':[58,86], '智力':[45,85], '体格':[45,85] };
  const PHYSIOLOGY_KEYS = ['endurance','power','economy','kinetics','durability'];
  function neutralPhysiology() {
    return {version:1,endurance:0,power:0,economy:0,kinetics:0,durability:0};
  }
  function physiologySeed(h,salt='horse-physiology-v1') {
    // 与生成/比赛 RNG 独立；初次迁移后持久化，训练不重新抽样。
    const identity=[salt,h.id||'',h.name||'',h.sire||'',h.dam||'',
      ...Object.keys(HORSE_STATS).map(k=>(h.stats||{})[k]??70)].join('|');
    let seed=2166136261;
    for(const c of identity) seed=Math.imul(seed^c.charCodeAt(0),16777619);
    return seed>>>0;
  }
  function samplePhysiology(rng) {
    const [a,b,c,d,e]=Array.from({length:5},()=>rng()*2-1);
    // 供给与短时容量不绑成同一个轴。有限共同因子允许弱协变，
    // 氧动力学/疲劳耐受与持续供给部分相关；幅度是待实赛标定的模型假设。
    return {version:1,endurance:0.85*a+0.15*e,power:0.85*b+0.15*e,
      economy:0.9*c+0.1*e,kinetics:0.6*d+0.2*a+0.2*e,durability:0.65*e+0.35*a};
  }
  function horsePhysiology(h) {
    const supplied=h.physiology||{}, fallback=samplePhysiology(mulberry32(physiologySeed(h)));
    const profile={version:1};
    for(const key of PHYSIOLOGY_KEYS) profile[key]=clamp(Number.isFinite(supplied[key])?supplied[key]:fallback[key],-1,1);
    h.physiology=profile;
    return profile;
  }
  function inheritPhysiology(sire,dam,offspring) {
    const a=horsePhysiology(sire),b=horsePhysiology(dam);
    const innovation=samplePhysiology(mulberry32(physiologySeed(offspring,'foal-physiology-v1')));
    const profile={version:1};
    // 均值回归与相关创新；不是已测量的遗传率，不额外消耗繁育 RNG。
    for(const key of PHYSIOLOGY_KEYS) profile[key]=clamp(0.45*(a[key]+b[key])+0.30*innovation[key],-1,1);
    return profile;
  }
  function horseBehavior(h,generationRng) {
    // 新马由生成 RNG 取样并持久化；旧档缺少性格时按稳定身份补齐。
    // 两者均不消费比赛 RNG，也不读取跑法标签。
    let seed=2166136261; for(const c of String(h.id||h.name||'horse')) seed=Math.imul(seed^c.charCodeAt(0),16777619);
    const r=generationRng||mulberry32(seed), s=h.stats||{}, supplied=h.behavior||{};
    // Mild full-support temperament prior; gate execution does not dictate intent.
    const values={forwardness:0.5-Math.sin(Math.asin(1-2*r())/3),
      settle:0.5+((s['智力']??70)-70)*0.004+(r()-0.5)*0.3,
      tractability:0.65+((s['智力']??70)-70)*0.003+(r()-0.5)*0.2};
    for(const key of Object.keys(values)) values[key]=clamp(Number.isFinite(supplied[key])?supplied[key]:values[key],0,1);
    return values;
  }
  function racePlanFor(h,behavior) {
    const plan=h.racePlan||{};
    return {position:clamp(Number.isFinite(plan.position)?plan.position:behavior.forwardness,0,1),
      risk:clamp(Number.isFinite(plan.risk)?plan.risk:0.35+((h.aggression??1)-1)*0.3,0,1),
      patience:clamp(Number.isFinite(plan.patience)?plan.patience:behavior.settle,0,1)};
  }
  function describeHorse(h,historicalStyle,generationRng) {
    h.behavior=horseBehavior(h,generationRng);
    horsePhysiology(h);
    const forward=racePlanFor(h,h.behavior).position;
    h.style=historicalStyle || (forward>=0.75?'逃':forward>=0.55?'先':forward>=0.30?'差':'追');
    return h;
  }
  function makeHorse(rng, opts) {
    const o = opts || {};
    /* 「强马」的档差。原为 ±5 —— 也就是场次内单靠 tier 就能拉出 5 点能力差。
       与「场次内能力跨度 ±2」的策略对齐后压到 ±2（见 FIELD_LEVEL_SPAN）。 */
    const boost = 0; // 历史 tier 兼容，不为指定马制造能力优势。
    /* 场次水平决定整体档次；个体能力与跑法标签独立。 */
    const level = o.level !== undefined ? o.level : 70;
    const stats = {};
    for (const k of Object.keys(HORSE_STATS)) {
      const r = HORSE_STATS[k];
      const mid = (r[0] + r[1]) / 2;
      const roll = r[0] + rng() * (r[1] - r[0]);
      /* 个体差异压缩系数。归因实验（全同跑法·全同 level 的 8 匹马）
         显示属性随机差异单独贡献 0.93 马身（1-2 名）。
         现实里同一班次马的能力本就接近，故由 0.40 再压到 0.30。 */
      const shaped = mid + (roll - mid) * 0.30;
      stats[k] = clamp(Math.round(level + (shaped - 70) * 0.8 + boost), 20, 97);
    }
    stats['血统力'] = clamp(Math.round(30 + rng() * 60), 10, 99);
    const age = 2 + Math.floor(rng() * 4);
    const sex = rng() < 0.5 ? '牡' : '牝';
    const 出赛 = Math.max(1, (age - 1) * 4 + Math.floor(rng() * 5));
    /* 战绩必须是「实力的有噪声结果」，不能是纯随机。
       原来的写法（出赛 × 随机 0.15~0.45）让战绩与隐藏属性完全无关，
       于是任何"public-only"的人气模型都在给噪声定价——市场必然抓不住真实实力，
       赔率会离谱到出现 +500% 期望值的机会。现实中战绩正是实力的公开投影，
       所以这里按"该马相对同场的实力水平"反推一个带噪声的胜率。 */
    const hp = (k, c) => clamp(((stats[k] === undefined ? 70 : stats[k]) - c) / 26, -1.6, 1.6);
    const strength = hp('速度', 72) * 0.34 + hp('爆发力', 70) * 0.20 + hp('耐力', 65) * 0.16 +
                     hp('出闸能力', 65) * 0.10 + hp('毅力', 68) * 0.10 + hp('力量', 62) * 0.10;
    const rawRate = clamp(0.24 + strength * 0.085 + (rng() - 0.5) * 0.10, 0.03, 0.62);
    const 胜利 = clamp(Math.round(出赛 * rawRate), 0, 出赛);
    const 前三 = Math.min(出赛, 胜利 + Math.round(出赛 * (0.20 + rng() * 0.22)));
    return describeHorse({
      id: o.id || ('h' + Math.floor(rng() * 1e9)),
      name: o.name || '', sire: o.sire || '', dam: o.dam || '',
      age, sex,
      behavior:o.behavior?{...o.behavior}:undefined, racePlan:o.racePlan?{...o.racePlan}:undefined,
      physiology:o.physiology?{...o.physiology}:undefined,
      carriedWeight:o.carriedWeight, bodyMass:o.bodyMass,
      coat: o.coat || pick(rng, COATS),
      surface: o.surface || weightedPick(rng, [['草地', 85], ['泥草双刀', 10], ['泥地', 5]]),
      special: o.special || weightedPick(rng, [['左右皆可', 80], ['左回', 9], ['右回', 9], ['左右皆不可', 2]]),
      stats,
      '斗志': o.斗志 !== undefined ? o.斗志 : clamp(Math.round(55 + rng() * 45), 20, 100),
      '疲劳': o.疲劳 !== undefined ? o.疲劳 : (rng() < 0.5 ? Math.round(rng() * 25) : rng() < 0.8 ? Math.round(26 + rng() * 24) : Math.round(51 + rng() * 19)),
      jockeyGrade: o.jockeyGrade || weightedPick(rng, [['普通', 55], ['新人', 20], ['优秀', 18], ['殿堂', 7]]),
      aggression: o.aggression !== undefined ? o.aggression : Math.round((0.5 + rng()) * 10) / 10,
      form: { 出赛, 胜利, 前三 },
      player: !!o.player,
    },o.style,rng);
  }
  /* ---------------- 赛前候选与条件阵容 ---------------- */
  // 报名分布的模型假设；不会乘进速度、成本或距离适性。
  const COHORT_VERSION = 1;
  const COHORT_POOL_MULTIPLIER = 4;
  const cohortForecastCache = new Map();
  function applyCohortEntryOverrides(h, overrides) {
    const o=overrides||{};
    // 状态规范在完整生成和档案物化之后、报名评估之前；不改生成 RNG。
    for(const key of ['surface','special','斗志','疲劳','jockeyGrade','bodyMass','carriedWeight'])
      if(Object.prototype.hasOwnProperty.call(o,key))h[key]=o[key];
    return h;
  }
  function cohortRaceOptions(options) {
    const o=options||{}, race=o.race||o;
    return {length:Number(race.length||race.dist)||2000,course:race.course||race.venue||'标准',
      surface:race.surface||'草地',state:race.state||'良',dir:race.dir||'左回',
      profile:race.profile||'平坦',wind:Number(race.wind)||0};
  }
  function cohortLevelBand(options) {
    const o=options||{}, tier=typeof o.tierKey==='string'?TIER_BY_KEY[o.tierKey]:o.tierDef;
    const explicit=o.levelBand||tier?.level;
    const requestedCenter=Number.isFinite(o.level)?o.level:explicit?(explicit[0]+explicit[1])/2:70;
    const lower=explicit?Number(explicit[0]):20,upper=explicit?Number(explicit[1]):97;
    if(!Number.isFinite(lower)||!Number.isFinite(upper)||lower>upper)throw new Error('无效赛级能力区间');
    const center=clamp(requestedCenter,lower,upper);
    return [clamp(Math.max(lower,center-FIELD_LEVEL_SPAN),20,97),clamp(Math.min(upper,center+FIELD_LEVEL_SPAN),20,97)];
  }
  function raceEntryForecast(h, options) {
    if(!h||!h.stats)throw new Error('无效赛前候选马');
    const raceOptions=cohortRaceOptions(options);
    if(!Number.isFinite(raceOptions.length)||raceOptions.length<200)throw new Error('无效报名比赛距离');
    // 仅克隆并构造同物理的赛前状态，不 step、不读取赛后名次/总时。
    // 输入档案不因评估距离而改变，现有马只由选择入口显式补齐旧档。
    const entry=JSON.parse(JSON.stringify(h));horsePhysiology(entry);entry.behavior=horseBehavior(entry);
    const key=JSON.stringify([raceOptions,entry.stats,entry.physiology,entry['疲劳']||0,entry['斗志']??70,
      entry.behavior,entry.surface,entry.special,entry.bodyMass,entry.carriedWeight,RACE_F]);
    if(cohortForecastCache.has(key))return {...cohortForecastCache.get(key)};
    const r=createRace([entry],{...raceOptions,rng:()=>0.5}),H=r.race.horses[0];
    H.t=r.race.geo.referenceLane;H.targetT=H.t;
    let low=3,high=H.maxV,best=null;
    for(let i=0;i<9;i++){
      const requested=(low+high)/2,forecast=H.finishPlan(requested,0,{earlyExit:true});
      if(forecast.feasible){low=requested;best=forecast;}else high=requested;
    }
    if(!best)best=H.finishPlan(low,0);
    const result={version:COHORT_VERSION,seconds:best.seconds,requestedV:low,
      required:best.required,capacity:H.staminaMax,aerobic:H.aerobic,maxV:H.maxV,
      peakPowerShortfall:best.peakPowerShortfall,feasible:best.feasible,referenceLane:H.t};
    if(![result.seconds,result.requestedV,result.required,result.capacity,result.aerobic,result.maxV].every(Number.isFinite)||result.seconds<=0)
      throw new Error('赛前候选预测未产生有限结果');
    if(cohortForecastCache.size>=512)cohortForecastCache.delete(cohortForecastCache.keys().next().value);
    cohortForecastCache.set(key,result);return {...result};
  }
  function cohortReference(level, race, entryOverrides) {
    const reference=makeHorse(()=>0.5,{id:'cohort-reference',level,physiology:neutralPhysiology(),
      behavior:{forwardness:0.5,settle:0.5,tractability:0.65},surface:race.surface,
      special:'左右皆可','斗志':50,'疲劳':0,bodyMass:480,carriedWeight:57});
    applyCohortEntryOverrides(reference,entryOverrides);return raceEntryForecast(reference,race);
  }
  function selectRaceCohort(candidates, rng, options) {
    if(!Array.isArray(candidates)||typeof rng!=='function')throw new Error('无效候选池');
    const o=options||{},race=cohortRaceOptions(o),band=cohortLevelBand(o);
    const requested=Number.isInteger(o.n)?Math.max(0,o.n):8,n=Math.min(requested,candidates.length);
    const ids=new Set();
    for(const h of candidates){if(!h||!h.id||ids.has(h.id))throw new Error('候选身份重复或缺失');ids.add(h.id);horsePhysiology(h);}
    const references=band.map(level=>cohortReference(level,race,o.entryOverrides));
    const fast=Math.min(...references.map(r=>r.seconds)),slow=Math.max(...references.map(r=>r.seconds));
    const assessed=candidates.map((h,index)=>{
      const forecast=raceEntryForecast(h,race),inside=forecast.feasible&&forecast.seconds<=slow+1e-7;
      const distance=forecast.seconds>slow?forecast.seconds-slow:0;
      return {h,index,forecast,inside,distance};
    });
    const eligible=assessed.filter(x=>x.inside),selected=[];
    const available=eligible.slice();
    // 合格候选无放回报名；没有“八匹最接近”或指定冠军。
    while(selected.length<n&&available.length){const i=Math.min(available.length-1,Math.floor(rng()*available.length));selected.push(available.splice(i,1)[0]);}
    const fallback=n-selected.length;
    if(fallback){
      const rest=assessed.filter(x=>!x.inside).map(x=>({...x,tie:rng()})).sort((a,b)=>a.distance-b.distance||a.tie-b.tie||a.index-b.index);
      selected.push(...rest.slice(0,fallback));
    }
    return {horses:selected.map(x=>x.h),diagnostics:{version:COHORT_VERSION,race,levelBand:band,
      predictionWindow:{fastSeconds:fast,slowSeconds:slow},candidates:candidates.length,requested,selected:selected.length,
      eligibilityScope:'Caller filters decide age, wins/class and rest qualification; forecast only matches payable distance/grade readiness.',
      fastIsNotAdmissionCeiling:true,
      eligible:eligible.length,fallback,shortage:Math.max(0,requested-candidates.length),
      selection:'Payable entrants no slower than shared grade/distance reference: uniform without replacement. Faster entrants remain admissible. Scarcity: nearest slow boundary, explicitly reported. Qualification is determined by caller filters; no realized race simulation.',
      entries:selected.map(x=>({id:x.h.id,eligible:x.inside,forecast:{...x.forecast}}))}};
  }
  function makeRaceCandidatePool(rng, options) {
    const o=options||{},n=Number.isInteger(o.n)?o.n:32,band=cohortLevelBand(o),used=new Set(),horses=[];
    if(n<1||n>256)throw new Error('无效候选池规模');
    // 生成不读取比赛距离/赛道；相同 RNG、赛级和池规模对应相同个体。
    for(let i=0;i<n;i++){
      const level=band[0]+rng()*(band[1]-band[0]);
      const h=makeHorse(rng,{level,id:(o.idPrefix||'h')+(i+1),player:false});
      h.name=makeName(rng,used);h.sire=makeName(rng,used);h.dam=makeName(rng,used);
      applyCohortEntryOverrides(h,o.entryOverrides);horses.push(h);
    }
    return horses;
  }
  function makeField(rng, opts) {
    const o=opts||{},n=o.n||8;
    if(!Number.isInteger(n)||n<1||n>64)throw new Error('无效阵容规模');
    // strongIndex 保留为玩家身份兼容选项，不再给能力或生理加点。
    const identityIndex=o.strongIndex!==undefined?o.strongIndex:Math.floor(rng()*n);
    const playerIndex=o.playerIndex!==undefined?o.playerIndex:identityIndex;
    const level=o.level!==undefined?o.level:62+Math.floor(rng()*17);
    const race=o.race||(Number.isFinite(o.length)||Number.isFinite(o.dist)?o:null);
    if(!race){
      const used=new Set(),horses=[];
      for(let i=0;i<n;i++){
        const h=makeHorse(rng,{level,id:(o.idPrefix||'h')+(i+1),player:i===playerIndex});
        h.name=makeName(rng,used);h.sire=makeName(rng,used);h.dam=makeName(rng,used);horses.push(h);
      }
      return horses;
    }
    const poolSize=Math.min(256,Math.max(n,n*COHORT_POOL_MULTIPLIER));
    const pool=makeRaceCandidatePool(rng,{n:poolSize,level,levelBand:o.levelBand,tierKey:o.tierKey,tierDef:o.tierDef,idPrefix:o.idPrefix,entryOverrides:o.entryOverrides});
    const player=Number.isInteger(playerIndex)&&playerIndex>=0&&playerIndex<pool.length?pool[playerIndex]:null;
    const result=selectRaceCohort(pool.filter(h=>h!==player),rng,{...o,level,race,n:n-(player?1:0)});
    const horses=result.horses;
    if(player){player.player=true;horses.splice(Math.min(playerIndex,horses.length),0,player);}
    Object.defineProperty(horses,'cohort',{value:{...result.diagnostics,playerReserved:player?.id||null},enumerable:false});
    return horses;
  }

  /* 兼容旧调用的返回形状；所有赔率统一使用只读公开信息的市场模型。
     原签名 (horses, rng) 仍可用，第三个参数可补充本场赛道条件。 */
  function oddsAndPopularity(horses, rng, raceOpts) {
    return marketOddsAndPopularity(horses, raceOpts, rng).byId;
  }

  /* 公开的赛前展开预测：战术声明或历史跑法，只供市场/界面参考。
     不读取隐藏性格/能力，不进入实际速度、耗能或骑手决策。 */
  const PACE_WEIGHT = { '逃': 1.00, '先': 0.12 };
  function paceStrengthOf(horses) {
    let want = 0;
    for (const h of horses) {
      const declared=h.racePlan?.position;
      const w=Number.isFinite(declared)?Math.pow(clamp(declared,0,1),3):(PACE_WEIGHT[h.style]||0);
      if (w <= 0) continue;
      const mor = (h['斗志'] !== undefined) ? h['斗志'] : 70;
      want += w * (0.6 + 0.4 * clamp(mor / 100, 0, 1));
    }
    const fieldFix = 1 + (horses.length - 8) * RACE_F.paceSizeFix;
    const s = clamp((want / RACE_F.paceRef) * fieldFix, 0, 2.5);
    return {
      strength: s,
      level: s < RACE_F.paceSlowGate ? 'スロー'
        : s > RACE_F.paceHighGate ? 'ハイ' : '平均',
    };
  }

  /* ============================================================
   * 人气/赔率模型（市场）——独立于比赛引擎
   * ------------------------------------------------------------
   * 铁律：
   *   ① 本模型**只许读公开信息**（战绩、骑手、血统、年龄、适性），
   *      永远不许读 h.stats 里的隐藏属性（速度/爆发力/耐力/毅力/力量/出闸能力…）。
   *   ② 比赛结果不许读赔率。市场是旁观者的看法，不影响比赛。
   *   ③ 市场看到的不能比玩家更多——玩家的信息集 = 公开信息 + 自己的员工报告。
   *      这块差额就是信息差博弈里玩家要赚的钱。
   *
   * 玩家（也就是未来的员工情报系统）能看到隐藏属性，市场看不到；
   * 于是"隐藏属性强、但公开信息平庸"的马会被系统性低估——那就是套利空间。
   * ============================================================ */
  /* 市场参数：全部集中在这里，便于用蒙特卡洛扫描标定。
     目标是让"公开智能投注"的期望回报落在 1.05~1.20（技术能赢、新手会亏）。 */
  const MARKET = {
    /* 公开信号权重（相对权重，内部会归一化；不参与"真实实力"的权重分配） */
    wForm: 0.34,      // 战绩：公众最依赖，也最容易高估
    wJockey: 0.18,    // 骑手名气
    wBlood: 0.14,     // 血统（父系/母系成绩）
    wAge: 0.10,       // 年龄与出赛经验
    wFit: 0.14,       // 场地/回向适性（公开记录）
    wBody: 0.06,      // 体格等公开外观
    wNoise: 0.04,     // 群体非理性噪声
    /* 软最大化温度：越小 → 热门越热、冷门越冷（市场越"自信"）。
       注意：评分会先按本场标准差归一化，所以这个值有稳定含义，
       不会因为"权重和"或"几匹马参赛"而漂移。 */
    temp: 1.05,
    /* 抽水：玩家必须跨过的门槛。现实赛马场约 15~25%。
       赔率 = (1 - takeout) / 概率，这样 Σ(1/赔率) = 1/(1-takeout)，
       即抽水恒为 takeout，与概率分布形状无关。 */
    takeout: 0.18,
    /* 群体系统性偏差（这三条是玩家可以学会并利用的"市场规律"） */
    biasWinStreak: 0.90,   // 高胜率溢价：公开评分除以该系数（<1），提高人气
    biasUnraced: 1.10,     // 新马被低估：公开评分除以该系数（>1），降低人气
    biasBloodNeglect: 0.92,// 血统被系统性轻视（对血统分做压缩）
    biasJockeyHalo: 1.06,  // 名骑手光环：骑手分被放大
    /* 步速（展开）的公开信息启发式。历史跑法与已声明计划可用于预测，
       但真实节奏由比赛中骑乘产生；权重与信念折减是游戏市场假设，
       不能当作已知比赛效果或现实市场套利保证。 */
    wPace: 0.10,           // 步速在公开评分里的权重
    marketPaceDamp: 0.40,  // 市场对展开预测的信念折减比例
  };
  /* 市场对历史跑法与展开的启发式看法，不能当作真实物理效果。 */
  const PACE_MARKET_BELIEF = { '逃': -1.00, '先': -0.40, '差': +0.50, '追': +0.90 };
  const PACE_TRUE_EFFECT = PACE_MARKET_BELIEF; // 旧市场调用兼容名
  /* ---------------- 市场模型的公开信号（绝不含隐藏属性） ---------------- */
  function marketFormScore(h) {
    const f = h.form || { '出赛': 0, '胜利': 0, '前三': 0 };
    const starts = Math.max(0, f['出赛'] || 0);
    if (starts === 0) return 0.5;                        // 新马：市场只能给中性
    const win = (f['胜利'] || 0) / starts;
    const place = (f['前三'] || 0) / starts;
    const exp = Math.min(starts, 12) / 12;               // 经验越多越可信
    const raw = win * 0.62 + place * 0.38;
    return clamp(0.5 + (raw - 0.25) * 1.5 * exp, 0, 1);
  }
  function marketJockeyScore(h) {
    const base = { '新人': 0.30, '普通': 0.50, '优秀': 0.74, '殿堂': 0.94 };
    const v = base[h.jockeyGrade] !== undefined ? base[h.jockeyGrade] : 0.5;
    // 公众放大名骑手 → 让高等级骑手的分更极端
    return h.jockeyGrade === '殿堂' || h.jockeyGrade === '优秀'
      ? clamp(v * MARKET.biasJockeyHalo, 0, 1) : v;
  }
  function marketBloodScore(h) {
    const s = (h.stats && h.stats['血统力'] !== undefined) ? h.stats['血统力'] : 50;
    const v = clamp(s / 100, 0, 1);
    return clamp(v * MARKET.biasBloodNeglect, 0, 1);     // 公众轻视血统
  }
  function marketAgeScore(h) {
    const age = h.age || 3;
    const exp = Math.min(1, (h.form ? h.form['出赛'] : 0) / 10);
    const t = clamp((age - 2) / 5, 0, 1);
    return clamp(0.45 + t * 0.4 + exp * 0.15, 0, 1);
  }
  function marketFitScore(h, raceOpts) {
    raceOpts = raceOpts || {};
    let s = 0.5;
    if (raceOpts.surface && h.surface) {
      const ok = (h.surface === raceOpts.surface ||
                  (h.surface === '泥草双刀' && raceOpts.surface !== undefined));
      s += ok ? 0.22 : -0.22;
    }
    if (raceOpts.dir && h.special) {
      if (h.special === '左右皆可') s += 0.12;
      else if (h.special === raceOpts.dir) s += 0.18;
      else if (h.special === '左右皆不可') s -= 0.20;
      else s -= 0.14;
    }
    return clamp(s, 0, 1);
  }
  function marketBodyScore(h) {
    const g = (h.stats && h.stats['体格'] !== undefined) ? h.stats['体格'] : 60;
    return clamp(g / 100, 0, 1);
  }
  /* 市场对「本场步速」的看法 —— 与引擎同口径（paceStrengthOf），
     因为节奏本来就是从参赛表上数出来的公开信息。
     差别只在【程度】：市场只兑现真效应的 marketPaceDamp 倍。 */
  function marketPaceLevel(horses) { return paceStrengthOf(horses); }
  function marketEntryScore(h, raceOpts, rng) {
    const f = marketFormScore(h);
    const j = marketJockeyScore(h);
    const b = marketBloodScore(h);
    const a = marketAgeScore(h);
    const fit = marketFitScore(h, raceOpts);
    const body = marketBodyScore(h);
    const noise = rng ? (rng() - 0.5) * 2 : 0;           // [-1,1]
    const W = MARKET;
    let s = f * W.wForm + j * W.wJockey + b * W.wBlood + a * W.wAge +
            fit * W.wFit + body * W.wBody + noise * W.wNoise;
    /* 群体偏差：连胜溢价 / 新马被低估 */
    const starts = h.form ? (h.form['出赛'] || 0) : 0;
    const wins = h.form ? (h.form['胜利'] || 0) : 0;
    const winRate = starts ? wins / starts : 0;
    if (starts > 0 && winRate >= 0.35) s /= W.biasWinStreak;
    if (starts === 0) s /= W.biasUnraced;
    return { score: s, parts: { form: f, jockey: j, blood: b, age: a, fit, body, noise } };
  }
  /* 由公开信息算出人气与赔率。
     返回 { byId, order }；每项含 人气/赔率/概率/公开评分
     关键：评分先按本场标准差标准化，再进 softmax。
     否则"权重和"和"参赛马数量"会间接改变市场自信度——参数就失去意义了。 */
  function marketOddsAndPopularity(horses, raceOpts, rng) {
    const pace = marketPaceLevel(horses);
    const scored = horses.map((h) => {
      const e = marketEntryScore(h, raceOpts, rng);
      // 根据公开历史倾向预测节奏影响；这是市场信念与游戏偏差，
      // 不是真实物理效应，也不保证市场必然低估某种临场战术。
      const marketBelief = (pace.strength - 1) * (PACE_MARKET_BELIEF[h.style] || 0);
      const damped = marketBelief * MARKET.marketPaceDamp;
      e.score += damped * MARKET.wPace;
      e.parts.pace = damped;
      return { h, score: e.score, parts: e.parts };
    });
    /* 标准化：让评分分布与权重无关 */
    const n = scored.length || 1;
    const mu = scored.reduce((s, x) => s + x.score, 0) / n;
    const sd = Math.sqrt(scored.reduce((s, x) => s + (x.score - mu) * (x.score - mu), 0) / n);
    const std = sd > 1e-9 ? (x) => (x - mu) / sd : () => 0;
    const exps = scored.map((x) => Math.exp(std(x.score) / MARKET.temp));
    const sum = exps.reduce((s, v) => s + v, 0) || 1;
    scored.forEach((x, i) => { x.p = exps[i] / sum; });
    const byId = {};
    scored.forEach((x) => {
      /* 赔率 = (1-takeout)/p：Σ(1/赔率) = 1/(1-takeout)，抽水恒定 */
      const odds = Math.max(1.05, (1 - MARKET.takeout) / Math.max(1e-6, x.p));
      byId[x.h.id] = {
        '人气': 0, '赔率': Math.round(odds * 10) / 10, '概率': x.p,
        '公开评分': x.score, '标准分': std(x.score), parts: x.parts,
      };
    });
    const order = scored.slice().sort((a, b) => b.p - a.p);
    order.forEach((x, i) => { byId[x.h.id]['人气'] = i + 1; });
    return { byId, order: order.map((x) => x.h.id) };
  }
  /* 由赔率反推市场隐含概率（含抽水），供"是否存在正期望"判断 */
  function marketImpliedProb(odds) { return Math.max(0, 1 / Math.max(1.0001, odds)); }
  /* 正期望判断：真实概率 × 赔率 > 1 才值得下注 */
  function expectedValue(trueP, odds) { return trueP * Math.max(0, odds) - 1; }

  /* ---------------- 情报生成（4.5 三层误差） ---------------- */
  function makeStaff(rng) {
    return {
      '牧场长': { '相马眼': weightedPick(rng, [['S', 5], ['A', 30], ['B', 30], ['C', 25], ['D', 8], ['E', 2]]) },
      '调教师': { '洞察力': weightedPick(rng, [['S', 5], ['A', 28], ['B', 30], ['C', 25], ['D', 10], ['E', 2]]) },
      '厩务员': { '护理力': weightedPick(rng, [['S', 8], ['A', 26], ['B', 30], ['C', 24], ['D', 10], ['E', 2]]) },
    };
  }
  function generateReport(horse, staff, rng) {
    const lines = [];
    const pool = ['速度', '爆发力', '出闸能力', '耐力', '力量', '毅力', '智力', '体格'];
    const s1 = pick(rng, pool);
    const s2 = pick(rng, pool.filter((s) => s !== s1));
    /* 1. 牧场长报告：真实值 → 观测值(绝对误差) → 评语 */
    const err1 = STAFF['相马眼'][staff['牧场长']['相马眼']];
    const obs1 = clamp(Math.round(horse.stats[s1] + (rng() * 2 - 1) * err1 * (0.5 + rng() * 0.5)), 0, 115);
    lines.push({
      source: '牧场长', kind: 'stat', stat: s1,
      truth: horse.stats[s1], obs: obs1,
      text: tierText(s1, obs1), truthText: tierText(s1, horse.stats[s1]),
      correct: tierIdx(horse.stats[s1]) === tierIdx(obs1),
      grade: '相马眼 ' + staff['牧场长']['相马眼'] + ' 级',
    });
    /* 2. 调教师报告：百分比误差 */
    const err2 = STAFF['洞察力'][staff['调教师']['洞察力']];
    const obs2 = clamp(Math.round(horse.stats[s2] * (1 + (rng() < 0.5 ? -1 : 1) * err2 / 100 * (0.5 + rng() * 0.5))), 0, 115);
    lines.push({
      source: '调教师', kind: 'stat', stat: s2,
      truth: horse.stats[s2], obs: obs2,
      text: tierText(s2, obs2), truthText: tierText(s2, horse.stats[s2]),
      correct: tierIdx(horse.stats[s2]) === tierIdx(obs2),
      grade: '洞察力 ' + staff['调教师']['洞察力'] + ' 级',
    });
    /* 3. 调教师类别判断：正确率 + 错误池 */
    const cat = pick(rng, ['场地适性', '特殊适性']);
    const truthCat = horse[cat === '场地适性' ? 'surface' : 'special'];
    const correct = rng() * 100 < STAFF['正确率'][staff['调教师']['洞察力']];
    const claim = correct ? truthCat : pick(rng, CAT_ERROR_POOL[cat][truthCat]);
    lines.push({
      source: '调教师', kind: 'cat', cat,
      claim, truth: truthCat, correct,
      text: catText(cat, claim), truthText: catText(cat, truthCat),
      grade: '洞察力 ' + staff['调教师']['洞察力'] + ' 级',
    });
    /* 4. 厩务员疲劳判断 */
    const fObs = clamp(Math.round(horse['疲劳'] + (rng() * 2 - 1) * STAFF['相马眼'][staff['厩务员']['护理力']] * (0.6 + rng() * 0.4)), 0, 110);
    lines.push({
      source: '厩务员', kind: 'fatigue',
      obs: fObs, truth: horse['疲劳'],
      text: fatigueText(fObs), truthText: fatigueText(horse['疲劳']),
      correct: fatigueBand(fObs) === fatigueBand(horse['疲劳']),
      grade: '护理力 ' + staff['厩务员']['护理力'] + ' 级',
    });
    return { lines, staff };
  }

  /* ---------------- 连续比赛引擎 ----------------
     跑法为历史表现标签；物理、属性生成和骑乘决策均不读取跑法系数。
     持续供能与短时储备共同支付实际功率；毅力表示疲劳耐受，两者并行变化。
     H.control 是验证/外部控制入口：{targetV,targetT}；不读取全场均值决定速度或成本。
  */
  function createRace(field, opts) {
    const o=opts||{}, length=Number(o.length)||2000;
    if(!Array.isArray(field)||!field.length||!Number.isFinite(length)||length<200) throw new Error('无效参赛阵容或距离');
    const surface=o.surface||'草地', state=o.state||'良';
    const sandboxProfile=SLOPE_PROFILES[o.profile]?o.profile:'缓坂';
    const geo=trackGeometry(length,o.course||o.venue,surface), rng=o.rng||mulberry32(1);
    const dir=geo.direction||(o.dir==='右回'?'右回':'左回');
    const profile=geo.elevationProfile?'官方高程':sandboxProfile,g=geo.elevationProfile?0:SLOPE_PROFILES[sandboxProfile].g;
    const wind=clamp(Number(o.wind)||0,-12,12);
    const prediction=paceStrengthOf(field);
    const race={length,surface,state,dir,profile,g,geo,wind,course:geo.course,t:0,finished:false,
      events:[],order:[],dnf:[],winnerTime:null,pacePrediction:prediction,
      paceStrength:1,paceLevel:'平均',paceContest:0,avgV:0,avgBase:0,
      prevLead:null,posHistory:[],_lastPct:0,lastEventAt:{},sectionals:[]};
    // 预算网格随真实路线而定。弯直、高程及圈接点必须保留，细分仅用于积分。
    const routeKeys=[0,length,...geo.boundaries.map(b=>b.s)];
    if(geo.elevationProfile) {
      for(let loop=-1;loop<=Math.ceil(length/geo.lap)+1;loop++) {
        for(const [at] of geo.elevationProfile) {
          const s=loop*geo.lap+at-geo.startOffset;
          if(s>0&&s<length) routeKeys.push(s);
        }
      }
    }
    routeKeys.sort((a,b)=>a-b);
    const routeCorners=routeKeys.filter((s,i)=>!i||s-routeKeys[i-1]>1e-7);
    function planningPoints(maxStep=40) {
      const points=[0];
      for(let i=1;i<routeCorners.length;i++) {
        const a=routeCorners[i-1],b=routeCorners[i],n=Math.ceil((b-a)/maxStep);
        for(let j=1;j<=n;j++) points.push(a+(b-a)*j/n);
      }
      return points;
    }
    const routeMesh=planningPoints();
    const gates=field.map((_,i)=>i+1);
    for(let i=gates.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [gates[i],gates[j]]=[gates[j],gates[i]]; }
    const horses=field.map((h,i)=>{
      const adj={}; const mor=((h['斗志']??70)-50)*0.0002;
      for(const k of ['速度','爆发力','出闸能力','耐力','力量','毅力','体格','智力']) adj[k]=clamp((h.stats[k]??70)*(1+mor),1,115);
      const gate=gates[i], width=geo.width||TRACK_WIDTH;
      // 单排闸位不得靠压缩身体或生成虚构前后闸列容纳超额阵容。
      const pitch=Math.min(1.6,(width-2)/field.length);
      if(pitch<0.95) throw new Error('赛道宽度不足以合法布置'+field.length+'匹单排发走闸');
      const t=1+pitch*(gate-0.5);
      const surfC=(SURFACE_COEF[surface]||{})[h.surface]??1;
      const base=baseSpeed(adj['速度']), fatMult=fatigueMultiplier(h['疲劳']||0);
      const behavior=horseBehavior(h), plan=racePlanFor(h,behavior), physiology=horsePhysiology(h);
      const bodyMass=clamp(Number(h.bodyMass)||450+(adj['体格']-70)*1.5,320,650);
      const carriedWeight=clamp(Number(h.carriedWeight)||57,40,70), massRatio=(bodyMass+carriedWeight)/(bodyMass+57);
      const H={h,id:h.id,name:h.name,style:h.style||'先',jockey:h.jockeyGrade||'普通',adj,mor,gate,
        behavior,plan,physiology,bodyMass,carriedWeight,massRatio,
        s:0,t,targetT:t,v:0,prevV:0,pot:0,targetV:base,accel:0,power:0,gateOpen:false,startSettled:false,
        stamina:adj['耐力']*RACE_F.staminaPer*(1+0.10*physiology.power),
        staminaMax:adj['耐力']*RACE_F.staminaPer*(1+0.10*physiology.power),
        guts:adj['毅力']*RACE_F.gutsPer*(1+0.10*physiology.durability),
        gutsMax:adj['毅力']*RACE_F.gutsPer*(1+0.10*physiology.durability),
        stage:'耐力',retention:1,base,fatMult,fieldCoef:(FIELD_STATE_COEF[state]||1)*surfC,
        surfaceCost:1+(1-surfC)*0.75,startDelay:0.12+(100-adj['出闸能力'])*0.003+rng()*0.15,
        action:null,actionT:0,lastObserve:0,laneIntentT:0,laneJitter:0,squeezePass:0,
        blocked:false,blocker:null,collisionCoef:1,collisionIntensity:0,stallTimer:0,
        place:null,time:null,gapAtWin:null,dnf:false,sprintAt:null,sectionals:[],
        cumulativeWork:0,statsSummary:{workUsed:0,aerobicUsed:0,energyUsed:0,unpaidWork:0,recovered:0,draftSeconds:0,blockedSeconds:0,peakSpeed:0,sprintAt:null},
        aggression:h.aggression??1,aiBias:(rng()-0.5)*0.12};
      H.economy=Math.exp((70-adj['速度'])*RACE_F.efficiencyPerPoint)*(1-0.025*physiology.economy);
      H.aerobic=clamp(RACE_F.aerobicPower+(adj['耐力']-70)*RACE_F.aerobicPerPoint,35,RACE_F.aerobicCeiling)*fatMult*(1+0.05*physiology.endurance);
      H.aerobicTau=RACE_F.aerobicTau*(1-0.20*physiology.kinetics)*clamp(1-(adj['耐力']-70)*0.002,0.85,1.15);
      H.reservePower=RACE_F.reservePower*(1+0.12*physiology.power)*clamp(1+(adj['爆发力']-70)*0.005,0.75,1.25);
      H.fatigueLoss=RACE_F.fatigueLoss*(1-0.20*physiology.durability);
      H.fatigueWork=RACE_F.fatigueWork*(1-0.08*physiology.endurance);
      H.fatigueExcess=RACE_F.fatigueExcess*(1-0.10*physiology.durability);
      H.recoveryRate=RACE_F.recoveryRate*(1+0.15*physiology.endurance);
      H.recoveryMax=RACE_F.recoveryMax*(1+0.15*physiology.endurance);
      H.aerobicOutput=H.aerobic*0.45;
      H.maxV=(base+RACE_F.peakExtra+(adj['爆发力']-70)*RACE_F.burstSpeedK)*fatMult*(1+0.006*physiology.power);
      H.powerFor=(v,a,drafting,at=H.s)=>powerCost(H,v,a,drafting,at);
      H.sustainableV=(at=H.s,drafting=false,power=H.aerobic*H.retention)=>speedAtPower(H,power,drafting,at);
      H.kineticCost=(from,to)=>0.5*Math.max(0,to*to-from*from)*H.massRatio;
      // 验证/诊断入口：不消耗随机数，也不修改马匹或比赛状态。
      H.finishPlan=(requestedV,draftDistance=0,options={})=>finishPlan(H,requestedV,draftDistance,options);
      H.projectActions=(actions,options={})=>projectActions(H,actions,options);
      H.cruise=H.sustainableV();
      return H;
    }); race.horses=horses;
    function event(text,force) {
      if(!force && race.lastEventAt[text]!==undefined && race.t-race.lastEventAt[text]<4) return;
      race.lastEventAt[text]=race.t; if(race.events.length>80) race.events.shift(); race.events.push({t:race.t,text});
    }
    const active=()=>horses.filter(H=>!H.place&&!H.dnf);
    const ranked=()=>active().sort((a,b)=>b.s-a.s || a.gate-b.gate);
    function setAction(H,type,dur=2) { H.action=type; H.actionT=dur; }
    function setLaneTarget(H,t) {
      const margin=horseWid(H)/2+0.2; H.targetT=clamp(t,margin,trackWidthAt(H.s,geo)-margin);
      H.laneIntentT=Math.abs(H.targetT-H.t)/RACE_F.lateralSpeed+2;
    }
    function frontOf(H,limit=26) {
      return active().filter(F=>F!==H && F.s>H.s && F.s-H.s<limit && Math.abs(F.t-H.t)<(horseWid(H)+horseWid(F))/2+0.3)
        .sort((a,b)=>a.s-b.s)[0]||null;
    }
    // 路线只比较附近马匹和可达的通道；横移时间与弯道外绕都是机会成本。
    function findGap(H,preferInner) {
      const others=active().filter(F=>F!==H && F.s>H.s-8 && F.s<H.s+24);
      const margin=horseWid(H)/2+0.25;
      let best=null,bestScore=-Infinity;
      for(let t=margin;t<=trackWidthAt(H.s,geo)-margin;t+=0.35) {
        const shift=Math.abs(t-H.t);
        if(shift>5.6) continue;
        // 身体并排时不能穿过对手；前方堵塞可先收力再横移。
        if(others.some(F=>Math.abs(F.s-H.s)<(horseLen(H)+horseLen(F))/2-0.05 &&
          Math.min(H.t,t)-(horseWid(H)+horseWid(F))/2-0.15<F.t &&
          F.t<Math.max(H.t,t)+(horseWid(H)+horseWid(F))/2+0.15)) continue;
        const corridor=others.filter(F=>Math.abs(F.t-t)<(horseWid(H)+horseWid(F))/2+0.25);
        if(corridor.some(F=>Math.abs(F.s-H.s)<(horseLen(H)+horseLen(F))/2+0.7)) continue;
        const front=corridor.filter(F=>F.s>H.s).sort((a,b)=>a.s-b.s)[0];
        const pace=front?Math.min(H.targetV,front.v+Math.max(0,front.s-H.s-4)*0.22):H.targetV;
        const projected=pace*laneProgressCoef(H.s,t,geo);
        const score=projected-shift*0.12-(preferInner&&kAt(H.s,geo)>0?t*0.012:0);
        if(score>bestScore) {bestScore=score;best={t,pace,score};}
      }
      return best;
    }
    function avoidBlock(H,gap=findGap(H,true)) {
      const front=H.blocker||frontOf(H);
      const currentPace=front?Math.min(H.targetV,front.v+Math.max(0,front.s-H.s-4)*0.22):H.targetV;
      if(gap && Math.abs(gap.t-H.t)>0.25 && gap.pace>currentPace+0.10) {
        H.passTarget=front;setLaneTarget(H,gap.t);setAction(H,gap.t<H.t?'斜行in':'斜行out');
        return true;
      }
      if(front) H.targetV=Math.min(H.targetV,Math.max(3,front.v+Math.max(0,front.s-H.s-4)*0.25));
      setAction(H,'收力');return false;
    }
    function projectedCap(H,at) {
      let cap=H.maxV*H.retention;
      const curvature=laneCurvatureAt(at,H.t,geo);
      if(curvature>0) cap=Math.min(cap,Math.sqrt(Math.max(1,
        (RACE_F.curveLateral+(H.adj['力量']-70)*0.008)/curvature))*bendCoefFor(H.h.special,dir));
      return cap;
    }
    // 状态推进共用实际供能、有限加速、弧长运动和储备/疲劳/恢复结算。
    // 余程预算是需求可支付检查；动作预测是受限制的执行轨迹，两者不混淆。
    function raceSupplyState(H,dt) {
      const fatigue=1-H.fatigueLoss*(1-H.guts/H.gutsMax);
      const aerobicTarget=H.aerobic*fatigue;
      const aerobic=(H.aerobicOutput??H.aerobic*0.45)+(aerobicTarget-(H.aerobicOutput??H.aerobic*0.45))*(1-Math.exp(-dt/H.aerobicTau));
      const reserveFade=clamp(clamp(H.stamina/H.staminaMax,0,1)/RACE_F.reserveFade,0,1);
      const reservePower=Math.min(H.reservePower*reserveFade,Math.max(0,H.stamina)/dt);
      return {fatigue,aerobicTarget,aerobic,reserveFade,reservePower,maxPower:aerobic+reservePower};
    }
    function raceEnergyState(H,work,aerobic,dt) {
      const excess=Math.max(0,work-aerobic),draw=Math.min(H.stamina,excess*dt);
      const restore=Math.min(H.staminaMax-H.stamina,Math.max(0,aerobic*0.90-work)*H.recoveryRate*dt,H.recoveryMax*dt);
      const stamina=clamp(H.stamina-draw+restore,0,H.staminaMax);
      const guts=Math.max(0,H.guts-(H.fatigueWork*work+H.fatigueExcess*excess)*dt);
      return {excess,draw,restore,stamina,guts,retention:1-H.fatigueLoss*(1-guts/H.gutsMax)};
    }
    function raceAccelerationLimits(H,supply,drafting) {
      const mix=clamp(H.v/H.base,0,1);
      const maxA=(RACE_F.maxAccel*(0.7+H.adj['出闸能力']/230)*(1-mix)+
        RACE_F.runningAccel*(0.65+H.adj['爆发力']/200)*mix)*(0.65+0.35*supply.reserveFade);
      const response=RACE_F.responseTime*clamp(1+(0.65-H.behavior.tractability)*0.4,0.82,1.26);
      const kineticBudget=Math.max(0,supply.maxPower-powerCost(H,H.v,0,drafting))/(H.massRatio*Math.max(H.v,1));
      return {maxA,response,kineticBudget};
    }
    function raceKinematicProposal(H,before,v,transverse,dt,startFraction,aerobic) {
      const bodyMargin=horseWid(H)/2,width=trackWidthAt(H.s,geo);
      const lateralLimit=Math.min(RACE_F.lateralSpeed,(H.v+v)/2*0.06)*dt*startFraction;
      const t=clamp(H.t+clamp(transverse-H.t,-lateralLimit,lateralLimit),bodyMargin,width-bodyMargin);
      const lateral=startFraction?(t-before.t)/(dt*startFraction):0,travelV=(H.v+v)/2;
      const forwardV=Math.sqrt(Math.max(0,travelV*travelV-lateral*lateral));
      return {s:laneAdvance(H.s,forwardV*dt*startFraction,(H.t+t)/2,geo),
        t,v,a:(v-H.v)/dt,travelV,lateral,aerobic,activeFraction:startFraction};
    }
    function projectionCopy(H) {
      // The forecast mutates only top-level motion/energy fields (s, t, v, stamina,
      // guts, retention, aerobicOutput). adj / behavior / statsSummary are read-only
      // for the whole projection: there is no assignment to .adj[...] , .adj.x,
      // .behavior.x or .statsSummary.x anywhere in the engine, and none inside the
      // projection. Sharing them keeps the forecast isolated exactly as before while
      // removing three throwaway objects per copy, which the closure-heavy planner
      // performs twice per candidate.
      return {...H};
    }
    function followingBodyLength(H) {return H.observedBodyLength??horseLen(H);}
    function followingBodyWidth(H) {return H.observedBodyWidth??horseWid(H);}
    function followingBodyClearance(H,F,hs,fs,ht,ft) {
      const scale=Math.max(1,trafficProgressCoef(hs,ht),trafficProgressCoef(fs,ft));
      return {longitudinal:((followingBodyLength(H)+followingBodyLength(F))/2+0.20)*scale,
        lateral:(followingBodyWidth(H)+followingBodyWidth(F))/2+0.10};
    }
    function followingSpeedCap(H,F,before=H,frontBefore=F) {
      if(!F)return Infinity;
      const gap=frontBefore.s-before.s-(followingBodyLength(H)+followingBodyLength(F))/2-0.25;
      return Math.max(0,frontBefore.v+gap*0.65);
    }
    function projectionWake(H,F) {
      return !!F&&!F.finished&&F!==H&&F.s>H.s&&F.s-H.s<=RACE_F.draftRange&&Math.abs(F.t-H.t)<=(followingBodyWidth(H)+followingBodyWidth(F))/2+0.8;
    }
    function projectionBodySweep(H,F,before,frontBefore,move,frontMove) {
      const clear=followingBodyClearance(H,F,(before.s+move.s)/2,(frontBefore.s+frontMove.s)/2,(before.t+move.t)/2,(frontBefore.t+frontMove.t)/2);
      const longitudinal=axisOverlap(frontBefore.s-before.s,frontMove.s-move.s,clear.longitudinal);
      const lateral=axisOverlap(frontBefore.t-before.t,frontMove.t-move.t,clear.lateral);
      return !!longitudinal&&!!lateral&&Math.min(longitudinal[1],lateral[1])-Math.max(longitudinal[0],lateral[0])>1e-9;
    }
    function projectionMove(H,requestedV,requestedT,drafting,dt,time,demand=false,front=null,traffic=[]) {
      const before={s:H.s,t:H.t,v:H.v},supply=raceSupplyState(H,dt);
      H.aerobicOutput=supply.aerobic;
      const maxVelocity=H.maxV*supply.fatigue,powerVelocity=speedAtPower(H,supply.maxPower,drafting);
      const curvature=laneCurvatureAt(H.s,H.t,geo),curveVelocity=curvature>0?Math.sqrt(Math.max(1,
        (RACE_F.curveLateral+(H.adj['力量']-70)*0.008)/curvature))*bendCoefFor(H.h.special,dir):Infinity;
      const physicalCap=Math.min(maxVelocity,curveVelocity),cap=demand?physicalCap:Math.min(physicalCap,powerVelocity);
      const followingCap=followingSpeedCap(H,front,before,front);
      const fraction=clamp((time+dt-H.startDelay)/dt,0,1),desired=fraction?Math.min(Math.max(0,requestedV),cap,followingCap):0;
      const limits=raceAccelerationLimits(H,supply,drafting),upperA=demand?limits.maxA:Math.min(limits.maxA,limits.kineticBudget);
      const a=clamp((desired-H.v)/limits.response,-RACE_F.braking,upperA);
      const freeV=Math.max(0,H.v+a*dt*fraction),minimumV=Math.max(0,H.v-RACE_F.braking*dt*fraction);
      const margin=horseWid(H)/2+0.2,targetT=clamp(requestedT,margin,trackWidthAt(H.s,geo)-margin);
      const proposalCache=new Map();
      const propose=v=>{if(!proposalCache.has(v))proposalCache.set(v,raceKinematicProposal(H,before,v,targetT,dt,fraction,supply.aerobic));return proposalCache.get(v);};
      let move=propose(freeV),work=motionPower(H,before,move,drafting,dt),finiteBrakingFeasible=true;
      if(!demand&&work>supply.maxPower+1e-7) {
        let low=minimumV,high=freeV;
        if(motionPower(H,before,propose(low),drafting,dt)>supply.maxPower+1e-7) finiteBrakingFeasible=false;
        else {
          for(let n=0;n<28;n++) {const mid=(low+high)/2;if(motionPower(H,before,propose(mid),drafting,dt)<=supply.maxPower) low=mid;else high=mid;}
          move=propose(low);work=motionPower(H,before,move,drafting,dt);
        }
      }
      let trafficFeasible=true,headwayLimited=false;
      if(traffic.length) {
        let followingSlack=null;
        const ahead=traffic.filter(x=>x.before.s>before.s).sort((a,b)=>b.before.s-a.before.s);
        for(const observed of ahead) {
          const F=observed.h,fm=observed.move,clear=followingBodyClearance(H,F,before.s,observed.before.s,before.t,observed.before.t);
          const transverse=axisOverlap(observed.before.t-before.t,fm.t-move.t,clear.lateral);
          if(!transverse)continue;
          followingSlack??=followingConstraintSolver(Math.max(freeV,...traffic.map(x=>x.move.v)));
          if(followingSlack(H,F,move,fm)>=-1e-8)continue;
          const lower=propose(minimumV);headwayLimited=true;
          if(followingSlack(H,F,lower,fm)<-1e-7) {
            if(followingSlack(H,F,lower,fm,false)<-1e-7)trafficFeasible=false;
            move=lower;
          } else {
            let low=minimumV,high=move.v;
            for(let n=0;n<28;n++){const mid=(low+high)/2;if(followingSlack(H,F,propose(mid),fm)>=0)low=mid;else high=mid;}
            move=propose(low);
          }
          work=motionPower(H,before,move,drafting,dt);
          if(!demand&&work>supply.maxPower+1e-7)finiteBrakingFeasible=false;
        }
      }
      const energy=raceEnergyState(H,work,supply.aerobic,dt),path=laneArcDistance(before.s,move.s,(before.t+move.t)/2,geo);
      const finishTime=move.s>=length?time+dt*(1-fraction)+(path>0?clamp(laneArcDistance(before.s,length,(before.t+move.t)/2,geo)/path,0,1)*dt*fraction:dt*fraction):null;
      H.s=move.s;H.t=move.t;H.v=move.v;H.stamina=energy.stamina;H.guts=energy.guts;H.retention=energy.retention;
      return {before,move,supply,limits,energy,work,finishTime,finiteBrakingFeasible,
        requestedV,desired,physicalCap,powerVelocity,curveVelocity,cap,drafting,followingCap,trafficFeasible,headwayLimited,
        requestedPowerShortfall:Math.max(0,work-supply.maxPower),velocityCapShortfall:Math.max(0,requestedV-physicalCap),
        requestedTrackingShortfall:Math.max(0,requestedV-(before.v+move.v)/2)};
    }
    function projectActions(H,actions,options={}) {
      if(!Array.isArray(actions)||actions.length>32) throw new Error('动作预测需要至多32个有限动作');
      // Only s/t/v are ever read back from the pre-override snapshot; the reserve is
      // reported from initialReserve below, so a second full horse copy is not needed.
      const local=projectionCopy(H),initial={s:H.s,t:H.t,v:H.v},atTime=race.t;
      if(Number.isFinite(options.reserve)) local.stamina=clamp(options.reserve,0,local.staminaMax);
      const initialReserve=local.stamina;
      const requestedMode=options.demand===true,maxDt=clamp(Number.isFinite(options.maxDt)?options.maxDt:1/30,1/120,1);
      const tickOrigin=Number.isFinite(options.tickOrigin)?options.tickOrigin:atTime;
      // Measured A/B: coarsening this step is NOT a safe optimisation. budgetSpeed
      // feeds its result back into rider speed choice, so a coarser integral changes
      // which race is run: same source, same seed, 8 horses 4x slower / 16 horses 2x
      // faster, because the 8-horse race became a different (longer) race. Keep the
      // reference resolution until the remainder budget can be computed with an
      // identical-result, cheaper algorithm.
      const tailMaxDt=clamp(Number.isFinite(options.tailMaxDt)?options.tailMaxDt:0.5,1/120,1);
      const ledger={work:0,aerobicUsed:0,energyUsed:0,requiredDraw:0,recovered:0,unpaidWork:0,kineticChange:0,positiveKineticWork:0};
      const limits={requestSeconds:0,velocitySeconds:0,powerSeconds:0,curveSeconds:0,accelerationSeconds:0,draftingSeconds:0,followingSeconds:0,headwaySeconds:0};
      let elapsed=0,steps=0,finished=local.s>=length,finishTime=finished?atTime:null,finiteBrakingFeasible=true,trafficFeasible=true,pathConflict=false,peakPowerShortfall=0,targetShortfall=0,trackingIntegral=0,stoppedEarly=false;
      const segments=[],trace=options.trace?[]:null,observedLeaders=new Map();let previousLeader=null;
      // Optional public launch hypothesis. The default observation API remains
      // the measured-motion extrapolator, including fixed-control comparisons.
      const suppliedPrior=options.opponentMotionPrior;
      const motionPrior=suppliedPrior&&Number.isFinite(suppliedPrior.pace)&&suppliedPrior.pace>0?{
        pace:clamp(suppliedPrior.pace,3,30),
        launchUntil:Number.isFinite(suppliedPrior.launchUntil)?Math.max(0,suppliedPrior.launchUntil):0.8,
        assumedDelay:Number.isFinite(suppliedPrior.assumedDelay)?Math.max(0,suppliedPrior.assumedDelay):0.3}:null;
      let opponentPathConflict=false;
      const multipleOpponents=Object.prototype.hasOwnProperty.call(options,'opponents');
      if(multipleOpponents&&(!Array.isArray(options.opponents)||options.opponents.length>128))throw new Error('可见对手预测需要至多128个观测记录');
      function observation(seen) {
        if(!seen||![seen.s,seen.t,seen.v].every(Number.isFinite)||seen.v<0)throw new Error('对手预测需要可见位置与非负速度');
        const key=seen.id??JSON.stringify([seen.s,seen.t,seen.v,seen.accel,seen.lateralV,seen.bodyWidth,seen.bodyLength,seen.observedAt]);
        if(observedLeaders.has(key))return observedLeaders.get(key);
        const size=!multipleOpponents&&Number.isFinite(seen.bodySize)?seen.bodySize:70;
        const F={id:seen.id??'visible-'+observedLeaders.size,s:seen.s,t:seen.t,v:seen.v,observedV:seen.v,
          observedAt:Number.isFinite(seen.observedAt)?seen.observedAt:atTime,lastAt:Number.isFinite(seen.observedAt)?seen.observedAt:atTime,
          adj:{'体格':size},observedBodyWidth:Number.isFinite(seen.bodyWidth)&&seen.bodyWidth>0?seen.bodyWidth:horseWid({adj:{'体格':size}}),
          observedBodyLength:Number.isFinite(seen.bodyLength)&&seen.bodyLength>0?seen.bodyLength:horseLen({adj:{'体格':size}}),
          accel:clamp(Number.isFinite(seen.accel)?seen.accel:0,-RACE_F.braking,RACE_F.runningAccel),
          lateralV:clamp(Number.isFinite(seen.lateralV)?seen.lateralV:0,-RACE_F.lateralSpeed,RACE_F.lateralSpeed),finished:seen.s>=length};
        F.launchPrior=!!motionPrior&&((F.observedAt<motionPrior.launchUntil&&F.observedV<3)||
          (F.accel>0.3&&F.observedV<motionPrior.pace*0.9));
        observedLeaders.set(key,F);return F;
      }
      function observedMove(F,dt,time) {
        const age=Math.max(0,time+dt-F.observedAt),tau=RACE_F.responseTime;
        let v;
        if(F.launchPrior) {
          const delay=F.observedV>0?0:Math.max(0,motionPrior.assumedDelay-F.observedAt);
          const fraction=clamp((time+dt-F.observedAt-delay)/dt,0,1);
          const mix=clamp(F.v/Math.max(3,motionPrior.pace),0,1);
          const acceleration=RACE_F.maxAccel*(0.7+70/230)*(1-mix)+RACE_F.runningAccel*(0.65+70/200)*mix;
          v=Math.max(0,F.v+clamp((motionPrior.pace-F.v)/tau,-RACE_F.braking,acceleration)*dt*fraction);
          // Fractional stall release must not advance along the full time step.
          dt*=fraction;
        } else v=Math.max(0,F.observedV+F.accel*tau*(1-Math.exp(-age/tau)));
        const meanV=(F.v+v)/2;
        const margin=followingBodyWidth(F)/2,width=trackWidthAt(F.s,geo),lateralLimit=Math.min(RACE_F.lateralSpeed,meanV*0.06);
        const t=clamp(F.t+clamp(F.lateralV,-lateralLimit,lateralLimit)*dt,margin,width-margin),lateral=dt>0?(t-F.t)/dt:0;
        return {s:laneAdvance(F.s,Math.sqrt(Math.max(0,meanV*meanV-lateral*lateral))*dt,(F.t+t)/2,geo),t,v};
      }
      function catchObservationUp(F,time) {
        while(!F.finished&&F.lastAt<time-1e-10){const dt=Math.min(maxDt,time-F.lastAt),move=observedMove(F,dt,F.lastAt);
          Object.assign(F,move);F.lastAt+=dt;F.finished=F.s>=length;}
      }
      const opponents=multipleOpponents?options.opponents.map(observation).filter((F,i,a)=>a.indexOf(F)===i):[];
      // Linear advance of the local horse is monotone inside one projection, so the
      // next route key can be tracked with a cursor instead of a full scan per step.
      // The value is identical to routeCorners.find(s => s > local.s + 1e-6).
      let cornerCursor=0;
      function nextRouteKey(s) {
        while(cornerCursor>0&&routeCorners[cornerCursor-1]>s+1e-6)cornerCursor--;
        while(cornerCursor<routeCorners.length&&routeCorners[cornerCursor]<=s+1e-6)cornerCursor++;
        return cornerCursor<routeCorners.length?routeCorners[cornerCursor]:undefined;
      }
      function run(action,isTail,index) {
        if(!action||!Number.isFinite(action.targetV)||action.targetV<0) throw new Error('无效动作预测请求速度');
        if(!isTail&&(!Number.isFinite(action.duration)||action.duration<=0||action.duration>120)) throw new Error('有限动作预测时长必须在0至120秒之间');
        const duration=isTail?600:action.duration,begin=elapsed,startS=local.s,goal=action.goal||null;
        // 对手只接受可见位置、速度/加速度及横移。不得读取目标指令或生理储备。
        let leader=previousLeader;
        if(!multipleOpponents&&action.leader)leader=observation(action.leader);
        if(Object.prototype.hasOwnProperty.call(action,'leader')&&action.leader===null) leader=null;
        previousLeader=leader;
        while(elapsed-begin<duration-1e-10&&!finished&&steps<48000) {
          let dt=Math.min(isTail?tailMaxDt:maxDt,duration-(elapsed-begin));
          // Keep one cadence across finite action boundaries. Do not start a new
          // full frame after a short boundary substep; execution consumes the
          // remaining part of the same prescribed frame before its next frame.
          if(!isTail) {
            const phase=(atTime+elapsed-tickOrigin)/maxDt;
            if(Math.abs(phase-Math.round(phase))>1e-7)dt=Math.min(dt,tickOrigin+Math.ceil(phase)*maxDt-(atTime+elapsed));
          }
          if(isTail&&(Math.abs(action.targetV-local.v)>0.8||local.stamina/local.staminaMax<0.15||local.v<3)) dt=Math.min(dt,0.05);
          const nextKey=nextRouteKey(local.s);
          if(dt>1/60+1e-10&&nextKey!=null&&local.v>1) dt=Math.min(dt,Math.max(1/120,(nextKey-local.s)/Math.max(1,local.v*laneProgressCoef(local.s,local.t,geo))));
          const visible=multipleOpponents?opponents:leader?[leader]:[];
          for(const F of visible)catchObservationUp(F,atTime+elapsed);
          // A one-way forecast only ever consumes the nearest drafter and the nearest
          // body blocker ahead, so a single pass replaces sorting every opponent on
          // every step. Ties keep the first-seen opponent, exactly as a stable sort
          // followed by .find would.
          const activeVisible=[];
          let wake=null,front=null;
          for(const F of visible) {
            if(F.finished)continue;
            activeVisible.push(F);
            if(projectionWake(local,F)&&(wake===null||F.s<wake.s))wake=F;
            if(F.s>local.s&&Math.abs(F.t-local.t)<(followingBodyWidth(local)+followingBodyWidth(F))/2+0.2&&
              (front===null||F.s<front.s))front=F;
          }
          const drafting=!!wake||!activeVisible.length&&(action.draft===true||Number.isFinite(action.draftUntil)&&local.s<action.draftUntil);
          const traffic=activeVisible.map(F=>({h:F,before:{s:F.s,t:F.t,v:F.v},move:observedMove(F,dt,atTime+elapsed)}));
          const result=projectionMove(local,action.targetV,Number.isFinite(action.targetT)?action.targetT:local.t,drafting,dt,atTime+elapsed,requestedMode,front,traffic);
          if(!result.trafficFeasible){trafficFeasible=false;pathConflict=true;}
          for(const observed of traffic){if(projectionBodySweep(local,observed.h,result.before,observed.before,result.move,observed.move))pathConflict=true;
            Object.assign(observed.h,observed.move);observed.h.lastAt=atTime+elapsed+dt;observed.h.finished=observed.h.s>=length;}
          // Peers may respond to each other, which this one-way forecast cannot know.
          // Their mutual extrapolated collision is uncertainty, not an own route veto.
          if(!opponentPathConflict) {
            peerCollision:for(let a=0;a<traffic.length;a++)for(let b=a+1;b<traffic.length;b++) {
              if(projectionBodySweep(traffic[a].h,traffic[b].h,traffic[a].before,traffic[b].before,traffic[a].move,traffic[b].move)) {
                opponentPathConflict=true;break peerCollision;
              }
            }
          }
          const {energy,supply,work}=result;
          ledger.work+=work*dt;ledger.aerobicUsed+=Math.min(work,supply.aerobic)*dt;ledger.energyUsed+=energy.draw;
          ledger.requiredDraw+=energy.excess*dt;ledger.recovered+=energy.restore;ledger.unpaidWork+=Math.max(0,work*dt-Math.min(work,supply.aerobic)*dt-energy.draw);
          const kinetic=0.5*(result.move.v*result.move.v-result.before.v*result.before.v)*local.massRatio;
          ledger.kineticChange+=kinetic;ledger.positiveKineticWork+=Math.max(0,kinetic);
          peakPowerShortfall=Math.max(peakPowerShortfall,result.requestedPowerShortfall);targetShortfall=Math.max(targetShortfall,Math.max(0,action.targetV-result.cap));trackingIntegral+=result.requestedTrackingShortfall*dt;
          if(action.targetV<=result.cap+1e-7) limits.requestSeconds+=dt;
          if(result.physicalCap<=Math.min(result.powerVelocity,result.curveVelocity)+1e-7&&action.targetV>=result.cap-1e-7) limits.velocitySeconds+=dt;
          if(result.powerVelocity<=Math.min(result.physicalCap,result.curveVelocity)+1e-7&&action.targetV>=result.cap-1e-7) limits.powerSeconds+=dt;
          if(result.curveVelocity<=Math.min(result.physicalCap,result.powerVelocity)+1e-7&&action.targetV>=result.cap-1e-7) limits.curveSeconds+=dt;
          if(Math.abs(result.move.a-result.limits.maxA)<1e-6) limits.accelerationSeconds+=dt;
          if(drafting) limits.draftingSeconds+=dt;
          if(result.followingCap<Math.min(action.targetV,result.cap)-1e-7)limits.followingSeconds+=dt;
          if(result.headwayLimited)limits.headwaySeconds+=dt;
          elapsed+=dt;steps++;
          if(!result.finiteBrakingFeasible) finiteBrakingFeasible=false;
          if(trace) trace.push({time:atTime+elapsed,s:local.s,t:local.t,v:local.v,stamina:local.stamina,guts:local.guts,retention:local.retention,aerobicOutput:local.aerobicOutput,work,supply:supply.aerobic,drafting,requestedV:action.targetV,
            followingCap:result.followingCap,headwayLimited:result.headwayLimited,trafficFeasible:result.trafficFeasible,frontId:front?.id??null,wakeId:wake?.id??null,
            ...(wake||leader?{observedLeader:{s:(wake||leader).s,t:(wake||leader).t,v:(wake||leader).v}}:{}),
            ...(multipleOpponents?{opponents:visible.map(F=>({id:F.id,s:F.s,t:F.t,v:F.v,finished:F.finished}))}:{})});
          if(result.finishTime!=null) {finished=true;finishTime=result.finishTime;}
          if(!finiteBrakingFeasible||!trafficFeasible||options.earlyExit&&requestedMode&&(peakPowerShortfall>1e-7||ledger.requiredDraw>initialReserve+ledger.recovered+1e-7)) {stoppedEarly=true;break;}
        }
        const goalReached=!goal||(Number.isFinite(goal.s)?local.s>=goal.s-(goal.tolerance??0.02):true)&&
          (Number.isFinite(goal.t)?Math.abs(local.t-goal.t)<=(goal.lateralTolerance??0.2):true);
        segments.push({index,from:startS,to:local.s,time:elapsed-begin,duration:elapsed-begin,requestedDuration:action.duration??null,
          startedAt:atTime+begin,endedAt:atTime+elapsed,targetV:action.targetV,goalReached,...(goal?{goal:{...goal},distanceShortfall:Number.isFinite(goal.s)?Math.max(0,goal.s-local.s):0}:{})});
      }
      for(let i=0;i<actions.length&&!finished&&!stoppedEarly;i++) run(actions[i],false,i);
      if(!finished&&!stoppedEarly&&Number.isFinite(options.tailTargetV)) run({targetV:options.tailTargetV,targetT:options.tailTargetT??local.t,draftUntil:options.tailDraftUntil},true,actions.length);
      const completionRequired=Number.isFinite(options.tailTargetV),complete=!stoppedEarly&&steps<48000&&(!completionRequired||finished);
      const energyFeasible=finiteBrakingFeasible&&peakPowerShortfall<=1e-7&&ledger.unpaidWork<=1e-6;
      const requestedEnergyFeasible=finiteBrakingFeasible&&peakPowerShortfall<=1e-7&&ledger.requiredDraw<=initialReserve+ledger.recovered+1e-7;
      const finalGoal=options.goal,finalGoalReached=!finalGoal||(Number.isFinite(finalGoal.s)?local.s>=finalGoal.s-(finalGoal.tolerance??0.02):true)&&
        (Number.isFinite(finalGoal.t)?Math.abs(local.t-finalGoal.t)<=(finalGoal.lateralTolerance??0.2):true);
      return {complete,finished,seconds:finished?finishTime-atTime:elapsed,ledgerSeconds:elapsed,steps,endpoint:{s:finished?length:local.s,t:local.t,v:local.v,stamina:local.stamina,guts:local.guts,retention:local.retention,aerobicOutput:local.aerobicOutput},
        ledger,limits,required:ledger.requiredDraw,netRequired:ledger.requiredDraw-ledger.recovered,peakPowerShortfall,energyFeasible,requestedEnergyFeasible,
        goalReached:complete&&finalGoalReached&&segments.every(s=>s.goalReached),targetShortfall,meanTrackingShortfall:elapsed?trackingIntegral/elapsed:0,
        pathConflict,opponentPathConflict,trafficFeasible,trafficCertified:false,feasible:complete&&requestedEnergyFeasible,segments,
        observedLeaderEndpoints:[...observedLeaders.values()].map(F=>({id:F.id,s:F.s,t:F.t,v:F.v,finished:F.finished})),...(trace?{trace}:{}),
        model:{mode:requestedMode?'demand':'paid-execution',maxDt,tailMaxDt,tickOrigin,opponentMotionPrior:motionPrior,opponent:'visible motion only; all supplied opponents propagate once per step; closest aligned wake/front; shared finite stopping/response constraint; no hidden state or full traffic certification',initialState:{s:initial.s,t:initial.t,v:initial.v,reserve:initialReserve}}};
    }
    function finishPlan(H,requestedV,draftDistance=0,options={}) {
      if(!Number.isFinite(requestedV)||requestedV<0) throw new Error('无效预测配速');
      const from=clamp(H.s,0,length),draftEnd=Math.min(length,from+Math.max(0,draftDistance));
      const result=projectActions(H,[],{...options,demand:true,tailTargetV:Math.max(3,requestedV),tailTargetT:H.t,tailDraftUntil:draftEnd,
        tailMaxDt:Number.isFinite(options.maxStep)?clamp(options.maxStep/Math.max(1,H.v||H.base),1/120,0.5):(options.tailMaxDt??0.5)});
      return {...result,feasible:result.complete&&result.requestedEnergyFeasible};
    }

    // Shared one-way physical stopping/response constraint; no opponent hidden state.
    function followingConstraintSolver(maximumSpeed) {
      const brakingCache=new WeakMap(),stoppingCache=new WeakMap(),followingCache=new WeakMap(),brakingInterval=0.125;
      const brakingSteps=Math.ceil(maximumSpeed/RACE_F.braking/brakingInterval);
      function advancePhysical(at,distance,transverse) {
        return laneAdvance(at,distance,transverse,geo);
      }
      function stoppingEnd(move) {
        if(!stoppingCache.has(move)) stoppingCache.set(move,advancePhysical(move.s,move.v*move.v/(2*RACE_F.braking),move.t));
        return stoppingCache.get(move);
      }
      function brakingTrajectory(move) {
        if(brakingCache.has(move)) return brakingCache.get(move);
        const points=[{s:move.s,v:move.v}],events=[move.v/RACE_F.braking];let at=move.s,previous=move.v,eventsReady=false;
        function ensurePoints(until=brakingSteps) {
          for(let i=points.length;i<=until;i++) {
            const next=Math.max(0,move.v-RACE_F.braking*brakingInterval*i);
            const elapsed=previous>0?Math.min(brakingInterval,previous/RACE_F.braking):0;
            if(elapsed) at=advancePhysical(at,(previous+next)/2*elapsed,move.t);
            points.push({s:at,v:next});previous=next;
          }
          return points;
        }
        function ensureEvents() {
          if(eventsReady)return events;
          ensurePoints();
          const breakpoints=laneArcBreakpoints(move.s,at,geo);
          for(const where of breakpoints) {
            if(kAt(where-1e-4,geo)===0&&kAt(where+1e-4,geo)===0) continue;
            const distance=laneArcDistance(move.s,where,move.t,geo);
            const terminal=Math.sqrt(Math.max(0,move.v*move.v-2*RACE_F.braking*distance));
            events.push(2*distance/Math.max(1e-12,move.v+terminal));
          }
          eventsReady=true;return events;
        }
        const queryCache=new Map();
        const trajectory={get points(){return ensurePoints();},get events(){return ensureEvents();},sampleAt(time){
          const i=Math.round(time/brakingInterval),regular=Math.abs(time-i*brakingInterval)<1e-12;
          if(regular&&i>=0&&i<=brakingSteps){ensurePoints(i);return points[i];}
          return this.pointAt(time);
        },pointAt:time=>{
          if(queryCache.has(time)) return queryCache.get(time);
          const atTime=Math.min(Math.max(0,time),move.v/RACE_F.braking),v=Math.max(0,move.v-RACE_F.braking*atTime);
          const index=Math.min(brakingSteps,Math.floor(atTime/brakingInterval));ensurePoints(index);
          const base=points[index],elapsed=atTime-index*brakingInterval;
          const point={s:advancePhysical(base.s,(base.v+v)/2*elapsed,move.t),v};
          queryCache.set(time,point);return point;
        }};
        brakingCache.set(move,trajectory);return trajectory;
      }
      function followingSlack(H,F,move,frontMove,withResponse=true) {
        const ownScale=trafficProgressCoef(move.s,move.t);
        let paired=followingCache.get(move);
        if(!paired){paired=new WeakMap();followingCache.set(move,paired);}
        if(paired.has(frontMove)) return paired.get(frontMove)-(withResponse?(1/60)*move.v*ownScale:0);
        const response=(1/60)*move.v*ownScale;
        if(withResponse) {
          // One negative witness proves rejection, but is only an upper bound
          // on the full minimum. Never cache it for physical-slack queries.
          const now=frontMove.s-move.s-followingBodyClearance(H,F,move.s,frontMove.s,move.t,frontMove.t).longitudinal-response;
          if(now<-1e-7) return now;
          const rearEnd=stoppingEnd(move),frontEnd=stoppingEnd(frontMove);
          const stop=frontEnd-rearEnd-followingBodyClearance(H,F,rearEnd,frontEnd,move.t,frontMove.t).longitudinal-response;
          if(stop<-1e-7) return stop;
        }
        if(geo.progressCoefUpperBound) {
          const bodyUpper=((followingBodyLength(H)+followingBodyLength(F))/2+0.20)*Math.max(1,geo.progressCoefUpperBound);
          // 前马在未来只向前运动。若后马完整停止终点仍在前马
          // 当前身体之后，则全时域可行；几何界由导数包络保守得出。
          const lowerBound=frontMove.s-stoppingEnd(move)-bodyUpper;
          if(lowerBound>=(1/60)*move.v*ownScale+1e-8) {
            paired.set(frontMove,lowerBound);
            return lowerBound-(withResponse?(1/60)*move.v*ownScale:0);
          }
        }
        // Write the future gap as physical arc along the rear horse's lane:
        // G(t)=G(0)+dFront(t)-dRear(t)+(tRear-tFront)*deltaHeadingFront(t).
        // Equal finite braking gives dFront-dRear >= -max(0,(vr²-vf²)/(2a)).
        // The derivative-control curvature bound also covers the absolute
        // heading variation, so this proof does not assume constant curvature
        // or a monotone center-gap. If it cannot prove safety, check every cell.
        const routeBound=trafficRouteIntervalBounds(Math.min(move.s,frontMove.s),Math.max(stoppingEnd(move),stoppingEnd(frontMove)),geo);
        const curvatureUpper=routeBound?.maxCurvature??geo.maxReferenceCurvature;
        const frontMetricMargin=1-Math.abs(frontMove.t-(geo.referenceLane??(TRACK_WIDTH/2)))*curvatureUpper;
        const rearMetricMargin=1-Math.abs(move.t-(geo.referenceLane??(TRACK_WIDTH/2)))*curvatureUpper;
        if(geo.progressCoefLowerBound>0&&Number.isFinite(curvatureUpper)&&frontMetricMargin>0&&rearMetricMargin>0) {
          const initialPhysicalGap=laneArcDistance(move.s,frontMove.s,move.t,geo);
          const frontDistance=frontMove.v*frontMove.v/(2*RACE_F.braking);
          const closingDistance=Math.max(0,(move.v*move.v-frontMove.v*frontMove.v)/(2*RACE_F.braking));
          const headingBound=curvatureUpper*frontDistance/frontMetricMargin;
          const physicalLower=initialPhysicalGap-closingDistance-Math.abs(move.t-frontMove.t)*headingBound;
          const bodyUpper=((followingBodyLength(H)+followingBodyLength(F))/2+0.20)*Math.max(1,geo.progressCoefUpperBound);
          // Convert only along the rear lane, rather than every legal track lane.
          // |signed curvature| <= curvatureUpper bounds its physical metric.
          const rearMetricUpper=(routeBound?.maxMetric??geo.maxReferenceMetric)*(1+Math.abs(move.t-(geo.referenceLane??(TRACK_WIDTH/2)))*curvatureUpper);
          const rearProgressLower=Number.isFinite(rearMetricUpper)&&rearMetricUpper>0?Math.min(1,1/rearMetricUpper):0;
          const lowerBound=physicalLower*rearProgressLower-bodyUpper;
          if(lowerBound>=response+1e-8) {
            paired.set(frontMove,lowerBound);return lowerBound-(withResponse?response:0);
          }
        }
        // 同样的有限制动下，后马必须留下相对停止距离。固定使用最大
        // 内部步1/60秒的响应余量，不能随当前小步缩小，否则下一次
        // 合法外部step变大时会突然要求更多空间，制造不可行状态。
        const own=brakingTrajectory(move),front=brakingTrajectory(frontMove);
        let witnesses=trafficNegativeWitnessCache.get(H);
        if(!witnesses){witnesses=new WeakMap();trafficNegativeWitnessCache.set(H,witnesses);}
        // Any exact sampled negative gap rejects a response query. The previous
        // pair's minimizing time is just a candidate; it never proves acceptance.
        const witnessTime=witnesses.get(F);
        if(withResponse&&Number.isFinite(witnessTime)&&witnessTime>=0) {
          const time=Math.min(witnessTime,brakingSteps*brakingInterval),i=Math.round(time/brakingInterval),regular=Math.abs(time-i*brakingInterval)<1e-12;
          // Match the original regular-grid representation as well as pointAt.
          const r=regular?own.points[i]:own.pointAt(time),f=regular?front.points[i]:front.pointAt(time);
          const witness= f.s-r.s-followingBodyClearance(H,F,r.s,f.s,move.t,frontMove.t).longitudinal-response;
          if(witness<-1e-7)return witness;
        }
        let closest=Infinity;
        // 最终停止位置不足以定义安全域：前马先入外道弯道时，即使
        // 后马物理速度较低，进度速度也可暂时更高。检查整个未来
        // 制动过程的最近接近，提前留下空间而不是临接触才制动。
        const values=new Map();
        function gapAt(time) {
          if(values.has(time)) return values.get(time);
          const i=Math.round(time/brakingInterval),regular=Math.abs(time-i*brakingInterval)<1e-12;
          const r=regular&&own.points[i]?own.points[i]:own.pointAt(time);
          const f=regular&&front.points[i]?front.points[i]:front.pointAt(time);
          const body=followingBodyClearance(H,F,r.s,f.s,move.t,frontMove.t),gap=f.s-r.s-body.longitudinal;
          values.set(time,gap);
          if(gap<closest)witnesses.set(F,time);
          closest=Math.min(closest,gap);return gap;
        }
        const certificates=[];
        function certifyInterval(left,right,depth) {
          const r=own.sampleAt(left),f=front.sampleAt(left),rr=own.sampleAt(right),fr=front.sampleAt(right),span=right-left;
          const bounds=trafficRouteIntervalBounds(Math.min(r.s,f.s)-1e-6,Math.max(rr.s,fr.s)+1e-6,geo);
          let lower=-Infinity;
          if(bounds&&bounds.minMetric>0&&Number.isFinite(bounds.signedMin)&&Number.isFinite(bounds.signedMax)) {
            const reference=geo.referenceLane??(TRACK_WIDTH/2),rd=move.t-reference,fd=frontMove.t-reference;
            const rearMetricMax=bounds.maxMetric*Math.max(1+rd*bounds.signedMin,1+rd*bounds.signedMax);
            const rearOffsetMin=Math.min(1+rd*bounds.signedMin,1+rd*bounds.signedMax);
            const frontOffsetMin=Math.min(1+fd*bounds.signedMin,1+fd*bounds.signedMax);
            const rearProjectionMin=bounds.minMetric*Math.min(1+rd*Math.max(0,bounds.signedMin),1+rd*Math.max(0,bounds.signedMax));
            const frontProjectionMin=bounds.minMetric*Math.min(1+fd*Math.max(0,bounds.signedMin),1+fd*Math.max(0,bounds.signedMax));
            if(rearMetricMax>0&&rearOffsetMin>0&&frontOffsetMin>0&&rearProjectionMin>0&&frontProjectionMin>0) {
              const distance=(v,time)=>{const elapsed=Math.min(time,v/RACE_F.braking);return(v+Math.max(0,v-RACE_F.braking*elapsed))/2*elapsed;};
              const rearDistance=distance(r.v,span),frontDistance=distance(f.v,span),closing=Math.max(0,rearDistance-frontDistance);
              const headingMin=frontDistance*bounds.signedMin/(1+fd*bounds.signedMin),headingMax=frontDistance*bounds.signedMax/(1+fd*bounds.signedMax);
              // This is a bound for every intermediate time, including the
              // zero heading change at the left endpoint. Do not prepay gains.
              const headingContribution=Math.min(0,(move.t-frontMove.t)*headingMin,(move.t-frontMove.t)*headingMax);
              const physicalLower=laneArcDistance(r.s,f.s,move.t,geo)-closing+headingContribution-1e-6;
              const bodyUpper=((followingBodyLength(H)+followingBodyLength(F))/2+0.20)*Math.max(1,1/rearProjectionMin,1/frontProjectionMin);
              lower=physicalLower>0?physicalLower/rearMetricMax-bodyUpper:-Infinity;
            }
          }
          if(lower>=response+1e-8) {certificates.push({left,right,lower});return true;}
          if(depth>=6)return false;
          const middle=(left+right)/2;
          const a=certifyInterval(left,middle,depth+1),b=certifyInterval(middle,right,depth+1);return a&&b;
        }
        const fullyCertified=certifyInterval(0,brakingSteps*brakingInterval,0);
        certificates.sort((a,b)=>a.left-b.left);
        for(const certificate of certificates)closest=Math.min(closest,certificate.lower);
        if(fullyCertified){paired.set(frontMove,closest);return closest-(withResponse?response:0);}
        function covered(left,right) {
          let through=left;
          for(const certificate of certificates) {
            if(certificate.right<through)continue;
            if(certificate.left>through+1e-12)return false;
            through=Math.max(through,certificate.right);
            if(through>=right-1e-12)return true;
          }
          return false;
        }
        const times=[...own.points.map((_,i)=>i*brakingInterval),...own.events,...front.events]
          .filter(t=>t>=0&&t<=brakingSteps*brakingInterval).sort((a,b)=>a-b)
          .filter((t,i,all)=>!i||t-all[i-1]>1e-10);
        for(const time of times) {
          if(covered(time,time))continue;
          gapAt(time);
          if(withResponse&&closest-response<-1e-7) return closest-response;
        }
        for(let i=1;i<times.length;i++) {
          const left=times[i-1],right=times[i],span=right-left;
          if(span<1e-8||covered(left,right)) continue;
          // Enclose center progress and body projection over this complete time
          // interval. Only certified intervals skip the original root search.
          function sampledPoint(trajectory,time) {
            const j=Math.round(time/brakingInterval),regular=Math.abs(time-j*brakingInterval)<1e-12;
            return regular&&trajectory.points[j]?trajectory.points[j]:trajectory.pointAt(time);
          }
          const rl=sampledPoint(own,left),fl=sampledPoint(front,left),rr=sampledPoint(own,right),fr=sampledPoint(front,right);
          const interval=trafficRouteIntervalBounds(Math.min(rl.s,fl.s)-1e-6,Math.max(rr.s,fr.s)+1e-6,geo);
          if(interval&&interval.minMetric>0&&Number.isFinite(interval.signedMin)&&Number.isFinite(interval.signedMax)) {
            const ref=geo.referenceLane??(TRACK_WIDTH/2),rd=move.t-ref,fd=frontMove.t-ref;
            const physicalRearMin=interval.minMetric*Math.min(1+rd*interval.signedMin,1+rd*interval.signedMax);
            const physicalFrontMax=interval.maxMetric*Math.max(1+fd*interval.signedMin,1+fd*interval.signedMax);
            const physicalFrontMin=interval.minMetric*Math.min(1+fd*interval.signedMin,1+fd*interval.signedMax);
            const projectionRearMin=interval.minMetric*Math.min(1+rd*Math.max(0,interval.signedMin),1+rd*Math.max(0,interval.signedMax));
            const projectionFrontMin=interval.minMetric*Math.min(1+fd*Math.max(0,interval.signedMin),1+fd*Math.max(0,interval.signedMax));
            if(physicalRearMin>0&&physicalFrontMin>0&&physicalFrontMax>0&&projectionRearMin>0&&projectionFrontMin>0) {
              const rateUpper=rl.v/physicalRearMin-Math.max(0,fl.v-RACE_F.braking*span)/physicalFrontMax;
              const bodyUpper=((followingBodyLength(H)+followingBodyLength(F))/2+0.20)*Math.max(1,1/projectionRearMin,1/projectionFrontMin);
              const intervalLower=fl.s-rl.s-Math.max(0,rateUpper)*span-bodyUpper-1e-6;
              if(intervalLower>=response+1e-8) {closest=Math.min(closest,intervalLower);continue;}
            }
          }

          // 包含完整身体投影的局部极小，而不只找两马中心进度速度
          // 相等。断点左右极限也保留，覆盖内道身体投影与曲率跳变。
          const edge=Math.min(1e-8,span/1000),epsilon=Math.min(1e-5,span/1000);
          gapAt(left+edge);gapAt(right-edge);
          const middle=(left+right)/2;gapAt(middle);
          if(withResponse&&closest-response<-1e-7) return closest-response;
          const slopes=new Map();
          const slopeAt=time=>{
            if(slopes.has(time))return slopes.get(time);
            if(time>=Math.max(move.v,frontMove.v)/RACE_F.braking)return 0;
            const r=own.pointAt(time),f=front.pointAt(time);
            const rv=r.v*trafficProgressCoef(r.s,move.t),fv=f.v*trafficProgressCoef(f.s,frontMove.t);
            // 对完整身体投影做局部导数。中心进度速度直接来自同一
            // 弧长导数；只在微小局部计算投影变化，避免重复逆解路径。
            const a=Math.max(left+edge,time-epsilon),b=Math.min(right-edge,time+epsilon);
            if(b<=a)return 0;
            const ca=followingBodyClearance(H,F,r.s+rv*(a-time),f.s+fv*(a-time),move.t,frontMove.t).longitudinal;
            const cb=followingBodyClearance(H,F,r.s+rv*(b-time),f.s+fv*(b-time),move.t,frontMove.t).longitudinal;
            const value=fv-rv-(cb-ca)/(b-a);slopes.set(time,value);return value;
          };
          for(const [a,b] of [[left+edge,middle],[middle,right-edge]]) {
            let low=a,high=b,dl=slopeAt(low),dh=slopeAt(high);
            if(!(dl<-1e-7&&dh>1e-7)) continue;
            if(!geo.route) {
              // 抽象直弯区间中，两马倍率与身体投影为常量，有限
              // 制动的相对进度速度为线性函数，极小点可以直接求出。
              gapAt(low-dl*(high-low)/(dh-dl));continue;
            }
            for(let n=0;n<18;n++) {
              const mid=(low+high)/2;
              if(slopeAt(mid)<0) low=mid;else high=mid;
            }
            gapAt((low+high)/2);
            if(withResponse&&closest-response<-1e-7) return closest-response;
          }
        }
        paired.set(frontMove,closest);
        return closest-(withResponse?(1/60)*move.v*ownScale:0);
      }
      return followingSlack;
    }
    function reserveToFinish(H,requestedV,draftDistance=0) {
      return finishPlan(H,requestedV,draftDistance).required;
    }
    function budgetSpeed(H,reserve,draftDistance=0) {
      let low=3,high=H.maxV;
      for(let i=0;i<9;i++) {
        const mid=(low+high)/2;
        if(finishPlan(H,mid,draftDistance,{reserve,earlyExit:true}).feasible) low=mid;else high=mid;
      }
      return low;
    }
    function updateStartState(H,planned=H.targetV) {
      H.gateOpen=race.t>=H.startDelay;
      if(H.startSettled||!H.gateOpen) return;
      const reference=Math.min(planned,H.sustainableV(),projectedCap(H,H.s));
      const response=RACE_F.responseTime*clamp(1+(0.65-H.behavior.tractability)*0.4,0.82,1.26);
      // 起步完成取决于已达到的速度及仍需多少提速，不依赖走了多少米。
      H.startSettled=H.v>STALL_SPEED&&H.v>=reference*0.95&&
        Math.max(0,H.accel)*response<=Math.max(0.3,reference*0.08);
    }
    function recordDecision(H,list,mode,reason,reserveEstimate,observedPace) {
      const stats=H.statsSummary;
      stats.decisions=(stats.decisions||0)+1;
      if(H.s>80 && H.s<length*0.8) {
        const rank=list.indexOf(H)/Math.max(1,list.length-1);
        stats.positionSamples=(stats.positionSamples||0)+1;
        stats.meanPosition=(stats.meanPosition||0)+(rank-(stats.meanPosition||0))/stats.positionSamples;
        H.observedStyle=stats.meanPosition<=0.15?'逃':stats.meanPosition<=0.45?'先':stats.meanPosition<=0.75?'差':'追';
      }
      H.strategy={mode,reason,reserveEstimate,observedPace,targetV:H.targetV,at:H.s,time:race.t};
      if(!H.strategyHistory) H.strategyHistory=[];
      H.strategyHistory.push({...H.strategy});if(H.strategyHistory.length>80) H.strategyHistory.shift();
    }
    // Only visible motion is extrapolated. Opponents' energy and future orders are unknown.
    function observedPosition(F,seconds,anticipatedPace=null) {
      const response=RACE_F.responseTime;
      // At the break, frozen zero-speed extrapolation would pretend that all rivals
      // remain in their stalls. Use a shared public kinematic prior, then replace it
      // with observed motion. No rival attributes or reserve enter this estimate.
      if(anticipatedPace&&((race.t<0.8&&F.v<3)||(F.accel>0.3&&F.v<anticipatedPace*0.9))) {
        let elapsed=0,v=F.v,distance=0,delay=F.v>0?0:Math.max(0,0.3-race.t);
        while(elapsed<seconds-1e-9){const dt=Math.min(0.25,seconds-elapsed),moving=Math.max(0,elapsed+dt-Math.max(elapsed,delay));
          const mix=clamp(v/Math.max(3,anticipatedPace),0,1);
          const limit=RACE_F.maxAccel*(0.7+70/230)*(1-mix)+RACE_F.runningAccel*(0.65+70/200)*mix;
          const next=Math.max(0,v+clamp((anticipatedPace-v)/response,-RACE_F.braking,limit)*moving);
          distance+=(v+next)*moving/2;v=next;elapsed+=dt;}
        return {s:F.s+distance*laneProgressCoef(F.s,F.t,geo),t:F.t,v};
      }
      const a=clamp(F.accel||0,-RACE_F.braking,RACE_F.runningAccel);
      const change=a*response*(1-Math.exp(-seconds/response));
      const stop=a<0&&F.v+a*response<0?-response*Math.log1p(F.v/(a*response)):Infinity;
      const movingSeconds=Math.min(seconds,stop);
      const distance=Math.max(0,F.v*movingSeconds+a*response*(movingSeconds-response*(1-Math.exp(-movingSeconds/response))));
      return {s:F.s+distance*laneProgressCoef(F.s,F.t,geo),t:F.t,v:Math.max(0,F.v+change)};
    }
    function applyRiderSequence(H) {
      const sequence=H.riderSequence;if(!sequence)return;
      let elapsed=race.t-sequence.at,index=0;
      while(index<sequence.actions.length&&elapsed>=sequence.actions[index].duration-1e-9){elapsed-=sequence.actions[index++].duration;}
      if(index===sequence.actions.length){H.riderSequence=null;H.lastObserve=0;return;}
      const action=sequence.actions[index];
      H.targetV=Math.max(3,Math.min(H.maxV,action.targetV));
      if(sequence.stage!==index){sequence.stage=index;setLaneTarget(H,action.targetT);}
    }
    function runAI(H) {
      if(H.control) return;
      const list=ranked(),remaining=Math.max(0,length-H.s),localFront=frontOf(H);
      const behavior=H.behavior||{forwardness:0.5,settle:0.5,tractability:0.5};
      const plan=H.plan||{position:behavior.forwardness,risk:0.5,patience:behavior.settle};
      const quality={'新人':0.40,'普通':0.70,'优秀':0.88,'殿堂':0.97}[H.jockey]??0.70;
      const speedError=(rng()*2-1)*(0.05+(1-quality)*0.55);
      const reserveEstimate=H.stamina*clamp(1+(rng()*2-1)*(0.02+(1-quality)*0.18),0.82,1.18);
      const near=list.filter(F=>F!==H&&Math.abs(F.s-H.s)<48);
      const wake=near.filter(F=>F.s>H.s&&F.s-H.s<=RACE_F.draftRange&&
        Math.abs(F.t-H.t)<=(horseWid(H)+horseWid(F))/2+0.8).sort((a,b)=>a.s-b.s)[0];
      const visible=F=>({id:F.id,s:F.s,t:F.t,v:Math.max(0,F.v+speedError),accel:F.accel||0,lateralV:F.lateralV||0,
        bodyLength:horseLen(F),bodyWidth:horseWid(F)});
      const observedPace=(wake?.v??localFront?.v??H.v)+speedError;
      // The remaining-route budget and the short action forecast share state propagation.
      // A possible wake is credited only by a finite forecast while actually in its corridor.
      const planned=budgetSpeed(H,reserveEstimate*clamp(0.965+0.02*plan.risk,0.965,0.985),0);
      // 跑法与位置意图进入【配速请求】。
      // 现实里马群出闸后不久就拉开，靠的是各骑手选择的配速不同：抢前型前压、
      // 后追型收后。此前 plan.position 只经 targetRank 影响"瞄准第几名"，不改变
      // 请求速度，于是全场配速几乎相同、马群长时间并排，变道在赛程前 36% 都不合法
      // （见 docs/变道插空机制-2026-10-06.md §八）。
      // 该偏置在早段最强；中后段由"剩余储备"自然接管——前压者储备更低 ⇒
      // budgetSpeed 复算出的配速回落，这正是现实里的拱形配速（而非硬编码形状）。
      const frontBias=clamp((plan.position-0.5)*2,-1,1)*0.6+clamp((behavior.forwardness-0.5)*2,-1,1)*0.4;
      const earlyWeight=clamp(1-H.s/Math.max(1,length*0.35),0,1);
      const intentV=Math.max(3,Math.min(H.maxV,planned*(1+frontBias*RACE_F.paceIntentSpan*earlyWeight)));
      updateStartState(H,planned);
      const horizon=Math.max(0.05,Math.min(8,remaining/Math.max(3,planned)));
      const settleDuration=Math.min(RACE_F.responseTime*2,Math.max(0,remaining/Math.max(3,planned)-horizon));
      const evaluationHorizon=horizon+settleDuration;
      const options={maxDt:0.12,trace:true,opponents:list.filter(F=>F!==H).map(visible),
        opponentMotionPrior:{pace:H.startSettled?planned:Math.max(planned,H.base+RACE_F.peakExtra),launchUntil:0.8,assumedDelay:0.3}};
      const holdT=H.laneIntentT>0?H.targetT:H.t;
      const evaluate=(mode,actions,t,goal=null,maxDt=options.maxDt)=>{
        const requests=actions.map(a=>({...a,targetT:a.targetT??t}));
        if(requests[0].leader===undefined)requests[0].leader=wake?visible(wake):null;
        if(goal)requests.at(-1).goal=goal;
        // Account for the subsequent return to budget pace instead of pricing all
        // terminal kinetic energy as if it disappeared at the planning boundary.
        if(settleDuration>0)requests.push({duration:settleDuration,targetV:planned,targetT:t,leader:null});
        const forecast=H.projectActions(requests,{...options,maxDt});
        // Every projected own sweep is checked against the same visible motion
        // used for wake and following constraints. Future rival responses remain
        // uncertain; the actual simultaneous solver still checks execution.
        const conflict=forecast.pathConflict;
        return {mode,actions,t,goal,forecast,conflict,request:actions[0].targetV};
      };
      if(H.riderSequence) {
        const sequence=H.riderSequence,actions=[];let elapsed=race.t-sequence.at;
        for(const action of sequence.actions){if(elapsed>=action.duration){elapsed-=action.duration;continue;}
          actions.push({...action,duration:action.duration-elapsed,
            leader:action.leader===null?null:action.leader&&wake?visible(wake):undefined});elapsed=0;}
        const continuation=actions.length?evaluate(sequence.mode,actions,actions.at(-1).targetT,sequence.goal,1/60):null;
        if(continuation&&!continuation.conflict&&continuation.forecast.energyFeasible&&continuation.forecast.goalReached) {
          applyRiderSequence(H);
          H.planning={...H.planning,continuation:true,remainingActions:actions.length,
            predictedGoal:continuation.forecast.goalReached,predictedS:continuation.forecast.endpoint.s};
          recordDecision(H,list,sequence.mode,'从实测状态复核并继续已规划的动作序列',reserveEstimate,observedPace);return;
        }
        H.statsSummary.cancelledSequences=(H.statsSummary.cancelledSequences||0)+1;H.riderSequence=null;
      }
      const candidates=[],baseline=evaluate(H.startSettled?'settle':'start',
        [{duration:horizon,targetV:intentV}],holdT);
      candidates.push(baseline);
      const ahead=near.filter(F=>F.s>H.s).sort((a,b)=>a.s-b.s)[0];
      const nextBend=routeCorners.find(at=>at>H.s+0.1&&kAt(Math.min(length,at+0.1),geo)>0);
      const bendDeadline=nextBend===undefined?Infinity:(nextBend-H.s)/Math.max(3,planned);
      const targetRank=(1-plan.position)*Math.max(0,list.length-1);
      const rankCache=new WeakMap();
      const rankAt=forecast=>{
        if(rankCache.has(forecast))return rankCache.get(forecast);
        // Utility and motion share this candidate's visible trajectory and time.
        const endpoints=new Map((forecast.observedLeaderEndpoints||[]).map(F=>[F.id,F]));
        const rank=list.filter(F=>F!==H).reduce((sum,F)=>{
          const p=endpoints.get(F.id)||observedPosition(visible(F),forecast.seconds,options.opponentMotionPrior.pace);
          return sum+(p.finished?1:clamp(0.5+(p.s-forecast.endpoint.s)/Math.max(2,horseLen(H)*2),0,1));
        },0);
        rankCache.set(forecast,rank);return rank;
      };
      const baseRank=rankAt(baseline.forecast);
      const baseEnergy=baseline.forecast.ledger.energyUsed-baseline.forecast.ledger.recovered;
      const powerSlope=(H.powerFor(planned+0.12,0,false)-H.powerFor(Math.max(3,planned-0.12),0,false))/0.24;
      const reservePrice=(1+0.12*plan.patience)/Math.max(3,powerSlope-Math.max(0,H.powerFor(planned,0,false)-H.aerobicOutput)/Math.max(3,planned));
      // Position has value through room to run, contact with the pack and corner access.
      // It never adds a speed, acceleration or energy multiplier to a running style.
      const positionValue=horseLen(H)*(0.65+0.55*plan.risk)*(bendDeadline<horizon+3?1.35:1);
      H.targetV=planned;
      const openGap=findGap(H,true);
      // 变道可达性 —— 判据是「插空」，不是「走廊必须空」。
      // 旧判据要求【整条横向走廊在当前位置上此刻为空】，现实里骑手做不到也不必做到：
      // 变道是一个过程，只要【到达那一刻目标车道留得下这匹马】即可。
      // 横移到 t 需 dtLat=|t-H.t|/lateralSpeed 秒，期间本马前进 v·dtLat；
      // 对手届时位置按各自的观测速度外推。真正的碰撞仍由预测的 pathConflict 兜底
      // （有冲突的候选会被 -Infinity 淘汰），这里只做粗筛。
      const laneReachable=t=>{
        const dtLat=Math.abs(t-H.t)/Math.max(1e-6,RACE_F.lateralSpeed);
        const lead=Math.max(0,H.v)*dtLat,s0=H.s+lead;
        return !near.some(F=>{
          if(Math.abs(F.t-t)>=(horseWid(H)+horseWid(F))/2+0.1) return false;   // 目标车道上没有人
          const fs=F.s+Math.max(0,F.v)*dtLat;                                  // 对手届时纵向位置
          return Math.abs(fs-s0)<(horseLen(H)+horseLen(F))/2+0.35;
        });
      };
      const lanes=[holdT];
      if(openGap&&Math.abs(openGap.t-holdT)>0.3&&laneReachable(openGap.t)) lanes.push(openGap.t);
      // 内线候选的可达车道 = 一个视界内横移速度所能达到的最内侧。
      // 原来写死上限 2 m（视界 8 s × 横移 0.8 m/s ⇒ 本可达 6.4 m），使外侧马
      // 每 ~4.5 s 只能内移 2 m（等效 0.44 m/s，低于横移速度），17 m 要 ~38 s，
      // 占 1200 m 赛程 58%。写死 2 m 原本是为在密集马群里"够得到"，现在
      // laneReachable 已按"到达时刻插空"判定，大跨度不再必然被挡，故按物理量取。
      const inner=Math.max(horseWid(H)/2+0.25,H.t-horizon*RACE_F.lateralSpeed);
      if(H.laneIntentT<=0&&Math.abs(inner-holdT)>0.3&&laneReachable(inner)&&!lanes.some(t=>Math.abs(t-inner)<0.3)) lanes.push(inner);
      const attackPlan=finishPlan(H,H.maxV,0,{reserve:reserveEstimate});
      const budgetFinishTime=attackPlan.feasible?finishPlan(H,planned,0,{reserve:reserveEstimate}).seconds:null;
      for(const t of lanes) {
        if(t!==holdT)candidates.push(evaluate('route',[{duration:horizon,targetV:planned}],t));
        const needPosition=!H.startSettled||baseRank>targetRank+0.25||
          (ahead&&ahead.s-H.s<12&&ahead.v>planned+0.05);
        if(needPosition||attackPlan.feasible) {
          const surge=Math.min(H.maxV,Math.max(planned+0.25,
            ahead?ahead.v+speedError+(ahead.s-H.s+horseLen(H))/Math.max(2,horizon):H.maxV));
          candidates.push(evaluate(attackPlan.feasible?'attack':!H.startSettled?'start-position':'position',
            [{duration:horizon,targetV:attackPlan.feasible?H.maxV:surge}],t));
        }
      }
      // Dropping behind a flank can create a legal inside route; it is paid and timed.
      if(H.laneIntentT<=0&&(!laneReachable(inner)||H.blocked)&&H.v>3) {
        const delay=Math.min(2,horizon/2),front=localFront;
        const easing=Math.max(3,Math.min(planned-0.35,front?front.v-0.2:planned-0.35));
        candidates.push(evaluate('wait-route',[{duration:delay,targetV:easing,targetT:H.t},
          {duration:horizon-delay,targetV:planned,targetT:inner}],inner));
      }
      H.followOpportunity=null;
      if(wake&&observedPace>3&&observedPace<=planned+0.25&&horizon>1&&plan.patience>0.2) {
        // A cheap same-resolution comparison screens opportunities. It is a
        // planning heuristic, not a traffic certificate or a catch guarantee.
        // Only a subsequent 60 Hz reference and catch may enter the candidates.
        const following=Math.max(3,Math.min(planned,observedPace+0.04));
        const followTime=Math.min(horizon/2,(wake.s-H.s)/Math.max(0.1,planned-observedPace));
        const catchTime=horizon-followTime;
        const catchV=planned+Math.max(0,planned-following)*followTime/Math.max(0.1,catchTime);
        const actions=[{duration:followTime,targetV:following,targetT:wake.t,leader:visible(wake)},
          {duration:catchTime,targetV:catchV,targetT:holdT}];
        const netEnergy=f=>f.ledger.energyUsed-f.ledger.recovered;
        const goalAt=f=>f.trace.find(p=>p.time>=race.t+horizon-1e-7)?.s??f.endpoint.s;
        const coarseGoal=goalAt(baseline.forecast);
        const screened=evaluate('follow',actions,holdT,{s:coarseGoal,tolerance:0.12});
        const coarseSaving=netEnergy(baseline.forecast)-netEnergy(screened.forecast);
        const rejectReason=(c,saving,prefix)=>!c.forecast.energyFeasible?prefix+'energy':
          !c.forecast.complete||!c.forecast.goalReached?prefix+'goal':c.conflict?prefix+'path':
          !(saving>0)?prefix+'no-saving':null;
        const coarseReject=rejectReason(screened,coarseSaving,'coarse-');
        H.statsSummary.followScreenAttempts=(H.statsSummary.followScreenAttempts||0)+1;
        H.followOpportunity={following,catchV,followTime,catchTime,saving:coarseSaving,
          savingResolution:'coarse',regainedDistance:screened.forecast.endpoint.s-baseline.forecast.endpoint.s,
          goalReached:screened.forecast.goalReached,targetShortfall:screened.forecast.targetShortfall,
          pathConflict:screened.conflict,accepted:false,fineChecked:false,rejectedReason:coarseReject,
          coarse:{maxDt:options.maxDt,goalS:coarseGoal,goalReached:screened.forecast.goalReached,
            energyFeasible:screened.forecast.energyFeasible,pathConflict:screened.conflict,
            saving:coarseSaving,regainedDistance:screened.forecast.endpoint.s-baseline.forecast.endpoint.s,
            steps:screened.forecast.steps},fine:null};
        if(coarseReject) {
          const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
          reasons[coarseReject]=(reasons[coarseReject]||0)+1;
          H.statsSummary.coarseCatchRejected=(H.statsSummary.coarseCatchRejected||0)+1;
          H.statsSummary.rejectedCatchPlans=(H.statsSummary.rejectedCatchPlans||0)+1;
        } else {
          H.statsSummary.fineCatchChecks=(H.statsSummary.fineCatchChecks||0)+1;
          const reference=evaluate(baseline.mode,baseline.actions,holdT,null,1/60);
          const goalS=goalAt(reference.forecast);
          const c=evaluate('follow',actions,holdT,{s:goalS,tolerance:0.12},1/60);
          c.reference=reference;
          const saving=netEnergy(reference.forecast)-netEnergy(c.forecast),fineReject=rejectReason(c,saving,'fine-');
          Object.assign(H.followOpportunity,{saving,savingResolution:'fine',fineChecked:true,
            regainedDistance:c.forecast.endpoint.s-reference.forecast.endpoint.s,
            goalReached:c.forecast.goalReached,targetShortfall:c.forecast.targetShortfall,
            pathConflict:c.conflict,rejectedReason:fineReject,
            fine:{maxDt:1/60,goalS,goalReached:c.forecast.goalReached,energyFeasible:c.forecast.energyFeasible,
              pathConflict:c.conflict,saving,regainedDistance:c.forecast.endpoint.s-reference.forecast.endpoint.s,
              steps:c.forecast.steps}});
          if(!fineReject) {
            H.statsSummary.fineCatchViable=(H.statsSummary.fineCatchViable||0)+1;
            candidates.push(c);
          } else {
            const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
            reasons[fineReject]=(reasons[fineReject]||0)+1;
            H.statsSummary.fineCatchRejected=(H.statsSummary.fineCatchRejected||0)+1;
            H.statsSummary.rejectedCatchPlans=(H.statsSummary.rejectedCatchPlans||0)+1;
          }
        }
      }
      const futureTurns=routeMesh.reduce((angle,at,i)=>i&&at>H.s?
        angle+kAt((Math.max(H.s,routeMesh[i-1])+at)/2,geo)*(at-Math.max(H.s,routeMesh[i-1])):angle,0);
      for(const c of candidates) {
        const f=c.forecast,rank=rankAt(f),netEnergy=f.ledger.energyUsed-f.ledger.recovered;
        const reference=c.reference||baseline,ref=reference.forecast;
        const refEnergy=ref.ledger.energyUsed-ref.ledger.recovered,refRank=rankAt(ref);
        const positionGain=Math.abs(refRank-targetRank)-Math.abs(rank-targetRank);
        const routeBenefit=(holdT-f.endpoint.t)*futureTurns*RACE_F.laneRouteWeight;
        const changeCost=c.t!==holdT?0.15:0;
        c.score=f.endpoint.s-ref.endpoint.s-(netEnergy-refEnergy)*reservePrice+
          positionGain*positionValue+routeBenefit-changeCost;
        // Once the complete remaining route is payable, unused reserve has no
        // terminal value: compare finishing time, keeping the local traffic check.
        if(c.mode==='attack'&&attackPlan.feasible)c.score=Math.max(c.score,
          (budgetFinishTime-attackPlan.seconds)*planned+routeBenefit-changeCost);
        if(f.finished)c.score=((baseline.forecast.finished?baseline.forecast.seconds:budgetFinishTime??evaluationHorizon)-f.seconds)*planned;
        if(c.conflict||!f.energyFeasible)c.score=-Infinity;
      }
      const viable=candidates.filter(c=>Number.isFinite(c.score));
      let chosen=viable.sort((a,b)=>b.score-a.score)[0]||baseline;
      if(chosen!==baseline&&chosen.score<0.15&&Number.isFinite(baseline.score))chosen=baseline;
      let mode=chosen.mode,reason={start:'建立可支付的跑动速度','start-position':'在发走后争取可达的位置',
        settle:'按自身状态保留余程能力',route:'比较横移时间与剩余弯道外绕成本',position:'短时推进争取可达位置',
        attack:'余程预算支持持续发力',follow:'连续跟跑、追回的距离目标可达且净耗能降低',
        'wait-route':'收力留出横移间隙，再进入较短路线'}[mode];
      const attacking=mode==='attack',sr=H.stamina/Math.max(1,H.staminaMax);
      H.targetV=Math.max(3,Math.min(H.maxV,chosen.request));
      const first=chosen.actions[0];
      if(Math.abs((first.targetT??chosen.t)-H.targetT)>0.2)setLaneTarget(H,first.targetT??chosen.t);
      if(mode==='follow')H.followOpportunity.accepted=true;
      else if(H.followOpportunity?.fineChecked&&!H.followOpportunity.rejectedReason) {
        H.followOpportunity.rejectedReason='lower-score';
        const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
        reasons['lower-score']=(reasons['lower-score']||0)+1;
      }
      if(mode==='follow'||mode==='wait-route') {
        H.riderSequence={at:race.t,mode,stage:-1,actions:chosen.actions.map(a=>({...a})),
          goal:chosen.goal};
        applyRiderSequence(H);
      }
      H.planning={horizon,evaluationHorizon,targetRank,bendDeadline:Number.isFinite(bendDeadline)?bendDeadline:null,
        reservePrice,selected:mode,selectedScore:Number.isFinite(chosen.score)?chosen.score:null,
        baseline:{s:baseline.forecast.endpoint.s,energy:baseEnergy,rank:baseRank},
        candidates:candidates.map(c=>({mode:c.mode,targetV:c.request,targetT:c.t,score:Number.isFinite(c.score)?c.score:null,
          predictedS:c.forecast.endpoint.s,predictedReserve:c.forecast.endpoint.stamina,
          energyFeasible:c.forecast.energyFeasible,goalReached:c.forecast.goalReached,
          targetShortfall:c.forecast.targetShortfall,pathConflict:c.conflict}))};
      const sequenceBeforeSafety=H.riderSequence,beforeSafety={targetV:H.targetV,targetT:H.targetT},reasonBeforeSafety=reason;
      setAction(H,attacking?(sr>0.15?'打鞭':'推骑'):H.targetV>H.v+0.15?'推骑':'收力');
      if(!viable.length||(localFront&&localFront.s-H.s<4+Math.max(0,H.targetV-localFront.v)*3&&H.targetV>localFront.v+0.3)) {
        if(!avoidBlock(H,openGap)){mode='wait';reason='预测通道未开放，保留制动距离等待';}
      }
      const speedChanged=H.targetV!==beforeSafety.targetV,laneChanged=H.targetT!==beforeSafety.targetT;
      H.planning.selectedCandidate=chosen.mode;
      H.planning.actualControls={targetV:H.targetV,targetT:H.targetT};
      if(speedChanged||laneChanged) {
        // The safety command has no forecast for the selected action tuple.
        // Preserve that immediate command and distinguish it from its candidate.
        H.statsSummary.safetyOverrides=(H.statsSummary.safetyOverrides||0)+1;
        if(sequenceBeforeSafety) {
          H.riderSequence=null;
          H.statsSummary.safetyOverriddenSequences=(H.statsSummary.safetyOverriddenSequences||0)+1;
          if(sequenceBeforeSafety.mode==='follow'&&H.followOpportunity) {
            H.followOpportunity.accepted=false;
            H.followOpportunity.rejectedReason='safety-override';
            const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
            reasons['safety-override']=(reasons['safety-override']||0)+1;
          }
        }
        mode=laneChanged?'route':'wait';
        reason=sequenceBeforeSafety?'按实测近马避让调整实际指令，取消尚未执行的动作序列':'按实测近马避让调整实际指令';
        H.planning.selectedCandidateScore=H.planning.selectedScore;
        H.planning.selectedScore=null;
        H.planning.selected=mode;
        H.planning.sequenceCommitted=false;
        H.planning.safetyOverride={candidateMode:chosen.mode,before:beforeSafety,
          actual:{targetV:H.targetV,targetT:H.targetT},speedChanged,laneChanged};
      } else {
        // Merely repeating a safe assignment does not change the action tuple.
        if(sequenceBeforeSafety) {
          mode=sequenceBeforeSafety.mode;reason=reasonBeforeSafety;
          H.statsSummary.committedSequences=(H.statsSummary.committedSequences||0)+1;
          H.planning.sequenceCommitted=true;
        } else if(mode!==chosen.mode) {
          // No viable plan may require waiting without a numerical tuple change.
          H.planning.selectedCandidateScore=H.planning.selectedScore;
          H.planning.selectedScore=null;
          H.planning.fallbackReason=reason;
        }
        H.planning.selected=mode;
      }
      // Bookkeep labels after safety chooses the actual instruction, once only.
      const finalAttacking=mode==='attack';
      if(finalAttacking&&!H.attacking) {
        H.statsSummary.launches=(H.statsSummary.launches||0)+1;
        if(H.sprintAt===null){H.sprintAt=H.s;H.statsSummary.sprintAt=H.s;}
        event(H.name+' 开始发力！');
      } else if(!finalAttacking&&H.attacking) {
        H.statsSummary.withdrawals=(H.statsSummary.withdrawals||0)+1;event(H.name+' 收力重新调整节奏');
      }
      H.attacking=finalAttacking;
      recordDecision(H,list,mode,reason,reserveEstimate,observedPace);
      // A lateral commitment has a lifecycle, not just a start. While the chosen
      // lateral route is still unfinished the promise is kept; once it is done,
      // a passing commitment is released as soon as the opponent is no longer
      // being passed (gone, finished, out of reach or not actually losing ground).
      // Without this the horse would stay pinned outside for the rest of the race.
      if(H.laneIntentT>0&&Math.abs(H.targetT-H.t)>0.1) {
        H.statsSummary.keptLaneCommitments=(H.statsSummary.keptLaneCommitments||0)+1;
      } else if(H.passTarget) {
        const pass=H.passTarget;
        const gainV=H.targetV*laneProgressCoef(H.s,H.t,geo)-pass.v*laneProgressCoef(pass.s,pass.t,geo);
        const stillPassing=!pass.place&&!pass.dnf&&pass.s-H.s<=14&&gainV>0.05&&
          H.s-pass.s<(horseLen(H)+horseLen(pass))/2+1;
        if(!stillPassing) {
          H.statsSummary.releasedPassTargets=(H.statsSummary.releasedPassTargets||0)+1;
          H.passTarget=null;
        }
      }
      if(H.planning.safetyOverride||H.planning.fallbackReason) {
        const detail={selectedCandidate:H.planning.selectedCandidate,targetT:H.targetT,
          ...(H.planning.safetyOverride?{safetyOverride:H.planning.safetyOverride}:{}),
          ...(H.planning.fallbackReason?{fallbackReason:H.planning.fallbackReason}:{})};
        Object.assign(H.strategy,detail);
        Object.assign(H.strategyHistory[H.strategyHistory.length-1],detail);
      }
    }
    function headwindAt(at) {
      // 固定风向投影到路线切线；终直道迎风时，对向直道为顺风。
      if(!wind) return 0;
      const here=trackTangent(at,geo.referenceLane,geo,dir),finish=trackTangent(length,geo.referenceLane,geo,dir);
      return wind*(here.x*finish.x+here.y*finish.y);
    }
    function powerCost(H,v,a,drafting,at=H.s,gravityPower=null,transverse=H.t) {
      const speed=Math.max(0,v), terms=powerTerms(H,drafting,at,transverse);
      const airV=Math.max(0,speed+terms.wind);
      // 推进功率遵循牛顿定律；减速动能可支付阻力，但不能灌回储备。
      return Math.max(0,(terms.c2*speed*speed+terms.c6*Math.pow(speed,6)+
        terms.air*airV*airV*speed+(gravityPower??terms.gravity*speed)+a*speed)*H.massRatio);
    }
    function powerTerms(H,drafting,at,transverse=H.t) {
      const condition=(surface==='草地'?{'良':1,'稍重':1.035,'重':1.08,'不良':1.15}:
        {'良':1,'稍重':0.995,'重':1.02,'不良':1.075})[state]||1;
      const ground=1+(condition-1)*clamp(1-(H.adj['力量']-70)*0.006,0.7,1.3);
      const c2=RACE_F.resistanceK*H.economy*ground*H.surfaceCost;
      const curvature=laneCurvatureAt(at,transverse,geo), radius=curvature>0?1/curvature:Infinity;
      return {c2,c6:Number.isFinite(radius)?c2*RACE_F.turnCost/(radius*radius*RACE_F.curveLateral*RACE_F.curveLateral):0,
        air:RACE_F.airK*(drafting?RACE_F.draftSave:1),wind:headwindAt(at),
        gravity:9.81*gradientAt(at,geo,g)*laneProgressCoef(at,transverse,geo)};
    }
    function motionPower(H,before,move,drafting,dt) {
      // 用实际高差支付势能；跨坡段接点时不能用坡前的点估计限制出力，
      // 再用坡后的点记账。外道的同一高差也不能按更长弧长重复计费。
      const gravityPower=9.81*(elevationAt(move.s,geo,g)-elevationAt(before.s,geo,g))/dt;
      return powerCost(H,(before.v+move.v)/2,(move.v-before.v)/dt,drafting,
        (before.s+move.s)/2,gravityPower,(before.t+move.t)/2);
    }
    function speedAtPower(H,power,drafting,at=H.s) {
      const terms=powerTerms(H,drafting,at), available=power/H.massRatio;
      let v=Math.sqrt(Math.max(0,available)/terms.c2);
      for(let n=0;n<5;n++) {
        const airV=Math.max(0,v+terms.wind), v2=v*v, v5=v2*v2*v;
        const demand=terms.c2*v2+terms.c6*v5*v+terms.air*airV*airV*v+terms.gravity*v;
        const derivative=2*terms.c2*v+6*terms.c6*v5+terms.air*(airV*airV+2*airV*v)+terms.gravity;
        v=clamp(v-(demand-available)/Math.max(0.1,derivative),0,H.maxV*1.1);
      }
      return v;
    }
    // 两个线性积分路径在整步内进入同一身体矩形的时间区间。
    // 不能只检查单马新横坐标对另一匹的旧横坐标。
    function axisOverlap(from,to,clearance) {
      const delta=to-from;
      if(Math.abs(delta)<1e-12) return Math.abs(from)<clearance-1e-9?[0,1]:null;
      const a=(-clearance-from)/delta,b=(clearance-from)/delta;
      const low=Math.max(0,Math.min(a,b)),high=Math.min(1,Math.max(a,b));
      return high-low>1e-9?[low,high]:null;
    }
    let trafficProgressCache=new Map(),trafficProgressCacheSize=0;
    function trafficProgressCoef(s,t) {
      let lane=trafficProgressCache.get(t);
      if(lane){const value=lane.get(s);if(value!==undefined)return value;}
      const value=laneProgressCoef(s,t,geo);
      if(trafficProgressCacheSize>=16384){trafficProgressCache.clear();trafficProgressCacheSize=0;lane=null;}
      if(!lane){lane=new Map();trafficProgressCache.set(t,lane);}
      lane.set(s,value);trafficProgressCacheSize++;return value;
    }
    function bodyClearance(H,F,hs,fs,ht,ft) {
      // 纵坐标是路线进度；在内外道把真实体长投影到相同坐标。
      const scale=Math.max(1,trafficProgressCoef(hs,ht),trafficProgressCoef(fs,ft));
      return {longitudinal:((horseLen(H)+horseLen(F))/2+0.20)*scale,
        lateral:(horseWid(H)+horseWid(F))/2+0.10};
    }
    function sweptBodies(H,F,before,frontBefore,move,frontMove) {
      const clear=bodyClearance(H,F,(before.s+move.s)/2,(frontBefore.s+frontMove.s)/2,
        (before.t+move.t)/2,(frontBefore.t+frontMove.t)/2);
      const long=axisOverlap(frontBefore.s-before.s,frontMove.s-move.s,clear.longitudinal);
      if(!long) return false;
      const lateral=axisOverlap(frontBefore.t-before.t,frontMove.t-move.t,clear.lateral);
      return !!lateral&&Math.min(long[1],lateral[1])-Math.max(long[0],lateral[0])>1e-9;
    }
    function trafficFailure(reason,H,F,detail={}) {
      race.traffic.infeasibleSteps++;
      race.traffic.lastInfeasible={time:race.t,reason,horse:H?.id,other:F?.id,...detail};
      throw new Error('交通运动状态不可行：'+reason+'（'+(H?.id||'')+'/'+(F?.id||'')+'，'+race.t.toFixed(3)+'秒）');
    }
    const trafficNegativeWitnessCache=new WeakMap();
    function tick(dt) {
      trafficProgressCache=new Map();trafficProgressCacheSize=0;
      const act=active();if(!act.length){race.finished=true;return;}
      race.traffic??={steps:0,syncLateralDenied:0,brakingSteps:0,marginRecoverySteps:0,infeasibleSteps:0,
        minAcceleration:0,minFollowingSlack:null,minResponseSlack:null,lastInfeasible:null};
      race.traffic.steps++;
      const old=new Map(act.map(H=>[H,{s:H.s,t:H.t,v:H.v,stamina:H.stamina,guts:H.guts}]));
      for(const H of act) {
        const before=old.get(H),halfWidth=horseWid(H)/2,width=trackWidthAt(before.s,geo);
        if(!Number.isFinite(before.s)||!Number.isFinite(before.t)||!Number.isFinite(before.v)||before.v<0||
          before.t<halfWidth-1e-7||before.t>width-halfWidth+1e-7)
          trafficFailure('步前位置或速度超出合法运动范围',H,null,{before,width});
      }
      for(let i=0;i<act.length;i++) for(let j=i+1;j<act.length;j++) {
        const H=act[i],F=act[j],a=old.get(H),b=old.get(F);
        const clear=bodyClearance(H,F,a.s,b.s,a.t,b.t);
        if(Math.abs(a.s-b.s)<clear.longitudinal-1e-7&&Math.abs(a.t-b.t)<clear.lateral-1e-7)
          trafficFailure('步前身体已重叠，不能通过清零速度掩盖',H,F,{before:a,otherBefore:b});
      }
      for(const H of act) {
        H.lastObserve-=dt;H.actionT=Math.max(0,H.actionT-dt);H.laneIntentT=Math.max(0,H.laneIntentT-dt);
        if(!H.control)applyRiderSequence(H);
        if(!H.control && H.lastObserve<=0) {runAI(H);H.lastObserve=(JOCKEY_CADENCE[H.jockey]||2)*(0.95+rng()*0.10);}
        if(H.control) {if(Number.isFinite(H.control.targetV)) H.targetV=Math.max(0,H.control.targetV);if(Number.isFinite(H.control.targetT)) H.targetT=H.control.targetT;}
      }
      const motion=new Map(),motionModel=new Map(),denied=new Set(),marginRecovery=new Set();
      for(const H of act) {
        const before=old.get(H);H.blocked=false;H.blocker=null;H.collisionIntensity=0;H.squeezePass=0;
        const wake=act.find(F=>F!==H && old.get(F).s>before.s && old.get(F).s-before.s<=RACE_F.draftRange &&
          Math.abs(old.get(F).t-before.t)<=(horseWid(H)+horseWid(F))/2+0.8);
        H.drafting=!!wake;
        const supply=raceSupplyState(H,dt);
        H.aerobicOutput=supply.aerobic;
        const {fatigue,aerobic,reserveFade,maxPower}=supply;
        let cap=Math.min(H.maxV*fatigue,speedAtPower(H,maxPower,!!wake));
        const curvature=laneCurvatureAt(H.s,H.t,geo);
        if(curvature>0) {
          const radius=1/curvature;
          cap=Math.min(cap,Math.sqrt(Math.max(1,(RACE_F.curveLateral+(H.adj['力量']-70)*0.008)*radius))*bendCoefFor(H.h.special,dir));
        }
        const grad=gradientAt(H.s,geo,g); H.grad=grad;H.slopeCoef=1;
        let desired=Math.min(H.targetV,cap);
        const front=act.filter(F=>F!==H && old.get(F).s>before.s && Math.abs(old.get(F).t-before.t)<(horseWid(H)+horseWid(F))/2+0.2)
          .sort((a,b)=>old.get(a).s-old.get(b).s)[0];
        if(front) {
          const safe=followingSpeedCap(H,front,before,old.get(front));
          if(safe<desired-0.1){H.blocked=true;H.blocker=front;}
          desired=Math.min(desired,safe);
        }
        const startFraction=clamp((race.t+dt-H.startDelay)/dt,0,1);
        if(!startFraction) desired=0;
        const limits=raceAccelerationLimits(H,supply,!!wake);
        const {maxA,response,kineticBudget}=limits;
        let a=clamp((desired-H.v)/response,-RACE_F.braking,Math.min(maxA,kineticBudget));
        let nextV=Math.max(0,H.v+a*dt*startFraction);
        // 先提案，随后共同验证整步横移与跟车，不在积分后硬夹位置或速度。
        const bodyMargin=horseWid(H)/2,margin=bodyMargin+0.2,width=trackWidthAt(H.s,geo);
        const target=clamp(H.targetT,margin,width-margin);
        // This model exists for one simultaneous tick, whose H state is held
        // constant until commit. Reuse identical immutable proposals so exact
        // duplicate budget/safety queries retain their pair/trajectory caches.
        const proposalCache=new Map();
        function propose(v,transverse=target) {
          let lateralCache=proposalCache.get(v);
          if(!lateralCache){lateralCache=new Map();proposalCache.set(v,lateralCache);}
          if(lateralCache.has(transverse))return lateralCache.get(transverse);
          const proposal=raceKinematicProposal(H,before,v,transverse,dt,startFraction,aerobic);
          lateralCache.set(transverse,proposal);return proposal;
        }
        const minV=Math.max(0,before.v-RACE_F.braking*dt*startFraction);
        // 限制与记账使用相同的实际路径、高差及积分中点；预算根求解
        // 的下界仍是有限制动，不能在缺功率时偷偷从零速重新求根。
        function paidProposal(v,transverse=target) {
          let move=propose(v,transverse);
          if(motionPower(H,before,move,!!wake,dt)<=maxPower+1e-7) return move;
          let low=minV,high=v;
          if(motionPower(H,before,propose(low,transverse),!!wake,dt)>maxPower+1e-7)
            trafficFailure('有限制动下供能约束不可行',H,null,{before,minV,maxPower});
          for(let n=0;n<28;n++) {
            const mid=(low+high)/2;
            if(motionPower(H,before,propose(mid,transverse),!!wake,dt)<=maxPower) low=mid;else high=mid;
          }
          return propose(low,transverse);
        }
        motionModel.set(H,{propose,paidProposal,minV,target,maxPower,freeV:nextV});
        motion.set(H,paidProposal(nextV));H.pot=desired;
      }
      const frontFirst=act.slice().sort((a,b)=>old.get(b).s-old.get(a).s||a.gate-b.gate);
      const followingSlack=followingConstraintSolver(Math.max(...[...motionModel.values()].map(m=>m.freeV)));
      // 横移提案同步审核；两匹相向并道不得分别对照旧位置获得许可。
      // 否决整步横移后重新积分，不重写已经走出的距离。
      let changed=true,passes=0;
      trafficSolve: while(changed&&passes++<act.length+2) {
        changed=false;
        for(let i=0;i<act.length;i++) for(let j=i+1;j<act.length;j++) {
          const H=act[i],F=act[j],a=old.get(H),b=old.get(F),hm=motion.get(H),fm=motion.get(F);
          const clear=bodyClearance(H,F,a.s,b.s,a.t,b.t);
          const movingH=Math.abs(hm.t-a.t)>1e-12,movingF=Math.abs(fm.t-b.t)>1e-12;
          if(!movingH&&!movingF) continue;
          const merge=Math.abs(a.t-b.t)>=clear.lateral-1e-8&&Math.abs(hm.t-fm.t)<clear.lateral+1e-8;
          const rear=a.s<b.s?H:F,front=rear===H?F:H;
          const unsafeMerge=merge&&followingSlack(rear,front,motion.get(rear),motion.get(front))<0;
          if(!sweptBodies(H,F,a,b,hm,fm)&&!unsafeMerge) continue;
          for(const [X,moving] of [[H,movingH],[F,movingF]]) if(moving) {
            const model=motionModel.get(X);model.target=old.get(X).t;
            motion.set(X,model.paidProposal(motion.get(X).v,model.target));
            denied.add(X);changed=true;
          }
        }
        // 前马的最终运动提案已知后，求后马的可行末速度；这个速度
        // 同时用于梯形积分与能量账，没有事后位置钳制或速度清零。
        for(const H of frontFirst) for(const F of frontFirst) {
          if(F===H||old.get(F).s<=old.get(H).s) continue;
          const before=old.get(H),frontBefore=old.get(F),move=motion.get(H),fm=motion.get(F);
          const clear=bodyClearance(H,F,before.s,frontBefore.s,before.t,frontBefore.t);
          const transverse=axisOverlap(frontBefore.t-before.t,fm.t-move.t,clear.lateral);
          if(!transverse||followingSlack(H,F,move,fm)>=-1e-8) continue;
          const model=motionModel.get(H),lower=model.propose(model.minV,model.target);
          if(followingSlack(H,F,lower,fm)<-1e-7) {
            // 只缺额外反应余量时，合法的脱离车道路径仍可继续。
            // 否决向外避让会把后马永久困在同一走廊，反而妨碍解阻。
            if(followingSlack(H,F,lower,fm,false)>=-1e-7) {
              motion.set(H,model.paidProposal(model.minV,model.target));H.blocked=true;
              if(!H.blocker||frontBefore.s<old.get(H.blocker).s) H.blocker=F;
              marginRecovery.add(H);if(move.v-model.minV>1e-7) changed=true;
              continue;
            }
            let canceled=false;
            // 在弯道横移会改变车道弧长及停止距离；即使本步没有碰到
            // 身体，也不能允许并道吞掉已经需要的制动空间。
            for(const X of [H,F]) if(Math.abs(motion.get(X).t-old.get(X).t)>1e-12) {
              const xm=motionModel.get(X);xm.target=old.get(X).t;
              motion.set(X,xm.paidProposal(xm.freeV,xm.target));denied.add(X);canceled=true;
            }
            if(canceled) {changed=true;continue trafficSolve;}
            trafficFailure('既有跟车间距不满足有限制动可行域',H,F,{before,otherBefore:frontBefore,
              minV:model.minV,minimumSlack:followingSlack(H,F,lower,fm),proposal:move,frontProposal:fm});
          }
          let low=model.minV,high=move.v;
          for(let n=0;n<28;n++) {
            const mid=(low+high)/2;
            if(followingSlack(H,F,model.propose(mid,model.target),fm)>=0) low=mid;else high=mid;
          }
          motion.set(H,model.paidProposal(low,model.target));H.blocked=true;
          if(move.v-low>1e-7) changed=true;
          if(!H.blocker||frontBefore.s<old.get(H.blocker).s) H.blocker=F;
        }
      }
      for(let i=0;i<act.length;i++) for(let j=i+1;j<act.length;j++) {
        const H=act[i],F=act[j];
        if(sweptBodies(H,F,old.get(H),old.get(F),motion.get(H),motion.get(F)))
          trafficFailure('同步运动求解后整步身体路径仍重叠',H,F);
        const rear=old.get(H).s<old.get(F).s?H:F,front=rear===H?F:H;
        const rm=motion.get(rear),fm=motion.get(front);
        const clear=bodyClearance(rear,front,rm.s,fm.s,rm.t,fm.t);
        if(Math.abs(rm.t-fm.t)<clear.lateral&&old.get(rear).s<old.get(front).s) {
          const slack=followingSlack(rear,front,rm,fm,false),response=followingSlack(rear,front,rm,fm);
          if(axisOverlap(fm.t-rm.t,fm.t-rm.t,clear.lateral)) {
            race.traffic.minFollowingSlack=race.traffic.minFollowingSlack==null?slack:Math.min(race.traffic.minFollowingSlack,slack);
            race.traffic.minResponseSlack=race.traffic.minResponseSlack==null?response:Math.min(race.traffic.minResponseSlack,response);
          }
        }
      }
      for(const H of frontFirst) {
        const move=motion.get(H), before=old.get(H);
        H.s=move.s;H.t=move.t;H.prevV=before.v;H.v=move.v;H.accel=(H.v-before.v)/dt;H.lateralV=move.lateral;
        H.trafficStep={lateralDenied:denied.has(H),boundedBraking:H.blocked&&H.accel<-1e-8,
          marginRecovery:marginRecovery.has(H),blocker:H.blocker?.id||null,deltaS:move.s-before.s,deltaT:move.t-before.t};
        race.traffic.syncLateralDenied+=denied.has(H)?1:0;
        race.traffic.brakingSteps+=H.trafficStep.boundedBraking?1:0;
        race.traffic.marginRecoverySteps+=marginRecovery.has(H)?1:0;
        race.traffic.minAcceleration=Math.min(race.traffic.minAcceleration,H.accel);
        H.statsSummary.lateralDeniedSteps=(H.statsSummary.lateralDeniedSteps||0)+(denied.has(H)?1:0);
        H.statsSummary.boundedBrakingSeconds=(H.statsSummary.boundedBrakingSeconds||0)+(H.trafficStep.boundedBraking?dt:0);
        H.statsSummary.marginRecoverySteps=(H.statsSummary.marginRecoverySteps||0)+(marginRecovery.has(H)?1:0);
        const work=motionPower(H,before,move,H.drafting,dt);
        H.power=work;H.effort=H.targetV/Math.max(1,H.cruise);
        const energy=raceEnergyState(H,work,move.aerobic,dt);
        const {excess,draw,restore}=energy;
        H.stamina=energy.stamina;H.guts=energy.guts;H.retention=energy.retention;
        updateStartState(H);
        H.stage=H.stamina>H.staminaMax*0.12?'耐力':H.stamina>H.staminaMax*0.015?'毅力':'失速';
        const stats=H.statsSummary,aerobicUsed=Math.min(work,move.aerobic)*dt;
        H.cumulativeWork+=work*dt;stats.workUsed=H.cumulativeWork;stats.aerobicUsed+=aerobicUsed;
        stats.energyUsed+=draw;stats.unpaidWork+=Math.max(0,work*dt-aerobicUsed-draw);
        stats.recovered+=restore;stats.draftSeconds+=H.drafting?dt:0;stats.blockedSeconds+=H.blocked?dt:0;stats.peakSpeed=Math.max(stats.peakSpeed,H.v);
      }
      const crossings=[];const sectionalCrossings=[];
      for(const H of act) {
        const before=old.get(H), delta=H.s-before.s;
        const move=motion.get(H),meanT=(before.t+move.t)/2;
        const path=laneArcDistance(before.s,move.s,meanT,geo),fraction=move.activeFraction;
        const crossingTime=at=>race.t+dt*(1-fraction)+
          (path>0?clamp(laneArcDistance(before.s,at,meanT,geo)/path,0,1)*dt*fraction:dt*fraction);
        if(H.t600==null && before.s<length-600 && H.s>=length-600) H.t600=crossingTime(length-600);
        let next=(Math.floor(before.s/200)+1)*200;
        while(next<=Math.min(H.s,length)+1e-9) {
          const time=crossingTime(next),prev=H.sectionals.at(-1)?.time||0;
          H.sectionals.push({distance:next,time,split:time-prev,stamina:H.stamina,guts:H.guts});sectionalCrossings.push({distance:next,time});next+=200;
        }
        if(H.s>=length) crossings.push({H,time:crossingTime(length)});
      }
      sectionalCrossings.sort((a,b)=>a.distance-b.distance||a.time-b.time);
      for(const c of sectionalCrossings) if(!race.sectionals.some(s=>s.distance===c.distance)) {
        race.sectionals.push({...c,split:c.time-(race.sectionals.at(-1)?.time||0)});
      }
      crossings.sort((a,b)=>a.time-b.time||a.H.gate-b.H.gate);
      for(const {H,time} of crossings) {
        H.s=length;H.place=race.order.length+1;H.time=time;H.final3f=time-(H.t600??time);
        H.historicalStyle=H.style;H.style=H.observedStyle||H.style;
        if(length%200 && H.sectionals.at(-1)?.distance!==length) H.sectionals.push({distance:length,time,split:time-(H.sectionals.at(-1)?.time||0),stamina:H.stamina,guts:H.guts});
        race.order.push(H);
        if(H.place===1) {
          race.winnerTime=time;
          if(length%200) race.sectionals.push({distance:length,time,split:time-(race.sectionals.at(-1)?.time||0)});
          const fraction=clamp((time-race.t)/dt,0,1);
          for(const F of horses) {
            const before=old.get(F),move=motion.get(F);
            if(F===H||!before){F.gapAtWin=0;continue;}
            const meanT=(before.t+move.t)/2,activeFraction=move.activeFraction;
            const progressFraction=activeFraction?clamp((fraction-(1-activeFraction))/activeFraction,0,1):0;
            const travel=laneArcDistance(before.s,move.s,meanT,geo);
            F.gapAtWin=Math.max(0,length-laneAdvance(before.s,travel*progressFraction,meanT,geo));
          }
          event('🏆 '+H.name+' 率先冲线！',true);
        } else event('第'+H.place+'位 '+H.name+'（'+(H.gapAtWin/2.4).toFixed(1)+'马身差）');
      }
      race.t+=dt;race.avgV=act.reduce((sum,H)=>sum+H.v,0)/act.length;
      const lead=ranked()[0];
      if(lead) {
        // 公布实际领跑分段的速度；赛前预测保留在pacePrediction，不给马额外加成。
        const last=race.sectionals.at(-1), ref=baseSpeed(70)*Math.cbrt(RACE_F.aerobicBase);
        if(last && last.distance>200) race.paceStrength=((last.distance-(race.sectionals.at(-2)?.distance||0))/last.split)/ref;
        else race.paceStrength=lead.v/ref;
        race.paceLevel=race.paceStrength<0.97?'スロー':race.paceStrength>1.03?'ハイ':'平均';
        race.paceContest=active().filter(F=>F!==lead&&lead.s-F.s<9&&F.v>=lead.v-0.3&&
          (F.strategy?.mode==='position'||F.strategy?.mode==='attack'||F.targetV>F.cruise+0.1)).length;
        if(race.prevLead!==lead) {if(!race.order.length) event(lead.name+' 跑在最前方！');race.prevLead=lead;}
        const pct=Math.floor(lead.s/length*100);
        if(pct>race._lastPct){race._lastPct=pct;race.posHistory.push({pct,order:ranked().map(H=>H.id)});}
      }
      if(!active().length || race.t>600) {
        race.finished=true;for(const H of active()){H.dnf=true;race.dnf.push(H);}
      }
    }
    function step(dt,onTick) {
      if(!Number.isFinite(dt)||dt<=0) throw new Error('比赛步长必须是正数');
      const count=Math.ceil(dt/(1/60)), sub=dt/count;
      for(let i=0;i<count&&!race.finished;i++) {
        let left=sub;
        while(left>1e-10&&!race.finished) {
          let slice=left;
          // Execute finite action transitions at their forecast time, including
          // transitions falling between two display/60 Hz update boundaries.
          for(const H of horses)if(!H.control&&!H.place&&!H.dnf&&H.riderSequence) {
            let boundary=H.riderSequence.at;
            for(const action of H.riderSequence.actions){boundary+=action.duration;
              const until=boundary-race.t;if(until>1e-9){slice=Math.min(slice,until);break;}}
          }
          const before=typeof onTick==='function'?horses.map(H=>({id:H.id,s:H.s,t:H.t,v:H.v,place:H.place,dnf:H.dnf})):null;
          tick(slice);if(before)onTick(before,slice);left-=slice;
        }
      }
    }
    function snapshot() {
      const list=ranked();return {t:race.t,finished:race.finished,length,dir,profile,g,course:geo.course,
        traffic:race.traffic?{...race.traffic}:null,
        paceLevel:race.paceLevel,paceStrength:race.paceStrength,pacePrediction:race.pacePrediction,
        leader:list[0]?.id||null,leaderProgress:list[0]?list[0].s/length:1,events:race.events.slice(-10),order:race.order.map(H=>H.id),
        horses:horses.map(H=>({id:H.id,name:H.name,s:H.s,t:H.t,v:H.v,pot:H.pot,accel:H.accel,power:H.power,
          rank:H.place|| (H.dnf?null:list.indexOf(H)+1),stage:H.stage,stamina:H.stamina,guts:H.guts,
          trafficStep:H.trafficStep?{...H.trafficStep}:null,
          staminaMax:H.staminaMax,gutsMax:H.gutsMax,retention:H.retention,action:H.action,dnf:H.dnf,
          place:H.place,time:H.time,blocked:H.blocked,style:H.observedStyle||H.style,observedStyle:H.observedStyle,
          strategy:H.strategy,gateOpen:H.gateOpen,startSettled:H.startSettled,
          aerobicOutput:H.aerobicOutput,gapAtWin:H.gapAtWin,final3f:H.final3f,sprintAt:H.sprintAt}))};
    }
    return {race,step,snapshot,state:snapshot};
  }

  /* ---------------- 生涯模式（周推进 + 赛事体系 + 马匹生命周期） ---------------- */
  /* 🎯 场次内的能力跨度（上下各几点）—— 「马身差距」的最大杠杆
     实测：每 ±1 点 ≈ 2.5 马身（1-2 名着差）。
     原来生涯模式的每名对手都在赛事等级的【整个区间】里独立取值
     （10 点，如 G1 是 84~94），等于一场比赛里马的实力能差 10 点 ——
     而现实同班次马的实力要接近得多，这正是真实赛马"冠军只赢半个马身"
     的前提。收窄到 ±2（共 4 点）后实测 1-2 名着差由 15.15 → ~6.4。
     注意：`tierDef.level` 仍负责【场次档次】（新马赛 44~54 vs G1 84~94），
     只是不再作为【同场马之间的差异】。 */
  const FIELD_LEVEL_SPAN = 2;
  /* 赛事体系（策划案 4.10.6）：按胜场数解锁，level 为对手强度区间 */
  const RACE_TIERS = [
    { key: 'newcomer', name: '新马赛', prize: 250, level: [44, 54], dist: [1600, 2000] },
    { key: 'maiden', name: '未胜利赛', prize: 200, level: [48, 58], dist: [1600, 2000] },
    { key: 'cond1', name: '一胜赛', prize: 400, level: [54, 64], dist: [1600, 2000] },
    { key: 'cond2', name: '二胜赛', prize: 500, level: [58, 68], dist: [1600, 2000, 2400] },
    { key: 'cond3', name: '三胜赛', prize: 600, level: [62, 72], dist: [1600, 2000, 2400] },
    { key: 'open', name: '公开赛/表列赛', prize: 800, level: [68, 78], dist: [2000, 2400] },
    { key: 'g3', name: 'G3', prize: 1500, level: [72, 82], dist: [1800, 2000, 2400] },
    { key: 'g2', name: 'G2', prize: 2500, level: [78, 88], dist: [2000, 2400] },
    { key: 'g1', name: 'G1', prize: 5000, level: [84, 94], dist: [2000, 2400, 3200] },
  ];
  const TIER_BY_KEY = {};
  RACE_TIERS.forEach((t) => { TIER_BY_KEY[t.key] = t; });
  const TIER_RANK = { '新马赛': 0, '未胜利赛': 1, '一胜赛': 2, '二胜赛': 3, '三胜赛': 4, '公开赛/表列赛': 5, 'G3': 6, 'G2': 7, 'G1': 8 };
  /* 训练方针（系统文档 3.4/3.6）：成长系数 + 每周疲劳区间 */
  const TRAINING_DEF = {
    '速度特化': { coef: { '速度': 2 }, fatigue: [18, 22] },
    '耐力特化': { coef: { '耐力': 2 }, fatigue: [15, 20] },
    '力量特化': { coef: { '力量': 2 }, fatigue: [16, 20] },
    '出闸强化': { coef: { '出闸能力': 2 }, fatigue: [10, 14] },
    '基础均衡': { coef: { all: 1.15 }, fatigue: [12, 16] },
    '维持状态': { coef: {}, fatigue: [8, 12] },
    '休养优先': { coef: {}, fatigue: [-15, -9] },
  };
  const PRIZE_SHARE = [1, 0.4, 0.25, 0.15, 0.1];
  function prizeForPlace(prize, place) {
    if (!place || place < 1 || place > 5) return 0;
    return Math.round(prize * PRIZE_SHARE[place - 1]);
  }
  const RACE_NAME_A = ['新春', '皐月', '初夏', '盛夏', '秋華', '菊花', '有終', '飛翔', '開拓', '黎明', '希望', '王冠'];
  const RACE_NAME_B = ['賞', '杯', '記念', 'ステークス'];
  function makeRaceName(rng, n) {
    return '第' + n + '回 ' + pick(rng, RACE_NAME_A) + pick(rng, RACE_NAME_B);
  }
  /* 生涯马：2岁出道，属性上限隐藏、当前值约为上限55%，状态值决定成长长度 */
  function makeCareerHorse(rng) {
    const caps = {};
    for (const k of Object.keys(HORSE_STATS)) {
      const r = HORSE_STATS[k];
      caps[k] = clamp(Math.round((r[0] + r[1]) / 2 + (rng() - 0.5) * (r[1] - r[0]) * 0.5 + 20), 50, 97);
    }
    const stats = {};
    for (const k of Object.keys(caps)) stats[k] = Math.max(20, Math.round(caps[k] * 0.55));
    const used = new Set();
    const sv = 2600 + Math.round(rng() * 1800);
    return describeHorse({
      id: 'ph',
      name: makeName(rng, used),
      sex: rng() < 0.5 ? '牡' : '牝',
      coat: pick(rng, COATS),
      surface: weightedPick(rng, [['草地', 80], ['泥草双刀', 14], ['泥地', 6]]),
      special: weightedPick(rng, [['左右皆可', 80], ['左回', 10], ['右回', 10]]),
      age: 2, stats, caps,
      '状态值': sv, '状态值Max': sv,
      '周消耗': 22 + Math.round(rng() * 16),
      '斗志': 70, '疲劳': 0, injury: 0, weeksSinceRace: 0,
      wins: 0, starts: 0, g1: 0, earnings: 0, bestTier: null,
      sire: makeName(rng, used), dam: makeName(rng, used),
      jockeyGrade: weightedPick(rng, [['普通', 60], ['优秀', 30], ['殿堂', 10]]),
      aggression: Math.round((0.5 + rng()) * 10) / 10,
      history: [],
    },undefined,rng);
  }
  /* 每周结算：训练疲劳/成长或衰退/斗志/伤病（文档 3.1/3.2/3.6/3.7/3.8） */
  function careerWeeklyTick(h, training, rng) {
    horsePhysiology(h);
    const events = [];
    const isInjured = h.injury > 0;
    if (isInjured) {
      h.injury--;
      events.push({ type: 'injury', text: h.name + ' 仍在伤病休养中（还有 ' + h.injury + ' 周）' });
      training = '休养优先';
    }
    const t = TRAINING_DEF[training] || TRAINING_DEF['基础均衡'];
    h['疲劳'] = clamp(h['疲劳'] + t.fatigue[0] + rng() * (t.fatigue[1] - t.fatigue[0]) - 5, 0, 130);
    if (h['状态值'] > 0) {
      const ratio = h['状态值'] / h['状态值Max'];
      const intel = 0.5 + h.stats['智力'] / 100;
      for (const k of ['速度', '爆发力', '出闸能力', '耐力', '力量', '毅力', '体格']) {
        const c = t.coef.all || t.coef[k] || 1;
        h.stats[k] = Math.min(h.caps[k], h.stats[k] + 0.35 * c * ratio * intel);
      }
      h['状态值'] = Math.max(0, h['状态值'] - h['周消耗']);
      if (h['状态值'] === 0) events.push({ type: 'peak', text: h.name + ' 的成长资源耗尽，进入衰退期' });
    } else {
      for (const k of ['速度', '爆发力', '出闸能力', '耐力', '力量', '毅力', '体格']) {
        h.stats[k] = Math.max(20, h.stats[k] - 0.5);
      }
    }
    h.weeksSinceRace++;
    if (h.weeksSinceRace > 5) h['斗志'] = Math.max(0, h['斗志'] - 5);
    if (h.weeksSinceRace > 10) h['斗志'] = Math.max(0, h['斗志'] - 5);
    const fat = h['疲劳'];
    const pInj = fat <= 25 ? 0.01 : fat <= 50 ? 0.01 : fat <= 70 ? 0.03 : fat <= 85 ? 0.08 : fat <= 100 ? 0.2 : 0.5;
    if (!isInjured && rng() < pInj) {
      h.injury = 2 + Math.floor(rng() * 4);
      h['疲劳'] = Math.max(0, h['疲劳'] - 10);
      events.push({ type: 'injury', text: '❗ ' + h.name + ' 受伤了！需要休养 ' + h.injury + ' 周' });
    }
    return events;
  }
  /* 生涯比赛的对手阵容（7名AI + 玩家马，对手强度按赛事等级） */
  function makeCareerRaceField(h, tierDef, rng, race) {
    horsePhysiology(h);
    const base=(tierDef.level[0]+tierDef.level[1])/2;
    const horses=makeField(rng,{n:7,level:base,tierDef,race,playerIndex:-1,idPrefix:'r'});
    for(const rh of horses){rh.age=h.age;rh.player=false;}
    const playerEntry = {
      id: h.id, name: h.name, style: h.style, age: h.age, sex: h.sex, coat: h.coat,
      surface: h.surface, special: h.special,
      behavior:h.behavior?{...h.behavior}:undefined, racePlan:h.racePlan?{...h.racePlan}:undefined,
      physiology:{...h.physiology},
      carriedWeight:h.carriedWeight, bodyMass:h.bodyMass,
      stats: JSON.parse(JSON.stringify(h.stats)),
      '斗志': h['斗志'], '疲劳': h['疲劳'],
      jockeyGrade: h.jockeyGrade, aggression: h.aggression,
      form: { '出赛': h.starts, '胜利': h.wins, '前三': Math.min(h.starts, h.wins + Math.floor(h.starts * 0.2)) },
      player: true, sire: h.sire, dam: h.dam,
    };
    horses.splice(Math.floor(rng() * 8), 0, playerEntry);
    return horses;
  }
  /* 本周可参赛事：按胜场数解锁等级 */
  function raceOptionsFor(h, rng) {
    let keys;
    if (h.starts === 0) keys = ['newcomer'];
    else if (h.wins === 0) keys = ['maiden'];
    else if (h.wins === 1) keys = ['cond1'];
    else if (h.wins === 2) keys = ['cond2'];
    else if (h.wins === 3) keys = ['cond3'];
    else keys = ['open', 'g3', 'g2', 'g1'];
    return keys.map((key) => {
      const t = TIER_BY_KEY[key];
      const dist = pick(rng, t.dist);
      const surface = rng() < 0.85 ? '草地' : '泥地';
      const state = weightedPick(rng, [['良', 80], ['稍重', 12], ['重', 5], ['不良', 3]]);
      const dir = rng() < 0.5 ? '左回' : '右回';
      const profile = weightedPick(rng, [['平坦', 20], ['缓坂', 45], ['中坂', 25], ['急坂', 10]]);
      const field = makeCareerRaceField(h, t, rng, {length:dist,surface,state,dir,profile});
      const odds = marketOddsAndPopularity(field, { length: dist, surface, state, dir, profile }, rng).byId;
      return { key, name: t.name, prize: t.prize, dist, surface, state, dir, profile, field, odds };
    });
  }
  /* 每周瞩目赛事（G3/G2/G1，自动模拟，供下注） */
  function makeFeaturedRace(rng, weekNum) {
    const key = weightedPick(rng, [['g3', 45], ['g2', 35], ['g1', 20]]);
    const t = TIER_BY_KEY[key];
    const dist = pick(rng, t.dist);
    const surface = rng() < 0.85 ? '草地' : '泥地';
    const state = weightedPick(rng, [['良', 80], ['稍重', 12], ['重', 5], ['不良', 3]]);
    const dir = rng() < 0.5 ? '左回' : '右回';
    const profile = weightedPick(rng, [['平坦', 20], ['缓坂', 45], ['中坂', 25], ['急坂', 10]]);
    const field = makeField(rng, {n:8,level:t.level[0]+rng()*(t.level[1]-t.level[0]),tierDef:t,playerIndex:-1,race:{length:dist,surface,state,dir,profile}});
    const odds = marketOddsAndPopularity(field, { length: dist, surface, state, dir, profile }, rng).byId;
    return {
      name: makeRaceName(rng, 5 + (weekNum % 30)), key, tier: t.name, prize: t.prize,
      dist, surface, state, dir, profile, field, odds,
      rngSeed: Math.floor(rng() * 1e9),
    };
  }

  /* ---------------- 血统库（种马/繁殖牝马 + 退役马入种） ---------------- */
  function makeBaseBreedingStock(rng) {
    const stock = [];
    const used = new Set();
    for (let i = 0; i < 26; i++) {
      const male = i < 14;
      const starts = 12 + Math.floor(rng() * 20);
      const wins = 2 + Math.floor(rng() * (male ? 16 : 10));
      const g1 = rng() < (male ? 0.3 : 0.15) ? 1 + Math.floor(rng() * 4) : 0;
      const bestTier = g1 > 0 ? 'G1' : (rng() < 0.5 ? 'G3' : '公开赛/表列赛');
      const level = 55 + (g1 ? 22 : 10) + rng() * 15;
      const stats = {};
      for (const k of Object.keys(HORSE_STATS)) {
        const rr = HORSE_STATS[k];
        stats[k] = clamp(Math.round((rr[0] + rr[1]) / 2 + (rng() - 0.5) * (rr[1] - rr[0]) * 0.5 + (level - 70)), 40, 97);
      }
      stock.push({
        id: 'bs' + i, name: makeName(rng, used),
        sex: male ? '牡' : '牝',
        starts, wins: Math.min(starts, wins), g1,
        bestTier, retired: true, isBase: true,
        stats, surface: '草地', special: '左右皆可',
        blQ: 0.2 + rng() * 0.6, stQ: 0.2 + rng() * 0.6, wQ: 0.2 + rng() * 0.6,
      });
    }
    for(const h of stock) horsePhysiology(h);
    return stock;
  }
  /* 按成绩加权选种（G1冠军权重远高于普通马） */
  function pickBreeder(rng, stock, sex) {
    const pool = stock.filter((h) => h.sex === sex);
    if (!pool.length) return { name: '不明', sex, starts: 0, wins: 0, g1: 0, bestTier: '—', retired: true };
    const weighted = pool.map((h) => ({ h, w: 1 + (h.g1 || 0) * 8 + (h.wins || 0) * 0.3 }));
    const total = weighted.reduce((s, e) => s + e.w, 0);
    let r = rng() * total;
    for (const e of weighted) { r -= e.w; if (r <= 0) return e.h; }
    return weighted[weighted.length - 1].h;
  }
  /* 退役马转入血统库 */
  function breederFromHorse(rh) {
    horsePhysiology(rh);
    return {
      id: rh.id, name: rh.name, sex: rh.sex,
      starts: rh.starts, wins: rh.wins, g1: rh.g1 || 0,
      bestTier: rh.bestTier || '未胜利', retired: true,
      sireName: rh.sireName, damName: rh.damName,
      sireRec: rh.sireRec, damRec: rh.damRec,
      stats: JSON.parse(JSON.stringify(rh.stats)),
      surface: rh.surface, special: rh.special,
      behavior:rh.behavior?{...rh.behavior}:undefined, racePlan:rh.racePlan?{...rh.racePlan}:undefined,
      physiology:{...rh.physiology},
      carriedWeight:rh.carriedWeight, bodyMass:rh.bodyMass,
      blQ: rh.blQ || 0.5, stQ: rh.stQ || 0.5, wQ: rh.wQ || 0.5,
    };
  }

  /* 马主/调教师名池 */
  const OWNER_A = ['高松', '藤原', '佐々木', '山口', '村上', '小林', '加藤', '伊藤', '山田', '渡辺', '中村', '井上'];
  const OWNER_B = ['牧場', 'ファーム', 'ステーブル', '農場', 'ホースクラブ'];
  const TRAINER_A = ['西村', '岡田', '橋本', '石川', '吉田', '松本', '木村', '森田', '斎藤', '青木'];
  function makeOwner(rng) { return pick(rng, OWNER_A) + pick(rng, OWNER_B); }
  function makeTrainer(rng) { return pick(rng, TRAINER_A) + '厩舎'; }

  /* ---------------- 马群连续性（参赛马池） ---------------- */
  function makeRosterHorse(rng, age, idSeed, stock) {
    const caps = {};
    for (const k of Object.keys(HORSE_STATS)) {
      const r = HORSE_STATS[k];
      caps[k] = clamp(Math.round((r[0] + r[1]) / 2 + (rng() - 0.5) * (r[1] - r[0]) * 0.5 + 12), 45, 97);
    }
    const ageF = age === 2 ? 0.55 : age === 3 ? 0.82 : age === 4 ? 0.95 : 1.0;
    const stats = {};
    for (const k of Object.keys(caps)) stats[k] = Math.max(20, Math.round(caps[k] * ageF));
    const used = new Set();
    const starts = age === 2 ? Math.floor(rng() * 3) : age === 3 ? 4 + Math.floor(rng() * 5) : age === 4 ? 9 + Math.floor(rng() * 6) : 14 + Math.floor(rng() * 7);
    const ability = caps['速度'] * 0.4 + caps['耐力'] * 0.2 + caps['爆发力'] * 0.2 + caps['毅力'] * 0.2;
    const winRate = clamp(0.04 + (ability - 50) / 90, 0.03, 0.45);
    const sireRec = pickBreeder(rng, stock || [], '牡');
    const damRec = pickBreeder(rng, stock || [], '牝');
    return describeHorse({
      id: 'rh' + idSeed,
      name: makeName(rng, used),
      sex: rng() < 0.5 ? '牡' : '牝',
      coat: pick(rng, COATS),
      surface: weightedPick(rng, [['草地', 80], ['泥草双刀', 14], ['泥地', 6]]),
      special: weightedPick(rng, [['左右皆可', 80], ['左回', 10], ['右回', 10]]),
      age, stats, caps, ability,
      '斗志': 55 + Math.round(rng() * 30),
      '疲劳': Math.round(rng() * 25),
      jockeyGrade: weightedPick(rng, [['普通', 55], ['优秀', 30], ['新人', 5], ['殿堂', 10]]),
      aggression: Math.round((0.5 + rng()) * 10) / 10,
      starts, wins: Math.min(starts, Math.round(starts * winRate)),
      lastRaceWeek: -99, retired: false, retireReason: null,
      history: [], earnings: 0,
      owner: makeOwner(rng), trainer: makeTrainer(rng),
      g1: 0, bestTier: null,
      sire: sireRec.name, dam: damRec.name,
      sireName: sireRec.name, damName: damRec.name,
      sireRec, damRec,
      blQ: 0.2 + rng() * 0.6, stQ: 0.2 + rng() * 0.6, wQ: 0.2 + rng() * 0.6,
    },undefined,rng);
  }
  function makeRoster(rng, stock) {
    if (!stock) stock = makeBaseBreedingStock(rng);
    const roster = [];
    let id = 0;
    for (const pair of [[2, 18], [3, 20], [4, 18], [5, 16]]) {
      for (let i = 0; i < pair[1]; i++) roster.push(makeRosterHorse(rng, pair[0], id++, stock));
    }
    return roster;
  }
  function rosterEntry(rh, rng) {
    horsePhysiology(rh);
    return {
      id: rh.id, name: rh.name, style: rh.style, age: rh.age, sex: rh.sex, coat: rh.coat,
      surface: rh.surface, special: rh.special,
      behavior:rh.behavior?{...rh.behavior}:undefined, racePlan:rh.racePlan?{...rh.racePlan}:undefined,
      physiology:{...rh.physiology},
      carriedWeight:rh.carriedWeight, bodyMass:rh.bodyMass,
      stats: JSON.parse(JSON.stringify(rh.stats)),
      '斗志': clamp(rh['斗志'] + Math.round((rng() - 0.5) * 20), 30, 100),
      '疲劳': rh['疲劳'],
      jockeyGrade: rh.jockeyGrade, aggression: rh.aggression,
      form: { '出赛': rh.starts, '胜利': rh.wins, '前三': Math.min(rh.starts, rh.wins + Math.floor(rh.starts * 0.25)) },
      player: false, sire: rh.sire, dam: rh.dam,
    };
  }
  /* 从马群按条件选马（cooldown 周内不再出赛，保证赛程合理+连续性） */
  function pickRosterField(roster, rng, weekNum, opts) {
    const o = opts || {};
    const cooldown = o.cooldown !== undefined ? o.cooldown : 2;
    const pool = roster.filter((h) => !h.retired && h.age >= (o.ageMin || 2) && h.age <= (o.ageMax || 5) &&
      h.wins >= (o.winsMin || 0) && h.wins <= (o.winsMax !== undefined ? o.winsMax : 99) &&
      h.starts <= (o.startsMax !== undefined ? o.startsMax : 99) &&
      h.ability >= (o.abilityMin || 0) && h.ability <= (o.abilityMax !== undefined ? o.abilityMax : 100) &&
      weekNum - h.lastRaceWeek >= cooldown);
    const n = Math.min(o.n || 8, pool.length);
    if(o.race){
      const selected=selectRaceCohort(pool,rng,{...o,n:o.n||8});
      Object.defineProperty(selected.horses,'cohort',{value:selected.diagnostics,enumerable:false});
      return selected.horses;
    }
    const sorted = pool.slice().sort((a, b) => b.ability - a.ability);
    const chosen = [];
    if (sorted.length <= n) chosen.push(...sorted);
    else {
      while (chosen.length < n) {
        const idx = Math.floor(Math.pow(rng(), 1.7) * sorted.length);
        const h = sorted[idx];
        if (chosen.indexOf(h) === -1) chosen.push(h);
      }
    }
    return chosen;
  }
  /* 战绩累积：比赛结束后更新马群马匹的出场/胜利/历史战绩/疲劳，并掷重伤退役判定 */
  function applyRaceForm(roster, field, raceOrder, weekNum, rng, stock, raceName, tier, dist, prize) {
    const events = [];
    for (const H of raceOrder) {
      const rh = roster.find((x) => x.id === H.id);
      if (!rh) continue;
      rh.starts++;
      if (H.place === 1) {
        rh.wins++;
        if (tier === 'G1') rh.g1 = (rh.g1 || 0) + 1;
        if (!rh.bestTier || TIER_RANK[tier] > TIER_RANK[rh.bestTier]) rh.bestTier = tier;
      }
      if (prize && H.place && H.place <= 5) rh.earnings = (rh.earnings || 0) + prizeForPlace(prize, H.place);
      rh.lastRaceWeek = weekNum;
      rh['疲劳'] = clamp((rh['疲劳'] || 0) + 12, 0, 130);
      if(H.observedStyle) rh.style=H.observedStyle;
      rh.history.push({ week: weekNum, race: raceName || '—', tier: tier || '—', place: H.place,
        dist: dist || 0, style:H.observedStyle||rh.style, time:H.time, final600:H.final3f });
      // 重伤退役判定：疲劳>70概率×3，5岁×2
      if (!rh.retired) {
        let p = 0.002;
        if (rh['疲劳'] > 70) p *= 3;
        if (rh.age >= 5) p *= 2;
        if (rng && rng() < p) {
          rh.retired = true;
          rh.retireReason = '伤病';
          if (stock) stock.push(breederFromHorse(rh));
          events.push({ type: 'retire', text: '❗ ' + rh.name + '（' + rh.age + '岁 · ' + rh.starts + '战' + rh.wins + '胜）因伤退役！' });
        }
      }
    }
    return events;
  }
  /* 每周马群疲劳恢复 */
  function rosterTick(roster) {
    for (const h of roster) if (!h.retired) h['疲劳'] = Math.max(0, (h['疲劳'] || 0) - 8);
  }
  /* ---------------- 52周年度赛程日历 ---------------- */
  const VENUES = ['東京', '中山', '阪神', '京都', '福島', '新潟', '中京', '小倉'];
  /* 每周赛程（策划案 4.10.6 全梯队）：
     未胜利/一胜/二胜/三胜/G3 每周各1场；新马赛仅在6-12月(2岁出道季)；
     表列赛双数周、G1单数周、G2每4周各1场——G1压轴排最后 */
  function weekRaceSpecs(week) {
    const specs = [];
    if (week >= 22) specs.push({ key: 'newcomer', tier: '新马赛', prize: 250, winsMin: 0, winsMax: 0, startsMax: 0, ageMin: 2, ageMax: 2, abilityMin: 0, cooldown: 1 });
    specs.push({ key: 'maiden', tier: '未胜利赛', prize: 200, winsMin: 0, winsMax: 0, ageMin: 2, ageMax: 5, abilityMin: 0, cooldown: 1 });
    specs.push({ key: 'cond1', tier: '一胜赛', prize: 400, winsMin: 1, winsMax: 1, ageMin: 2, ageMax: 5, abilityMin: 0, cooldown: 1 });
    specs.push({ key: 'cond2', tier: '二胜赛', prize: 500, winsMin: 2, winsMax: 2, ageMin: 2, ageMax: 5, abilityMin: 0, cooldown: 1 });
    specs.push({ key: 'cond3', tier: '三胜赛', prize: 600, winsMin: 3, winsMax: 3, ageMin: 2, ageMax: 5, abilityMin: 0, cooldown: 1 });
    if (week % 2 === 0) specs.push({ key: 'listed', tier: '表列赛', prize: 800, winsMin: 4, winsMax: 99, ageMin: 3, ageMax: 5, abilityMin: 55, cooldown: 2 });
    specs.push({ key: 'g3', tier: 'G3', prize: 1500, winsMin: 2, winsMax: 99, ageMin: 3, ageMax: 5, abilityMin: 60, cooldown: 2 });
    if (week % 4 === 0) specs.push({ key: 'g2', tier: 'G2', prize: 2500, winsMin: 3, winsMax: 99, ageMin: 3, ageMax: 5, abilityMin: 70, cooldown: 2 });
    if (week % 2 === 1) specs.push({ key: 'g1', tier: 'G1', prize: 5000, winsMin: 4, winsMax: 99, ageMin: 3, ageMax: 5, abilityMin: 78, cooldown: 2 });
    return specs;
  }
  function makeScheduledRace(rng, roster, weekNum, idx, spec) {
    const dist = pick(rng, spec.key === 'g1' ? [2000, 2400, 3200] : (spec.key === 'g3' || spec.key === 'g2' || spec.key === 'listed') ? [1800, 2000, 2400] : [1600, 2000]);
    const surface = rng() < 0.85 ? '草地' : '泥地';
    const state = weightedPick(rng, [['良', 80], ['稍重', 12], ['重', 5], ['不良', 3]]);
    let dir = rng() < 0.5 ? '左回' : '右回';
    let profile = weightedPick(rng, [['平坦', 20], ['缓坂', 45], ['中坂', 25], ['急坂', 10]]);
    const venue = pick(rng, VENUES);
    const venueGeo=trackGeometry(dist,venue,surface);
    if(venueGeo.direction) dir=venueGeo.direction;
    else if(['福島','小倉','中京'].includes(venue)) dir=venue==='中京'?'左回':'右回';
    if(venueGeo.elevationProfile) profile='官方高程';
    const chosen = pickRosterField(roster, rng, weekNum, {
      ageMin: spec.ageMin, ageMax: spec.ageMax, winsMin: spec.winsMin, winsMax: spec.winsMax,
      startsMax:spec.startsMax,abilityMin:spec.abilityMin,n:8,cooldown:spec.cooldown,
      tierKey:spec.key==='listed'?'open':spec.key,race:{length:dist,course:venue,surface,state,dir,profile},
    });
    const field = chosen.map((rh) => rosterEntry(rh, rng));
    const odds = marketOddsAndPopularity(field, { length: dist, surface, state, dir, profile }, rng).byId;
    const graded = spec.key === 'g1' || spec.key === 'g2' || spec.key === 'g3' || spec.key === 'listed';
    return {
      id: 'ai' + idx,
      name: graded ? makeRaceName(rng, 8 + ((weekNum * 7 + idx) % 40)) : venue + ' ' + spec.tier + '（' + dist + 'm）',
      venue,
      tier: spec.tier, prize: spec.prize, dist, surface, state, dir, profile, field, odds, key: spec.key,
      rngSeed: Math.floor(rng() * 1e9),
    };
  }
  /* 每周情报：从本周赛程中挑几匹马给出带误差的马评（赌徒的信息优势来源） */
  function makeWeekIntel(races, staff, rng) {
    const lines = [];
    const pool = races.filter((r) => r.field && r.field.length > 0);
    const n = Math.min(3, pool.length);
    const used = [];
    while (used.length < n) {
      const x = Math.floor(rng() * pool.length);
      if (used.indexOf(x) === -1) used.push(x);
    }
    used.forEach((raceIdx) => {
      const race = pool[raceIdx];
      const hIdx = Math.floor(rng() * race.field.length);
      const h = race.field[hIdx];
      const stat = pick(rng, ['速度', '耐力', '爆发力', '力量', '出闸能力']);
      const err = STAFF['相马眼'][staff['牧场长']['相马眼']];
      const obs = clamp(Math.round(h.stats[stat] + (rng() * 2 - 1) * err * (0.5 + rng() * 0.5)), 0, 115);
      lines.push({
        raceId: race.id, raceName: race.name,
        horseName: h.name, num: hIdx + 1, stat,
        text: tierText(stat, obs),
        obs, truth: h.stats[stat], truthText: tierText(stat, h.stats[stat]),
        correct: tierIdx(obs) === tierIdx(h.stats[stat]),
        checked: false,
      });
    });
    return lines;
  }
  /* 每年马群老化 + 6岁退役入种 + 新2岁马入厩（血统库选亲） */
  function ageRoster(roster, rng, stock) {
    const events = [];
    for (const h of roster) {
      horsePhysiology(h);
      h.age++;
      if (h.age >= 6 && !h.retired) {
        h.retired = true;
        h.retireReason = '年龄';
        if (stock) stock.push(breederFromHorse(h));
        events.push({ type: 'retire', text: '🏁 ' + h.name + '（' + h.starts + '战' + h.wins + '胜' + (h.g1 ? ' · G1 ' + h.g1 + '胜' : '') + '）年满退役，进入配种行列' });
      }
      if (!h.retired) {
        if (h.age === 3) { for (const k of Object.keys(h.stats)) h.stats[k] = Math.min(h.caps[k], Math.round(h.stats[k] * 1.15)); }
        else if (h.age === 4) { for (const k of Object.keys(h.stats)) h.stats[k] = Math.min(h.caps[k], Math.round(h.stats[k] * 1.08)); }
        else if (h.age === 5) { for (const k of Object.keys(h.stats)) h.stats[k] = Math.min(h.caps[k], Math.round(h.stats[k] * 1.03)); }
      }
    }
    let maxId = roster.reduce((m, h) => Math.max(m, parseInt(h.id.slice(2), 10)), 0);
    for (let i = 0; i < 8; i++) {
      const sire = pickBreeder(rng, stock, '牡');
      const dam = pickBreeder(rng, stock, '牝');
      const foal = breedFoal(rng, sire, dam);
      if (!foal.earlyDeath) roster.push(foalToRosterHorse(rng, foal, sire, dam, ++maxId));
    }
    return events;
  }
  /* 每周AI赛事（新马/条件/重赏） */
  const AI_RACE_SPEC = {
    'maiden': { tierName: '新马/未胜利赛', prize: 250, ageMin: 2, ageMax: 3, winsMax: 0, abilityMin: 0 },
    'cond': { tierName: '条件赛', prize: 500, ageMin: 2, ageMax: 5, winsMax: 3, abilityMin: 0 },
    'g': { tierName: 'G3', prize: 1500, ageMin: 3, ageMax: 5, winsMax: 99, abilityMin: 60 },
  };
  function makeWeeklyAiRace(rng, roster, weekNum, idx, key) {
    const spec = AI_RACE_SPEC[key];
    let tierName = spec.tierName, prize = spec.prize, abilityMin = spec.abilityMin;
    if (key === 'g') {
      const gRoll = rng();
      if (gRoll < 0.55) { tierName = 'G3'; prize = 1500; abilityMin = 60; }
      else if (gRoll < 0.85) { tierName = 'G2'; prize = 2500; abilityMin = 70; }
      else { tierName = 'G1'; prize = 5000; abilityMin = 78; }
    }
    const dist = pick(rng, tierName === 'G1' ? [2000, 2400, 3200] : [1600, 2000, 2400]);
    const surface = rng() < 0.85 ? '草地' : '泥地';
    const state = weightedPick(rng, [['良', 80], ['稍重', 12], ['重', 5], ['不良', 3]]);
    const dir = rng() < 0.5 ? '左回' : '右回';
    const profile = weightedPick(rng, [['平坦', 20], ['缓坂', 45], ['中坂', 25], ['急坂', 10]]);
    const chosen = pickRosterField(roster,rng,weekNum,{ageMin:spec.ageMin,ageMax:spec.ageMax,winsMax:spec.winsMax,abilityMin,n:8,tierKey:tierName==='G1'?'g1':tierName==='G2'?'g2':tierName==='G3'?'g3':key==='maiden'?'maiden':'cond2',race:{length:dist,surface,state,dir,profile}});
    const field = chosen.map((rh) => rosterEntry(rh, rng));
    const odds = marketOddsAndPopularity(field, { length: dist, surface, state, dir, profile }, rng).byId;
    return {
      id: 'ai' + idx,
      name: key === 'g' ? makeRaceName(rng, 8 + ((weekNum * 7 + idx) % 40)) : tierName + '（' + dist + 'm）',
      tier: tierName, prize, dist, surface, state, dir, profile, field, odds, key,
      rngSeed: Math.floor(rng() * 1e9),
    };
  }
  /* 我的出赛选项：对手从马群中选取（连续性） */
  const TIER_ABILITY_BAND = {
    'newcomer': [0, 55, 2, 3], 'maiden': [0, 58, 2, 3],
    'cond1': [35, 62, 2, 4], 'cond2': [40, 68, 2, 4], 'cond3': [45, 72, 3, 5],
    'open': [55, 78, 3, 5], 'g3': [60, 82, 3, 5], 'g2': [68, 88, 3, 5], 'g1': [76, 96, 3, 5],
  };
  // Same sporting qualification as the weekly schedule. Ability bands are
  // representative readiness references; stronger entrants are never barred.
  const PLAYER_RACE_QUALIFICATION = {
    newcomer:{winsMin:0,winsMax:0,startsMax:0},maiden:{winsMin:0,winsMax:0},
    cond1:{winsMin:1,winsMax:1},cond2:{winsMin:2,winsMax:2},cond3:{winsMin:3,winsMax:3},
    open:{winsMin:4,winsMax:99},g3:{winsMin:2,winsMax:99},g2:{winsMin:3,winsMax:99},g1:{winsMin:4,winsMax:99},
  };
  function raceOptionsForRoster(h, rng, roster, weekNum) {
    horsePhysiology(h);
    let keys;
    if (h.starts === 0) keys = ['newcomer'];
    else if (h.wins === 0) keys = ['maiden'];
    else if (h.wins === 1) keys = ['cond1'];
    else if (h.wins === 2) keys = ['cond2'];
    else if (h.wins === 3) keys = ['cond3'];
    else keys = ['open', 'g3', 'g2', 'g1'];
    return keys.map((key) => {
      const t = TIER_BY_KEY[key];
      const band = TIER_ABILITY_BAND[key];
      const dist = pick(rng, t.dist);
      const surface = rng() < 0.85 ? '草地' : '泥地';
      const state = weightedPick(rng, [['良', 80], ['稍重', 12], ['重', 5], ['不良', 3]]);
      const dir = rng() < 0.5 ? '左回' : '右回';
      const profile = weightedPick(rng, [['平坦', 20], ['缓坂', 45], ['中坂', 25], ['急坂', 10]]);
      const rivals = pickRosterField(roster.filter(rh=>rh.id!==h.id),rng,weekNum,{...PLAYER_RACE_QUALIFICATION[key],ageMin:band[2],ageMax:band[3],abilityMin:band[0],abilityMax:Infinity,n:7,tierKey:key,race:{length:dist,surface,state,dir,profile}});
      const field = rivals.map((rh) => rosterEntry(rh, rng));
      const playerEntry = {
        id: h.id, name: h.name, style: h.style, age: h.age, sex: h.sex, coat: h.coat,
        surface: h.surface, special: h.special,
        physiology: { ...h.physiology },
        behavior:h.behavior?{...h.behavior}:undefined, racePlan:h.racePlan?{...h.racePlan}:undefined,
        carriedWeight:h.carriedWeight, bodyMass:h.bodyMass,
        stats: JSON.parse(JSON.stringify(h.stats)),
        '斗志': h['斗志'], '疲劳': h['疲劳'],
        jockeyGrade: h.jockeyGrade, aggression: h.aggression,
        form: { '出赛': h.starts, '胜利': h.wins, '前三': Math.min(h.starts, h.wins + Math.floor(h.starts * 0.2)) },
        player: true, sire: h.sire, dam: h.dam,
      };
      field.splice(Math.floor(rng() * 8), 0, playerEntry);
      const odds = marketOddsAndPopularity(field, { length: dist, surface, state, dir, profile }, rng).byId;
      return { id: 'my' + key, key, name: t.name, prize: t.prize, dist, surface, state, dir, profile, field, odds };
    });
  }

  /* ---------------- 下注玩法（单胜+复式） ---------------- */
  const BET_TYPES = ['単勝', '複勝', '馬連', '馬単', '三連複', '三連単'];
  const BET_TYPE_LABEL = {
    '単勝': '猜冠军', '複勝': '猜进前三', '馬連': '猜前二(不分顺序)', '馬単': '猜前二(分顺序)',
    '三連複': '猜前三(不分顺序)', '三連単': '猜前三(分顺序)',
  };
  const BET_NEED = { '単勝': 1, '複勝': 1, '馬連': 2, '馬単': 2, '三連複': 3, '三連単': 3 };
  /* 下单与结算共用：一张券必须选够互不重复的马。
     fieldIds 可传本场合法马 ID 的数组或 Set；非法输入返回 false。 */
  function validBetSelection(type, ids, fieldIds) {
    if (BET_TYPES.indexOf(type) < 0 || !Array.isArray(ids) || ids.length !== BET_NEED[type]) return false;
    for (const id of ids) if (typeof id !== 'string' || id.trim().length === 0) return false;
    if (new Set(ids).size !== ids.length) return false;
    if (fieldIds !== undefined) {
      if (!Array.isArray(fieldIds) && !(fieldIds instanceof Set)) return false;
      const allowed = fieldIds instanceof Set ? fieldIds : new Set(fieldIds);
      if (!ids.every((id) => allowed.has(id))) return false;
    }
    return true;
  }
  /* 复式赔率模型：由各马单胜赔率推导（演示用近似模型） */
  function calcBetOdds(type, winOddsArr) {
    if (BET_TYPES.indexOf(type) < 0 || !Array.isArray(winOddsArr) || winOddsArr.length !== BET_NEED[type]) return null;
    if (!winOddsArr.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0)) return null;
    const [w1, w2, w3] = winOddsArr;
    let odds;
    if (type === '単勝') odds = Math.max(1.1, w1);
    else if (type === '複勝') odds = Math.max(1.05, 1 + (w1 - 1) * 0.35);
    else if (type === '馬連') odds = Math.max(1.5, Math.round(w1 * w2 * 0.28 * 10) / 10);
    else if (type === '馬単') odds = Math.max(2, Math.round(w1 * w2 * 0.5 * 10) / 10);
    else if (type === '三連複') odds = Math.max(3, Math.round(w1 * w2 * w3 * 0.07 * 10) / 10);
    else odds = Math.max(5, Math.round(w1 * w2 * w3 * 0.45 * 10) / 10);
    return Number.isFinite(odds) ? odds : null;
  }
  function betTypeHit(type, ids, orderIds) {
    if (!Array.isArray(orderIds) || Array.from(orderIds).some((id) => typeof id !== 'string' || id.trim().length === 0) ||
        new Set(orderIds).size !== orderIds.length || !validBetSelection(type, ids, orderIds)) return false;
    const top2 = orderIds.slice(0, 2), top3 = orderIds.slice(0, 3);
    if (type === '単勝') return ids[0] === orderIds[0];
    if (type === '複勝') return top3.indexOf(ids[0]) !== -1;
    if (type === '馬連') return top2.indexOf(ids[0]) !== -1 && top2.indexOf(ids[1]) !== -1;
    if (type === '馬単') return ids[0] === orderIds[0] && ids[1] === orderIds[1];
    if (type === '三連複') return ids.every((x) => top3.indexOf(x) !== -1);
    return ids[0] === orderIds[0] && ids[1] === orderIds[1] && ids[2] === orderIds[2];
  }

  /* ---------------- 繁殖系统（系统文档 3.11 公式落地） ---------------- */
  /* 近亲判定：三代血统查重，位置权重 本身21/父母12/二代6 */
  function checkInbreeding(sire, dam) {
    if (!sire || !dam) return 0;
    if (sire.id === dam.id) return 21;
    const sP = [sire.sireRec && sire.sireRec.id, sire.damRec && sire.damRec.id];
    const dP = [dam.sireRec && dam.sireRec.id, dam.damRec && dam.damRec.id];
    if ((sP[0] && sP[0] === dP[0]) || (sP[1] && sP[1] === dP[1]) || (sP[0] && sP[0] === dP[1]) || (sP[1] && sP[1] === dP[0])) return 12;
    const sG = [sP[0], sP[1], sire.sireRec && sire.sireRec.sireRec && sire.sireRec.sireRec.id, sire.damRec && sire.damRec.damRec && sire.damRec.damRec.id];
    const dG = [dP[0], dP[1], dam.sireRec && dam.sireRec.sireRec && dam.sireRec.sireRec.id, dam.damRec && dam.damRec.damRec && dam.damRec.damRec.id];
    if (sG.some((a) => a && dG.indexOf(a) !== -1)) return 6;
    return 0;
  }
  function inbreedingPenalty(weight) {
    if (weight <= 0) return { name: '无近亲', stateExtra: 0, earlyExtra: 0 };
    if (weight <= 4) return { name: '轻度近亲', stateExtra: 0.1, earlyExtra: 0.02 };
    if (weight <= 11) return { name: '中度近亲', stateExtra: 0.2, earlyExtra: 0.05 };
    if (weight <= 20) return { name: '高度近亲', stateExtra: 0.4, earlyExtra: 0.1 };
    return { name: '极度近亲', stateExtra: 0.8, earlyExtra: 0.2 };
  }
  /* 分位数遗传（3.1/3.2/血统力共用）：5%突变(90%普通/5%低端/5%高端)，
     否则父母区间×三段重叠权重(低端2/高端2/普通wMid)，区间±0.01取随机 */
  function inheritQuantile(rng, fq, mq, opts) {
    const o = opts || {};
    const lowA = o.lowA, lowB = o.lowB, highA = o.highA, highB = o.highB, wMid = o.wMid;
    if (rng() < 0.05) {
      const r2 = rng();
      if (r2 < 0.9) return { q: lowB + rng() * (highB - lowB), mutated: true };
      if (r2 < 0.95) return { q: lowA + rng() * (lowB - lowA), mutated: true };
      return { q: highA + rng() * (highB - highA), mutated: true };
    }
    let lo = Math.max(Math.min(fq, mq), lowA);
    let hi = Math.min(Math.max(fq, mq), highB);
    if (lo >= hi) return { q: clamp(lo, lowA, highB), mutated: true, forced: true };
    const overLow = Math.max(0, Math.min(hi, lowB) - lo);
    const overMid = Math.max(0, Math.min(hi, highA) - Math.max(lo, lowB));
    const overHigh = Math.max(0, hi - Math.max(lo, highA));
    const total = overLow * 2 + overMid * wMid + overHigh * 2;
    let r = rng() * total;
    let bandLo, bandHi;
    r -= overLow * 2;
    if (r <= 0) { bandLo = lo; bandHi = Math.min(hi, lowB); }
    else {
      r -= overMid * wMid;
      if (r <= 0) { bandLo = Math.max(lo, lowB); bandHi = Math.min(hi, highA); }
      else { bandLo = Math.max(lo, highA); bandHi = hi; }
    }
    const q = clamp((bandLo - 0.01) + rng() * ((bandHi + 0.01) - (bandLo - 0.01)), lowA, highB);
    return { q, mutated: false };
  }
  function stateFromQuantile(q) {
    if (q < 0.025) return 1000 + q / 0.025 * 2000;
    if (q < 0.975) return 3000 + (q - 0.025) / 0.95 * 9000;
    return 12000 + (q - 0.975) / 0.025 * 3000;
  }
  function weeklyDrainFromQuantile(q) { return 14.6 * (1.5 - q); }
  function bloodlineFromQuantile(q) {
    if (q < 0.025) return q / 0.025 * 25;
    if (q < 0.975) return 25 + (q - 0.025) / 0.95 * 50;
    return 75 + (q - 0.975) / 0.025 * 25;
  }
  /* 属性遗传（3.11）：5%变异→极值随机；否则 子代=血统力×c1+父母均值×c2±a */
  const INHERIT_DEF = {
    '速度': { c1: 0.6, c2: 0.3, a: [4, 6, 8, 12] },
    '耐力': { c1: 0.55, c2: 0.4, a: [2, 4, 6, 8] },
    '爆发力': { c1: 0.6, c2: 0.3, a: [4, 6, 8, 12] },
    '出闸能力': { c1: 0.55, c2: 0.3, a: [6, 8, 12, 18] },
    '力量': { c1: 0.55, c2: 0.4, a: [2, 4, 6, 8] },
    '毅力': { c1: 0.55, c2: 0.3, a: [6, 8, 12, 18] },
    '智力': { c1: 0.55, c2: 0.3, a: [6, 8, 12, 18] },
    '体格': { c1: 0.6, c2: 0.3, a: [4, 6, 8, 13] },
  };
  function aBandFor(mean, arr) {
    if (mean >= 85) return arr[3];
    if (mean >= 70) return arr[2];
    if (mean >= 50) return arr[1];
    return arr[0];
  }
  function inheritAttr(rng, attr, sireStats, damStats, bloodline) {
    const pMean = (sireStats[attr] + damStats[attr]) / 2;
    if (rng() < 0.05) {
      const lo = Math.min(sireStats[attr], damStats[attr]);
      const hi = Math.max(sireStats[attr], damStats[attr]);
      return rng() < 0.5 ? rng() * lo : hi + rng() * (100 - hi);
    }
    const d = INHERIT_DEF[attr];
    const a = aBandFor(pMean, d.a);
    return bloodline * d.c1 + pMean * d.c2 + (rng() < 0.5 ? -1 : 1) * a * rng();
  }
  function inheritSurface(rng, sS, dS) {
    const T = {
      '草地,草地': [85, 12, 3], '草地,泥草双刀': [60, 30, 10], '草地,泥地': [35, 30, 35],
      '泥草双刀,草地': [60, 30, 10], '泥草双刀,泥草双刀': [30, 40, 30], '泥草双刀,泥地': [10, 30, 60],
      '泥地,草地': [35, 30, 35], '泥地,泥草双刀': [10, 30, 60], '泥地,泥地': [3, 12, 85],
    };
    const p = T[sS + ',' + dS] || [50, 30, 20];
    const r = rng() * 100;
    if (r < p[0]) return '草地';
    if (r < p[0] + p[1]) return '泥草双刀';
    return '泥地';
  }
  function inheritSpecial(rng) {
    if (rng() < 0.2) {
      const r = rng();
      if (r < 0.45) return '右回';
      if (r < 0.9) return '左回';
      return '左右皆不可';
    }
    return '左右皆可';
  }
  /* 配种：完整流程（血统力→属性→适性→状态值/周消耗→近亲→早夭） */
  function breedFoal(rng, sire, dam) {
    const ibW = checkInbreeding(sire, dam);
    const pen = inbreedingPenalty(ibW);
    const blQ = inheritQuantile(rng, sire.blQ || 0.5, dam.blQ || 0.5, { lowA: 0, lowB: 0.025, highA: 0.975, highB: 1, wMid: 0.9 });
    const bloodline = bloodlineFromQuantile(blQ.q);
    const stats = {};
    let earlyDeath = false;
    for (const attr of Object.keys(INHERIT_DEF)) {
      const v = inheritAttr(rng, attr, sire.stats, dam.stats, bloodline);
      if (v > 100 || v < 0) earlyDeath = true;
      stats[attr] = clamp(Math.round(v), 1, 100);
    }
    const stQ = inheritQuantile(rng, sire.stQ || 0.5, dam.stQ || 0.5, { lowA: -0.0125, lowB: 0.025, highA: 0.975, highB: 1.04, wMid: 0.947 });
    if (stQ.q < -0.0125 || stQ.q > 1.04) earlyDeath = true;
    const state = stateFromQuantile(clamp(stQ.q, -0.0125, 1.04));
    const wQ = inheritQuantile(rng, sire.wQ || 0.5, dam.wQ || 0.5, { lowA: 0, lowB: 0.025, highA: 0.975, highB: 1, wMid: 0.9 });
    const drain = weeklyDrainFromQuantile(clamp(wQ.q, 0, 1));
    const surface = inheritSurface(rng, sire.surface || '草地', dam.surface || '草地');
    const special = inheritSpecial(rng);
    const earlyP = 0.05 + pen.earlyExtra;
    if (!earlyDeath && rng() < earlyP) earlyDeath = true;
    const physiology=inheritPhysiology(sire,dam,{stats,sire:sire.id||sire.name,dam:dam.id||dam.name,
      id:[blQ.q,stQ.q,wQ.q].join('|')});
    return {
      stats, physiology, bloodline: Math.round(bloodline),
      state: Math.round(state), drain: Math.round(drain * 10) / 10,
      surface, special,
      blQ: blQ.q, stQ: stQ.q, wQ: wQ.q,
      inbred: ibW, inbredName: pen.name, stateExtra: pen.stateExtra,
      earlyDeath,
    };
  }
  /* 幼驹 → 马群马匹（2岁出道） */
  function foalToRosterHorse(rng, foal, sire, dam, id) {
    const caps = {};
    for (const k of Object.keys(foal.stats)) caps[k] = clamp(Math.round(foal.stats[k] * 1.2 + 4), 45, 100);
    const ability = foal.stats['速度'] * 0.4 + foal.stats['耐力'] * 0.2 + foal.stats['爆发力'] * 0.2 + foal.stats['毅力'] * 0.2;
    return describeHorse({
      id: 'rh' + id,
      name: makeName(rng, new Set()),
      sex: rng() < 0.5 ? '牡' : '牝',
      coat: pick(rng, COATS),
      surface: foal.surface, special: foal.special,
      physiology:foal.physiology?{...foal.physiology}:undefined,
      age: 2, stats: JSON.parse(JSON.stringify(foal.stats)), caps, ability,
      '斗志': 55 + Math.round(rng() * 30), '疲劳': Math.round(rng() * 20),
      jockeyGrade: weightedPick(rng, [['普通', 60], ['优秀', 30], ['新人', 10]]),
      aggression: Math.round((0.5 + rng()) * 10) / 10,
      starts: 0, wins: 0, lastRaceWeek: -99, retired: false, retireReason: null,
      history: [], earnings: 0,
      owner: makeOwner(rng), trainer: makeTrainer(rng),
      g1: 0, bestTier: null,
      sire: sire.name, dam: dam.name, sireName: sire.name, damName: dam.name,
      sireRec: sire, damRec: dam,
      blQ: foal.blQ, stQ: foal.stQ, wQ: foal.wQ,
      '状态值': foal.state, '状态值Max': foal.state, '周消耗': foal.drain,
    },undefined,rng);
  }
  /* 种费（3.11 配种费用公式，牝系未实装按0计） */
  const FEE_TIERS = [['未胜利', 0, 30], ['条件赛', 30, 80], ['公开赛/表列赛', 80, 200], ['G3', 200, 500], ['G2', 500, 800], ['G1', 800, 1500]];
  function feeBand(tier) {
    for (const [name, lo, hi] of FEE_TIERS) if (tier === name) return [lo, hi];
    return [0, 30];
  }
  function fatherBonusFor(h) {
    if (!h) return 0;
    const g1 = h.g1 || 0, best = h.bestTier || '';
    if (g1 >= 3) return 0.75;
    if (g1 >= 1) return 0.55;
    if (best === 'G2') return 0.35;
    if (best === 'G3') return 0.2;
    if (best === '公开赛/表列赛') return 0.1;
    return 0.05;
  }
  function motherRaceBonusFor(h) {
    if (!h) return 0.02;
    const t = h.bestTier || '';
    if (t === 'G1') return 0.7;
    if (t === 'G2') return 0.5;
    if (t === 'G3') return 0.3;
    if (t === '公开赛/表列赛') return 0.1;
    if (t === '条件赛') return 0.05;
    return 0.02;
  }
  function studFeeFor(stallion) {
    const starts = Math.max(1, stallion.starts || 0);
    const winRate = (stallion.wins || 0) / starts;
    const top3Rate = Math.min(1, winRate + 0.3);
    const self = top3Rate * 0.5 + winRate * 0.3 + (stallion.g1 || 0) * 0.03;
    const fb = fatherBonusFor(stallion.sireRec);
    const mb = motherRaceBonusFor(stallion.damRec) * 0.6; // 牝系加成=0
    const band = feeBand(stallion.bestTier);
    let fee = band[0] + (band[1] - band[0]) * (self * 0.6 + fb * 0.25 + mb * 0.15);
    return Math.max(band[0], Math.min(band[1], Math.round(fee)));
  }

  /* ---------------- 导出 ---------------- */
  const api = {
    mulberry32, clamp, pick, weightedPick,
    TRACK_WIDTH, STALL_SPEED, PHASE_DEFS, phaseAt, STYLE_BASE_T,
    RACE_F, drainDistanceCoef, staminaBudget, rangeCoef, powerDrainCoef,
    STAMINA_RANGE_PER_POINT, GROUND_RANGE_COEF,
    STYLE_COEF, STYLE_COEF_DOC, JOCKEY_BONUS, JOCKEY_CADENCE, FIELD_STATE_COEF, SURFACE_COEF,
    ACTION_DEF, actionBonus, actionCoef, baseSpeed, fatigueMultiplier,
    COURSES, COURSE_WIDTHS, trackGeometry, trackPoint, trackTangent, trackWidthAt, kAt, laneCurvatureAt, laneProgressCoef,
    laneArcDistance, laneAdvance, laneArcBreakpoints, bendCoefFor, SLOPE_PROFILES, gradientAt, elevationAt,
    TIER_LABELS, tierIdx, tierText, COMMENT_TABLES,
    STAFF, CAT_ERROR_POOL, catText, fatigueBand, fatigueText,
    makeHorse,makeField,makeRaceCandidatePool,raceEntryForecast,selectRaceCohort,COHORT_VERSION,COHORT_POOL_MULTIPLIER,horseBehavior,racePlanFor,horsePhysiology,neutralPhysiology,PHYSIOLOGY_KEYS,
    makeStaff, generateReport, oddsAndPopularity,
    /* 人气/赔率模型（市场）：独立于比赛引擎，只吃公开信息 */
    MARKET, marketEntryScore, marketOddsAndPopularity, marketImpliedProb, expectedValue,
    marketPaceLevel, PACE_MARKET_BELIEF, PACE_TRUE_EFFECT, paceStrengthOf, PACE_WEIGHT,
    makeName, createRace,
    RACE_TIERS, TIER_BY_KEY, TIER_RANK, FIELD_LEVEL_SPAN, TRAINING_DEF, PRIZE_SHARE, prizeForPlace, makeRaceName,
    makeCareerHorse, careerWeeklyTick, makeCareerRaceField, raceOptionsFor, makeFeaturedRace,
    makeRosterHorse, makeRoster, rosterEntry, pickRosterField, applyRaceForm, ageRoster, rosterTick, makeWeeklyAiRace, raceOptionsForRoster,
    makeBaseBreedingStock, pickBreeder, breederFromHorse,
    BET_TYPES, BET_TYPE_LABEL, BET_NEED, validBetSelection, calcBetOdds, betTypeHit,
    checkInbreeding, inbreedingPenalty, inheritQuantile, stateFromQuantile, weeklyDrainFromQuantile, bloodlineFromQuantile,
    INHERIT_DEF, inheritAttr, inheritSurface, inheritSpecial, breedFoal, foalToRosterHorse, FEE_TIERS, studFeeFor,
    VENUES, weekRaceSpecs, makeScheduledRace, makeWeekIntel,
  };
  root.SaimaSim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
