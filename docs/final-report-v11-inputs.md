# v11 最终报告输入清单

这是冻结后的操作模板，不代表最终数值已完成。实际最终批次路径由运行记录指定；以下采用protocol示例名。归约器不步进引擎，不重写输入。报告只能在全部最终批次、两个回归wrapper和release重建证明闭合后定稿。

|输入|用途与数量|参数|
|---|---|---|
|旧源72场基线gzip|24官方事件×3种子；主比较自动取匹配seed0，72场另作背景|`--baseline`|
|最终冻结源训练12、内部12、2020年份6|30官方事件，各1个预声明种子；不使用旧630探索训练冒充最终源|多次`--candidate`|
|最终冻结源controls三个36行批次|1200/2400/3200全部既定108个至600米组合|多次`--candidate`|
|最终冻结源forecast18|18次单马全程，与30官方场合计48次全程|`--candidate`|
|old6 headway原网格及新3 mechanical原网格gzip|14/24行政停止和12/12已闭合；不同controller源码逐组解释|多次`--calibration`|
|selected声明、配对、决策、小summary|选型理由与指标取舍；两1200输入改变，两2400输入相同|多次`--selection`|
|selected普通validator原始4+4+剩余8gzip，以及开发/停止/恢复记录|探索执行及未知进度保留，永不累计进最终48/108|多次`--development`|
|最终entry与机制wrapper|11个Node/browser入口case和7个机制suite，均须最终源；安全suite至少10项|两次`--regression`|
|最终源零步路线查表检查|第三份supplemental，须最终sourceHash/全部checks通过；不能替代两个必需wrapper|`--regression`|
|旧源查表组件与2秒前缀对照|组件benchmark与所有不利CPU/wall结果保留，不算完整全场且不证明整场加速|`--selection`及`--development`|

所有数值报告引用的source/driver/orchestrator gzip必须一并提交。selected单臂报告没有`arms`/orchestrator，不能放入`--calibration`。训练合并12是4+8的零步并集，若另附为派生选型记录，不能与components重复累计。冻结参数或版本、机制安全修复改变hash后，旧630的12场仍只属探索。

```powershell
$reportArgs = @(
  'tests/report-system-v11.js',
  '--official-replicates','1',
  '--expected-engine-sha','FINAL_ENGINE_SHA',
  '--baseline','docs/race-validation-v11-baseline-external.json.gz',
  '--candidate','docs/candidate-final-calibration.json.gz',
  '--candidate','docs/candidate-final-internal.json.gz',
  '--candidate','docs/candidate-final-reserved2020.json.gz',
  '--candidate','docs/candidate-final-controls-1200.json.gz',
  '--candidate','docs/candidate-final-controls-2400.json.gz',
  '--candidate','docs/candidate-final-controls-3200.json.gz',
  '--candidate','docs/candidate-final-forecasts.json.gz',
  '--calibration','docs/calibration-screen-v11-headway.json.gz',
  '--calibration','docs/calibration-mechanical-v11.json.gz',
  '--selection','docs/calibration-selected-v11-declaration.json',
  '--selection','docs/calibration-selected-v11-paired.json',
  '--selection','docs/calibration-selected-v11-decision.json',
  '--selection','docs/calibration-selected-nopeak-v11.summary.json',
  '--selection','docs/calibration-selected-peak-v11.summary.json',
  '--selection','docs/calibration-selected-training-v11.summary.json',
  '--development','docs/calibration-selected-nopeak-v11.json.gz',
  '--development','docs/calibration-selected-peak-v11.json.gz',
  '--development','docs/calibration-selected-training-rest-v11.json.gz',
  '--development','docs/calibration-screen-v11-development.json',
  '--development','docs/calibration-screen-v11-stop.json',
  '--development','docs/calibration-mechanical-v11-checkpoint-resume.json',
  '--development','docs/calibration-mechanical-v11-missing-process-resume.json',
  '--selection','docs/validation-scheduling-v11.json',
  '--selection','docs/validation-scheduling-final-v11.json',
  '--selection','docs/route-station-lookup-v11.json',
  '--development','docs/route-station-lookup-prefix-v11.json',
  '--regression','docs/entry-regressions-v11.json',
  '--regression','docs/final-engine-regressions-v11.json',
  '--regression','docs/FINAL_SOURCE_LOOKUP_REPORT.json',
  '--out','docs/比赛系统重构与联合校准-v11.md',
  '--summary','docs/system-report-v11-summary.json'
)
node @reportArgs
```

`FINAL_ENGINE_SHA`和最终批次文件名必须替换为实际冻结记录。三份官方reference默认显式核对字节hash，另传`--reference`时须仍包含全部30事件。被压缩的wrapper可直接用对应`.json.gz`输入；helper按形状识别，核对最终sourceHash/expectedSourceHash/productionEndHash以及entry pageHash。仅预览时加`--draft`，缺失清单会写入草稿，不能改成通过声明。失败wrapper在覆盖和来源齐全时保留原失败，状态为`complete_with_retained_failures`；错误或缺失源hash则拒绝正式归约。

`FINAL_SOURCE_LOOKUP_REPORT.json`亦须换为冻结后实际零步报告。旧`route-station-lookup-v11.json`的sourceHash是2ab0、candidateHash是f280，仅作历史组件对照。它证明284,563个路线查询的bracket/字段等价；2秒×2臂前缀保留240 ticks、466 forecast、最终状态的JSON等价。五轮每臂一百万纯组件查询的CPU中位降低46.3%，但短前缀CPU增加12.7%、墙钟增加1.5%，不能声称全场加速。帧/forecast/最终状态的gzip原始证据必须随两份报告保留。
