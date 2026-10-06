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
    "'use strict';\nglobalThis.__P={calls:0,hits:0,clears:0,tbl:0,rsi:0,lane:0,raa:0,raaIters:0,rkp:0};",
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
      const propose=v=>{if(!proposalCache.has(v))proposalCache.set(v,raceKinematicProposal(H,before,v,targetT,dt,fraction,supply.aerobic));return proposalCache.get(v);};""",
    'rkp', required=False)

io.open(dst, 'w', encoding='utf-8', newline='').write(s)
print('已生成 ' + dst + '（CAP=' + cap + '）')
