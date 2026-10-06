#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""给引擎副本注入内部计数器，用于回答结构性问题（命中率、调用次数）。

用法：python tests/perf-instrument-v11.py <输入.js> <输出.js> [CAP]
注入：
  __P.calls            routeArcState 调用次数
  __P.hits             routeArcState 缓存命中次数
  __P.clears           缓存清空次数（cache.size >= CAP 时）
  __P.tbl              routeTablePoint 调用次数
  __P.rsi              routeStationLowerIndex 调用次数
  __P.lane             laneAdvance 调用次数
  __P.raa              referenceArcAt 调用次数
  __P.raaIters         referenceArcAt 二分比较总次数
  __P.rkp              raceKinematicProposal 调用次数（含重复计算）
  __P.memo1            （可选）routeArcState 一级「最近一次」记忆命中次数
CAP 默认 4096，用于实验「缓存上限」对命中率的影响。
"""
import io, sys

src, dst = sys.argv[1], sys.argv[2]
cap = sys.argv[3] if len(sys.argv) > 3 else '4096'
s = io.open(src, encoding='utf-8').read()

def sub(old, new, label, required=True):
    global s
    if old not in s:
        assert not required, '锚点缺失: ' + label
        return
    assert s.count(old) == 1, '锚点不唯一: ' + label
    s = s.replace(old, new, 1)

sub("'use strict';",
    "'use strict';\nglobalThis.__P={calls:0,hits:0,clears:0,tbl:0,rsi:0,lane:0,raa:0,raaIters:0,rkp:0,"
    "pm:0,pm_d:0,pm_n:0,prop_d:0,prop_n:0,pwr_d:0,pwr_n:0,pwr_enter:0,pw_t:0,pw_f:0,"
    "fw_bis:0,fw_t:0,fw_f:0,tr_pairs:0,tr_steps:0,tr_opp:0,quad:0,q_pt:0,lrp:0,headwind:0,dt_tail:0,dt_fine:0,dt_coarse:0,dt_dv:0,dt_st:0,dt_sl:0};",
    'counters')

sub("""    let cache=ROUTE_STATE_VALUE_CACHE.get(geo);
    if(!cache){cache=new Map();ROUTE_STATE_VALUE_CACHE.set(geo,cache);}
    if(cache.has(s))return cache.get(s);""",
    """    let cache=ROUTE_STATE_VALUE_CACHE.get(geo);
    if(!cache){cache=new Map();ROUTE_STATE_VALUE_CACHE.set(geo,cache);}
    globalThis.__P.calls++;
    const __hit=cache.get(s);
    if(__hit!==undefined){globalThis.__P.hits++;return __hit;}""",
    'routeArcState')

sub("    if(cache.size>=4096)cache.clear();",
    "    if(cache.size>=" + cap + "){cache.clear();globalThis.__P.clears++;}",
    'cache-cap')

sub("  function routeTablePoint(samples,step,at) {\n    let i,f;",
    "  function routeTablePoint(samples,step,at) {\n    globalThis.__P.tbl++;\n    let i,f;", 'tbl')

sub("  function routeStationLowerIndex(stations,at) {\n    const last=stations.length-1,first=stations[0],end=stations[last];",
    "  function routeStationLowerIndex(stations,at) {\n    globalThis.__P.rsi++;\n    const last=stations.length-1,first=stations[0],end=stations[last];", 'rsi')

sub("    const stateAt=geo.route?routeArcState:abstractArcState,origin=stateAt(s,geo),initialCoef=laneProgressCoef(s,t,geo);",
    "    globalThis.__P.lane++;\n    const stateAt=geo.route?routeArcState:abstractArcState,origin=stateAt(s,geo),initialCoef=laneProgressCoef(s,t,geo);", 'lane')

sub("  function referenceArcAt(table,q) {\n    if(q<=0) return q;",
    "  function referenceArcAt(table,q) {\n    globalThis.__P.raa++;\n    if(q<=0) return q;", 'raa')

sub("    while(hi-lo>1){const mid=(lo+hi)>>1;if(table.q[mid]<=q)lo=mid;else hi=mid;}\n    return table.arc[lo]+referenceArcIntegral(table.pointAt,table.q[lo],q);",
    "    while(hi-lo>1){const mid=(lo+hi)>>1;if(table.q[mid]<=q)lo=mid;else hi=mid;globalThis.__P.raaIters++;}\n    return table.arc[lo]+referenceArcIntegral(table.pointAt,table.q[lo],q);", 'raaLoop')

sub("""      const propose=v=>{if(!proposalCache.has(v))proposalCache.set(v,raceKinematicProposal(H,before,v,targetT,dt,fraction,supply.aerobic));return proposalCache.get(v);};""",
    """      globalThis.__P.rkp++;
      const propose=v=>{globalThis.__P[demand?'prop_d':'prop_n']++;if(!proposalCache.has(v))proposalCache.set(v,raceKinematicProposal(H,before,v,targetT,dt,fraction,supply.aerobic));return proposalCache.get(v);};""",
    'rkp', required=False)

# ---- 拆分「提案次数」的两条来源路径：候选动作评估（demand=false）vs 预算投影（demand=true）
sub("    function projectionMove(H,requestedV,requestedT,drafting,dt,time,demand=false,front=null,traffic=[]) {\n      const before={s:H.s,t:H.t,v:H.v},supply=raceSupplyState(H,dt);",
    "    function projectionMove(H,requestedV,requestedT,drafting,dt,time,demand=false,front=null,traffic=[]) {\n      globalThis.__P.pm++;globalThis.__P[demand?'pm_d':'pm_n']++;\n      const before={s:H.s,t:H.t,v:H.v},supply=raceSupplyState(H,dt);",
    'projectionMove')

sub("          for(let n=0;n<28;n++) {const mid=(low+high)/2;if(motionPower(H,before,propose(mid),drafting,dt)<=supply.maxPower) low=mid;else high=mid;}",
    "          globalThis.__P[demand?'pwr_d':'pwr_n']++;\n          for(let n=0;n<28;n++) {const mid=(low+high)/2;if(motionPower(H,before,propose(mid),drafting,dt)<=supply.maxPower) {low=mid;globalThis.__P.pw_t++;}else {high=mid;globalThis.__P.pw_f++;}}",
    'power-bisection')

sub("            for(let n=0;n<28;n++){const mid=(low+high)/2;if(followingSlack(H,F,propose(mid),fm)>=0)low=mid;else high=mid;}",
    "            globalThis.__P.fw_bis++;\n            for(let n=0;n<28;n++){const mid=(low+high)/2;if(followingSlack(H,F,propose(mid),fm)>=0){low=mid;globalThis.__P.fw_t++;}else {high=mid;globalThis.__P.fw_f++;}}",
    'following-bisection', required=False)

# ---- traffic 相关：每个投影步要处理多少对手 / 多少马对
sub("        const traffic=activeVisible.map(F=>({h:F,before:{s:F.s,t:F.t,v:F.v},move:observedMove(F,dt,atTime+elapsed)}));",
    "        globalThis.__P.tr_pairs+=activeVisible.length*(activeVisible.length-1)/2;globalThis.__P.tr_steps++;globalThis.__P.tr_opp+=activeVisible.length;\n        const traffic=activeVisible.map(F=>({h:F,before:{s:F.s,t:F.t,v:F.v},move:observedMove(F,dt,atTime+elapsed)}));",
    'traffic', required=False)

# ---- 五点求积的调用量：它只读 .metric，却调用了完整的 routeTablePoint
sub("    return (b-a)*ARC_QUADRATURE.reduce((sum,[at,weight])=>sum+weight*(pointAt(a+(b-a)*at).metric??1),0);",
    "    globalThis.__P.quad++;globalThis.__P.q_pt+=5;\n    return (b-a)*ARC_QUADRATURE.reduce((sum,[at,weight])=>sum+weight*(pointAt(a+(b-a)*at).metric??1),0);",
    'quadrature', required=False)

sub("  function loopReferencePoint(q,loop) {",
    "  function loopReferencePoint(q,loop) {\n    globalThis.__P.lrp++;",
    'loopReferencePoint', required=False)

# ---- 投影步的 dt 分布：`finishPlan` 占 96% 的投影步，须看清其中多少步是 0.05s 细步、
#      以及由哪个条件触发（决定「减少投影步数」是否有戏）。
sub("          if(isTail&&(Math.abs(action.targetV-local.v)>0.8||local.stamina/local.staminaMax<0.15||local.v<3)) dt=Math.min(dt,0.05);",
    "          if(isTail){const __dv=Math.abs(action.targetV-local.v)>0.8,__st=local.stamina/local.staminaMax<0.15,__sl=local.v<3;\n"
    "            globalThis.__P.dt_tail++;\n"
    "            if(__dv)globalThis.__P.dt_dv++;if(__st)globalThis.__P.dt_st++;if(__sl)globalThis.__P.dt_sl++;\n"
    "            if(__dv||__st||__sl){dt=Math.min(dt,0.05);globalThis.__P.dt_fine++;}else globalThis.__P.dt_coarse++;}",
    'dt-rule', required=False)

sub("    function headwindAt(at) {",
    "    function headwindAt(at) {\n      globalThis.__P.headwind++;",
    'headwindAt', required=False)

io.open(dst, 'w', encoding='utf-8', newline='').write(s)
print('已生成 ' + dst + '（CAP=' + cap + '）')
