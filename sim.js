/* ============================================================
 * 赛马风云 · 连续比赛模拟引擎 v2026.10.02.1
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
  /* 进程标签仅用于播报与显示，不控制速度或资源，也不触发冲刺。 */
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
  // 未建模起跑引入线、混合内外圈与可变弯道半径，见 geo.simplification。
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
  function courseElevationProfile(def,S,B,lap) {
    const h=def.elevation;
    if(!h) return null;
    // 坡段位置是官方文字说明约束的近似值，不是逐米测量数据。
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
    const referenceLane=1.4, referenceR=def.lap?(def.lap-2*S)/(2*Math.PI):def.R+referenceLane-TRACK_WIDTH/2;
    const R=referenceR-referenceLane+TRACK_WIDTH/2, B=Math.PI*referenceR, lap=def.lap || 2*S+2*B;
    const startOffset = mod(S - length, lap), boundaries = [];
    for (let loop = -1; loop <= Math.ceil(length / lap) + 1; loop++) {
      for (const [at, kind, label] of [[S, 'bendStart', '入弯'], [S+B, 'bendEnd', '出弯'], [2*S+B, 'bendStart', '入弯'], [lap, 'bendEnd', '出弯']]) {
        const s = loop * lap + at - startOffset;
        if (s > 0 && s < length) boundaries.push({ s, kind, label });
      }
    }
    boundaries.sort((a,b) => a.s-b.s);
    const official=!!def.lap, source=def.venue ? 'https://www.jra.go.jp/facilities/race/'+COURSE_SOURCES[def.venue]+'/course/index.html':null;
    const mixed=length===3200 && (def.venue==='中山'||def.venue==='阪神');
    return { length,R,referenceR,referenceLane,B,S,lap,startOffset,course:key,boundaries,finishStraight:Math.min(length,S),
      venue:def.venue||null,direction:def.direction||null,surface:surface||'草地',officialLap:official?lap:null,
      elevationRange:def.elevation||0,elevationProfile:courseElevationProfile(def,S,B,lap),source,
      distanceSupported:official?def.distances.includes(length):true,
      simplification:official?'官方A栏周长、终点直道与高差约束；两直两弯、统一20m可用宽度；引入线与变曲率未复刻'+(mixed?'；本距离混合内外圈暂以单圈代理':''):'抽象机制对照场地' };
  }
  function trackPoint(s, t, geo, dir) {
    const { R, B, S } = geo, turnR=geo.referenceR||R, q = mod(s + (geo.startOffset || 0), geo.lap || (2*S+2*B));
    const d = t - TRACK_WIDTH / 2; let x,y;
    if(q < S) { x=-S/2+q; y=-R-d; }
    else if(q < S+B) { const a=-Math.PI/2+(q-S)/turnR; x=S/2+(R+d)*Math.cos(a); y=(R+d)*Math.sin(a); }
    else if(q < 2*S+B) { x=S/2-(q-S-B); y=R+d; }
    else { const a=Math.PI/2+(q-2*S-B)/turnR; x=-S/2+(R+d)*Math.cos(a); y=(R+d)*Math.sin(a); }
    if(dir==='右回') x=-x; return {x,y};
  }
  function kAt(s, geo) {
    const {S,B,R}=geo, q=mod(s+(geo.startOffset||0),geo.lap||2*S+2*B);
    return (q>=S && q<S+B) || q>=2*S+B ? 1/R : 0;
  }
  function laneProgressCoef(s,t,geo) {
    const raw=kAt(s,geo)>0?(geo.referenceR||geo.R)/(geo.R+t-TRACK_WIDTH/2):1;
    return 1+(raw-1)*RACE_F.laneBias;
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
    baseSpeed:{a:0.020,b:15.80,min:1,max:115}, // 70点=17.2m/s参考速度
    staminaPer:35, gutsPer:60, energyScale:1,
    aerobicBase:0.86, aerobicStaminaK:0.0020, // 旧展示兼容；物理用下列有单位参数
    aerobicPower:50, aerobicPerPoint:0.24, aerobicTau:10,
    resistanceK:0.250, airK:0.00065, recoveryRate:0.12, recoveryMax:2.0,
    fatigueLoss:0.08, fatigueWork:0.11, fatigueExcess:0.45,
    reservePower:75, reserveFade:0.10, efficiencyPerPoint:0.0025,
    peakExtra:1.55, burstSpeedK:0.010,
    maxAccel:4.6, runningAccel:2.2, braking:3.5,
    responseTime:1.4, lateralSpeed:0.8, laneBias:1,
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
  function horseWid(H) { return 1+0.3*(H.adj['体格']/100); }

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
  function horseBehavior(h,generationRng) {
    // 新马由生成 RNG 取样并持久化；旧档缺少性格时按稳定身份补齐。
    // 两者均不消费比赛 RNG，也不读取跑法标签。
    let seed=2166136261; for(const c of String(h.id||h.name||'horse')) seed=Math.imul(seed^c.charCodeAt(0),16777619);
    const r=generationRng||mulberry32(seed), s=h.stats||{}, supplied=h.behavior||{};
    const values={forwardness:0.5+((s['出闸能力']??70)-(s['爆发力']??70))*0.006+(r()-0.5)*0.5,
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
    const forward=racePlanFor(h,h.behavior).position;
    h.style=historicalStyle || (forward>=0.75?'逃':forward>=0.55?'先':forward>=0.30?'差':'追');
    return h;
  }
  function makeHorse(rng, opts) {
    const o = opts || {};
    /* 「强马」的档差。原为 ±5 —— 也就是场次内单靠 tier 就能拉出 5 点能力差。
       与「场次内能力跨度 ±2」的策略对齐后压到 ±2（见 FIELD_LEVEL_SPAN）。 */
    const boost = o.tier === 'strong' ? 2 : (o.tier === 'weak' ? -2 : 0);
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
  function makeField(rng, opts) {
    const o = opts || {};
    const n = o.n || 8;
    const used = new Set();
    const strongIdx = o.strongIndex !== undefined ? o.strongIndex : Math.floor(rng() * n);
    const playerIdx = o.playerIndex !== undefined ? o.playerIndex : strongIdx;
    /* 场次水平（整场统一），档差由 tier 提供（见 RACE_F / makeHorse） */
    const level = o.level !== undefined ? o.level : 62 + Math.floor(rng() * 17);
    const horses = [];
    for (let i = 0; i < n; i++) {
      const h = makeHorse(rng, {
        tier: i === strongIdx ? 'strong' : 'normal',
        level,
        id: 'h' + (i + 1),
        player: i === playerIdx,
      });
      h.name = makeName(rng, used);
      h.sire = makeName(rng, used);
      h.dam = makeName(rng, used);
      horses.push(h);
    }
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
      prevLead:null,phaseAnnounced:{},posHistory:[],_lastPct:0,lastEventAt:{},sectionals:[]};
    const gates=field.map((_,i)=>i+1);
    for(let i=gates.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [gates[i],gates[j]]=[gates[j],gates[i]]; }
    const horses=field.map((h,i)=>{
      const adj={}; const mor=((h['斗志']??70)-50)*0.0002;
      for(const k of ['速度','爆发力','出闸能力','耐力','力量','毅力','体格','智力']) adj[k]=clamp((h.stats[k]??70)*(1+mor),1,115);
      const gate=gates[i], pitch=Math.min(1.6,(TRACK_WIDTH-3)/field.length), t=1.5+pitch*(gate-0.5);
      const surfC=(SURFACE_COEF[surface]||{})[h.surface]??1;
      const base=baseSpeed(adj['速度']), fatMult=fatigueMultiplier(h['疲劳']||0);
      const behavior=horseBehavior(h), plan=racePlanFor(h,behavior);
      const bodyMass=clamp(Number(h.bodyMass)||450+(adj['体格']-70)*1.5,320,650);
      const carriedWeight=clamp(Number(h.carriedWeight)||57,40,70), massRatio=(bodyMass+carriedWeight)/(bodyMass+57);
      const H={h,id:h.id,name:h.name,style:h.style||'先',jockey:h.jockeyGrade||'普通',adj,mor,gate,
        behavior,plan,bodyMass,carriedWeight,massRatio,
        s:0,t,targetT:t,v:0,prevV:0,pot:0,targetV:base,accel:0,power:0,
        stamina:adj['耐力']*RACE_F.staminaPer,staminaMax:adj['耐力']*RACE_F.staminaPer,
        guts:adj['毅力']*RACE_F.gutsPer,gutsMax:adj['毅力']*RACE_F.gutsPer,
        stage:'耐力',retention:1,base,fatMult,fieldCoef:(FIELD_STATE_COEF[state]||1)*surfC,
        surfaceCost:1+(1-surfC)*0.75,startDelay:0.12+(100-adj['出闸能力'])*0.003+rng()*0.15,
        action:null,actionT:0,lastObserve:0,laneIntentT:0,laneJitter:0,squeezePass:0,
        blocked:false,blocker:null,collisionCoef:1,collisionIntensity:0,stallTimer:0,
        place:null,time:null,gapAtWin:null,dnf:false,sprintAt:null,sectionals:[],
        cumulativeWork:0,statsSummary:{workUsed:0,aerobicUsed:0,energyUsed:0,unpaidWork:0,recovered:0,draftSeconds:0,blockedSeconds:0,peakSpeed:0,sprintAt:null},
        aggression:h.aggression??1,aiBias:(rng()-0.5)*0.12};
      H.economy=Math.exp((70-adj['速度'])*RACE_F.efficiencyPerPoint);
      H.aerobic=clamp(RACE_F.aerobicPower+(adj['耐力']-70)*RACE_F.aerobicPerPoint,35,68)*fatMult;
      H.aerobicOutput=H.aerobic*0.45;
      H.maxV=(base+RACE_F.peakExtra+(adj['爆发力']-70)*RACE_F.burstSpeedK)*fatMult;
      H.powerFor=(v,a,drafting,at=H.s)=>powerCost(H,v,a,drafting,at);
      H.sustainableV=(at=H.s,drafting=false,power=H.aerobic*H.retention)=>speedAtPower(H,power,drafting,at);
      H.kineticCost=(from,to)=>0.5*Math.max(0,to*to-from*from)*H.massRatio;
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
      const margin=horseWid(H)/2+0.2; H.targetT=clamp(t,margin,TRACK_WIDTH-margin);
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
      for(let t=margin;t<=TRACK_WIDTH-margin;t+=0.35) {
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
      if(kAt(at,geo)>0) cap=Math.min(cap,Math.sqrt(Math.max(1,
        (RACE_F.curveLateral+(H.adj['力量']-70)*0.008)*(geo.R+H.t-TRACK_WIDTH/2)))*bendCoefFor(H.h.special,dir));
      return cap;
    }
    // 与实际运动使用同一 W/kg 功率函数，积分为 J/kg；遮挡只预测当前近邻的一小段。
    function reserveToFinish(H,requestedV,draftDistance=0) {
      const remaining=Math.max(0,length-H.s), samples=8;
      let required=H.kineticCost(H.v,Math.min(requestedV,projectedCap(H,H.s))), elapsed=0;
      const maximumSupply=H.aerobic*H.retention;
      const oxygenDeficit=Math.max(0,maximumSupply-(H.aerobicOutput??maximumSupply));
      for(let i=0;i<samples;i++) {
        const distance=remaining*(i+0.5)/samples,at=H.s+distance;
        const v=Math.max(3,Math.min(requestedV,projectedCap(H,at)));
        const seconds=remaining/samples/Math.max(1,v*laneProgressCoef(at,H.t,geo));
        const supply=maximumSupply-oxygenDeficit*Math.exp(-(elapsed+seconds/2)/RACE_F.aerobicTau);
        required+=Math.max(0,H.powerFor(v,0,distance<draftDistance,at)-supply)*seconds;
        elapsed+=seconds;
      }
      return required;
    }
    function budgetSpeed(H,reserve,draftDistance=0) {
      let low=Math.max(3,H.sustainableV(H.s,!!draftDistance)*0.88),high=H.maxV;
      for(let i=0;i<9;i++) {
        const mid=(low+high)/2;
        if(reserveToFinish(H,mid,draftDistance)<=reserve) low=mid;else high=mid;
      }
      return low;
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
    function runAI(H) {
      if(H.control) return;
      const list=ranked(),remaining=Math.max(0,length-H.s),localFront=frontOf(H);
      const behavior=H.behavior||{forwardness:0.5,settle:0.5,tractability:0.5};
      const plan=H.plan||{position:behavior.forwardness,risk:0.5,patience:behavior.settle};
      const quality={'新人':0.40,'普通':0.70,'优秀':0.88,'殿堂':0.97}[H.jockey]??0.70;
      // 有限观察间隔与有界误差；优秀骑手更准确，不取得额外速度或能量。
      const speedError=(rng()*2-1)*(0.05+(1-quality)*0.55);
      const reserveEstimate=H.stamina*clamp(1+(rng()*2-1)*(0.02+(1-quality)*0.18),0.82,1.18);
      const judgement=clamp(1+(rng()*2-1)*(1-quality)*0.10,0.92,1.08);
      const near=list.filter(F=>F!==H && Math.abs(F.s-H.s)<24);
      const ahead=near.filter(F=>F.s>H.s+3).sort((a,b)=>a.s-b.s)[0];
      const wake=near.find(F=>F.s>H.s+3 && F.s-H.s<12 && Math.abs(F.t-H.t)<2.5);
      const observedPace=(wake?.v??ahead?.v??H.v)+speedError;
      const sustainable=H.sustainableV(H.s,!!wake);
      // 完整滚动预算只保留很小的判断误差余量；耐心不直接扣减巡航速度。
      const allocation=clamp(0.96+0.025*plan.risk,0.96,0.985);
      const planned=budgetSpeed(H,reserveEstimate*allocation,wake?Math.min(44,remaining):0);
      const maxDemand=reserveToFinish(H,H.maxV);
      const sr=H.stamina/Math.max(1,H.staminaMax);
      const obstruction=localFront && localFront.s-H.s<4+Math.max(0,H.maxV-localFront.v)*3 && localFront.v<H.maxV-0.35;
      // 用本次预算速度评估通道，不能沿用上一观察的慢速指令把超越机会误判为无收益。
      H.targetV=planned;
      const gap=obstruction||H.blocked?findGap(H,true):null;
      const hasPass=gap && Math.abs(gap.t-H.t)>0.25 && gap.pace>(localFront?.v??H.v)+0.12;
      const keepAttack=!!H.attacking && maxDemand<=reserveEstimate*judgement*1.12;
      let attacking=H.s>30 && sr>0.015 && (keepAttack||maxDemand<=reserveEstimate*judgement*(0.92+0.08*plan.risk));
      if(obstruction && !hasPass) attacking=false;
      let desired,mode,reason;
      if(attacking) {
        desired=H.maxV;mode='attack';reason='预计余力可支付余程，存在推进机会';
      } else {
        desired=planned;mode=sr<0.12||H.attacking?'recover':'settle';
        reason=H.attacking?'撤回发动，重新分配余力':'按自身能力与余程分配出力';
        // 跟跑节省的能量必须足以偿付之后追回丢失距离的出力；便宜遮挡不能成为慢跑陷阱。
        if(wake && observedPace>3 && observedPace<=planned+0.3 && plan.patience>0.25) {
          const horizon=Math.min(8,remaining/Math.max(3,planned)*0.20);
          const following=Math.min(planned,observedPace+0.06);
          const lostDistance=Math.max(0,planned-following)*horizon;
          const catchWindow=Math.min(8,Math.max(0,remaining/Math.max(3,planned)-horizon));
          const catchV=planned+lostDistance/Math.max(0.1,catchWindow);
          const saving=Math.max(0,H.powerFor(planned,0,false)-H.powerFor(following,0,true))*horizon;
          const regainCost=Math.max(0,H.powerFor(catchV,0,false)-H.powerFor(planned,0,false))*catchWindow+
            H.kineticCost(following,catchV);
          const benefit=saving-regainCost;
          const canRegain=catchWindow>0.5&&catchV<=projectedCap(H,H.s+remaining*0.65);
          H.followOpportunity={saving,regainCost,lostDistance,benefit};
          if(canRegain&&benefit>Math.max(0.1,(1-plan.patience)*0.5)&&plan.position<0.85) {
            desired=following;mode='follow';reason='遮挡收益足以偿付之后追回距离的出力';
          }
        }
        // 前位指令只为可支付的实际超越机会短时出力，不对领先者施加保护或远距追赶。
        if(ahead&&ahead.s-H.s<12&&plan.position>0.55&&sr>0.06&&mode!=='follow') {
          const horizon=Math.min(8,remaining/Math.max(3,planned));
          const clearance=(horseLen(H)+horseLen(ahead))/2+0.5;
          const requested=Math.min(H.maxV,Math.max(planned,ahead.v+speedError+(ahead.s-H.s+clearance)/Math.max(1,horizon)));
          const extra=Math.max(0,H.powerFor(requested,0,false)-H.powerFor(planned,0,false))*horizon+
            Math.max(0,H.kineticCost(H.v,requested)-H.kineticCost(H.v,planned));
          const available=Math.max(0,reserveEstimate-reserveToFinish(H,planned))*(0.35+plan.risk*0.65);
          if(extra<=available&&requested>planned+0.05) {
            desired=requested;mode='position';reason='支付短时超越成本后仍可完成余程预算';
          }
        }
        if(sr<0.04) desired=Math.min(desired,sustainable);
      }
      if(attacking&&!H.attacking) {
        H.statsSummary.launches=(H.statsSummary.launches||0)+1;
        if(H.sprintAt===null) {H.sprintAt=H.s;H.statsSummary.sprintAt=H.s;}
        event(H.name+' 开始发力！');
      } else if(!attacking&&H.attacking) {
        H.statsSummary.withdrawals=(H.statsSummary.withdrawals||0)+1;
        event(H.name+' 收力重新调整节奏');
      }
      H.attacking=attacking;H.targetV=Math.max(3,Math.min(H.maxV,desired));
      setAction(H,attacking?(sr>0.15?'打鞭':'推骑'):H.targetV>H.v+0.15?'推骑':'收力');
      if(H.blocked || (localFront && localFront.s-H.s<4+Math.max(0,H.targetV-localFront.v)*3 && H.targetV>localFront.v+0.3)) {
        if(!avoidBlock(H,gap||findGap(H,true))) {mode='follow';reason='通道未开放，收力等待机会';}
        recordDecision(H,list,mode,reason,reserveEstimate,observedPace);return;
      }
      recordDecision(H,list,mode,reason,reserveEstimate,observedPace);
      if(H.laneIntentT>0 && Math.abs(H.targetT-H.t)>0.1) return;
      H.laneIntentT=0;
      const pass=H.passTarget,gainV=pass?H.targetV*laneProgressCoef(H.s,H.t,geo)-pass.v*laneProgressCoef(pass.s,pass.t,geo):0;
      if(pass && !pass.place && !pass.dnf && pass.s-H.s<=14 && gainV>0.05 && H.s-pass.s<(horseLen(H)+horseLen(pass))/2+1) return;
      H.passTarget=null;
      let goal=H.t;
      if(wake&&!attacking&&H.targetV<=wake.v+0.25) goal=wake.t;
      else if(kAt(H.s,geo)>0 || !localFront) goal=Math.max(1.4,H.t-2);
      // 选短路/遮挡同样需要开放路径，不能给入内指令跨越并排马匹。
      const side=near.some(F=>Math.abs(F.s-H.s)<(horseLen(H)+horseLen(F))/2+0.4 &&
        Math.min(H.t,goal)-(horseWid(H)+horseWid(F))/2<F.t && F.t<Math.max(H.t,goal)+(horseWid(H)+horseWid(F))/2);
      if(!side&&Math.abs(goal-H.t)>0.2) {
        setLaneTarget(H,goal);setAction(H,goal<H.t?'斜行in':'斜行out');
      }
    }
    function headwindAt(at) {
      // 固定风向投影到路线切线；终直道迎风时，对向直道为顺风。
      const q=mod(at+geo.startOffset,geo.lap),{S,B,referenceR}=geo;
      return wind*(q<S?1:q<S+B?-Math.sin(-Math.PI/2+(q-S)/referenceR):
        q<2*S+B?-1:-Math.sin(Math.PI/2+(q-2*S-B)/referenceR));
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
      const curvature=kAt(at,geo), radius=curvature>0?geo.R+transverse-TRACK_WIDTH/2:Infinity;
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
    function tick(dt) {
      const act=active();if(!act.length){race.finished=true;return;}
      const old=new Map(act.map(H=>[H,{s:H.s,t:H.t,v:H.v,stamina:H.stamina,guts:H.guts}]));
      for(const H of act) {
        H.lastObserve-=dt;H.actionT=Math.max(0,H.actionT-dt);H.laneIntentT=Math.max(0,H.laneIntentT-dt);
        if(!H.control && H.lastObserve<=0) {runAI(H);H.lastObserve=(JOCKEY_CADENCE[H.jockey]||2)*(0.95+rng()*0.10);}
        if(H.control) {if(Number.isFinite(H.control.targetV)) H.targetV=Math.max(0,H.control.targetV);if(Number.isFinite(H.control.targetT)) H.targetT=H.control.targetT;}
      }
      const motion=new Map();
      for(const H of act) {
        const before=old.get(H);H.blocked=false;H.blocker=null;H.collisionIntensity=0;H.squeezePass=0;
        const wake=act.find(F=>F!==H && old.get(F).s>before.s && old.get(F).s-before.s<=RACE_F.draftRange &&
          Math.abs(old.get(F).t-before.t)<=(horseWid(H)+horseWid(F))/2+0.8);
        H.drafting=!!wake;
        const fatigue=1-RACE_F.fatigueLoss*(1-H.guts/H.gutsMax);
        const aerobicTarget=H.aerobic*fatigue;
        H.aerobicOutput+=(aerobicTarget-H.aerobicOutput)*(1-Math.exp(-dt/RACE_F.aerobicTau));
        const aerobic=H.aerobicOutput;
        const stRatio=clamp(H.stamina/H.staminaMax,0,1);
        const reserveFade=clamp(stRatio/RACE_F.reserveFade,0,1);
        // 可用无氧功率同时受剩余容量与本步能量约束，不能先透支再截成零。
        const reservePower=Math.min(RACE_F.reservePower*reserveFade,H.stamina/dt);
        const maxPower=aerobic+reservePower;
        let cap=Math.min(H.maxV*fatigue,speedAtPower(H,maxPower,!!wake));
        const curvature=kAt(H.s,geo);
        if(curvature>0) {
          const radius=geo.R+H.t-TRACK_WIDTH/2;
          cap=Math.min(cap,Math.sqrt(Math.max(1,(RACE_F.curveLateral+(H.adj['力量']-70)*0.008)*radius))*bendCoefFor(H.h.special,dir));
        }
        const grad=gradientAt(H.s,geo,g); H.grad=grad;H.slopeCoef=1;
        let desired=Math.min(H.targetV,cap);
        const front=act.filter(F=>F!==H && old.get(F).s>before.s && Math.abs(old.get(F).t-before.t)<(horseWid(H)+horseWid(F))/2+0.2)
          .sort((a,b)=>old.get(a).s-old.get(b).s)[0];
        if(front) {
          const gap=old.get(front).s-before.s-(horseLen(H)+horseLen(front))/2-0.25;
          const safe=Math.max(0,old.get(front).v+gap*0.65);
          if(safe<desired-0.1){H.blocked=true;H.blocker=front;}
          desired=Math.min(desired,safe);
        }
        const startFraction=clamp((race.t+dt-H.startDelay)/dt,0,1);
        if(!startFraction) desired=0;
        const accelerationMix=clamp(H.v/H.base,0,1);
        const maxA=(RACE_F.maxAccel*(0.7+H.adj['出闸能力']/230)*(1-accelerationMix)+
          RACE_F.runningAccel*(0.65+H.adj['爆发力']/200)*accelerationMix)*
          (0.65+0.35*reserveFade);
        const response=RACE_F.responseTime*clamp(1+(0.65-H.behavior.tractability)*0.4,0.82,1.26);
        const kineticBudget=Math.max(0,maxPower-powerCost(H,H.v,0,!!wake))/(H.massRatio*Math.max(H.v,1));
        let a=clamp((desired-H.v)/response,-RACE_F.braking,Math.min(maxA,kineticBudget));
        let nextV=Math.max(0,H.v+a*dt*startFraction);
        // 合法横移：同一纵向身体区间内，横移路径不得穿过其他马匹。
        const margin=horseWid(H)/2+0.2, target=clamp(H.targetT,margin,TRACK_WIDTH-margin);
        function propose(v) {
          const lateralLimit=Math.min(RACE_F.lateralSpeed,(H.v+v)/2*0.06)*dt*startFraction;
          let t=clamp(H.t+clamp(target-H.t,-lateralLimit,lateralLimit),margin,TRACK_WIDTH-margin);
          for(const F of act) {
            if(F===H||Math.abs(old.get(F).s-before.s)>(horseLen(H)+horseLen(F))/2+0.3) continue;
            const clearance=(horseWid(H)+horseWid(F))/2+0.1;
            if(Math.abs(t-old.get(F).t)<clearance && Math.abs(t-old.get(F).t)<Math.abs(before.t-old.get(F).t)) t=before.t;
          }
          const lateral=(t-before.t)/dt,travelV=(H.v+v)/2;
          const forwardV=Math.sqrt(Math.max(0,travelV*travelV-lateral*lateral));
          return {s:H.s+forwardV*laneProgressCoef(H.s,(H.t+t)/2,geo)*dt*startFraction,
            t,v,a:(v-H.v)/dt,travelV,lateral,aerobic};
        }
        // 限制与记账使用相同的实际路径、高差及积分中点。
        let move=propose(nextV);
        for(let n=0;n<4;n++) {
          const paid=motionPower(H,before,move,!!wake,dt);
          if(paid<=maxPower+1e-7) break;
          nextV=Math.max(0,nextV-(paid-maxPower)*dt/(H.massRatio*Math.max(1,(H.v+nextV)/2)));
          move=propose(nextV);
        }
        if(motionPower(H,before,move,!!wake,dt)>maxPower+1e-7) {
          let low=0,high=nextV;
          for(let n=0;n<28;n++) {
            const mid=(low+high)/2;
            if(motionPower(H,before,propose(mid),!!wake,dt)<=maxPower) low=mid;else high=mid;
          }
          move=propose(low);
        }
        motion.set(H,move);H.pot=desired;
      }
      // 按前方先结算，真实身体间距限制推进；不存在强行突破的穿模豁免。
      for(const H of act.slice().sort((a,b)=>old.get(b).s-old.get(a).s || a.gate-b.gate)) {
        const move=motion.get(H), before=old.get(H);
        for(const F of act) {
          if(F===H||old.get(F).s<=before.s) continue;
          const fm=motion.get(F), clearance=(horseLen(H)+horseLen(F))/2+0.2;
          if(Math.abs(move.t-fm.t)<(horseWid(H)+horseWid(F))/2+0.1 && move.s>fm.s-clearance) {
            move.s=Math.max(before.s,Math.min(move.s,fm.s-clearance));H.blocked=true;
            if(!H.blocker||old.get(F).s<old.get(H.blocker).s) H.blocker=F;
            move.v=Math.min(move.v,Math.max(0,(move.s-before.s)/dt/laneProgressCoef(H.s,H.t,geo)));
          }
        }
        H.s=move.s;H.t=move.t;H.prevV=before.v;H.v=move.v;H.accel=(H.v-before.v)/dt;
        const work=motionPower(H,before,move,H.drafting,dt);
        H.power=work;H.effort=H.targetV/Math.max(1,H.cruise);
        const excess=Math.max(0,work-move.aerobic), draw=Math.min(H.stamina,excess*dt);
        // 只有明显低于供能的做功才允许有限恢复；制动不回充动能。
        const restore=Math.min(H.staminaMax-H.stamina,Math.max(0,move.aerobic*0.90-work)*RACE_F.recoveryRate*dt,RACE_F.recoveryMax*dt);
        H.stamina=clamp(H.stamina-draw+restore,0,H.staminaMax);
        H.guts=Math.max(0,H.guts-(RACE_F.fatigueWork*work+RACE_F.fatigueExcess*excess)*dt);
        H.retention=1-RACE_F.fatigueLoss*(1-H.guts/H.gutsMax);
        H.stage=H.stamina>H.staminaMax*0.12?'耐力':H.stamina>H.staminaMax*0.015?'毅力':'失速';
        const stats=H.statsSummary,aerobicUsed=Math.min(work,move.aerobic)*dt;
        H.cumulativeWork+=work*dt;stats.workUsed=H.cumulativeWork;stats.aerobicUsed+=aerobicUsed;
        stats.energyUsed+=draw;stats.unpaidWork+=Math.max(0,work*dt-aerobicUsed-draw);
        stats.recovered+=restore;stats.draftSeconds+=H.drafting?dt:0;stats.blockedSeconds+=H.blocked?dt:0;stats.peakSpeed=Math.max(stats.peakSpeed,H.v);
      }
      const crossings=[];const sectionalCrossings=[];
      for(const H of act) {
        const before=old.get(H), delta=H.s-before.s;
        const crossingTime=at=>race.t+(delta>0?clamp((at-before.s)/delta,0,1)*dt:dt);
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
            const before=old.get(F);F.gapAtWin=F===H?0:before?Math.max(0,length-(before.s+(motion.get(F).s-before.s)*fraction)):0;
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
    function step(dt) {
      if(!Number.isFinite(dt)||dt<=0) throw new Error('比赛步长必须是正数');
      const count=Math.ceil(dt/(1/60)), sub=dt/count;
      for(let i=0;i<count&&!race.finished;i++) tick(sub);
    }
    function snapshot() {
      const list=ranked();return {t:race.t,finished:race.finished,length,dir,profile,g,course:geo.course,
        paceLevel:race.paceLevel,paceStrength:race.paceStrength,pacePrediction:race.pacePrediction,
        leader:list[0]?.id||null,leaderProgress:list[0]?list[0].s/length:1,events:race.events.slice(-10),order:race.order.map(H=>H.id),
        horses:horses.map(H=>({id:H.id,name:H.name,s:H.s,t:H.t,v:H.v,pot:H.pot,accel:H.accel,power:H.power,
          rank:H.place|| (H.dnf?null:list.indexOf(H)+1),stage:H.stage,stamina:H.stamina,guts:H.guts,
          staminaMax:H.staminaMax,gutsMax:H.gutsMax,retention:H.retention,action:H.action,dnf:H.dnf,
          place:H.place,time:H.time,blocked:H.blocked,style:H.observedStyle||H.style,observedStyle:H.observedStyle,
          strategy:H.strategy,aerobicOutput:H.aerobicOutput,gapAtWin:H.gapAtWin,final3f:H.final3f,sprintAt:H.sprintAt}))};
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
  function makeCareerRaceField(h, tierDef, rng) {
    const horses = [];
    const used = new Set();
    for (let i = 0; i < 7; i++) {
      /* 场次档次取区间中点，同场马之间只差 ±FIELD_LEVEL_SPAN */
      const base = (tierDef.level[0] + tierDef.level[1]) / 2;
      const level = base + (rng() * 2 - 1) * FIELD_LEVEL_SPAN;
      const rh = makeHorse(rng, { level, id: 'r' + (i + 1) });
      rh.name = makeName(rng, used);
      rh.sire = makeName(rng, used);
      rh.dam = makeName(rng, used);
      rh.age = h.age;
      rh.player = false;
      horses.push(rh);
    }
    const playerEntry = {
      id: h.id, name: h.name, style: h.style, age: h.age, sex: h.sex, coat: h.coat,
      surface: h.surface, special: h.special,
      behavior:h.behavior?{...h.behavior}:undefined, racePlan:h.racePlan?{...h.racePlan}:undefined,
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
      const field = makeCareerRaceField(h, t, rng);
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
    const field = makeField(rng, { n: 8, level: t.level[0] + rng() * (t.level[1] - t.level[0]) });
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
    return {
      id: rh.id, name: rh.name, sex: rh.sex,
      starts: rh.starts, wins: rh.wins, g1: rh.g1 || 0,
      bestTier: rh.bestTier || '未胜利', retired: true,
      sireName: rh.sireName, damName: rh.damName,
      sireRec: rh.sireRec, damRec: rh.damRec,
      stats: JSON.parse(JSON.stringify(rh.stats)),
      surface: rh.surface, special: rh.special,
      behavior:rh.behavior?{...rh.behavior}:undefined, racePlan:rh.racePlan?{...rh.racePlan}:undefined,
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
    return {
      id: rh.id, name: rh.name, style: rh.style, age: rh.age, sex: rh.sex, coat: rh.coat,
      surface: rh.surface, special: rh.special,
      behavior:rh.behavior?{...rh.behavior}:undefined, racePlan:rh.racePlan?{...rh.racePlan}:undefined,
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
      h.wins >= (o.winsMin || 0) && h.wins <= (o.winsMax || 99) &&
      h.starts <= (o.startsMax !== undefined ? o.startsMax : 99) &&
      h.ability >= (o.abilityMin || 0) && h.ability <= (o.abilityMax || 100) &&
      weekNum - h.lastRaceWeek >= cooldown);
    const n = Math.min(o.n || 8, pool.length);
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
      startsMax: spec.startsMax, abilityMin: spec.abilityMin, n: 8, cooldown: spec.cooldown,
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
    const chosen = pickRosterField(roster, rng, weekNum, { ageMin: spec.ageMin, ageMax: spec.ageMax, winsMax: spec.winsMax, abilityMin, n: 8 });
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
  function raceOptionsForRoster(h, rng, roster, weekNum) {
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
      const rivals = pickRosterField(roster, rng, weekNum, { ageMin: band[2], ageMax: band[3], abilityMin: band[0], abilityMax: band[1], n: 7 });
      const field = rivals.map((rh) => rosterEntry(rh, rng));
      const playerEntry = {
        id: h.id, name: h.name, style: h.style, age: h.age, sex: h.sex, coat: h.coat,
        surface: h.surface, special: h.special,
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
    return {
      stats, bloodline: Math.round(bloodline),
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
    COURSES, trackGeometry, trackPoint, kAt, laneProgressCoef, bendCoefFor, SLOPE_PROFILES, gradientAt, elevationAt,
    TIER_LABELS, tierIdx, tierText, COMMENT_TABLES,
    STAFF, CAT_ERROR_POOL, catText, fatigueBand, fatigueText,
    makeHorse, makeField, horseBehavior, racePlanFor, makeStaff, generateReport, oddsAndPopularity,
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
