"""Static comparison of measured package effects; no parameter fitting."""
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
data = json.loads((ROOT / 'docs/system-reality-comparison-v2026.10.02.3.json').read_text(encoding='utf-8'))
font = FontProperties(fname='C:/Windows/Fonts/msyh.ttc')
plt.rcParams.update({'font.family': font.get_name(), 'axes.unicode_minus': False, 'font.size': 11,
                     'axes.spines.top': False, 'axes.spines.right': False, 'figure.facecolor': '#f6f8fa'})
fig, axes = plt.subplots(2, 4, figsize=(15, 8), constrained_layout=True)
items = [('tailSeconds', '首末完赛差', '秒', 1), ('within1', '冠军后1秒内', '%', 100),
         ('within2', '冠军后2秒内', '%', 100), ('final600Span', '全场个体末600极差', '秒', 1),
         ('first200', '首马起步200米', '秒', 1), ('post200Cv', '起步后首马200米波动', '%', 100),
         ('last200Difference', '最后200米减前200米', '秒', 1)]
colors = ['#46546a', '#cf8b48', '#2a7f87']
for ax, (key, title, unit, scale) in zip(axes.flat, items):
    row = data['alreadyViewed2023to2025']['aggregate'][key]
    values = [row[a]['median'] * scale for a in ['real', 'baseline', 'current']]
    ax.bar(['现实', 'v8', 'v9'], values, color=colors, width=.65)
    ax.set_title(title, loc='left', fontweight='bold')
    ax.set_ylabel(unit)
    ax.axhline(0, color='#bbb', lw=.7)
    ax.margins(y=.22)
    for i, value in enumerate(values):
        ax.annotate(f'{value:.2f}', (i, value), xytext=(0, 5 if value >= 0 else -14),
                    textcoords='offset points', ha='center', fontsize=11)
ax = axes.flat[-1]
for color, arm in zip(colors[1:], ['baseline', 'current']):
    points = data['alreadyViewed2023to2025']['paired']
    ax.scatter([r['length'] for r in points], [(r[arm]['winnerTime']/r['real']['winnerTime']-1)*100 for r in points],
               color=color, alpha=.8, s=35, label='v8' if arm=='baseline' else 'v9')
ax.axhline(0, color='#bbb', lw=.7)
ax.set_title('冠军总时间配对残差', loc='left', fontweight='bold')
ax.set_ylabel('%')
ax.set_xlabel('距离 / 米')
ax.legend(frameon=False)
fig.suptitle('工程一致性修复后的比赛形状仍有现实差距', fontsize=19, fontweight='bold')
fig.supxlabel('18场已查看JRA草地G1；每场3个合成阵容试算取中位，再按18场取中位。首马分段可切换领跑者。\n'
              'v9为交通、路线、个体分化整包变化；差异不能归因给单一机制。2022额外参照与干预诊断另见报告。', fontsize=10)
out = ROOT / 'docs/system-reality-comparison-v2026.10.02.3.png'
fig.savefig(out, dpi=160)
print(out)
