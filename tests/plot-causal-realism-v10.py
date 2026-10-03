"""Static causal diagnostic: population observations and paired intervention separated."""
import json
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(os.environ['TEMP']) / 'saima-audit-plot-libs-20261002'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / 'docs/causal-realism-diagnosis-v10.json').read_text(encoding='utf-8'))
e = data['evidence']
font = FontProperties(fname='C:/Windows/Fonts/msyh.ttc')
plt.rcParams.update({'font.family': font.get_name(), 'axes.unicode_minus': False,
                     'font.size': 11, 'axes.spines.top': False, 'axes.spines.right': False,
                     'figure.facecolor': '#f6f8fa'})
fig, axes = plt.subplots(2, 2, figsize=(13, 9), constrained_layout=True)
colors = ['#ce8a43', '#267e91']
ax = axes[0, 0]
rows = e['perDistanceStartAndRemainder']
x = list(range(len(rows)))
for dx, key, label, color in [(-.18, 'startError', '首200误差', colors[0]), (.18, 'remainingError', '200米后误差', colors[1])]:
    values = [r[key]['median'] for r in rows]
    ax.bar([i+dx for i in x], values, .34, color=color, label=label)
    for i, v in enumerate(values):
        ax.text(i+dx, v+(.15 if v>=0 else -.18), f'{v:+.2f}', ha='center', va='bottom' if v>=0 else 'top', fontsize=9)
ax.set_xticks(x, [str(r['length']) for r in rows])
ax.axhline(0, color='#aaa', lw=.8)
ax.set_ylabel('模拟 − 现实 / 秒')
ax.set_xlabel('距离 / 米；24赛事，各距离4场')
ax.set_title('起步慢，后续过快（赛事配对观测）', loc='left', weight='bold')
ax.legend(frameon=False)
ax.margins(y=.18)
ax = axes[0, 1]
assoc = e['prefixAndFinishAssociation']
values = [assoc['rhoReal']['median'], assoc['rhoCurrent']['median']]
ax.bar(['现实', '当前模拟'], values, color=colors, width=.5)
for i, v in enumerate(values):
    ax.text(i, v+(.025 if v>=0 else -.025), f'{v:+.3f}', ha='center', va='bottom' if v>=0 else 'top')
ax.axhline(0, color='#aaa', lw=.8)
ax.set_ylim(-1, 1)
ax.set_ylabel('ρ(A, B)；赛事级中位数')
ax.set_title('前末段关系相反（24赛事关联）', loc='left', weight='bold')
ax.set_xlabel('A = 总时 − B；现实 B 为公开末600推定值\n共享估计/计时误差；相关不能单独作因果解释')
case = next(r for r in e['isolatedInputInterventions'] if r['job']['length']==2400)
before, after = case['metrics']['baseline'], case['metrics']['physiologyNeutral']
ax = axes[1, 0]
for dx, r, label, color in [(-.18, before, '原生理', colors[0]), (.18, after, '中和生理', colors[1])]:
    values = [r['tailSeconds'], r['final600Span']]
    ax.bar([dx, 1+dx], values, .34, label=label, color=color)
    for i, v in enumerate(values):
        ax.text(i+dx, v+.12, f'{v:.3f}', ha='center', fontsize=10)
ax.set_xticks([0, 1], ['首末完赛差', '个体末600极差'])
ax.set_ylabel('秒')
ax.set_title('末段更分化，同时全场更紧（单因素干预）', loc='left', weight='bold')
ax.legend(frameon=False)
ax.margins(y=.2)
ax = axes[1, 1]
values = [before['last200Difference'], after['last200Difference']]
ax.bar(['原生理', '中和生理'], values, color=colors, width=.5)
for i, v in enumerate(values):
    ax.text(i, v+(.025 if v>=0 else -.025), f'{v:+.3f}', ha='center', va='bottom' if v>=0 else 'top')
ax.axhline(0, color='#aaa', lw=.8)
ax.set_ylim(-.15, .85)
ax.set_ylabel('最后200 − 前200 / 秒')
ax.set_title('同一执行模型可以临末衰速（单因素干预）', loc='left', weight='bold')
ax.set_xlabel('下排同一2400米阵容：固定原属性、原指令和内道\n全部个体末600之前累计时间精确不变')
fig.suptitle('现实偏差需要同时检查尺度、控制和用力历史', fontsize=19, weight='bold')
fig.supxlabel('下排中和生理改变了原预算指令的供需关系，是能力存在与约束敏感性证明，不能当作真实参数或自然群体策略的拟合。', fontsize=10)
out = ROOT / 'docs/causal-realism-diagnosis-v10.png'
fig.savefig(out, dpi=160)
print(out)
