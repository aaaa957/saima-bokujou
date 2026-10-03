"""Static research plots from the frozen diagnostic report; no model fitting."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(os.environ['TEMP']) / 'saima-audit-plot-libs-20261002'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.lines import Line2D

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / 'docs/current-engine-reality-assessment-2026-10-02.json').read_text(encoding='utf-8'))
font = FontProperties(fname='C:/Windows/Fonts/msyh.ttc')
plt.rcParams.update({'font.family': font.get_name(), 'axes.unicode_minus': False,
                     'figure.facecolor': '#f5f7fa', 'axes.facecolor': 'white',
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'axes.grid': True, 'grid.alpha': .18, 'font.size': 11})
fig, axes = plt.subplots(2, 2, figsize=(13, 8.2), constrained_layout=True)
colors = {1200: '#3182bd', 1600: '#e6550d', 2000: '#31a354', 2400: '#756bb1', 3000: '#a63603', 3200: '#636363'}
ax = axes[0, 0]
for row in data['paired']:
    ax.scatter(row['length'], row['winnerTimeErrorPercent'], c=colors[row['length']], s=42, alpha=.85)
ax.axhline(0, color='#333', lw=1)
ax.set_xticks([1200, 1600, 2000, 2400, 3000, 3200])
ax.set_title('冠军总时间：量级较接近，仍有距离/场次偏差', fontproperties=font)
ax.set_xlabel('比赛距离 / 米', fontproperties=font)
ax.set_ylabel('模拟减现实 / %（负数为偏快）', fontproperties=font)

ax = axes[0, 1]
for row in data['paired']:
    ax.scatter(row['actual']['post200Cv'] * 100, row['predicted']['post200CvRounded01'] * 100,
               c=colors[row['length']], s=42, alpha=.85)
ax.plot([0, 8], [0, 8], ls='--', color='#777', lw=1)
ax.set_xlim(0, 8); ax.set_ylim(0, 8)
ax.set_title('配速变化：模拟明显更平稳', fontproperties=font)
ax.set_xlabel('现实首马200米分段CV / %', fontproperties=font)
ax.set_ylabel('模拟分段取0.1秒后的CV / %', fontproperties=font)
ax.text(.04, .92, '排除起步200米；虚线表示两者相同', transform=ax.transAxes, fontproperties=font, fontsize=10)
legend = ax.legend(handles=[Line2D([], [], marker='o', linestyle='', color=color, label=str(distance)+'米')
                           for distance, color in colors.items()], loc='upper right', ncols=2, prop=font, title='散点颜色：距离')
legend.get_title().set_fontproperties(font)

ax = axes[1, 0]
for ident, real_color, sim_color in [('231029', '#31a354', '#a1d99b'), ('241027', '#756bb1', '#bcbddc')]:
    row = next(r for r in data['paired'] if r['id'] == ident)
    x = list(range(200, row['length'] + 1, 200))
    ax.plot(x, [200 / t for t in row['actualSectionals']], color=real_color, marker='o', ms=3, label=ident[:2] + '年 现实')
    ax.plot(x, [200 / t for t in row['predictedSectionals']], color=sim_color, ls='--', lw=2, label=ident[:2] + '年 模拟逐段中位')
ax.set_title('同为东京2000米：真实展开变化尚未复现', fontproperties=font)
ax.set_xlabel('距起点 / 米', fontproperties=font)
ax.set_ylabel('首马路标分段名义均速 / 米每秒', fontproperties=font)
ax.legend(prop=font, fontsize=9, ncols=2)

ax = axes[1, 1]
for row in data['paired']:
    ax.scatter(row['actual']['final600Span'], row['predicted']['final600Span'], c=colors[row['length']], s=42, alpha=.85)
ax.plot([0, 16], [0, 16], ls='--', color='#777', lw=1)
ax.set_xlim(0, 16); ax.set_ylim(0, 16)
ax.set_title('末段个体差异：模拟明显不足', fontproperties=font)
ax.set_xlabel('现实全场逐马末600米极差 / 秒', fontproperties=font)
ax.set_ylabel('模拟全场逐马末600米极差 / 秒', fontproperties=font)

fig.suptitle('冻结引擎 v2026.10.02.2：整体时间与比赛展开是两层问题\n18场草地G1参照，每场3种子取中位；固定86级假设，非逐马复演', fontproperties=font, fontsize=16)
fig.savefig(ROOT / 'docs/current-engine-reality-assessment-2026-10-02.png', dpi=170)
plt.close(fig)
print('Saved four-panel reality comparison plot')
