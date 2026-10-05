# v11 预测与动作执行：第二轮只读工程评审

源 SHA256：`675c31be6d606704663cc422d81da7ff2e0254cc62780dc30bde2ef03db96cab`；输入 SHA256：`07d4d79401f0a2d09a5d75850c746e2266464172d2448e26c8e01e812f0b08e0`。4 次短期执行、1176 帧。生产及 controller fixture 均未修改；instrumentation 对照误差 0。

本检查使用构造场景，区分代码可达反例、潜在 API 边界和预测控制本来允许的假设；不把它们宣称为自然比赛的现实偏差根因。

## Pre-fix wake omission: same request automatically drafts in execution

类型：counterexample。

Pre-fix omission reproduced by the declared one-line ablation. It does not prove a natural follow decision, real field effect, or that every future wake persists.

## Pre-fix re-observation starting in catch loses inherited leader

类型：counterexample。

Original omitted catch leader inherits within the original follow+catch call. A new continuation call has an empty observation map, so omission cannot inherit the prior call. Conservative energy bias; cancellation is not established by this case.

## Current continuation handling of explicit null

类型：latent-api-edge-case。

Current generator stores follow and omitted-leader catch only; appended leader:null settle is forecast-only. This explicit-null riderSequence is constructed, not a demonstrated natural sequence.

## Current baseline and catch first action observe existing wake

类型：fix-validated。

First finite action now receives the current observable wake, including when entering catch. The appended null settle tail remains a conservative forecast assumption; not a committed action.

## Forecast-only settle tail is not committed by riderSequence

类型：source-invariant。

Model predictive control may legitimately assume a settle tail before replanning. Scoring that tail is not a guarantee it will be executed, and should not be described as a committed3-stage sequence.

## 积分分辨率证据

|状态|dt/s|位置误差/m|速度误差/(m/s)|净储备耗能误差|
|---|---:|---:|---:|---:|
|gate|0.06|0.167080|-0.003692|0.823494|
|gate|0.12|0.392206|-0.009074|1.916717|
|gate|0.24|0.828533|-0.020717|4.023300|
|settled|0.06|0.011170|-0.005711|0.026921|
|settled|0.12|0.026404|-0.013701|0.060687|
|settled|0.24|0.056017|-0.029932|0.116225|
|low-reserve|0.06|-0.003724|0.000809|-0.024100|
|low-reserve|0.12|-0.007924|0.002011|-0.058357|
|low-reserve|0.24|-0.015772|0.004294|-0.123291|
|lateral|0.06|0.081826|-0.005515|0.403890|
|lateral|0.12|0.192437|-0.013261|0.939564|
|lateral|0.24|0.411176|-0.029088|1.975944|
|hill|0.06|0.042471|-0.009756|0.132271|
|hill|0.12|0.100994|-0.023173|0.315775|
|hill|0.24|0.216408|-0.050736|0.661232|

不能仅为了 CPU 放宽有限预测步长。先用粗候选筛选，再对最终候选、接近追回目标或碰撞边界的候选以60Hz复核，能把精度集中在硬约束上。跨状态缓存必须纳入 race.t/startDelay、路线及风、供氧、储备、guts、速度、横位和可见对手信息；本报告只验证完全相同输入的缓存不会改变结果。

生产开末源相同：true；失败 0 个，全部保存。CPU 是热身墙钟小样本，可能受并行任务影响。

复现：`node tests/prediction-execution-review-v11.js`。完整输入、反例账目、dt误差和微基准见 [JSON](prediction-execution-review-v11.json)。
