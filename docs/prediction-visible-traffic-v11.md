# 可见交通预测的一致性验证 v11

实际源 SHA256 e1bd832dbe954407d9fa7c44a12aa535881d8e2ab46fee8cb6a234033ccdb56f；候选 e1bd832dbe954407d9fa7c44a12aa535881d8e2ab46fee8cb6a234033ccdb56f。生产未由此脚本修改。

12/12 检查通过。46 次预测，9 次构造回放，1620 实际帧。

- Actual pure following extraction preserves every tick: headway：passed
- Actual pure following extraction preserves every tick: twoFronts：passed
- Actual pure following extraction preserves every tick: lateral：passed
- Prediction matches 180 actual ticks with visible constant-motion peers: headway：passed
- Prediction matches 180 actual ticks with visible constant-motion peers: twoFronts：passed
- Prediction matches 180 actual ticks with visible constant-motion peers: leavingWake：passed
- Closest wake/front is selected each step and an explicit leader is not counted twice：passed
- Visible opponent API does not read hidden physiology, intentions or performance：passed
- Opponent arrays are authoritative; omitted arrays retain legacy single-leader compatibility：passed
- Observed lateral motion enters and leaves corridors rather than staying frozen：passed
- A peer crossing the finish remains in this step and is excluded next step：passed
- Non-overlapping but physically infeasible following is reported, with finite braking and no hard relocation：passed

| 有限10.8秒预测 | 对手 | dt | 中位CPU毫秒 | p90毫秒 |
| --- | --- | --- | --- | --- |
| Binding same-lane headway | 1 | 0.016666666666666666 | 874.617 | 1101.933 |
| Two visible fronts | 2 | 0.016666666666666666 | 723.890 | 885.076 |
| Far visible front | 1 | 0.016666666666666666 | 6.460 | 19.015 |

共享的是实际两体停止与响应约束；观察只允许位置、速度、加速度、横移和可见身体尺寸。对手未来按有界观察运动外推，不读取指令或生理。无解返回 trafficFeasible=false/pathConflict=true，并保存有限制动失败状态；没有事后位置钳制。全场同步横移否决、对手相互回应和再观察不属于此预测，因此 trafficCertified 始终 false。

全部输入、脚本、安装器和源哈希及逐帧摘要在机器报告中；源和候选压缩快照同时保留。这些固定控制构造测试验证工程一致性，不是现实人群拟合证据。
