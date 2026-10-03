#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),input=path.join(ROOT,'docs/traffic-optimized-final-v9.json');
const r=JSON.parse(fs.readFileSync(input,'utf8'));
const {validateRow}=require('./traffic-optimized-final-v9');
assert(r.complete&&r.allExactEqual&&r.allStagesExactEqual&&r.sourceUnchanged);
assert.equal(r.rows.length,8);assert.equal(r.engineHash,'3b837b46bf03ed86a19fdbe0ff83a03bb4fd2211ff9a4692b2f1a78e12f221ff');
assert.equal(r.beforeHash,'ac9dc7f3f8d9a6bf001ad6aef979021b3e7d59a9c5d5cdf36dd7884182f99d84');
r.rows.forEach(validateRow);
const rows=r.rows.map(row=>{
 const c=row.config,b=row.before,a=row.after;
 return `| ${c.course} ${c.length}m / ${c.n}匹 / ${c.seconds?c.seconds+'秒前缀':'完整比赛'} | ${b.cpuSeconds.toFixed(3)} → ${a.cpuSeconds.toFixed(3)} | ${b.wallSeconds.toFixed(3)} → ${a.wallSeconds.toFixed(3)} | ${(b.cpuSeconds/a.cpuSeconds).toFixed(2)}× | ${a.p95.toFixed(2)}ms | ${a.max.toFixed(2)}ms |`;
});
const whole=r.rows.filter(row=>!row.config.seconds);
assert.equal(whole.length,2);assert(whole.every(row=>row.before.finished&&row.after.finished));
const frames=r.rows.reduce((sum,row)=>sum+row.after.frames,0);
const text=`# 交通求解优化：修复航向后的最终验收

本对照的两侧都采用修复后的连续航向。参考源码为 \`${r.beforeHash}\`，最终数值源码为 \`${r.engineHash}\`。旧版 atan2 分支在少数弯直接点会凭空增加一整圈航向，影响外道弧长与逆解；其失败证据与修复见 [航向接点测试](route-heading-junction-v9.json)。旧44版本的部分大矩阵数据保留为历史记录，不能当作最终源码验证。

最终优化使用实际两匹马车道与停止路线范围的 Bezier 导数包络、正负曲率分开的度量界和自适应时间区间正证。只能证明整个区间保持身体与反应空间时才跳过该区间的昂贵极小值求根；无法证明的原始区间保留完整搜索。正证不提前计入未来才产生的有利航向变化。惰性制动轨迹保留原来的逐段运算顺序；历史最近时刻只用于查找负证；精确车道系数缓存不对位置取整。所有速度二分仍最多28次。

六个前缀与两场完整比赛共 **${frames.toLocaleString('en-US')} 帧**。每匹马每帧的8项数值最大误差为0；运动、骑手命令、阻挡状态、实际做功、储备与疲劳、交通标志、分段和终点数据的扩展逐帧哈希也完全相同。完整标准1200米与京都外3200米均全场完赛，全部马的完赛秒数、末600米和各分段完全相同。保守的 \`race.traffic\` 间距下界诊断可变得更紧，未把这类诊断列为逐位相同。

| 场景 | CPU秒：参考 → 优化 | 墙钟秒：参考 → 优化 | CPU比值 | 优化帧P95 | 优化最大帧 |
|---|---:|---:|---:|---:|---:|
${rows.join('\n')}

CPU秒与墙钟秒包含此Node测试的记录与哈希工作，帧时长只测 \`step(1/60)\`；检查点序列化在该阶段测时之外。每个案例按参考、优化两侧顺序执行，其他试算可同时运行，测时依赖硬件、JIT、GC与负载。已有7个合法案例从严格检查过的原记录恢复，最后的京都3200米整场单独继续；表中各阶段保留原始实际测时，没有把暂停间隔计入CPU或墙钟，也没有统一空载重测。它们是特定场景的计算证据，不能据此宣称浏览器渲染达到60FPS。密集场景仍有明显峰值。

检查点逐项核对两侧源码、协议、案例身份、帧数、完赛状态、分段完整性、逐帧扩展哈希和终点结果；新记录另带完整行校验和。旧格式仅接受已保存的7项原记录的固定内容哈希，不能通过删除新版校验字段降级。原记录的原始字节已保存为 [7项原检查点](traffic-optimized-final-v9-original7.json.gz)，SHA256为 \`2594c9c8ad7e475146e50ee997059c710d2cf3532bf1c08d6a40c1beec72fa99\`。完成参考阶段后先保存带内容哈希和数值轨迹的压缩检查点，再开始优化侧。未完成阶段不计为通过。检查点先写临时文件再原子替换；若中断恰好发生在阶段文件与报告注册之间，恢复时重新核验该孤立阶段文件。\`--check-resume\` 只检查；\`--resume\` 只运行剩余案例。阶段轨迹用于同机恢复的本地检查点；公开结果复验请运行不带恢复参数的完整驱动。专用27项检查点拒绝测试见 \`tests/traffic-performance-resume-v9.js\`。

500个独立完整域检查采用另一个修复航向、没有新增认证的参考快照，再关闭旧正证与负证提前退出；不能用同一个新认证当自己的完整域参考。细节见 [完整域数据](traffic-domain-review-v9.json)。[定向回归](traffic-optimization-proof-v9.json) 保留了“把终点有利航向收益提前使用”的失败用例，最终下界加入区间起点的0；另外检查一个合成负曲率 Hermite 单元，区分真实有符号车道度量与身体投影的非负曲率。这些有限测试没有声称穷尽所有浮点状态。

复验：\`node tests/traffic-optimized-final-v9.js\`；\`node tests/traffic-domain-review-v9.js --source-archive docs/system-numeric-source-3b837b-v9.js.gz --reference-source docs/system-heading-source-ac9dc7-v9.js.gz\`；\`node tests/traffic-optimization-proof-v9.js\`。完整比赛驱动与定向回归默认固定使用3b数值、ac9参考归档，独立域命令将二者显式列出。源码快照只供测试编译，游戏加载正常的 \`sim.js\`。本对照始终保持两份归档的原哈希；生产文件的两行旧档案入口迁移/复制，以及后续间距遥测谓词修复，由 [源码一致性证明](source-snapshot-equivalence-v9.json) 与 [间距边界遥测审计](traffic-slack-boundary-v9.json) 单独承接，不能把本数据改标成新的生产源码哈希。
`;
fs.writeFileSync(path.join(ROOT,'docs/traffic-optimized-final-v9.md'),text);
console.log(JSON.stringify({complete:true,frames,wholeRaces:2,shortCases:6,engineHash:r.engineHash}));
