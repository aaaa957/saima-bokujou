/* ============================================================
 * 赛马风云 Demo · 比赛模拟引擎 v0.1
 * 公式来源：《系统数值设计文档》3.10 比赛系统设计
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
  const TRACK_WIDTH = 20; // 演示用赛道宽度(米)
  const STALL_SPEED = 2;
  const PHASE_DEFS = [
    { key: 'break', name: '出闸', from: 0.00, to: 0.05 },
    { key: 'open',  name: '序盘', from: 0.05, to: 0.20 },
    { key: 'mid',   name: '中盘', from: 0.20, to: 0.60 },
    { key: 'late',  name: '后盘', from: 0.60, to: 0.80 },
    { key: 'final', name: '终盘', from: 0.80, to: 1.00 },
  ];
  function phaseAt(s, length) {
    const f = length > 0 ? s / length : 0;
    for (const p of PHASE_DEFS) if (f < p.to) return p;
    return PHASE_DEFS[PHASE_DEFS.length - 1];
  }

  /* 跑法系数：出闸/序盘、中盘、后盘、终盘 */
  const STYLE_COEF = {
    '逃': { break: 1.08, open: 1.08, mid: 1.03, late: 1.02, final: 0.97 },
    '先': { break: 1.03, open: 1.03, mid: 1.00, late: 1.02, final: 1.04 },
    '差': { break: 0.96, open: 0.96, mid: 0.97, late: 1.03, final: 1.06 },
    '追': { break: 0.88, open: 0.88, mid: 0.95, late: 1.02, final: 1.10 },
  };
  /* 骑手等级修正：跑法系数加成 & 观察间隔(秒) */
  /* 平衡修正系数：压缩序盘/中盘差距，让四种跑法都能赢（默认）；
     文档原版系数下追马按公式推演永远追不上逃马，详见 README */
  const STYLE_COEF_BALANCED = {
    '逃': { break: 1.06, open: 1.06, mid: 1.02, late: 1.01, final: 1.05 },
    '先': { break: 1.03, open: 1.03, mid: 1.00, late: 1.02, final: 1.06 },
    '差': { break: 0.98, open: 0.98, mid: 0.99, late: 1.03, final: 1.07 },
    '追': { break: 0.93, open: 0.93, mid: 0.97, late: 1.03, final: 1.08 },
  };
  const JOCKEY_BONUS = { '新人': 0, '普通': 0, '优秀': 0.02, '殿堂': 0.04 };
  const JOCKEY_CADENCE = { '新人': 4, '普通': 2, '优秀': 1.5, '殿堂': 1 };
  /* 场地修正 */
  const FIELD_STATE_COEF = { '良': 1, '稍重': 0.98, '重': 0.95, '不良': 0.9 };
  const SURFACE_COEF = {
    '草地': { '草地': 1, '泥地': 0.92, '泥草双刀': 0.97 },
    '泥地': { '草地': 0.92, '泥地': 1, '泥草双刀': 0.97 },
  };
  /* 疲劳对比赛发挥的影响（3.6 疲劳影响表） */
  function fatigueMultiplier(f) {
    if (f <= 25) return 1; if (f <= 50) return 0.98; if (f <= 70) return 0.92;
    if (f <= 85) return 0.8; if (f <= 100) return 0.6; return 0.3;
  }

  /* ---------------- 赛道几何（椭圆：两条直道 + 两个弯道） ----------------
   * 出发门在终直左端，跑"终直 + 右弯 + 对直 + 左弯 + 终直"，全程 = 3S + 2πR */
  function trackGeometry(length) {
    const R = 70 + length / 40;          // 弯道半径(米)，随距离放大
    const B = Math.PI * R;               // 单个弯道弧长
    const S = (length - 2 * B) / 3;      // 单条直道长度
    return { length, R, B, S };
  }
  /* s→(x,y)：赛道坐标，y轴向上；dir='右回' 时水平镜像 */
  function trackPoint(s, t, geo, dir) {
    const { R, B, S } = geo;
    const d = t - 10;                    // 相对中线偏移：负=内侧
    let x, y;
    if (s < S) { x = -S / 2 + s; y = -R - d; }                                   // 终直(序盘)
    else if (s < S + B) { const a = -Math.PI / 2 + (s - S) / R; x = S / 2 + (R + d) * Math.cos(a); y = (R + d) * Math.sin(a); }   // 右弯
    else if (s < 2 * S + B) { x = S / 2 - (s - (S + B)); y = R + d; }             // 对直
    else if (s < 2 * S + 2 * B) { const a = Math.PI / 2 + (s - (2 * S + B)) / R; x = -S / 2 + (R + d) * Math.cos(a); y = (R + d) * Math.sin(a); } // 左弯
    else { x = -S / 2 + (s - (2 * S + 2 * B)); y = -R - d; }                      // 终直(冲刺)
    if (dir === '右回') x = -x;
    return { x, y };
  }
  /* 弯道曲率：直道 k=0，弯道 k=1/R */
  function kAt(s, geo) {
    const { R, B, S } = geo;
    if ((s >= S && s < S + B) || (s >= 2 * S + B && s < 2 * S + 2 * B)) return 1 / R;
    return 0;
  }
  /* 弯道系数（文档 3.10(11)）：适性匹配=1，不匹配=0.9 */
  function bendCoefFor(special, dir) {
    if (special === '左右皆可') return 1;
    if (special === '左右皆不可') return 0.9;
    return special === dir ? 1 : 0.9;
  }

  /* ---------------- 坡度系统（新增，文档 3.13 待补） ----------------
   * 坡度 g = 高差/水平距离。赛道分段（40m 平滑过渡）：
   * 序盘直线 0 → 右弯 0 → 对直 +g → 左弯 +0.6g → 终直 -0.4g（下坡冲线） */
  const SLOPE_PROFILES = { '平坦': { g: 0 }, '缓坂': { g: 0.015 }, '中坂': { g: 0.03 }, '急坂': { g: 0.05 } };
  function gradientAt(s, geo, g) {
    if (!g) return 0;
    const { B, S } = geo;
    const segs = [
      { from: 0, to: S, v: 0 },
      { from: S, to: S + B, v: 0 },
      { from: S + B, to: 2 * S + B, v: g },
      { from: 2 * S + B, to: 2 * S + 2 * B, v: 0.6 * g },
      { from: 2 * S + 2 * B, to: 3 * S + 2 * B, v: -0.4 * g },
    ];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (s >= seg.from && s <= seg.to) {
        const ramp = Math.min(40, (seg.to - seg.from) / 4);
        let v = seg.v;
        if (s > seg.to - ramp) {
          const next = segs[(i + 1) % segs.length];
          const k = (s - (seg.to - ramp)) / ramp;
          v = v * (1 - k) + next.v * k;
        }
        return v;
      }
    }
    return 0;
  }

  /* 骑手动作（3.10 骑手行为系统） */
  const ACTION_DEF = {
    '推骑':    { coef: 0.02,  stamina: 1.5 },
    '打鞭':    { coef: 0.05,  stamina: 2 },
    '收力':    { coef: -0.03, stamina: 0.7 },
    '减速':    { coef: -0.05, stamina: 0.5 },
    '斜行in':  { coef: 0,     stamina: 1.2 },
    '斜行out': { coef: 0,     stamina: 1.2 },
  };
  function actionBonus(a) { return ACTION_DEF[a] || { coef: 0, stamina: 1 }; }

  /* 基础速度（3.10） */
  function baseSpeed(spd) {
    return 1.944 + 0.15552 * Math.min(spd, 50) + 0.1944 * Math.max(spd - 50, 0);
  }
  function horseLen(H) { return 2.25 + 0.55 * (H.adj['体格'] / 100); }
  function horseWid(H) { return 1.0 + 0.3 * (H.adj['体格'] / 100); }

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
  /* 各跑法的属性模板（生成演示用马） */
  const STYLE_STATS = {
    '逃': { '速度': [70, 92], '耐力': [68, 90], '出闸能力': [65, 92], '爆发力': [40, 70], '力量': [45, 75], '毅力': [45, 75], '智力': [40, 80], '体格': [45, 85] },
    '先': { '速度': [62, 88], '耐力': [55, 80], '出闸能力': [55, 85], '爆发力': [55, 80], '力量': [50, 80], '毅力': [55, 85], '智力': [50, 85], '体格': [45, 80] },
    '差': { '速度': [60, 88], '耐力': [50, 75], '出闸能力': [45, 75], '爆发力': [70, 92], '力量': [55, 85], '毅力': [55, 85], '智力': [50, 85], '体格': [50, 85] },
    '追': { '速度': [62, 90], '耐力': [40, 65], '出闸能力': [35, 65], '爆发力': [75, 95], '力量': [50, 80], '毅力': [65, 95], '智力': [50, 85], '体格': [45, 80] },
  };
  function makeHorse(rng, opts) {
    const o = opts || {};
    const style = o.style || pick(rng, ['逃', '先', '先', '差', '差', '追', '追', '先']);
    const boost = o.tier === 'strong' ? 5 : (o.tier === 'weak' ? -5 : 0);
    /* 双层生成：场次水平(level)决定整体档次，跑法模板决定形态；
       形态差异保留(逃高耐力、追低耐力高爆发)，个体差异压缩，保证同场竞争性 */
    const level = o.level !== undefined ? o.level : 70;
    const stats = {};
    for (const k of Object.keys(STYLE_STATS[style])) {
      const r = STYLE_STATS[style][k];
      const mid = (r[0] + r[1]) / 2;
      const roll = r[0] + rng() * (r[1] - r[0]);
      const shaped = mid + (roll - mid) * 0.4;
      stats[k] = clamp(Math.round(level + (shaped - 70) * 0.8 + boost), 20, 97);
    }
    stats['血统力'] = clamp(Math.round(30 + rng() * 60), 10, 99);
    const age = 2 + Math.floor(rng() * 4);
    const sex = rng() < 0.5 ? '牡' : '牝';
    const 出赛 = Math.max(1, (age - 1) * 4 + Math.floor(rng() * 5));
    const 胜利 = Math.max(0, Math.round(出赛 * (0.15 + rng() * 0.3)));
    const 前三 = Math.min(出赛, 胜利 + Math.round(rng() * 4));
    return {
      id: o.id || ('h' + Math.floor(rng() * 1e9)),
      name: o.name || '', sire: o.sire || '', dam: o.dam || '',
      style, age, sex,
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
    };
  }
  function makeField(rng, opts) {
    const o = opts || {};
    const n = o.n || 8;
    const used = new Set();
    const styles = ['逃', '先', '差', '追', '先', '差', '追', pick(rng, ['逃', '先', '差', '追'])];
    const strongIdx = o.strongIndex !== undefined ? o.strongIndex : Math.floor(rng() * n);
    const playerIdx = o.playerIndex !== undefined ? o.playerIndex : strongIdx;
    const level = o.level !== undefined ? o.level : 62 + Math.floor(rng() * 17); // 场次水平 62-78
    const horses = [];
    for (let i = 0; i < n; i++) {
      const h = makeHorse(rng, {
        style: styles[i % styles.length],
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

  /* 人气与赔率（演示用简化模型） */
  function oddsAndPopularity(horses, rng) {
    const scored = horses.map((h) => {
      const f = h.form;
      const formScore = f.出赛 ? (f.胜利 / f.出赛) * 40 : 0;
      const s = h.stats['速度'] * 0.4 + h.stats['耐力'] * 0.2 + h.stats['爆发力'] * 0.15
        + h.stats['出闸能力'] * 0.1 + formScore * 0.4 + (rng() - 0.5) * 12;
      return { h, s };
    }).sort((a, b) => b.s - a.s);
    const ODDS = [1.9, 2.8, 4.5, 7.0, 11.0, 17.0, 28.0, 45.0];
    const map = {};
    scored.forEach((e, rank) => {
      map[e.h.id] = { '人气': rank + 1, '赔率': ODDS[Math.min(rank, ODDS.length - 1)] };
    });
    return map;
  }

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

  /* ---------------- 比赛引擎（3.10） ---------------- */
  function createRace(field, opts) {
    const o = opts || {};
    const length = o.length || 2000;
    const surface = o.surface || '草地';
    const state = o.state || '良';
    const dir = o.dir === '右回' ? '右回' : '左回';
    const profile = SLOPE_PROFILES[o.profile] ? o.profile : '缓坂';
    const g = SLOPE_PROFILES[profile].g;
    const geo = trackGeometry(length);
    const rng = o.rng || mulberry32(1);
    const styleCoefs = o.styleCoefs === 'doc' ? STYLE_COEF : STYLE_COEF_BALANCED;
    /* 爆发修正系数：文档原版0.25下，爆发力90与60的马在终盘400m会差出约24马身，
       平衡档降为0.10，让着差回到真实赛马量级 */
    const burstFactor = o.styleCoefs === 'doc' ? 0.25 : 0.10;
    const race = {
      length, surface, state, dir, profile, g, geo, t: 0, finished: false,
      events: [], order: [], dnf: [], winnerTime: null,
      prevLead: null, phaseAnnounced: {}, posHistory: [], _lastPct: 0,
      lastEventAt: {},
    };
    /* 第一遍：斗志修正后的参赛属性（文档：±10%；平衡档：±5% 减半） */
    const morRate = o.styleCoefs === 'doc' ? 0.002 : 0.001;
    const pre = field.map((h) => {
      const mor = ((h['斗志'] !== undefined ? h['斗志'] : 70) - 50) * morRate;
      const adj = {};
      for (const k of ['速度', '爆发力', '出闸能力', '耐力', '力量', '毅力', '体格']) {
        adj[k] = clamp(Math.round(h.stats[k] * (1 + mor)), 1, 115);
      }
      return { h, mor, adj };
    });
    /* 平衡档：参赛属性向全场均值回归35%，压缩"属性差→全程线性累积"的杠杆
       （文档原版不压缩，保留原始设计供对比） */
    if (o.styleCoefs !== 'doc') {
      const means = {};
      for (const k of ['速度', '爆发力', '出闸能力', '耐力', '力量', '毅力', '体格']) {
        means[k] = pre.reduce((sum, p) => sum + p.adj[k], 0) / pre.length;
      }
      for (const p of pre) {
        for (const k of ['速度', '爆发力', '出闸能力', '耐力', '力量', '毅力', '体格']) {
          p.adj[k] = clamp(Math.round(means[k] + (p.adj[k] - means[k]) * 0.55), 1, 115);
        }
      }
    }
    const horses = pre.map(({ h, mor, adj }) => {
      const surfC = (SURFACE_COEF[surface] || {})[h.surface];
      const fieldCoef = (FIELD_STATE_COEF[state] || 1) * (surfC !== undefined ? surfC : 1);
      return {
        h, id: h.id, name: h.name, style: h.style,
        jockey: h.jockeyGrade || '普通',
        s: 0, t: clamp(1.5 + rng() * 6, 1, 8), v: 0, prevV: 0, pot: 0, laneJitter: (rng() - 0.5) * 1.6,
        stamina: adj['耐力'] * 60, guts: adj['毅力'] * 60,
        stage: '耐力', lockedPot: null,
        collisionCoef: 1, collisionIntensity: 0,
        action: null, actionT: 0, _lastFinalAct: '推骑',
        lastObserve: -(rng() * 2),
        blocked: false, squeezePass: 0, stallTimer: 0,
        place: null, time: null, gapAtWin: null, dnf: false,
        base: baseSpeed(adj['速度']), fieldCoef, fatMult: fatigueMultiplier(h['疲劳'] || 0),
        adj, mor, breakNoise: 0.93 + rng() * 0.14,
        targetT: 2.5, aggression: h.aggression !== undefined ? h.aggression : 1,
      };
    });
    race.horses = horses;

    const event = (text, force) => {
      const now = race.t;
      if (!force && race.lastEventAt[text] !== undefined && now - race.lastEventAt[text] < 4) return;
      race.lastEventAt[text] = now;
      if (race.events.length > 80) race.events.shift();
      race.events.push({ t: now, text });
    };
    const eventOnce = (key, text) => {
      if (!race.phaseAnnounced[key]) { race.phaseAnnounced[key] = true; event(text, true); }
    };

    function active() { return race.horses.filter((H) => !H.place && !H.dnf); }
    function ranked() { return active().slice().sort((a, b) => b.s - a.s); }
    function setAction(H, type, dur) {
      if (type === '收力' && H.jockey === '新人') { H.action = null; H.actionT = 0; return; }
      if (type === '斜行out' && H.jockey === '新人') { H.action = '推骑'; H.actionT = 1; return; }
      H.action = type; H.actionT = dur;
    }
    function findGap(H, preferInner) {
      const ahead = race.horses.filter((F) => F !== H && !F.place && !F.dnf && F.s > H.s + 3 && F.s < H.s + 26);
      const blockedRanges = ahead.map((F) => [F.t - horseWid(F) / 2 - 0.2, F.t + horseWid(F) / 2 + 0.2]);
      let best = null; let bestScore = -Infinity;
      for (let t = 1.0; t <= TRACK_WIDTH - 1.0; t += 0.35) {
        if (blockedRanges.some((r) => t > r[0] && t < r[1])) continue;
        const distToMe = Math.abs(t - H.t);
        const innerBias = preferInner ? (TRACK_WIDTH - t) * 0.8 : 0;
        const score = innerBias - distToMe * 1.2;
        if (score > bestScore) { bestScore = score; best = t; }
      }
      return best === null ? null : { t: best };
    }
    function trySqueeze(H, F) {
      const staminaRatio = H.stage === '耐力' ? H.stamina / Math.max(1, H.adj['耐力'] * 60) : 0;
      if (staminaRatio < 0.15 || H.adj['体格'] < 40) {
        setAction(H, H.jockey === '新人' ? '推骑' : '斜行out', 2);
        return;
      }
      const tend = (H.adj['力量'] / 100 * 0.4 + H.adj['体格'] / 100 * 0.4 + H.adj['毅力'] / 100 * 0.2) * H.aggression;
      if (tend < 0.65) {
        setAction(H, H.jockey === '新人' ? '推骑' : '斜行out', 2);
        return;
      }
      const 冲撞力 = (H.adj['体格'] * 0.6 + H.adj['力量'] * 0.4) * Math.max(H.v, 5) * 0.2;
      const 抵抗力 = F.adj['体格'] * 0.5 + F.adj['力量'] * 0.3 + F.adj['毅力'] * 0.2;
      const ratio = 冲撞力 / Math.max(0.01, 抵抗力);
      if (ratio > 1.2) {
        H.squeezePass = 2.5;
        H.targetT = clamp(F.t + (F.t > TRACK_WIDTH / 2 ? -2.6 : 2.6), 0.8, TRACK_WIDTH - 0.8);
        event(H.name + ' 强行突破！');
      } else if (ratio >= 0.8) {
        event(H.name + ' 强行突破失败！');
        if (rng() < 0.1) event('⚡ ' + H.name + ' 与 ' + F.name + ' 发生接触！');
      } else {
        event(H.name + ' 的强行突破被挡下');
      }
    }

    /* AI：按文档 3.10 (13) ai跑法逻辑 简化实现 */
    function runAI(H) {
      const list = ranked();
      const n = list.length;
      const rank = list.indexOf(H) + 1;
      const ph = phaseAt(H.s, race.length);
      const leader = list[0];
      const ahead = rank >= 2 ? list[rank - 2] : null;
      const gapAhead = ahead ? ahead.s - H.s : Infinity;
      const gapLead = leader.s - H.s;
      const staminaRatio = H.stage === '耐力' ? H.stamina / Math.max(1, H.adj['耐力'] * 60) : 0;
      if (H.stage === '失速') { setAction(H, null, 0); return; }
      const isFinal = ph.key === 'final';
      const isLate = ph.key === 'late';
      const early = ph.key === 'break' || ph.key === 'open' || ph.key === 'mid';
      /* 过弯贴内栏：现实骑手在弯道切内线省路程（文档 3.10(11) 外道惩罚），
         弯道期间所有跑法都向内栏靠拢，直道再按各自跑法展开 */
      const onBend = kAt(H.s, race.geo) > 0;
      if (onBend && !isFinal) H.targetT = 2.0 + H.laneJitter * 0.5;

      switch (H.style) {
        case '逃': {
          H.targetT = 1.8;
          if (isFinal) {
            if (H.stage === '耐力' && staminaRatio > 0.2) setAction(H, '打鞭', 1.5);
            else setAction(H, '推骑', 2);
            return;
          }
          const leadMargin = rank === 1 ? (list[1] ? H.s - list[1].s : 30) : -gapLead;
          if (ph.key === 'break' || ph.key === 'open') {
            if (H.t > 2.6) setAction(H, '斜行in', 1.5);
            else if (leadMargin < 2) setAction(H, '推骑', 2);
            else setAction(H, '收力', 2);
          } else {
            if (leadMargin < 1.2) setAction(H, '推骑', 2);
            else if (leadMargin > 3.2) setAction(H, '收力', 2);
            else setAction(H, '收力', 1.2);
          }
          return;
        }
        case '先': {
          H.targetT = 3.2 + H.laneJitter;
          if (isFinal) {
            const next = H._lastFinalAct === '打鞭' ? '推骑' : '打鞭';
            H._lastFinalAct = next;
            setAction(H, next, 1.5);
            return;
          }
          if (early) {
            if (H.blocked) setAction(H, H.t > 10 ? '斜行in' : '斜行out', 2);
            else if (rank > 6) { if (H.t > 2.8) setAction(H, '斜行in', 2); else setAction(H, '推骑', 2); }
            else if (rank < 2) setAction(H, '收力', 2);
            else if (gapLead > 10) setAction(H, '推骑', 2);   // 与逃马保持接触(演示补充)
            else setAction(H, '收力', 1.5);
          } else if (isLate) {
            if (H.blocked && ahead) trySqueeze(H, ahead);
            else {
              const g = findGap(H, false);
              if (g) {
                H.targetT = g.t;
                if (Math.abs(g.t - H.t) > 1) setAction(H, g.t < H.t ? '斜行in' : '斜行out', 2);
                else setAction(H, '推骑', 2);
              } else setAction(H, '推骑', 2);
            }
          }
          return;
        }
        case '差': {
          H.targetT = 5.2 + H.laneJitter;
          if (isFinal) {
            const next = H._lastFinalAct === '打鞭' ? '推骑' : '打鞭';
            H._lastFinalAct = next;
            setAction(H, next, 1.5);
            return;
          }
          if (early) {
            const lo = Math.max(5, n - 3);
            if (H.blocked) setAction(H, H.t > 10 ? '斜行in' : '斜行out', 2);
            else if (rank < lo) setAction(H, '收力', 2);
            else if (gapLead > 20) setAction(H, '推骑', 2);        // 与领头集团保持接触(演示补充)
            else if (rank > lo) setAction(H, '推骑', 2);
            else setAction(H, '收力', 1.5);
            if (H.t > 3.2) setAction(H, '斜行in', 1.5);
          } else if (isLate) {
            if (H.blocked && ahead) trySqueeze(H, ahead);
            else {
              const g = findGap(H, false);
              if (g) {
                H.targetT = g.t;
                if (Math.abs(g.t - H.t) > 1) setAction(H, g.t < H.t ? '斜行in' : '斜行out', 2);
                else setAction(H, '推骑', 2);
              } else setAction(H, '推骑', 2);
            }
          }
          return;
        }
        case '追': {
          H.targetT = 6.8 + H.laneJitter;
          if (isFinal) {
            const g = findGap(H, true);
            if (g) {
              H.targetT = g.t;
              if (Math.abs(g.t - H.t) > 1) setAction(H, g.t < H.t ? '斜行in' : '斜行out', 2);
              else setAction(H, '打鞭', 1.5);
            } else if (H.blocked && ahead) trySqueeze(H, ahead);
            else setAction(H, '打鞭', 1.5);
            return;
          }
          if (early) {
            if (H.blocked) setAction(H, H.t > 10 ? '斜行in' : '斜行out', 2);
            else if (rank < n - 3 && gapLead < 45) setAction(H, '收力', 2);
            else if (gapLead > 25) setAction(H, '推骑', 2);          // 与领头集团保持接触(演示补充)
            else if (gapAhead > 15) setAction(H, '推骑', 2);
            else if (gapAhead < 4.5) setAction(H, '收力', 1.5);
            else setAction(H, '收力', 1);
            if (H.t > 3.6) setAction(H, '斜行in', 1.5);
          } else if (isLate) {
            const g = findGap(H, true);
            if (g) {
              H.targetT = g.t;
              if (Math.abs(g.t - H.t) > 1) setAction(H, g.t < H.t ? '斜行in' : '斜行out', 2);
              else setAction(H, '推骑', 2);
            } else if (H.blocked && ahead) trySqueeze(H, ahead);
            else setAction(H, '推骑', 2);
          }
          return;
        }
      }
    }

    function step(dt) {
      if (race.finished) return;
      const act = active();
      const list = act.slice().sort((a, b) => b.s - a.s);
      /* 1) 瞬时速度 */
      for (const H of act) {
        const ph = phaseAt(H.s, race.length);
        let runCoef = styleCoefs[H.style][ph.key] + (JOCKEY_BONUS[H.jockey] || 0) + actionBonus(H.action).coef;
        /* 马群跟跑耦合（演示补充机制）：序盘/中盘/后盘时，与直接前方马距离越远，
           加成越大（上限+0.07），模拟真实赛马"跟随领放节奏"的马群动力学；
           出闸/终盘不生效，让差距留到终盘才真正拉开 */
        if (ph.key === 'open' || ph.key === 'mid' || ph.key === 'late') {
          const leaderH = list[0];
          if (leaderH && leaderH !== H) {
            const gapLead = leaderH.s - H.s;
            if (gapLead > 6) runCoef += Math.min(0.10, (gapLead - 6) * 0.008);
          }
        }
        let pot;
        if (ph.key === 'break') {
          pot = H.base * (runCoef * (0.8 + 0.4 * (H.adj['出闸能力'] / 100)) * H.breakNoise) * H.fieldCoef * H.fatMult;
        } else if (ph.key === 'final') {
          pot = H.base * (burstFactor * (H.adj['爆发力'] / 100) + runCoef) * H.fieldCoef * H.fatMult;
        } else {
          pot = H.base * runCoef * H.fieldCoef * H.fatMult;
        }
        if (H.stage === '毅力' && H.lockedPot !== null) pot = H.lockedPot;
        H.pot = pot;
        /* 坡度速度修正：上坡=1-g·(3.0-2.0·力量/100)，下坡=1+min(0.04,|g|·0.6) */
        const grad = gradientAt(H.s, race.geo, race.g);
        H.grad = grad;
        H.slopeCoef = grad > 0
          ? 1 - grad * (3.0 - 2.0 * (H.adj['力量'] / 100))
          : 1 + Math.min(0.04, -grad * 0.6);
        if (H.stage === '失速') H.v = Math.max(STALL_SPEED, H.v * Math.pow(0.95, dt));
        else H.v = pot * H.collisionCoef * H.slopeCoef;
      }
      /* 2) 推进 + 碰撞 */
      for (const H of act) { H.collisionCoef = 1; H.collisionIntensity = 0; H.blocked = false; }
      for (const H of list) {
        if (H.action === '斜行in') H.t = clamp(H.t - 0.8 * dt, 0.7, TRACK_WIDTH - 0.7);
        else if (H.action === '斜行out') H.t = clamp(H.t + 0.8 * dt, 0.7, TRACK_WIDTH - 0.7);
        else H.t += (H.targetT - H.t) * Math.min(1, dt * 1.4);
        const k = kAt(H.s, race.geo);
        const bCoef = bendCoefFor(H.h.special, race.dir);
        let newS = H.s + H.v * bCoef / (1 + k * H.t) * dt;
        for (const F of list) {
          if (F === H || F.s <= H.s) continue;
          const halfL = (horseLen(H) + horseLen(F)) / 2;
          const halfW = (horseWid(H) + horseWid(F)) / 2;
          if (F.s - H.s <= halfL * 1.05 && Math.abs(F.t - H.t) <= halfW * 0.65 && H.v > F.v + 0.3) {
            const 冲撞力 = (H.adj['体格'] * 0.6 + H.adj['力量'] * 0.4) * Math.max(H.prevV, 1) * 0.2;
            const 抵抗力 = F.adj['体格'] * 0.5 + F.adj['力量'] * 0.3 + F.adj['毅力'] * 0.2;
            const intensity = 冲撞力 / Math.max(0.01, 抵抗力);
            H.collisionIntensity = Math.max(H.collisionIntensity, intensity);
            F.collisionIntensity = Math.max(F.collisionIntensity, intensity * 0.5);
            H.collisionCoef = Math.min(H.collisionCoef, Math.max(0.5, 1 - intensity * 0.15));
            F.collisionCoef = Math.min(F.collisionCoef, Math.max(0.5, 1 - intensity * 0.075));
            if (H.squeezePass <= 0) { newS = Math.min(newS, F.s - halfL * 0.5); H.blocked = true; }
          }
        }
        H.s = Math.max(H.s, newS);
        H.prevV = H.v;
      }
      /* 3) 耐力/毅力消耗 */
      for (const H of act) {
        const st = actionBonus(H.action).stamina;
        /* 坡度体力修正：上坡耗力、下坡省力。以"平地等效速度"(v/坡度系数)为基准，
           使上坡的额外消耗不被减速抵消——力量的价值变为"更快爬完坡、在坡上停留更短" */
        const gradDrain = (1 + 2.5 * Math.max(0, H.grad || 0)) * (1 + 1.0 * Math.min(0, H.grad || 0));
        let drain = H.v / (H.slopeCoef || 1) * 1.5 * st * gradDrain + H.collisionIntensity;
        if (H.stage === '耐力') {
          H.stamina -= drain * dt;
          if (H.stamina <= 0) {
            H.stamina = 0; H.stage = '毅力';
            H.lockedPot = H.v / Math.max(0.01, H.collisionCoef);
            event(H.name + ' 体力见底，开始拼毅力！');
          }
        } else if (H.stage === '毅力') {
          H.guts -= drain * dt;
          if (H.guts <= 0) { H.guts = 0; H.stage = '失速'; event(H.name + ' 失速！！'); }
        }
      }
      /* 4) 动作计时与 AI */
      for (const H of act) {
        if (H.actionT > 0) { H.actionT -= dt; if (H.actionT <= 0) H.action = null; }
        H.squeezePass = Math.max(0, H.squeezePass - dt);
        H.lastObserve -= dt;
        if (H.lastObserve <= 0) {
          H.lastObserve = (JOCKEY_CADENCE[H.jockey] || 2) * (0.85 + rng() * 0.3);
          runAI(H);
        }
      }
      /* 5) 完赛 / 中止 / 事件 */
      race.t += dt;
      for (const H of list) {
        if (H.place || H.dnf) continue;
        if (H.s >= race.length) {
          H.s = race.length;
          H.place = race.order.length + 1;
          H.time = race.t;
          race.order.push(H);
          if (race.order.length === 1) {
            race.winnerTime = race.t;
            for (const F of race.horses) if (!F.place && !F.dnf) F.gapAtWin = race.length - F.s;
            event('🏆 ' + H.name + ' 率先冲线！', true);
          } else {
            const gap = H.gapAtWin !== null ? H.gapAtWin : 0;
            const 马身 = Math.max(0, gap) / 2.4;
            event('第' + H.place + '位 ' + H.name + '（' + 马身.toFixed(1) + '马身差）');
          }
        }
      }
      for (const H of act) {
        if (H.stage === '失速' && H.v <= STALL_SPEED + 0.35 && (race.length - H.s) > 150) {
          H.stallTimer += dt;
          if (H.stallTimer > 8) { H.dnf = true; race.dnf.push(H); event('❗ ' + H.name + ' 竞走中止', true); }
        } else H.stallTimer = 0;
      }
      const cur = ranked();
      const leader = cur[0];
      if (leader) {
        const lf = leader.s / race.length;
        for (const p of PHASE_DEFS) if (lf >= p.from && p.name !== '出闸') eventOnce('ph' + p.key, '进入' + p.name + '！');
        if (race.g > 0) {
          const { B, S } = race.geo;
          if (leader.s >= S + B) eventOnce('secHill', '进入对直上坡！');
          if (leader.s >= 2 * S + B) eventOnce('secHill2', '进入左弯上坡！');
          if (leader.s >= 2 * S + 2 * B) eventOnce('secDown', '进入终直下坡！');
        }
        if (!race.prevLead) { race.prevLead = leader; event(leader.name + ' 出闸领跑！', true); }
        else if (leader !== race.prevLead) {
          if (race.order.length === 0) event(leader.name + ' 冲到最前方！', true);
          race.prevLead = leader;
        }
        if (cur[1] && lf > 0.8 && (leader.s - cur[1].s) < 2.2) eventOnce('deadheat', leader.name + ' 与 ' + cur[1].name + ' 并驾齐驱！');
        const pctNow = Math.floor(lf * 100);
        if (pctNow > race._lastPct) {
          race._lastPct = pctNow;
          race.posHistory.push({ pct: pctNow, order: cur.map((H) => H.id) });
        }
      }
      const remaining = race.horses.filter((H) => !H.place && !H.dnf).length;
      if (remaining === 0 || race.t > 600) {
        race.finished = true;
        for (const H of race.horses) if (!H.place && !H.dnf) { H.dnf = true; race.dnf.push(H); }
      }
    }

    function snapshot() {
      const list = ranked();
      return {
        t: race.t, finished: race.finished, length: race.length,
        dir: race.dir, profile: race.profile, g: race.g,
        leader: list[0] ? list[0].id : null,
        leaderProgress: list[0] ? list[0].s / race.length : 0,
        events: race.events.slice(-10),
        order: race.order.map((H) => H.id),
        horses: race.horses.map((H) => ({
          id: H.id, name: H.name, s: H.s, t: H.t, v: H.v, pot: H.pot,
          rank: H.place ? H.place : (H.dnf ? null : list.indexOf(H) + 1),
          stage: H.stage, stamina: H.stamina, guts: H.guts,
          staminaMax: H.adj['耐力'] * 60, gutsMax: H.adj['毅力'] * 60,
          action: H.action, dnf: H.dnf, place: H.place, time: H.time,
          blocked: H.blocked, style: H.style, gapAtWin: H.gapAtWin,
        })),
      };
    }

    return {
      race, step, snapshot,
      state: () => snapshot(),
    };
  }

  /* ---------------- 生涯模式（周推进 + 赛事体系 + 马匹生命周期） ---------------- */
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
    const style = pick(rng, ['逃', '先', '差', '追']);
    const caps = {};
    for (const k of Object.keys(STYLE_STATS[style])) {
      const r = STYLE_STATS[style][k];
      caps[k] = clamp(Math.round((r[0] + r[1]) / 2 + (rng() - 0.5) * (r[1] - r[0]) * 0.5 + 20), 50, 97);
    }
    const stats = {};
    for (const k of Object.keys(caps)) stats[k] = Math.max(20, Math.round(caps[k] * 0.55));
    const used = new Set();
    const sv = 2600 + Math.round(rng() * 1800);
    return {
      id: 'ph',
      name: makeName(rng, used),
      style,
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
    };
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
    const styles = ['逃', '先', '差', '追', '先', '差', '追'];
    for (let i = 0; i < 7; i++) {
      const level = tierDef.level[0] + rng() * (tierDef.level[1] - tierDef.level[0]);
      const rh = makeHorse(rng, { style: styles[i], level, id: 'r' + (i + 1) });
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
      const odds = oddsAndPopularity(field, rng);
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
    const odds = oddsAndPopularity(field, rng);
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
      const style = pick(rng, ['逃', '先', '差', '追']);
      const level = 55 + (g1 ? 22 : 10) + rng() * 15;
      const stats = {};
      for (const k of Object.keys(STYLE_STATS[style])) {
        const rr = STYLE_STATS[style][k];
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
    const style = pick(rng, ['逃', '先', '差', '追']);
    const caps = {};
    for (const k of Object.keys(STYLE_STATS[style])) {
      const r = STYLE_STATS[style][k];
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
    return {
      id: 'rh' + idSeed,
      name: makeName(rng, used),
      style, sex: rng() < 0.5 ? '牡' : '牝',
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
    };
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
      rh.history.push({ week: weekNum, race: raceName || '—', tier: tier || '—', place: H.place, dist: dist || 0 });
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
    const dir = rng() < 0.5 ? '左回' : '右回';
    const profile = weightedPick(rng, [['平坦', 20], ['缓坂', 45], ['中坂', 25], ['急坂', 10]]);
    const venue = pick(rng, VENUES);
    const chosen = pickRosterField(roster, rng, weekNum, {
      ageMin: spec.ageMin, ageMax: spec.ageMax, winsMin: spec.winsMin, winsMax: spec.winsMax,
      startsMax: spec.startsMax, abilityMin: spec.abilityMin, n: 8, cooldown: spec.cooldown,
    });
    const field = chosen.map((rh) => rosterEntry(rh, rng));
    const odds = oddsAndPopularity(field, rng);
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
    const odds = oddsAndPopularity(field, rng);
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
        stats: JSON.parse(JSON.stringify(h.stats)),
        '斗志': h['斗志'], '疲劳': h['疲劳'],
        jockeyGrade: h.jockeyGrade, aggression: h.aggression,
        form: { '出赛': h.starts, '胜利': h.wins, '前三': Math.min(h.starts, h.wins + Math.floor(h.starts * 0.2)) },
        player: true, sire: h.sire, dam: h.dam,
      };
      field.splice(Math.floor(rng() * 8), 0, playerEntry);
      const odds = oddsAndPopularity(field, rng);
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
  /* 复式赔率模型：由各马单胜赔率推导（演示用近似模型） */
  function calcBetOdds(type, winOddsArr) {
    const w1 = winOddsArr[0] || 5, w2 = winOddsArr[1] || 5, w3 = winOddsArr[2] || 5;
    if (type === '単勝') return Math.max(1.1, w1);
    if (type === '複勝') return Math.max(1.05, 1 + (w1 - 1) * 0.35);
    if (type === '馬連') return Math.max(1.5, Math.round(w1 * w2 * 0.28 * 10) / 10);
    if (type === '馬単') return Math.max(2, Math.round(w1 * w2 * 0.5 * 10) / 10);
    if (type === '三連複') return Math.max(3, Math.round(w1 * w2 * w3 * 0.07 * 10) / 10);
    return Math.max(5, Math.round(w1 * w2 * w3 * 0.45 * 10) / 10);
  }
  function betTypeHit(type, ids, orderIds) {
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
    const style = pick(rng, ['逃', '先', '差', '追']);
    const caps = {};
    for (const k of Object.keys(foal.stats)) caps[k] = clamp(Math.round(foal.stats[k] * 1.2 + 4), 45, 100);
    const ability = foal.stats['速度'] * 0.4 + foal.stats['耐力'] * 0.2 + foal.stats['爆发力'] * 0.2 + foal.stats['毅力'] * 0.2;
    return {
      id: 'rh' + id,
      name: makeName(rng, new Set()),
      style, sex: rng() < 0.5 ? '牡' : '牝',
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
    };
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
    TRACK_WIDTH, STALL_SPEED, PHASE_DEFS, phaseAt,
    STYLE_COEF, STYLE_COEF_BALANCED, JOCKEY_BONUS, JOCKEY_CADENCE, FIELD_STATE_COEF, SURFACE_COEF,
    ACTION_DEF, actionBonus, baseSpeed, fatigueMultiplier,
    trackGeometry, trackPoint, kAt, bendCoefFor, SLOPE_PROFILES, gradientAt,
    TIER_LABELS, tierIdx, tierText, COMMENT_TABLES,
    STAFF, CAT_ERROR_POOL, catText, fatigueBand, fatigueText,
    makeHorse, makeField, makeStaff, generateReport, oddsAndPopularity,
    makeName, createRace,
    RACE_TIERS, TIER_BY_KEY, TIER_RANK, TRAINING_DEF, PRIZE_SHARE, prizeForPlace, makeRaceName,
    makeCareerHorse, careerWeeklyTick, makeCareerRaceField, raceOptionsFor, makeFeaturedRace,
    makeRosterHorse, makeRoster, rosterEntry, pickRosterField, applyRaceForm, ageRoster, rosterTick, makeWeeklyAiRace, raceOptionsForRoster,
    makeBaseBreedingStock, pickBreeder, breederFromHorse,
    BET_TYPES, BET_TYPE_LABEL, BET_NEED, calcBetOdds, betTypeHit,
    checkInbreeding, inbreedingPenalty, inheritQuantile, stateFromQuantile, weeklyDrainFromQuantile, bloodlineFromQuantile,
    INHERIT_DEF, inheritAttr, inheritSurface, inheritSpecial, breedFoal, foalToRosterHorse, FEE_TIERS, studFeeFor,
    VENUES, weekRaceSpecs, makeScheduledRace, makeWeekIntel,
  };
  root.SaimaSim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
