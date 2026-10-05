# v11 最终引擎机制回归

执行源：`309e6ad6f5c2892d8cfbcc679e08bc4613578ecb764f505d649e6304365c9ce9`。结果：**FAIL**。

所有入口按顺序执行；每项旧报告先验证归档，新报告和日志再保存至同一运行目录。失败、缺失报告和源码变化均保留，不能用旧结果补齐。

|入口|结果|检查数|墙钟秒|
|---|---|---:|---:|
|prediction-consistency|passed|12|1.828|
|rider-route-planning|passed|15|1.854|
|rider-planning|failed|—|0.401|
|finalcoarse-focused|passed|10|1.319|
|rank-focused|passed|6|0.351|
|controller-review|passed|10|1.183|
|sequence-safety-focused|passed|10|0.948|

此表验证预测、路线、规划和公开信息使用的机制。这里的小场控制回放、粗筛 stub 和微基准不构成赛场群体数值验收；最终群体测试另行记录。

[完整结果](final-engine-regressions-v11.json) · [本次归档](final-engine-regressions-v11-history/2026-10-04T05-49-36-443Z-309e6ad6f5c2-jlWfKc/run.json)

复现：`node tests/final-engine-regressions-v11.js --run --expected-source 309e6ad6f5c2892d8cfbcc679e08bc4613578ecb764f505d649e6304365c9ce9`。
