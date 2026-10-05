# v11 压缩归档读取与最终重建

大历史报告只提交无损`.gz`，本地原始文件仍保留。以下命令显式读取仓库中的压缩输入，不依赖ignored raw文件；源码、driver与orchestrator快照的文件名前缀保留原`.json`，例如`headway.json.source.js.gz`，不是`headway.json.gz.source.js.gz`。字节证明见[validation-archives-v11.json](validation-archives-v11.json)。

## 只读审计与派生报告

```text
node tests/check-validation-v11.js --input docs/race-validation-v11-baseline-external.json.gz
node tests/check-validation-v11.js --input docs/calibration-screen-v11-headway.json.gz --allow-incomplete
node tests/summarize-calibration-v11.js --input docs/calibration-screen-v11-headway.json.gz --allow-incomplete --out docs/reproduced-headway-summary-v11.json
node tests/follow-coarse-screen-summary-v11.js --input docs/follow-coarse-screen-partial-v11.json.gz --out docs/reproduced-follow-summary-v11.json
node tests/wait-route-continuation-summary-v11.js --input docs/wait-route-continuation-partial-v11.json.gz --out docs/reproduced-wait-summary-v11.json
node tests/validation-resume-v11.js --input docs/race-validation-v11-baseline-external.json.gz
node tests/archive-readers-v11-checks.js
node tests/release-fixture-v11-checks.js
```

上述操作不步进引擎。follow/wait摘要只写新派生文件，保留历史测量、执行driver及当时的processor元数据，当前归约器hash另存`regeneratedSummary`。输入报告和其raw同名文件禁止作为摘要输出；不要覆盖原实验。`archive-readers`使用显式`.gz`、一个只有gzip而没有raw的临时构造，并核对归档前后字节hash，不需要再拉第二份仓库。

旧`validation-resume-v11.js`对压缩旧基线使用临时解压副本，只读核对历史定义应被拒绝，原归档不写。活动validator仍写raw checkpoint，不将历史`.gz`作为`--resume --out`写入目标。`record-exploratory-stop-v11.js`是当次行政停止的操作记录生成器，不能为“复现”重写历史停止时间或PID；其证据由stopproof及检查点gzip审计。

## 历史物理实验的来源检查

```text
node tests/follow-coarse-screen-partial-v11.js --input docs/calibration-screen-v11-headway.json.gz --source docs/follow-coarse-screen-partial-v11.json.source.js.gz --check-source
node tests/traffic-cpu-full-replay-v11.js --input docs/calibration-screen-v11-headway.json.gz --source docs/traffic-cpu-full-replay-v11.json.source.js.gz --check-source
node tests/wait-route-continuation-partial-v11.js --input docs/follow-coarse-screen-partial-v11.json.gz --check-source
```

这三个命令仅检验冻结输入、旧源hash和固定生成器，不运行比赛。生成器读取历史Git提交`582ce9046dd8552d950d0296e8500a8234388eff`，完整克隆包含该历史；浅克隆需先取得对应历史。CPU replay保留旧`d0fea99e…`守卫，不能拿当前骑手源码冒充当时的CPU等价复现。若确需重跑旧实验，去掉`--check-source`并提供新的`--out`路径；这会新增物理执行，要单列计数，不能覆盖历史记录或并入最终现实验收。

## 51ca基线至最终引擎的精确重建

`tests/cohort-fixture-proof-v11.js`从已提交的`race-validation-v11-baseline-external.json.source.js.gz`读取`51ca…`基线，依次在内存应用prediction、controller、cohort，最后应用独立`race-release-v11.patch`（仅在冻结后生成）。重建与生产归一化源码须逐字相同，报告列出各fixture哈希和声明的最终SHA；本证明限于`sim.js`，页面版本号另做页面回归。

最终发布fixture的工具已准备，当前未捕获未定参数。主代理冻结版本、参数和最终SHA后执行：

```text
node tests/fixtures/race-release-v11.js --capture --before PRE_RELEASE_MECHANISM_SOURCE.js.gz --after sim.js --expected-final FINAL_ENGINE_SHA --out tests/fixtures/race-release-v11.patch
node tests/cohort-fixture-proof-v11.js
```

`--before`必须是已经由机制fixture逐字重建的发布前源；先核对该SHA，不任意选择早期源。捕获只允许头部版本/报告注释和完整literal `RACE_F`改变，任何其它代码差异必须先同步机制fixture。操作写fixture，不写生产；apply检验发布前及发布后SHA，拒绝错误片段、额外修改与错误最终hash。当前的合成检查不会捕获或验证任何尚未冻结的生产参数。

正式数值报告的输入也显式使用gzip，例如`--baseline docs/race-validation-v11-baseline-external.json.gz --calibration docs/calibration-screen-v11-headway.json.gz`；候选输入须是最终冻结源完成的清单。继续使用`--official-replicates 1`，全部30事件、18单马全程与108部分起步未齐时，formal命令会拒绝写出最终报告；`--draft`仅预览，不能作通过声明。

正式报告同时导入`--regression docs/entry-regressions-v11.json --regression docs/final-engine-regressions-v11.json`。必须核对最终源码、entry全部11case/browser与机制全部7suite闭合；其中`sequence-safety-focused`要求至少10项检查，覆盖实际tuple安全改写后的承诺失效和非序列指令标签。缺失仍为草稿。已完成的失败wrapper保留原失败详情，`regressionsPassed=false`，状态不会宣称功能通过。数值工程检查和现实拟合残差各自独立，不能用任何一方的通过替代其它结果。

条件阵容的两个单arm训练报告不伪装成multi-arm grid，也不充作最终candidate。小型配对与选型记录可用多次`--selection`传入，如`--selection docs/calibration-selected-v11-declaration.json --selection docs/calibration-selected-v11-paired.json`，在探索选型小节独立链接并保留原始解压字节SHA。训练union不能与其原component一起累计；相同jobKey重复输入会拒绝。所有正式候选仍须匹配最终生产源码hash与完整实际参数。

正式报告的完整输入分工与命令模板见[final-report-v11-inputs.md](final-report-v11-inputs.md)。`--calibration`只接受有`arms`及orchestrator快照的原始多臂网格；selected两臂或训练8/合并12等普通validator报告通过`--development`保留，不能传入该参数。

三份冻结官方reference JSON由`.gitattributes`精确设置`-text`，避免Git自动CRLF/LF转换改变protocol中的raw字节SHA。现有两份参考工作树为CRLF，2020 fixture为LF；这些字节形式随快照保存，数值不改变。其它普通代码/文档不改换行策略。
