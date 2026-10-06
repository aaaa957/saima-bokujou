#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成性能改动的单变量变体，用于逐个验证（tests/perf-ab-v11.js）。

每个变体都是在基线（git ref）之上**只应用一处改动**的 sim.js 副本。
目的是分清「哪一处有效、哪一处反而更慢」——实测出现过一组自认为等价的
改动合起来反而慢 12% 的情况。

用法：python tests/perf-make-variants-v11.py [git-ref]
产出：.perf/base.js, .perf/p1a.js, .perf/p1b.js, .perf/p2.js, .perf/p3.js,
      .perf/propose.js
"""
import io, os, subprocess, sys

REF = sys.argv[1] if len(sys.argv) > 1 else '3890177'
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.perf')
os.makedirs(out_dir, exist_ok=True)

base = subprocess.run(['git', 'show', REF + ':sim.js'], cwd=os.path.join(out_dir, '..'),
                      capture_output=True, check=True).stdout.decode('utf-8')

def write(name, text):
    io.open(os.path.join(out_dir, name), 'w', encoding='utf-8', newline='').write(text)
    print('  ' + name)

def apply(text, patches):
    for label, old, new in patches:
        assert old in text, '锚点缺失 (' + label + ')'
        assert text.count(old) == 1, '锚点不唯一 (' + label + ')'
        text = text.replace(old, new, 1)
    return text

# ---------------------------------------------------------------- 原始片段
OLD_COMPONENT = """    const a=samples[i],b=samples[i+1];
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
    return {x:x.p,y:y.p,tx:x.v/n,ty:y.v/n,k:Math.max(0,(x.v*y.a-y.v*x.a)/(n*n*n)),metric:n};"""

HOIST_ANCHOR = """    return lo;
  }
  function routeTablePoint(samples,step,at) {"""

HOIST_FN_OBJ = """    return lo;
  }
  // 变体 P1a：只把内层闭包提到模块作用域（仍返回 {p,v,a} 对象）。
  function routeHermiteComponent(p0,p1,v0,v1,acc0,acc1,step,f) {
    const A=p0,B=step*v0,C=0.5*step*step*acc0,p=p1-A-B-C,v=step*v1-B-2*C,acc=step*step*acc1-2*C;
    const D=10*p-4*v+0.5*acc,E=-15*p+7*v-acc,F=6*p-3*v+0.5*acc;
    return {p:((((F*f+E)*f+D)*f+C)*f+B)*f+A,
      v:((((5*F*f+4*E)*f+3*D)*f+2*C)*f+B)/step,
      a:(((20*F*f+12*E)*f+6*D)*f+2*C)/(step*step)};
  }
  function routeTablePoint(samples,step,at) {"""

NEW_P1A = """    const a=samples[i],b=samples[i+1];
    const x=routeHermiteComponent(a.x,b.x,a.tx,b.tx,-a.k*a.ty,-b.k*b.ty,step,f),y=routeHermiteComponent(a.y,b.y,a.ty,b.ty,a.k*a.tx,b.k*b.tx,step,f),n=Math.hypot(x.v,y.v);
    return {x:x.p,y:y.p,tx:x.v/n,ty:y.v/n,k:Math.max(0,(x.v*y.a-y.v*x.a)/(n*n*n)),metric:n};"""

HOIST_FN_SCRATCH = """    return lo;
  }
  // 变体 P1b：提取闭包 + 用模块级 scratch 传回结果（无对象分配）。
  let _RTP_p=0,_RTP_v=0,_RTP_a=0;
  function routeHermiteComponent(p0,p1,v0,v1,acc0,acc1,step,f) {
    const A=p0,B=step*v0,C=0.5*step*step*acc0,p=p1-A-B-C,v=step*v1-B-2*C,acc=step*step*acc1-2*C;
    const D=10*p-4*v+0.5*acc,E=-15*p+7*v-acc,F=6*p-3*v+0.5*acc;
    _RTP_p=((((F*f+E)*f+D)*f+C)*f+B)*f+A;
    _RTP_v=((((5*F*f+4*E)*f+3*D)*f+2*C)*f+B)/step;
    _RTP_a=(((20*F*f+12*E)*f+6*D)*f+2*C)/(step*step);
  }
  function routeTablePoint(samples,step,at) {"""

NEW_P1B = """    const a=samples[i],b=samples[i+1];
    routeHermiteComponent(a.x,b.x,a.tx,b.tx,-a.k*a.ty,-b.k*b.ty,step,f);
    const xp=_RTP_p,xv=_RTP_v,xa=_RTP_a;
    routeHermiteComponent(a.y,b.y,a.ty,b.ty,a.k*a.tx,b.k*b.tx,step,f);
    const yp=_RTP_p,yv=_RTP_v,ya=_RTP_a;
    const n=Math.hypot(xv,yv);
    return {x:xp,y:yp,tx:xv/n,ty:yv/n,k:Math.max(0,(xv*ya-yv*xa)/(n*n*n)),metric:n};"""

# P2：referenceArcAt 桶表定位
P2_TABLE_OLD = """    const q=nodes.filter((x,i)=>!i||x-nodes[i-1]>1e-9),arc=[0];
    for(let i=1;i<q.length;i++) arc.push(arc[i-1]+referenceArcIntegral(pointAt,q[i-1],q[i]));
    const result={q,arc,total:arc.at(-1),pointAt};ROUTE_ARC_CACHE.set(owner,result);return result;"""

P2_TABLE_NEW = """    const q=nodes.filter((x,i)=>!i||x-nodes[i-1]>1e-9),arc=[0];
    for(let i=1;i<q.length;i++) arc.push(arc[i-1]+referenceArcIntegral(pointAt,q[i-1],q[i]));
    let bins=null,binWidth=0;
    if(Number.isFinite(step)&&step>0&&q.length>1) {
      binWidth=step;bins=new Uint32Array(Math.ceil(q.at(-1)/step)+2);
      let cursor=0;
      for(let k=0;k<bins.length;k++) {
        const seed=k*step;
        while(cursor<q.length-1&&q[cursor+1]<=seed)cursor++;
        bins[k]=cursor;
      }
    }
    const result={q,arc,total:arc.at(-1),bins,binWidth,pointAt};ROUTE_ARC_CACHE.set(owner,result);return result;"""

P2_AT_OLD = """  function referenceArcAt(table,q) {
    if(q<=0) return q;if(q>=table.q.at(-1)) return table.total+q-table.q.at(-1);
    let lo=0,hi=table.q.length-1;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(table.q[mid]<=q)lo=mid;else hi=mid;}
    return table.arc[lo]+referenceArcIntegral(table.pointAt,table.q[lo],q);
  }"""

P2_AT_NEW = """  function referenceArcAt(table,q) {
    if(q<=0) return q;if(q>=table.q.at(-1)) return table.total+q-table.q.at(-1);
    const tq=table.q;let lo;
    if(table.bins) {
      const k=Math.floor(q/table.binWidth);
      lo=table.bins[k<table.bins.length?k:table.bins.length-1];
      while(lo>0&&tq[lo]>q)lo--;
      while(lo<tq.length-1&&tq[lo+1]<=q)lo++;
    } else {
      let hi=tq.length-1;lo=0;
      while(hi-lo>1){const mid=(lo+hi)>>1;if(tq[mid]<=q)lo=mid;else hi=mid;}
    }
    return table.arc[lo]+referenceArcIntegral(table.pointAt,tq[lo],q);
  }"""

# P3：routeArcState 单次 get
P3_OLD = """    if(!cache){cache=new Map();ROUTE_STATE_VALUE_CACHE.set(geo,cache);}
    if(cache.has(s))return cache.get(s);"""
P3_NEW = """    if(!cache){cache=new Map();ROUTE_STATE_VALUE_CACHE.set(geo,cache);}
    const cached=cache.get(s);
    if(cached!==undefined)return cached;"""

# propose：延迟建立提案缓存
PROPOSE_OLD = """      const proposalCache=new Map();
      const propose=v=>{if(!proposalCache.has(v))proposalCache.set(v,raceKinematicProposal(H,before,v,targetT,dt,fraction,supply.aerobic));return proposalCache.get(v);};"""
PROPOSE_NEW = """      let firstMove=null,firstV=0,hasFirst=false,proposalCache=null;
      const propose=v=>{
        if(hasFirst&&v===firstV)return firstMove;
        if(proposalCache!==null){const hit=proposalCache.get(v);if(hit!==undefined)return hit;}
        const made=raceKinematicProposal(H,before,v,targetT,dt,fraction,supply.aerobic);
        if(!hasFirst){hasFirst=true;firstV=v;firstMove=made;}
        else{if(proposalCache===null){proposalCache=new Map();proposalCache.set(firstV,firstMove);}proposalCache.set(v,made);}
        return made;
      };"""

P1B = [('p1b', OLD_COMPONENT, NEW_P1B), ('p1b-hoist', HOIST_ANCHOR, HOIST_FN_SCRATCH)]
P2 = [('p2-table', P2_TABLE_OLD, P2_TABLE_NEW), ('p2-at', P2_AT_OLD, P2_AT_NEW)]
P3 = [('p3', P3_OLD, P3_NEW)]
PROPOSE = [('propose', PROPOSE_OLD, PROPOSE_NEW)]

# ---------------------------------------------------------------- 方向 3
# followingBodyClearance 在每个投影步里为「每一对（自己,前方对手）」构造一个新对象，
# 而 8 个调用点里只有 1 个真正需要 lateral（其余只要 longitudinal）。
# 拆成两个「返回数字」的函数：lateral 与位置无关，longitudinal 保留原式。
D3_DEF_OLD = """    function followingBodyClearance(H,F,hs,fs,ht,ft) {
      const scale=Math.max(1,trafficProgressCoef(hs,ht),trafficProgressCoef(fs,ft));
      return {longitudinal:((followingBodyLength(H)+followingBodyLength(F))/2+0.20)*scale,
        lateral:(followingBodyWidth(H)+followingBodyWidth(F))/2+0.10};
    }"""
D3_DEF_NEW = """    function followingBodyLateral(H,F) {return (followingBodyWidth(H)+followingBodyWidth(F))/2+0.10;}
    function followingBodyLongitudinal(H,F,hs,fs,ht,ft) {
      const scale=Math.max(1,trafficProgressCoef(hs,ht),trafficProgressCoef(fs,ft));
      return ((followingBodyLength(H)+followingBodyLength(F))/2+0.20)*scale;
    }
    function followingBodyClearance(H,F,hs,fs,ht,ft) {
      return {longitudinal:followingBodyLongitudinal(H,F,hs,fs,ht,ft),lateral:followingBodyLateral(H,F)};
    }"""
D3_CALLS = [
 ('d3-lateral',
  """          const F=observed.h,fm=observed.move,clear=followingBodyClearance(H,F,before.s,observed.before.s,before.t,observed.before.t);
          const transverse=axisOverlap(observed.before.t-before.t,fm.t-move.t,clear.lateral);""",
  """          const F=observed.h,fm=observed.move,lateral=followingBodyLateral(H,F);
          const transverse=axisOverlap(observed.before.t-before.t,fm.t-move.t,lateral);"""),
 ('d3-a', "const now=frontMove.s-move.s-followingBodyClearance(H,F,move.s,frontMove.s,move.t,frontMove.t).longitudinal-response;",
           "const now=frontMove.s-move.s-followingBodyLongitudinal(H,F,move.s,frontMove.s,move.t,frontMove.t)-response;"),
 ('d3-b', "const stop=frontEnd-rearEnd-followingBodyClearance(H,F,rearEnd,frontEnd,move.t,frontMove.t).longitudinal-response;",
           "const stop=frontEnd-rearEnd-followingBodyLongitudinal(H,F,rearEnd,frontEnd,move.t,frontMove.t)-response;"),
 ('d3-c', "const witness= f.s-r.s-followingBodyClearance(H,F,r.s,f.s,move.t,frontMove.t).longitudinal-response;",
           "const witness= f.s-r.s-followingBodyLongitudinal(H,F,r.s,f.s,move.t,frontMove.t)-response;"),
 ('d3-d', "const body=followingBodyClearance(H,F,r.s,f.s,move.t,frontMove.t),gap=f.s-r.s-body.longitudinal;",
           "const gap=f.s-r.s-followingBodyLongitudinal(H,F,r.s,f.s,move.t,frontMove.t);"),
 ('d3-e', "const ca=followingBodyClearance(H,F,r.s+rv*(a-time),f.s+fv*(a-time),move.t,frontMove.t).longitudinal;",
           "const ca=followingBodyLongitudinal(H,F,r.s+rv*(a-time),f.s+fv*(a-time),move.t,frontMove.t);"),
 ('d3-f', "const cb=followingBodyClearance(H,F,r.s+rv*(b-time),f.s+fv*(b-time),move.t,frontMove.t).longitudinal;",
           "const cb=followingBodyLongitudinal(H,F,r.s+rv*(b-time),f.s+fv*(b-time),move.t,frontMove.t);"),
]
D3 = [('d3-def', D3_DEF_OLD, D3_DEF_NEW)] + D3_CALLS

# D3-sweep：projectionBodySweep 先判横向（不需路线查询）再判纵向。
# 它被 O(n²) 的同伴碰撞检查调用，而绝大多数马对并不相交 ——
# 原式先算纵向（要查两次路线几何）再与横向相与，浪费掉这些查询。
D3_SWEEP_OLD = """    function projectionBodySweep(H,F,before,frontBefore,move,frontMove) {
      const clear=followingBodyClearance(H,F,(before.s+move.s)/2,(frontBefore.s+frontMove.s)/2,(before.t+move.t)/2,(frontBefore.t+frontMove.t)/2);
      const longitudinal=axisOverlap(frontBefore.s-before.s,frontMove.s-move.s,clear.longitudinal);
      const lateral=axisOverlap(frontBefore.t-before.t,frontMove.t-move.t,clear.lateral);
      return !!longitudinal&&!!lateral&&Math.min(longitudinal[1],lateral[1])-Math.max(longitudinal[0],lateral[0])>1e-9;
    }"""
D3_SWEEP_NEW = """    function projectionBodySweep(H,F,before,frontBefore,move,frontMove) {
      // 横向余量只取决于两匹马的体宽，不需要查路线几何；先判横向，可在绝大多数
      // （并不相交的）马对上省掉两次路线查询。逻辑与原先的
      // `!!longitudinal&&!!lateral&&…` 完全等价：两者都非空才继续，故数值逐位一致。
      const lateral=axisOverlap(frontBefore.t-before.t,frontMove.t-move.t,followingBodyLateral(H,F));
      if(!lateral)return false;
      const longitudinal=axisOverlap(frontBefore.s-before.s,frontMove.s-move.s,
        followingBodyLongitudinal(H,F,(before.s+move.s)/2,(frontBefore.s+frontMove.s)/2,(before.t+move.t)/2,(frontBefore.t+frontMove.t)/2));
      return !!longitudinal&&Math.min(longitudinal[1],lateral[1])-Math.max(longitudinal[0],lateral[0])>1e-9;
    }"""
D3_SWEEP = [('d3-sweep', D3_SWEEP_OLD, D3_SWEEP_NEW)]

# rsi：routeStationLowerIndex 每次调用都做一次 WeakMap 查询（实测 10.4M 次 / 300 步），
# 而它几乎总是被同一个 stations 数组重复调用。加一级「最近一次」记忆即可省掉这些查询。
# 纯记忆化，数值必然一致。
RSI_OLD = """    let lookup=ROUTE_STATION_LOOKUP_CACHE.get(stations);
    if(!lookup) {
      const bins=new Uint32Array(Math.ceil(end-first));let lo=0;
      for(let bin=0;bin<bins.length;bin++) {
        const seed=first+bin;
        while(lo<last-1&&stations[lo+1]<=seed)lo++;
        bins[bin]=lo;
      }
      lookup={first,bins};ROUTE_STATION_LOOKUP_CACHE.set(stations,lookup);
    }"""
RSI_NEW = """    let lookup;
    if(stations===_rsiLastStations)lookup=_rsiLastLookup;
    else {
      lookup=ROUTE_STATION_LOOKUP_CACHE.get(stations);
      if(!lookup) {
        const bins=new Uint32Array(Math.ceil(end-first));let lo=0;
        for(let bin=0;bin<bins.length;bin++) {
          const seed=first+bin;
          while(lo<last-1&&stations[lo+1]<=seed)lo++;
          bins[bin]=lo;
        }
        lookup={first,bins};ROUTE_STATION_LOOKUP_CACHE.set(stations,lookup);
      }
      _rsiLastStations=stations;_rsiLastLookup=lookup;
    }"""
RSI = [('rsi-decl', "  function routeStationLowerIndex(stations,at) {",
                    "  let _rsiLastStations=null,_rsiLastLookup=null;\n  function routeStationLowerIndex(stations,at) {"),
       ('rsi-body', RSI_OLD, RSI_NEW)]

print('基线 ' + REF + '，生成变体：')
write('base.js', base)
write('p1a.js', apply(base, [('p1a', OLD_COMPONENT, NEW_P1A), ('p1a-hoist', HOIST_ANCHOR, HOIST_FN_OBJ)]))
write('p1b.js', apply(base, P1B))
write('p2.js', apply(base, P2))
write('p3.js', apply(base, P3))
write('propose.js', apply(base, PROPOSE))
# 组合：拆解「哪一处附加改动吃掉了 p1b 的收益」
write('p1b_p2.js', apply(base, P1B + P2))
write('p1b_p3.js', apply(base, P1B + P3))
write('p2_p3.js', apply(base, P2 + P3))
write('p1b_propose.js', apply(base, P1B + PROPOSE))
write('p1b_p2_p3.js', apply(base, P1B + P2 + P3))
write('good.js', apply(base, P1B + P3 + PROPOSE))
write('d3.js', apply(base, D3))
write('d3sweep.js', apply(base, D3_SWEEP))
write('p1b_p3_d3.js', apply(base, P1B + P3 + D3))
# 候选终态：实测表明这些改动之间存在**强非加性交互**（V8 内联决策随组合翻转，
# 可差 ±10–20%），因此组合只能枚举实测，不能靠推理相加。
write('c1.js', apply(base, P1B + P2 + P3 + D3))
write('c2.js', apply(base, P1B + P2 + P3 + D3 + D3_SWEEP))
write('c3.js', apply(base, P1B + P2 + P3 + D3 + D3_SWEEP + PROPOSE))
write('c4.js', apply(base, D3 + D3_SWEEP))
write('c5.js', apply(base, D3 + D3_SWEEP + PROPOSE))
write('rsi.js', apply(base, RSI))
write('c1_rsi.js', apply(base, P1B + P2 + P3 + D3 + RSI))
write('c6.js', apply(base, P1B + P2 + P3 + D3 + RSI + PROPOSE))
# 「严格更少工作」的候选：每一项都只减少操作/分配，不改数值。
#  - P1B: routeTablePoint 每次调用少建 1 个闭包 + 2 个对象
#  - P2 : referenceArcAt 用桶表定位代替平均 11.92 次二分
#  - P3 : routeArcState 用 1 次 Map 查询代替 has+get
#  - D3 : followingBodyClearance 拆为返回数字的函数，少建对象；横向不查路线
#  - PROPOSE: projectionMove 的提案缓存改为按需创建（最热路径只提一次案）
write('cand.js', apply(base, P1B + P2 + P3 + D3 + PROPOSE))
print('完成')

