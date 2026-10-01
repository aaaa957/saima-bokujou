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
  /* 赛道宽度（米）。
     原来是 20。改为 11 的理由：现实跑道虽宽 20~30m，但同时并排只占约 8~10m；
     而弯道半径在 100~150m 量级。宽度/半径比应为 11/120 ≈ 9%，
     这样"外道多跑的距离"约 5%，接近现实内栏优势（1~2 马身 ≈ 3~5%）。
     取 20 时该比值达 17%，外道速度差约 15%——实测外道 4 匹马胜率合计 96.7%，
     正是当初不得不把车道与距离解耦的原因。收窄后可以恢复真实的几何差异。 */
  const TRACK_WIDTH = 11;
  const STALL_SPEED = 2;
  /* 阶段划分（3.10 重做，对齐现实赛马的分段）
     现实 2000m 一级赛的通行分段：
       出闸 0~100m(5%)  序盘 ~600m(30%)  中盘 ~1200m(30%)  后盘 ~1400m(10%)  末段 600m(30%)
     旧划分的中盘占 40%、终盘只占 20%（300m），把决定胜负的段落压缩了一半，
     后上型根本没有足够距离完成超越。现在末段扩到 30%（600m）。 */
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

  /* 跑法系数（现实取向，见"位置即代价"机制）
     ------------------------------------------------------------
     现实里跑法的差异不是"谁速度系数高"，而是【把体力花在哪一段】：
       逃 —— 序盘抢位（早期系数高），但承受风阻、烧油最多，末段必然最弱
       先 —— 中段位置好、可攻可守，全程中庸
       差 —— 前段省力，末段提速
       追 —— 前段最省，末段最强，但落后最多
     所以系数的形状必须是：早期 逃>先>差>追，末段 追>差>先>逃。
     注意末段应取【负系数】——逃马末段不是"稍慢"，而是明显慢于基准。
     历史遗留：STYLE_COEF 是文档原版，保留以供对比测试。 */
  const STYLE_COEF_DOC = {
    '逃': { break: 1.08, open: 1.08, mid: 1.03, late: 1.02, final: 0.97 },
    '先': { break: 1.03, open: 1.03, mid: 1.00, late: 1.02, final: 1.04 },
    '差': { break: 0.96, open: 0.96, mid: 0.97, late: 1.03, final: 1.06 },
    '追': { break: 0.88, open: 0.88, mid: 0.95, late: 1.02, final: 1.10 },
  };
  /* ⚠️ 标定要点：决定胜负的是【系数的距离加权积分】，不是单阶段的大小。
     所有马同距离、同起点，胜者 = 全程平均速度最高者。

     这里经过一次重要修正。旧表的积分跨度达 0.69%（逃 1.0316 → 追 1.0247），
     意味着「只要选对跑法，2000m 就白拿 5.6 马身」。
     实测把 8 匹马设成【完全同一水平】时，1-2 名仍差 8 马身、末位差 64 马身
     —— 马身差距失控的根因就在这一项，而不在能力跨度。

     现实里跑法决定的是【位置与节奏】，不是【总用时】：
     同场马的完赛时间本就只差 0.1~0.3%（冠军-亚军 1~2 马身）。
     故把系数相对 1 的幅度整体压缩到 35%，积分跨度降到 0.24%，
     位置形态仍然保留（早期 逃 vs 追 差 1.3%，半程就能拉开 7 马身，
     末段再追回来——这才是真实赛马的展开）。
     而「短途前速占优、长途后上占优」改由【体力与步速】决定，
     不再由系数直接决定。校验见 tests/realism.js。 */
  /* ⚠️ 标定要点：系数必须按【马群耦合后的有效积分】来配平，不能按原积分。
     packCoupling=0.40 把序盘/中盘的贡献压到 40%，各阶段的有效权重变成
       break 0.054 / open 0.108 / mid 0.120 / late 0.080 / final 0.300
     —— 于是【终盘的权重最大】，原来的系数表在耦合后反而变成"后上型最强"
     （实测 2000m 追 46.7% / 逃 1.7%）。
     本表按上述有效权重重新配平，使四跑法的耦合后有效积分基本相等
     （跨度 <0.02%），把"前速 vs 后上"的决定权交还给【步速与体力】，
     而不是让系数直接决定。形状仍保留：早期 逃>先>差>追，末段 追>差>先>逃。
     ⚠️ 若日后调整 packCoupling，本表必须重新配平。 */
  const STYLE_COEF = {
    '逃': { break: 1.0088, open: 1.0078, mid: 1.0053, late: 0.9983, final: 0.9931 },
    '先': { break: 1.0017, open: 1.0013, mid: 1.0006, late: 0.9996, final: 0.9982 },
    '差': { break: 0.9968, open: 0.9972, mid: 0.9982, late: 1.0000, final: 1.0014 },
    '追': { break: 0.9918, open: 0.9932, mid: 0.9960, late: 1.0009, final: 1.0044 },
  };
  /* 骑手的影响应当主要来自【战术与判断】（见 JOCKEY_CADENCE 的决策频率），
     而不是裸速度加成。原表给殿堂 +4%、新人 0 —— 等于"抽到好骑手"
     就能白拿 4% 的完赛时间（现实骑手差距更多体现在走位与配速判断上）。
     这是「8 匹同水平·同跑法的马仍差 7.6 马身」的两个主因之一。 */
  const JOCKEY_BONUS = { '新人': 0, '普通': 0.002, '优秀': 0.006, '殿堂': 0.012 };
  const JOCKEY_CADENCE = { '新人': 4, '普通': 2, '优秀': 1.5, '殿堂': 1 };
  /* 场地修正 */
  const FIELD_STATE_COEF = { '良': 1, '稍重': 0.98, '重': 0.95, '不良': 0.9 };
  const SURFACE_COEF = {
    '草地': { '草地': 1, '泥地': 0.92, '泥草双刀': 0.97 },
    '泥地': { '草地': 0.92, '泥地': 1, '泥草双刀': 0.97 },
  };
  /* 疲劳对比赛发挥的影响（3.6 疲劳影响表）
     ⚠️ 原表把 疲劳 85~100 压到 0.6、>100 压到 0.3 —— 等于让疲劳的马慢一倍。
     实测这一项单独就能贡献 8~40% 的速度差，是马身差距失控的来源之一
     （生成器会给约两成马分配 51~70 的疲劳，正好落在 0.92 档）。
     归因实验（2000m/全同跑法/全同水平）显示，斗志+疲劳+骑手三项合计
     仍贡献 2.28 马身（1-2名），故整体进一步收敛到数个百分点以内。 */
  function fatigueMultiplier(f) {
    if (f <= 25) return 1; if (f <= 50) return 0.995; if (f <= 70) return 0.985;
    if (f <= 85) return 0.97; if (f <= 100) return 0.955; return 0.94;
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

  /* ============================================================
   * 比赛公式参数（3.10 重做）
   * ------------------------------------------------------------
   * 旧公式的三个问题（均由 tests/attribute-impact.js 实测确认）：
   *   ① 速度独占：速度 +20 胜率 73%，而耐力 +20 = +0.0、毅力 +20 = +1.3
   *   ② 耐力无机制：毅力阶段"锁定额定速度"，全程没有任何衰减，
   *      耐力池还有富余时多加耐力毫无价值（实测耐力 70→90 完赛时间完全相同）
   *   ③ 速度标尺偏慢：2000m 要 139~166 秒（现实约 120 秒），最高速仅 47 km/h
   *
   * 新设计：把"速度"定义为上限、"耐力/毅力"定义为维持上限的能力，
   * 并通过「连续掉速」把两者连起来——这是现实中两者的真实关系。
   * ============================================================ */
  const RACE_F = {
    /* ① 基础速度标尺（m/s）
       ⚠️ 核心约束：速度是【乘法】作用于全程五个阶段的。
       速度高 1.5% → 2000m 就领先约 40 米，足以决定胜负。
       实测：速度 +20 在斜率 0.26 时胜率 +74.5 个百分点，压到 0.08 仍有 +39.5。
       所以速度标尺必须压得很窄，让它只负责"整体水准"；
       能力差异改由【阶段专属属性】承担（见 ⑤）。

       斜率从 0.045 再压到 0.028 的理由：
         生成器给同场马的 level 跨度常达 8~10 点（drama 场 62~70、
         G1 的 RACE_TIERS 是 84~94）。原斜率下这直接等于基速差 4.1%，
         而现实中同班次马的速度差距只有 2~3%（全场用时差 2~4%）。
         实测原斜率把「冠军-亚军着差」推高到 12 马身（现实约 1~2）。
         压窄后基速差降到 2.3%，落在现实量级。
       标定：速度 70 → 0.028×70+15.39 = 17.35 m/s，
       配合全程系数后 2000m ≈ 118 秒（现实 120 秒）。 */
    baseSpeed: { a: 0.014, b: 16.37, min: 40, max: 115 },
    /* ② 耐力池与消耗
       关键设计一：消耗由【距离】驱动，不由时间驱动。
       若按时间消耗，"掉速 → 跑得久 → 消耗更多 → 掉得更快"会形成死亡螺旋
       （实测按时间消耗时完赛时间从 120 秒飙到 170~206 秒）。
       按距离消耗则每米消耗固定，掉速不会反过来加剧消耗，系统稳定可读。

       关键设计二：消耗按【本场距离】归一，而不是固定绝对值。
       若按固定值标定（"耐力70 恰好在 2000m 用完"），则 2400m 会提前耗尽，
       实测出现末位慢 95 秒、3000m 全场中止。
       归一后，"耐力 70 = 任何距离都刚好够用"，距离只改变门槛的绝对值：
       1200m 时耐力富余（速度独大），3000m 时耐力成为硬门槛。 */
    staminaPer: 60,          // 池 = 耐力 × 60
    gutsPer: 60,             // 池 = 毅力 × 60
    drainDistBase: 2000,
    drainDistExp: 0.45,      // 距离指数：长距离每米消耗更高，但不线性爆掉
    /* ③ 三段式：耐力 / 毅力 / 失速（3.10(10) 重做）
       ------------------------------------------------------------
       设计意图（用户原始设计）：
         耐力阶段 —— 消耗耐力【可以提升速度】，也能维持速度
         毅力阶段 —— 耐力耗尽后，【只能维持速度，不能提升】
         失速阶段 —— 毅力也耗尽，掉速
       加速能力的正确形式：正比于【已消耗的耐力】，而不是剩余耐力。
       现实里出力的代价是耗油，所以"省下来的油"才是末段能变现的功率。
       若正比于剩余量会形成正反馈（越领先→油越多→提速越大→更领先）：
       实测那样做会让逃马胜率飙到 54.7%、差+追合计只剩 3.9%。
          accel = staminaAccel × 已消耗比例
       即"前段省下的体力"在末段转化为冲刺能力。 */
    staminaAccel: 0.12,      // 已消耗耐力全额兑现时的提速上限
    accelWindow: 0.05,       // 进入终盘后多少进度内完成兑现
    /* 掉速幅度必须【贴近现实量级】。原值 0.22/0.34 下，体力耗尽的马
       终盘只剩 (1-0.22)×(1-0.34)=0.51 的速度——比正常马慢一倍。
       实测末段落差拉到 10 秒以上，末位落后 116 马身（约 280m）。
       现实里「没跑完这口气」的马，终盘也只是慢 3~8%（约 1~3 秒），
       因为比赛总用时的差距本就只有 2~4%。故压到 0.10/0.14：
       全力竭 = 保留 90%×86% ≈ 77%，仍能明显看出掉速，但不会停摆。 */
    staminaMaintain: 0.05,   // 耐力阶段的掉速幅度（剩余耐力比越低掉越多）
    gutsMaintain: 0.07,      // 毅力阶段的额外掉速幅度（毅力剩越少掉越多）
    stallFall: 0.96,         // 刚进入失速时保留的速度比例
    stallDrop: 0.10,         // 失速阶段随速度下降继续衰减的幅度
    stallFloor: 0.88,        // 失速下限（保留基准速度的 88%）
    stallDecayPerSec: 0.985, // 失速阶段每秒速度衰减（原为 0.95/帧，下跌过快）
    /* 失速必须【有界】。旧值 (0.78 / 0.40 / 下限 0.30 + 速度地板 STALL_SPEED=2)
       会让耗尽体力的马以 2~3 m/s 爬完全程，实测把马群拉开到
       「冠军-末位 中位数 153 马身」（约 367 米）——而现实里
       「大差」的含义也只是 10 马身以上，不是几百米。
       现在把失速收敛为「保留 94%、最多再掉到 86%」：
       跑崩表现为明显变慢（数秒级），而不是停下来。 */
    /* ④ 位置即代价（3.10 新增）—— 这是四种跑法能平衡的根源
       现实里领放者承受全部风阻，跟跑者借前马的尾流省力，
       赛马界的经验值是跟跑约省 1~2 马身的能量（≈10~12%）。
       所以"抢到前面"不是免费的，而是要用体力买的。
       判定：正前方 draftRange 米内有马 = 被遮挡省力；
             独自领放 = 承受全风阻。 */
    draftRange: 12,          // 被遮挡的判定距离(米)
    draftSave: 0.93,         // 被遮挡时的耐力消耗倍率
    leadCost: 1.05,          // 独自领放时的耐力消耗倍率
    /* ⚠️ 领放惩罚必须收窄。原值 (1.10 / 0.88) 是 25% 的耗油差 ——
       跑满 2000m 必然力竭，于是「只要跑后上就赢」，实测 2000m 追 48%、
       3000m 追 67%，而前速型全军覆没。
       现实里尾流只省约 5~10% 体力（赛马界通行经验值），故收敛到 13% 差。
       领放的真实代价主要来自【节奏税】——即"被迫跑多快"，
       那已由 paceTax 按步速与跑法分别结算，不该在这里重复征收。 */
    /* ⑤ 节奏博弈（3.10 新增）
       同场争抢领放的逃马越多，前段节奏越快：速度上升的同时油耗也上升，
       于是互相消耗、末段集体崩溃——这是真实赛马最好看的部分。 */
    paceContestCoef: 0.012,  // （旧接口，保留供对比测试）
    paceContestDrain: 0.14,  // （旧接口，保留供对比测试）
    paceContestCap: 3,       // （旧接口，保留供对比测试）
    /* ⑦ 步速系统（3.10 新增，设计说明见 docs/比赛系统-现实差距评估.md §8）
       ------------------------------------------------------------
       旧 paceContest 为何失效：
         它的油耗端乘在 effortDrain 上，而 effort = H.v / race.avgV 是
         「相对全场均速」的比值 —— 步速抬高全场速度时分子分母同时变大，
         效应被数学抵消。于是节奏博弈没能真正改变体力分配
         （实测 race-drama「半程领先者即冠军」68.7%，几乎没起作用）。
       解法：旁路新增一个【不参与归一化】的绝对项 paceTax。

       而 paceTax 要乘 pacePull 才有意义：现实里步速由领放者设定，
       它只把「想跑在前面」的马拖着走；后上型仍按自己的节奏跑，
       快步速对它的意义是差距被拉开，而不是被拖着提速。 */
    pacePull: { '逃': 1.00, '先': 0.60, '差': 0.20, '追': 0.10 },
    paceWeight: { '逃': 1.00, '先': 0.12 },   // 谁在真正争抢领放
    paceRef: 1.15,           // 等效领放意愿 1.15 ≈「1 匹逃 + 3 匹先」= 标准节奏
    paceSizeFix: 0.03,       // 每多一匹马，争抢强度上升
    paceSlowGate: 1.00,      // paceStrength < 此值 = スロー
    paceHighGate: 1.50,      // paceStrength > 此值 = ハイ
    paceSpeedK: 0.012,       // 步速对前段速度的拉动幅度
    /* ⚠️ 这个值必须小。原写 0.045 时，ハイペース 下的逃马白拿
       (paceStrength-1)×0.045×1.0 ≈ +3.7% 的全程速度，而它的代价
       （节奏税）只在体力见底时才兑现 —— 短途体力富余，于是变成
       「争抢越快越白赚」，实测 1200m 逃马胜率 97.5%。
       现实相反：速度争夺的代价必须大于收益，否则就没有"烧掉"一说。
       现在压到 0.012，让步速的主要作用回到【体力再分配】上。 */
    paceTaxK: 0.40,          // 节奏税强度（× pacePull × 步速超出量）
    /* ⑥ 赛道几何（3.10 新增）—— 让弯道真正参与竞争
       弯道速度上限：过弯要抵抗离心力，半径越小越要减速。
         速度系数 = 1/(1 + k·bendPenaltyLen)，k = 1/R。
         R=100(1200m) → 0.917；R=145(3000m) → 0.942。
       内外道：弯道外侧弧更长，半径 (R+x) 对基准的比值即真实速度差，
         所以外侧必须更快才等价。这就是内栏优势与"抢位有价值"的来源。
       弯道屏蔽加速：现实过弯要维持平衡且容易被堵，后上型的加速窗口
         因此被弯道切碎——弯道占比越高，后上型越吃亏。 */
    bendPenaltyLen: 9,       // 弯道减速强度（米），配合 k=1/R 使用
    laneBias: 0.15,          // 内外道几何差异的保留强度（0=完全解耦）
    /* ⑧ 马群耦合（3.10 新增）—— 修正「速度作用方式」与现实的结构性偏离
       ------------------------------------------------------------
       旧结构里 base（含速度）是【乘法作用于全程】的，于是能力差从第一米
       起就线性累积到终点：1 点 level ≈ 0.16% 速度 ≈ 每点 1.34 马身，
       跑满 2000m 就拉开十几马身。实测 ±4 level 的场次 1-2 名差 15 马身
       （现实 1~2），而"8 匹同水平同跑法"也差 6% 完赛时间。

       但真实赛马不是这样跑的：序盘到中盘的马群被节奏【锁住】——
       跑在群里没法"想快就快"（受前马遮挡、还要留力），骑手会收着跑；
       能力差距要到【终盘 600m 才兑现】。这正是真实比赛"前 1400m 挤成一团、
       最后 400m 才拉开"的原因。

       本参数把序盘/中盘的个体速度差异压向全场均值，终盘完全放开：
         packCoupling = 0.40 → 序盘/中盘只保留 40% 的能力差
       压缩发生在 retention（体力/掉速）之前，所以耐力、毅力、失速
       依旧全额咬得住 —— 属性照样决定胜负，只是不再无脑变成时间差。 */
    packCoupling: 0.40,
    /* ⑦ 消耗 ∝ 出力强度
       原来按"速度×距离"算，于是"跑得更快"本身免费——逃马配速最高却
       不多耗油。现实里跑更快应显著更费油，这是逃马末段崩溃的根因。
       出力比 = v / 全场均速，消耗 ×= 出力比^effortExp。 */
    effortExp: 1.5,
    /* ⑤ 阶段专属属性（关键设计）
       旧实现里所有属性都只影响 base，而 base 乘以风格系数作用于全程——
       结果是"跑法"（风格系数差 ±7%）完全盖过"属性"（速度差 ±1.5%），
       比赛由跑法决定，属性形同虚设。
       现在把属性按【阶段】分配，每个属性都有专属的作用区间：
         出闸 ← 出闸能力、序盘/中盘 ← 力量、后盘 ← 毅力、终盘 ← 爆发力。
       k=0.16：属性 50→90 时该阶段系数变化约 ±6.4%，与风格系数同量级，
       于是"跑法"与"属性"共同决定胜负。 */
    stageAttr: {
      break: { key: '出闸能力', k: 0.16 },
      open:  { key: '力量',     k: 0.16 },
      mid:   { key: '力量',     k: 0.16 },
      late:  { key: '毅力',     k: 0.16 },
      final: { key: '爆发力',   k: 0.16 },
    },
    /* ⑥ 终盘爆发修正（3.10(6)）：在阶段属性之外再给爆发力一份额外权重。
       旧值 0.10 下爆发力 +20 只值 +3.4% 终盘速度、胜率仅 +2.7 个百分点。 */
    burstFactor: { doc: 0.14, balanced: 0.12 },
    /* ⑨ 终盘 = 属性的主场（3.10 新增）
       ------------------------------------------------------------
       设计意图（回答"属性要有作用、马身又要小"这组矛盾）：
       速度不再主要靠【全程乘算】取胜 —— 那会让优势从第一米起线性累积成
       十几马身；而是主要靠【终盘能开多快】。这正是现实中区分强马的方式：
       强马不是全程快 1%，而是末段能多给一脚。
       所以 baseSpeed 的斜率已相应压窄（0.028 → 0.014），
       差额挪到这里：终盘对速度的兑现系数。
       速度 90（+20 点）→ 终盘 +4% 速度，作用在最后 30% 赛程上；
       既能决定胜负，又不会在前面就攒出巨大领先。 */
    finalAttrK: 0.20,
  };

  /* 基础速度（3.10 重做）
     线性且斜率适中：既保留"速度是最重要的单项能力"，又不让它一票独裁。 */
  function baseSpeed(spd) {
    const F = RACE_F.baseSpeed;
    const s = Math.max(F.min, Math.min(F.max, spd));
    return F.a * s + F.b;
  }
  /* 可跑距离模型（3.10 重做）
     ------------------------------------------------------------
     设计意图：耐力不再是抽象数值，而是【能跑多远】的绝对距离。
         可跑距离 = 耐力 × 32 米
         耐力 50 → 1600m   耐力 70 → 2240m
         耐力 80 → 2560m   耐力 90 → 2880m   耐力 100 → 3200m
     与赛程无关——这正是"这匹马适合跑多远"这个问题的答案，
     也是"距离适性"赖以成立的基础。
     现实参照：最长的平地赛约 4000m 以上，所以耐力 100（3200m）仍非万能。

     消耗按【距离】驱动而非时间：若按时间消耗，"掉速→跑得久→耗更多→掉更快"
     会形成死亡螺旋（实测完赛时间从 120 秒飙到 206 秒）。

     与实际可跑距离相乘的修正（见 race.drainCoef）：
       场地状况 —— 良 1.00 / 稍重 0.95 / 重 0.88 / 不良 0.80
       力量     —— 场地越差，力量强的马越省力（好地几乎无差别）
       疲劳     —— 出赛前的疲劳直接缩短可跑距离
     坡度则在每帧单独结算（上坡多耗、下坡少耗），不并入这里。
     ============================================================ */
  /* 每点耐力对应的可跑距离（米）。
     设计标称是 32 米/点（耐力 100 → 3200m），但消耗公式里骑手动作系数、
     出力惩罚等乘数合计会额外放大到约 1.32 倍，因此这里取 43 作为内部常数，
     使【实际可跑距离】回到 32 米/点。实测（tests/stamina-range.js）：
       耐力 50/70/90/100 → 名义 1600/2240/2880/3200m 与实际一致。
     若日后调整骑手动作系数或出力指数，需用 tests/_probe-range.js 重新标定。 */
  const STAMINA_RANGE_PER_POINT = 32;
  /* 骑手动作的基准消耗系数（标定常数）。
     可跑距离必须在"实际骑手行为"下兑现（耐力70 = 2240m），所以按实测标定。
     实测 40 场 × 8 匹 / 2000m 的动作分布：
       推骑 38.9%(×1.5) / 无 22.3%(×1.0) / 斜行 19.6%(×1.2) /
       打鞭 10.1%(×2.0) / 收力 9.1%(×0.7)  →  加权平均 1.3075
     单马独跑实测：每米消耗 1.9164（基准 1.8750），耗尽点 2223m vs 名义 2240m，
     偏差 -0.76% → 按 2240/2223 反推得 1.3175。
     注意：单人独跑时 AI 全程"收力"(×0.7)，与真实比赛的动作构成不同，
     所以校准时以真实比赛行为为准。 */
  const ACTION_STAMINA_BASE = 1.3175;
  /* 场地对可跑距离的影响：烂地更费力 */
  const GROUND_RANGE_COEF = { '良': 1.00, '稍重': 0.95, '重': 0.88, '不良': 0.80 };
  /* 力量对续航的保护：基准 70 为中性，再乘以"场地恶劣度"，
     使好地上力量几乎不影响续航、烂地上影响明显。
     返回的是【可跑距离修正】(越大越省力)：力量90 在良地上 ≈1.00、
     在不良地上 ≈1.09；力量50 在不良地上 ≈0.91。 */
  function powerDrainCoef(power, state) {
    const badness = 1 - (GROUND_RANGE_COEF[state] !== undefined ? GROUND_RANGE_COEF[state] : 1);
    return clamp(1 + (power - 70) * 0.0006 * (badness / 0.20) * 2.5, 0.75, 1.25);
  }
  /* 本场的可跑距离修正（场地 × 力量）
     疲劳不并入这里——它已经通过全局速度乘数 fatMult 让马跑得更慢，
     若再缩短可跑距离会形成双重惩罚（实测疲劳100 时可跑距离掉到名义的 71%）。
     设计上"疲劳"的作用是让马变慢，不是让它提前力竭。 */
  function rangeCoef(state, power) {
    const ground = GROUND_RANGE_COEF[state] !== undefined ? GROUND_RANGE_COEF[state] : 1;
    return ground * powerDrainCoef(power, state);
  }
  /* 兼容旧接口：距离归一已由"绝对可跑距离"取代，这里保持返回 1 */
  function drainDistanceCoef() { return 1; }
  /* 基准马的耐力值：预算的参考尺度。
     预算 = (本场距离 / 基准耐力) × 池倍率 × (32 / STAMINA_RANGE_PER_POINT)
     最后那个比值才是"每点耐力能跑多少米"的真正旋钮：
        每点可跑米数 = REF_STAMINA × 池倍率 × RANGE_PER_POINT / 32
                     = 67.2 × RANGE_PER_POINT
     危险点（曾踩坑）：若省掉这个比值，drainPerMeter 就与耐力值无关，
     改 STAMINA_RANGE_PER_POINT 只会改变"标称显示"，实际耗尽点纹丝不动
     （实测把常数改成 18/22/26 结果完全一致）。 */
  const REF_STAMINA = 70;
  const RANGE_REF = 32;          // 标称基准：32 米/点
  /* ⚠️ 标定尚未收口（如实记录）：
     改 STAMINA_RANGE_PER_POINT 的实际效果是【非线性】的，因为 drainPerMeter
     依赖本场距离，而改常数会改变耗尽发生在什么速度下，两者相互耦合。
     实测（真实 8 匹马比赛，良地/力量70）：
       常数 20.4 → 耐力70 实际 2284m（标称 1428m，+60%）
       常数 32   → 耐力70 实际 3509m（标称 2240m，+57%）
     即偏差比例稳定在 +57~60%，但绝对值不随常数线性变化。
     下一步应改为直接按目标耗尽里程解方程，而不是线性外推。 */
  const RANGE_CALIB = 0.626;     // 经验修正：把标称对齐到实测，待解方程后移除
  function staminaBudget(length) {
    return (length / REF_STAMINA) * RACE_F.staminaPer *
      (RANGE_REF / STAMINA_RANGE_PER_POINT) / RANGE_CALIB;
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
  /* 各跑法的属性模板（生成演示用马）
     ⚠️ 两条重要修正：
     ① 耐力不再按跑法大幅分化。旧模板给「追」只有 耐力 40~65
        （level 66 时约 52 → 可跑距离 1664m），意味着后上型在马厩里
        就已经跑不完 2000m —— 实测会让马群裂成「两匹能跑完 + 六匹崩盘」，
        第 3 名就落后 57 马身。
        现实里跑法决定的是【把体力花在哪一段】，不是【体力的上限】。
     ② 速度也对齐了。旧模板 逃 速度[70,92] vs 差[60,88]，
        在同 level 下光速度就差 5.6 点（≈1.5%），2000m 就是 12 马身 ——
        等于让「跑法」白送实力。现实中同班次的马速度本就接近，
        跑法只是【战术选择】，不应该自带能力优势。
     属性分工保留：出闸能力 逃高追低、爆发力 追高逃低、毅力 追高逃低。 */
  const STYLE_STATS = {
    '逃': { '速度': [66, 90], '耐力': [68, 90], '出闸能力': [65, 92], '爆发力': [46, 72], '力量': [48, 82], '毅力': [54, 82], '智力': [45, 85], '体格': [45, 85] },
    '先': { '速度': [66, 90], '耐力': [66, 88], '出闸能力': [56, 84], '爆发力': [56, 80], '力量': [50, 82], '毅力': [56, 84], '智力': [45, 85], '体格': [45, 85] },
    '差': { '速度': [66, 90], '耐力': [64, 86], '出闸能力': [46, 74], '爆发力': [68, 90], '力量': [54, 84], '毅力': [58, 86], '智力': [45, 85], '体格': [45, 85] },
    '追': { '速度': [66, 90], '耐力': [62, 84], '出闸能力': [40, 70], '爆发力': [72, 94], '力量': [52, 82], '毅力': [62, 92], '智力': [45, 85], '体格': [45, 85] },
  };
  function makeHorse(rng, opts) {
    const o = opts || {};
    const style = o.style || pick(rng, ['逃', '先', '先', '差', '差', '追', '追', '先']);
    /* 「强马」的档差。原为 ±5 —— 也就是场次内单靠 tier 就能拉出 5 点能力差。
       与「场次内能力跨度 ±2」的策略对齐后压到 ±2（见 FIELD_LEVEL_SPAN）。 */
    const boost = o.tier === 'strong' ? 2 : (o.tier === 'weak' ? -2 : 0);
    /* 双层生成：场次水平(level)决定整体档次，跑法模板决定形态；
       形态差异保留(逃高耐力、追低耐力高爆发)，个体差异压缩，保证同场竞争性 */
    const level = o.level !== undefined ? o.level : 70;
    const stats = {};
    for (const k of Object.keys(STYLE_STATS[style])) {
      const r = STYLE_STATS[style][k];
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
    /* 场次水平（整场统一），档差由 tier 提供（见 RACE_F / makeHorse） */
    const level = o.level !== undefined ? o.level : 62 + Math.floor(rng() * 17);
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

  /* ---------------- 步速（展开）判定（3.10 新增） ----------------
   * 只吃公开信息：跑法 + 斗心。参赛表上就能数出几匹逃马，
   * 所以「本场节奏」本来就是赛前可判读的公开信息
   * ——现实中马评家判读展开用的也正是这个方法。
   *
   * 一匹斗心正常的逃马 = 1.0；先行马按 0.12 计入（它们会压上施压，但不真正领放）。
   * 返回值：1.0 = 标准节奏；< paceSlowGate = スロー；> paceHighGate = ハイ。
   *   スロー —— 无人认真争抢 → 领放者可控制节奏「偷走比赛」
   *   ハイ   —— 多马互抢 → 前段更快也更烧油 → 末段集体崩溃、后上型受益
   *
   * ⚠️ 只在赛前判定一次。若每帧重算，赛末活跃马变少会把强度稀释掉
   * （实测 2 匹逃马的场次会被算成 0.67 = スロー）。
   * ============================================================ */
  const PACE_WEIGHT = { '逃': 1.00, '先': 0.12 };
  function paceStrengthOf(horses) {
    let want = 0;
    for (const h of horses) {
      const w = PACE_WEIGHT[h.style] || 0;
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
    biasWinStreak: 0.90,   // 连胜溢价：上一场赢了 → 人气被过度推高（乘数<1）
    biasUnraced: 1.10,     // 新马被低估
    biasBloodNeglect: 0.92,// 血统被系统性轻视（对血统分做压缩）
    biasJockeyHalo: 1.06,  // 名骑手光环：骑手分被放大
    /* 步速（展开）—— 市场看得见，但会系统性低估。
       参赛表上就能数出几匹逃马，所以「本场节奏」对市场是公开信息，
       市场也的确会据此刻度赔率；但它只做了打折处理：真效应 × damp。
       剩下的差额就是玩家要赚的钱 —— 正对应业界共识
       「betting market almost never prices pace correctly」。 */
    wPace: 0.10,           // 步速在公开评分里的权重
    marketPaceDamp: 0.40,  // 市场对步速效应的打折比例（越小 → 套利空间越大）
  };
  /* 步速对各跑法的「真实」影响方向（正=有利）。
     ハイペース 烧掉前速马 → 逃/先 受损，差/追 受益；スロー 则相反。 */
  const PACE_TRUE_EFFECT = { '逃': -1.00, '先': -0.40, '差': +0.50, '追': +0.90 };
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
    if (starts > 0 && winRate >= 0.35) s *= W.biasWinStreak;
    if (starts === 0) s *= W.biasUnraced;
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
      /* 步速调整：市场知道本场节奏（公开信息），但只兑现真效应的
         marketPaceDamp 倍 —— 未被兑现的部分正是玩家可以赚的错价。
         现实中市场对「单骑领放偷走比赛」与「争抢步速烧掉前速马」
         这两件事的定价都偏轻，这里的打折就是那个偏差。 */
      const trueEffect = (pace.strength - 1) * (PACE_TRUE_EFFECT[h.style] || 0);
      const damped = trueEffect * MARKET.marketPaceDamp;
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
    const styleCoefs = o.styleCoefs === 'doc' ? STYLE_COEF_DOC : STYLE_COEF;
    /* 爆发修正系数：旧值 0.25/0.10 下爆发力 +20 只值约 3.4% 终盘速度，
       实测对胜率仅 +2.7 个百分点——"末段加速"没有存在感。
       新值提高到 0.45/0.30，配合连续掉速，让爆发力成为真正的第二个维度。 */
    const burstFactor = o.styleCoefs === 'doc' ? RACE_F.burstFactor.doc : RACE_F.burstFactor.balanced;
    const race = {
      length, surface, state, dir, profile, g, geo, t: 0, finished: false,
      events: [], order: [], dnf: [], winnerTime: null,
      /* 本场耐力预算（已含场地修正；力量与疲劳是每匹马各自的，在消耗处结算） */
      staminaBudget: staminaBudget(length),
      paceContest: 0,          // 节奏博弈强度（同场争抢领放的逃马数-1），每帧更新
      avgV: 0,                 // 全场瞬时均速，用于计算"出力强度"（每帧更新）
      avgCap: 0,               // 全场"纯能力速度"均值，用于马群耦合（每帧更新）
      prevLead: null, phaseAnnounced: {}, posHistory: [], _lastPct: 0,
      lastEventAt: {},
    };
    /* 第一遍：斗志修正后的参赛属性（文档：±10%；平衡档：±5% 减半）
       属性不再做任何"向全场均值回归"的压缩——见下方说明。 */
    /* 斗志修正必须收窄。原值 0.002（doc）/0.001（balanced）下，
       斗志 55~100 会带来最高 +5% 的【全属性】修正，也就是 5% 的速度差。
       单这一项就足以把 8 匹同水平、同跑法的马拉开 6% 的完赛时间
       （实测 1-2 名 7.6 马身）——而现实中"状态好坏"的量级是 1~2%。 */
    const morRate = o.styleCoefs === 'doc' ? 0.0004 : 0.0002;
    const pre = field.map((h) => {
      const mor = ((h['斗志'] !== undefined ? h['斗志'] : 70) - 50) * morRate;
      const adj = {};
      for (const k of ['速度', '爆发力', '出闸能力', '耐力', '力量', '毅力', '体格']) {
        adj[k] = clamp(Math.round(h.stats[k] * (1 + mor)), 1, 115);
      }
      return { h, mor, adj };
    });
    /* 「属性向全场均值回归 35%」已删除。
       它是为旧结构（所有属性只影响 base，属性差会线性累积）打的补丁，
       作用是抹平真实实力差距。现实不压缩实力——强弱马同场就是有差距，
       差距应该由【距离/场地/跑法/节奏】这些真实因素去调节，而不是把属性拉平。
       它同时是"着差中位数 16.87 马身"与"收敛机制失效"的根源。
       两个系数档位现在共用同一套压缩前的属性。 */
    const horses = pre.map(({ h, mor, adj }) => {
      const surfC = (SURFACE_COEF[surface] || {})[h.surface];
      const fieldCoef = (FIELD_STATE_COEF[state] || 1) * (surfC !== undefined ? surfC : 1);
      return {
        h, id: h.id, name: h.name, style: h.style,
        jockey: h.jockeyGrade || '普通',
        s: 0, t: clamp(1.0 + rng() * 4, 0.8, 6), v: 0, prevV: 0, pot: 0, laneJitter: (rng() - 0.5) * 1.6,
        stamina: adj['耐力'] * RACE_F.staminaPer, guts: adj['毅力'] * RACE_F.gutsPer,
        staminaMax: adj['耐力'] * RACE_F.staminaPer, gutsMax: adj['毅力'] * RACE_F.gutsPer,
        stage: '耐力', retention: 1,
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
    /* 步速在赛前就由参赛马的跑法决定，故只判定一次并冻结，
       不随赛末马匹减少而漂移。整场比赛的速度拉动与节奏税都读它。 */
    {
      const pace = paceStrengthOf(field);
      race.paceStrength = pace.strength;
      race.paceLevel = pace.level;
      race.paceContest = Math.max(0, Math.round((pace.strength - 1) * 2));
    }
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
      if (onBend && !isFinal) H.targetT = 1.2 + H.laneJitter * 0.3;

      switch (H.style) {
        case '逃': {
          H.targetT = 1.2;
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
          H.targetT = 2.2 + H.laneJitter * 0.6;
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
          H.targetT = 3.4 + H.laneJitter * 0.6;
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
          H.targetT = 4.4 + H.laneJitter * 0.6;
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
      /* 步速在 createRace 里已判定一次并冻结（见 paceStrengthOf 的说明）。
         这里不再重算 —— 若每帧重算，赛末活跃马变少会把 paceStrength 稀释掉。 */
      race.paceContest = Math.max(0, Math.round((race.paceStrength - 1) * 2));
      /* 全场瞬时均速：作为"出力强度"的基准。
         用瞬时值而非整场均值，好处是逃马在序盘高速领放时立刻承担更高油耗，
         而比赛后段全场都慢下来时不会凭空产生额外惩罚。 */
      let vSum = 0, vN = 0;
      for (const H of act) { vSum += H.v; vN++; }
      race.avgV = vN > 0 ? vSum / vN : 0;
      /* 马群耦合用的全场"纯能力速度"均值（本帧统计，下一帧生效，延迟一帧可忽略） */
      let capSum = 0, capN = 0;
      /* 1) 瞬时速度 */
      for (const H of act) {
        const ph = phaseAt(H.s, race.length);
        let runCoef = styleCoefs[H.style][ph.key] + (JOCKEY_BONUS[H.jockey] || 0) + actionBonus(H.action).coef;
        /* 「马群跟跑耦合」已删除。原实现是"离领头马越远、速度加成越大"，
           两个错误：① 方向反了——现实的跟跑是【省力】（借尾流），不是加速；
           ② 判定对象错了——省力取决于"是否紧跟某匹马"，而非"离领头马多远"
           （掉队到 50 米外就没有遮挡，一点也省不了）。
           真正的跟跑收益现在由「位置即代价」按【耐力消耗】结算，见下方第 3 步。 */
        /* 步速拉动前段速度 —— 按跑法衰减
           这是「展开」最关键的一层差异：步速由领放者设定，它只把想跑在
           前面的马拖着走（逃 1.00 / 先 0.60），后上型几乎不受影响
           （差 0.20 / 追 0.10）—— 对它们而言快步速只意味着差距被拉开。
           油耗端不在这里结算，见下方第 3 步的 paceTax。 */
        if (ph.key === 'break' || ph.key === 'open' || ph.key === 'mid') {
          const pull = RACE_F.pacePull[H.style] !== undefined ? RACE_F.pacePull[H.style] : 0.20;
          runCoef += (race.paceStrength - 1) * RACE_F.paceSpeedK * pull;
        }
        /* ---- 三段式：把「加速能力」与「维持能力」拆开 ----
           ① 耐力阶段：可【提速】。提速正比于已消耗的耐力——前段省下的油
              才是末段能变现的功率；同时剩余越少掉速越多。
           ② 毅力阶段：只能【维持】。提速项在此阶段完全不生效。
           ③ 失速阶段：掉速。
           阶段切换时 maintain 从上一阶段的值【接续】，否则会出现
           "切到毅力反而变快"的跳变。 */
        const stRatio = H.stamina / Math.max(1, H.staminaMax);
        const gtRatio = H.guts / Math.max(1, H.gutsMax);
        let accel = 0, maintain;
        if (H.stage === '耐力') {
          /* 只在进入终盘后的 accelWindow 内兑现，此前为 0：
             前段省下的体力不能提前变成速度，否则逃马依旧占尽便宜 */
          const f = race.length > 0 ? H.s / race.length : 0;
          const showFrac = ph.key === 'final'
            ? clamp((f - 0.70) / RACE_F.accelWindow, 0, 1)
            : (f >= 0.75 ? 1 : 0);
          /* 弯道上不能发力：现实里过弯要维持平衡、且容易被堵，
             后上型的加速窗口因此被弯道切碎。
             效果——弯道占比越高，后上型越吃亏（1200m 弯道占 52%、
             3000m 只占 30%），"距离适性"由几何自动产生。 */
          const bendLock = kAt(H.s, race.geo) > 0 ? 0 : 1;
          /* ⚠️ 原写法是 × clamp(1 - stRatio)。1 - stRatio 是【已消耗比例】，
             于是「跑得越快 → 耗得越多 → 末段加速越大」成为正反馈，
             与注释声称的「前段省下的体力在末段变现」正好相反。
             实测它让逃马在 1200m 拿到 80% 胜率（系数优势仅 0.31%），
             并把同水平场次的 1-2 名着差推到 8 马身。
             现在去掉体力耦合：冲刺能力只由【阶段 + 弯道】决定，
             不再与自己前段跑多快挂钩。 */
          accel = RACE_F.staminaAccel * showFrac * bendLock;
          H.accelLock = accel;              // 锁定力竭瞬间的推进，供毅力阶段维持
          maintain = 1 - RACE_F.staminaMaintain * (1 - stRatio);
          H.staminaEndMaintain = maintain;
        } else if (H.stage === '毅力') {
          /* 设计是「只能维持、不能提升」——所以这里【维持】力竭瞬间已有的
             推进力，而不是直接归零。归零会造成速度断崖：
             实测末段 上がり 跨度被拉到 30 秒（现实约 3~6 秒），
             马群裂开到 150 马身。 */
          accel = H.accelLock || 0;
          maintain = (H.staminaEndMaintain || 1) * (1 - RACE_F.gutsMaintain * (1 - gtRatio));
          H.gutsEndMaintain = maintain;
        } else {
          accel = 0;
          const ref = Math.max(1e-6, H.stallRef || H.v);
          maintain = (H.gutsEndMaintain || 1) * RACE_F.stallFall *
            (1 - RACE_F.stallDrop * (1 - H.v / ref));
        }
        H.retention = clamp(maintain, RACE_F.stallFloor, 1);
        H.accel = accel;

        let pot;
        if (ph.key === 'break') {
          pot = H.base * (runCoef * (0.8 + 0.4 * (H.adj['出闸能力'] / 100)) * H.breakNoise) * H.fieldCoef * H.fatMult;
        } else if (ph.key === 'final') {
          /* 终盘 = 属性的主场（见 RACE_F.finalAttrK）。
             爆发力 + 速度的一个分量，在这里一次性兑现。
             爆发力项只在【耐力阶段】能继续增长；进入毅力阶段后按设计
             「只能维持、不能提升」，故把它【锁定】在力竭瞬间的值 ——
             而不是归零（归零会造成速度断崖，是马身差距失控的主因之一）。
             若某匹马进入终盘时已在毅力阶段、从未有过锁定值，则按当前值取，
             同样避免断崖。 */
          const burstNow = burstFactor * (H.adj['爆发力'] / 100)
            + RACE_F.finalAttrK * ((H.adj['速度'] - 70) / 100);
          if (H.stage === '耐力') H.burstLock = burstNow;
          const burst = H.burstLock !== undefined ? H.burstLock : burstNow;
          pot = H.base * (burst + runCoef) * H.fieldCoef * H.fatMult;
        } else {
          pot = H.base * runCoef * H.fieldCoef * H.fatMult;
        }
        /* 阶段专属属性修正：让每个属性在自己负责的阶段起作用，
           而不是全部挤进 base（那会让"跑法"盖过"属性"）。
           属性 70 为中性点，50→90 时系数变化约 ±6.4%。 */
        const sa = RACE_F.stageAttr[ph.key];
        if (sa) pot *= 1 + ((H.adj[sa.key] - 70) / 100) * sa.k * 2;
        /* —— 马群耦合 ——
           序盘/中盘的马群被节奏锁住：个体速度差异压向全场均值。
           注意位置：压缩发生在 retention 之前，所以体力/掉速（耐力、毅力、
           失速）依旧全额生效 —— 属性仍决定胜负，只是不再从第一米起就
           线性累积成时间差。终盘不压缩，能力差在决胜段完整兑现。 */
        if ((ph.key === 'open' || ph.key === 'mid') && H.stage !== '失速') {
          capSum += pot; capN++;
          if (race.avgCap > 0) {
            const ratio = pot / race.avgCap;
            pot = race.avgCap * (1 + (ratio - 1) * RACE_F.packCoupling);
          }
        }
        pot *= H.retention * (1 + accel);
        H.pot = pot;
        /* 坡度速度修正：上坡=1-g·(3.0-2.0·力量/100)，下坡=1+min(0.04,|g|·0.6) */
        const grad = gradientAt(H.s, race.geo, race.g);
        H.grad = grad;
        H.slopeCoef = grad > 0
          ? 1 - grad * (3.0 - 2.0 * (H.adj['力量'] / 100))
          : 1 + Math.min(0.04, -grad * 0.6);
        if (H.stage === '失速') {
          /* 失速速度要【有界】。旧实现按 0.95^dt 无限衰减到 STALL_SPEED(2 m/s)，
             等于让力竭的马停下来；实测把马群拉到「冠军-末位 153 马身」。
             现在下限取「基准速度 × stallFloor」（默认 86%），
             跑崩表现为明显变慢，而不是停摆。 */
          const stallFloorV = Math.max(STALL_SPEED, H.base * RACE_F.stallFloor * (H.gutsEndMaintain || 1));
          H.v = Math.max(stallFloorV, H.v * Math.pow(RACE_F.stallDecayPerSec, dt));
        } else H.v = pot * H.collisionCoef * H.slopeCoef;
      }
      /* 更新马群耦合基准（本帧序盘/中盘马的"纯能力速度"均值） */
      race.avgCap = capN > 0 ? capSum / capN : 0;
      /* 2) 推进 + 碰撞 */
      for (const H of act) { H.collisionCoef = 1; H.collisionIntensity = 0; H.blocked = false; }
      for (const H of list) {
        if (H.action === '斜行in') H.t = clamp(H.t - 0.8 * dt, 0.7, TRACK_WIDTH - 0.7);
        else if (H.action === '斜行out') H.t = clamp(H.t + 0.8 * dt, 0.7, TRACK_WIDTH - 0.7);
        else H.t += (H.targetT - H.t) * Math.min(1, dt * 1.4);
        const k = kAt(H.s, race.geo);
        /* ⚠️ 回向适性只在【弯道】生效。bendCoefFor 是弯道系数，
           原来被无条件乘进全程（含直道）—— 适性不符的马会全程掉 10%，
           而生成器会给约 11% 的马分配不符的回向。
           这是「基速只差 1.8%、实测平均速度却差 11%」的主要剩余来源。
           直道上方向不构成障碍，故 k=0 时不施加。 */
        const bCoef = k > 0 ? bendCoefFor(H.h.special, race.dir) : 1;
        /* 车道与行进距离解耦（重要）
           本引擎的 t 是"离中线的横向偏移"（0~20），不是同心车道半径。
           若按同心车道处理，外侧弧更长、必须给速度补偿 (R+x)/R，
           但那样 20 米宽度配 120 米弯道半径会产生约 15% 的速度差，
           实测贴外栏的 4 匹马胜率合计 96.7%，比原来的内栏优势还极端。
           因此这里让各道【等效等长】：横向位置只影响碰撞与走位，不影响推进。
           这也更符合"赛道宽度代表马群宽度"的直觉。 */
        /* 弯道速度上限：过弯要抵抗离心力，半径越小越要减速。
           曲率 k = 1/R，故速度系数 = 1/(1 + k·bendPenaltyLen)。
           bendPenaltyLen 取 9m：R=100（1200m）时系数 0.917，
           R=145（3000m）时 0.942 —— 短途赛道弯道惩罚天然更重。 */
        const bendSlow = k > 0 ? 1 / (1 + k * RACE_F.bendPenaltyLen) : 1;
        /* 内外道几何（⚠️ 修正符号）
           出发点就是"内栏省距离"：横向偏移 t 的马，实跑距离 = s·(R+t)/R。
           所以同样的实速下，它【沿中线计的推进】应是 v·R/(R+t) —— 内道更快。
           旧实现写成 (R+t)/R 的反向形式（且上方注释还写着"各道等效等长"，
           注释与代码自相矛盾），等于让外道白拿最多 3.6% 的速度。
           而后上型恰好跑在外道（追 targetT=4.4 vs 逃 1.2），
           这正是后上型被系统性偏袒、短途「追 74%」的原因之一。
           TRACK_WIDTH 已从 20 收窄到 11（见顶部常量说明），
           几何差异现在可控，故恢复真实方向并保留 laneBias 强度旋钮。 */
        const laneRaw = k > 0 ? (1 + k * TRACK_WIDTH / 2) / (1 + k * H.t) : 1;
        const laneRatio = 1 + (laneRaw - 1) * RACE_F.laneBias;
        let newS = H.s + H.v * bCoef * bendSlow * laneRatio * dt;
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
            /* 碰撞减速要收敛：原下限 0.5（直接掉一半速度）过重，
               实测单场里可贡献数个百分点到十几的速度差。
               现实里被撞一下损失的是身位与节奏，不是一半速度。 */
            H.collisionCoef = Math.min(H.collisionCoef, Math.max(0.90, 1 - intensity * 0.05));
            F.collisionCoef = Math.min(F.collisionCoef, Math.max(0.95, 1 - intensity * 0.025));
            if (H.squeezePass <= 0) { newS = Math.min(newS, F.s - halfL * 0.5); H.blocked = true; }
          }
        }
        H.s = Math.max(H.s, newS);
        H.prevV = H.v;
      }
      /* 3) 耐力/毅力消耗 —— 可跑距离模型
         每米消耗 = 本场预算 / 本场距离 ÷ 本马的可跑距离修正。
         这样"耗尽点"恰好落在 耐力 × 32 × (场地 × 力量 × 疲劳) 米处，
         即"这匹马能跑多远"是确定的、可预期的，与赛程无关。
         消耗按距离而非时间：按时间会形成死亡螺旋（掉速→跑得久→耗更多→掉更快）。 */
      for (const H of act) {
        const st = actionBonus(H.action).stamina;
        /* 坡度体力修正：上坡耗力、下坡省力。以"平地等效速度"(v/坡度系数)为基准，
           使上坡的额外消耗不被减速抵消——力量的价值变为"更快爬完坡、在坡上停留更短" */
        const gradDrain = (1 + 2.5 * Math.max(0, H.grad || 0)) * (1 + 1.0 * Math.min(0, H.grad || 0));
        /* 本马的可跑距离修正：场地越差力量越值钱；疲劳直接缩短可跑距离 */
        const myRange = rangeCoef(race.state, H.adj['力量']);
        const drainPerMeter = (race.staminaBudget / Math.max(1, race.length)) /
          Math.max(0.35, myRange) * ACTION_STAMINA_BASE;
        /* 位置即代价：这是"抢到前面要用体力买"的落地处，也是四种跑法的平衡根源。
           正前方 draftRange 米内有马 → 借尾流省力（draftSave）；
           独自领放 → 承受全部风阻（leadCost）。
           现实依据：跟跑约省 1~2 马身的能量（赛马界通行经验值，≈10~12%）。 */
        let ahead = false;
        for (const F of list) {
          if (F === H) continue;
          if (F.s > H.s && F.s - H.s <= RACE_F.draftRange) { ahead = true; break; }
        }
        const posCoef = ahead ? RACE_F.draftSave : RACE_F.leadCost;
        H.drafting = ahead;
        /* —— 节奏税（步速系统的核心）——
           这是【不参与归一化】的绝对项，所以不会被 avgV 抵消。
           只有「承受步速」的马要交：乘上 pacePull 后，快节奏的代价
           几乎全落在逃马与先行马身上，后上型的油耗基本不变。
           这正是现实中「快节奏烧掉前速马、后上型捡漏」的机制，
           也是「单骑领放可偷走比赛」的来源（此时 paceStrength<1 → 税额为 0）。
           注意只在序盘/中盘征收 —— 节奏是在那两段跑出来的。 */
        const phNow = phaseAt(H.s, race.length);
        const paceMainPhase = (phNow.key === 'open' || phNow.key === 'mid');
        const pacePull = RACE_F.pacePull[H.style] !== undefined ? RACE_F.pacePull[H.style] : 0.20;
        const paceExcess = Math.max(0, race.paceStrength - 1);
        const paceTax = paceMainPhase
          ? 1 + RACE_F.paceTaxK * pacePull * paceExcess : 1;
        /* 消耗 ∝ 出力强度（关键修正）
           原来按 `速度 × 距离` 算，于是"跑得更快"这件事本身是免费的——
           逃马抢占领放、配速最高，却并不因此多耗油，只承担一个静态的领放惩罚。
           现实里跑更快应当显著更费油，这正是逃马末段崩溃的根本原因。
           现在用【相对全场均速的出力比】的 2.2 次方计算：
             出力 1.10 倍 → 消耗 1.23 倍；出力 0.93 倍 → 消耗 0.85 倍。
           指数 2.2 略高于空气阻力的三次方直觉，用来补偿状态机的离散性。 */
        const fieldAvgV = Math.max(1, race.avgV || H.v);
        const effort = clamp(H.v / fieldAvgV, 0.6, 1.6);
        const effortDrain = Math.pow(effort, RACE_F.effortExp);
        const drain = H.v * drainPerMeter * (st / ACTION_STAMINA_BASE) * gradDrain *
          posCoef * paceTax * effortDrain + H.collisionIntensity;
        if (H.stage === '耐力') {
          H.stamina -= drain * dt;
          if (H.stamina <= 0) {
            H.stamina = 0; H.stage = '毅力';
            event(H.name + ' 体力见底，开始拼毅力！');
          }
        } else if (H.stage === '毅力') {
          H.guts -= drain * dt;
          if (H.guts <= 0) {
            H.guts = 0; H.stage = '失速'; H.stallRef = H.v;
            event(H.name + ' 失速！！');
          }
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
      /* 上がり3ハロン：记录冲过「终点前 600m」的时刻，完赛时相减即得。
         这是日本赛马的头号公开指标，也是情报系统最该有误差的地方
         ——它和步速构成「天平两端」：慢步速下跑出快上がり是常态，
         快步速还能跑出快上がり，才是真有末脚。 */
      for (const H of list) {
        if (H.t600 == null && H.s >= race.length - 600) H.t600 = race.t;
      }
      for (const H of list) {
        if (H.place || H.dnf) continue;
        if (H.s >= race.length) {
          H.s = race.length;
          H.place = race.order.length + 1;
          H.time = race.t;
          H.final3f = H.t600 != null ? race.t - H.t600 : null;
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
        /* 步速播报：参赛表上就能数出几匹逃马，所以节奏本来就是公开信息
           （现实中马评家也正是靠这个判读展开）。 */
        if (lf >= 0.32) {
          eventOnce('pace', '本场步速：' + race.paceLevel +
            '（等效争抢 ' + race.paceStrength.toFixed(2) + '）');
        }
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
        paceLevel: race.paceLevel, paceStrength: race.paceStrength,
        leader: list[0] ? list[0].id : null,
        leaderProgress: list[0] ? list[0].s / race.length : 0,
        events: race.events.slice(-10),
        order: race.order.map((H) => H.id),
        horses: race.horses.map((H) => ({
          id: H.id, name: H.name, s: H.s, t: H.t, v: H.v, pot: H.pot,
          rank: H.place ? H.place : (H.dnf ? null : list.indexOf(H) + 1),
          stage: H.stage, stamina: H.stamina, guts: H.guts,
          staminaMax: H.staminaMax, gutsMax: H.gutsMax,
          retention: H.retention,
          action: H.action, dnf: H.dnf, place: H.place, time: H.time,
          blocked: H.blocked, style: H.style, gapAtWin: H.gapAtWin,
          final3f: H.final3f,
        })),
      };
    }

    return {
      race, step, snapshot,
      state: () => snapshot(),
    };
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
      /* 场次档次取区间中点，同场马之间只差 ±FIELD_LEVEL_SPAN */
      const base = (tierDef.level[0] + tierDef.level[1]) / 2;
      const level = base + (rng() * 2 - 1) * FIELD_LEVEL_SPAN;
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
    RACE_F, drainDistanceCoef, staminaBudget, rangeCoef, powerDrainCoef,
    STAMINA_RANGE_PER_POINT, GROUND_RANGE_COEF,
    STYLE_COEF, STYLE_COEF_DOC, JOCKEY_BONUS, JOCKEY_CADENCE, FIELD_STATE_COEF, SURFACE_COEF,
    ACTION_DEF, actionBonus, baseSpeed, fatigueMultiplier,
    trackGeometry, trackPoint, kAt, bendCoefFor, SLOPE_PROFILES, gradientAt,
    TIER_LABELS, tierIdx, tierText, COMMENT_TABLES,
    STAFF, CAT_ERROR_POOL, catText, fatigueBand, fatigueText,
    makeHorse, makeField, makeStaff, generateReport, oddsAndPopularity,
    /* 人气/赔率模型（市场）：独立于比赛引擎，只吃公开信息 */
    MARKET, marketEntryScore, marketOddsAndPopularity, marketImpliedProb, expectedValue,
    marketPaceLevel, PACE_TRUE_EFFECT, paceStrengthOf, PACE_WEIGHT,
    makeName, createRace,
    RACE_TIERS, TIER_BY_KEY, TIER_RANK, FIELD_LEVEL_SPAN, TRAINING_DEF, PRIZE_SHARE, prizeForPlace, makeRaceName,
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
