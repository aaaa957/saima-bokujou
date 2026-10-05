# docs/refs —— 参考文献本地归档

本目录存放**已下载到本地**的原始论文 PDF，供离线查阅。
（未列入的文献多为付费墙或反爬拦截，正文要点已提取进 `../参考资料-引擎现实拟合-v11.md`。）

## 已归档

| 文件 | 文献 | 来源 |
|---|---|---|
| `mercier-aftalion-2020-pacing-arxiv2006.10530.pdf` | Mercier & Aftalion, *Pacing strategy in horse racing* (2020)，含 Bocop 最优控制与参数辨识 | arXiv 开放获取 |
| `generative-frame-level-races-2023-arxiv2310.01748.pdf` | *A generative approach to frame-level multi-competitor races*, JQAS 2023 | arXiv 开放获取（9.2 MB，图多） |
| `cn-ea-2021-wuhan-results.pdf` | **中国马术协会** 2021 中国速度赛马公开赛（武汉站）成绩公告 | 官方免费直下；逐马时间 + 马身差 |

## 未归档（要点已提取，见主汇编）

| 文献 | 状态 | 说明 |
|---|---|---|
| Spence et al. 2012, *Speed, pacing strategy and aerodynamic drafting in Thoroughbred horse racing*, Biol Lett, DOI `10.1098/rsbl.2011.1120` | **BRONZE 开放但被 Cloudflare 403** | PMC3391435 全文可读（网页）；PDF 直链被反爬拦截 |
| Langsetmo et al. 1997, *V̇O₂ kinetics in the horse…*, J Appl Physiol 83:1235, DOI `10.1152/jappl.1997.83.4.1235` | **CLOSED** | 摘要免费；关键参数已全部提取进 §八 |
| Rose et al. 1988, *Maximum O₂ uptake, O₂ debt and deficit…*, J Appl Physiol 64:781, DOI `10.1152/jappl.1988.64.2.781` | **CLOSED** | 摘要免费；生理实测值已提取进 §二 |

## 复现下载命令（需代理）

本机代理：**FlClash，混合端口 `127.0.0.1:7890`**（FlClashCore.exe）。

```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
curl -sL -A "Mozilla/5.0" -o mercier-aftalion-2020-pacing-arxiv2006.10530.pdf  https://arxiv.org/pdf/2006.10530
curl -sL -A "Mozilla/5.0" -o generative-frame-level-races-2023-arxiv2310.01748.pdf https://arxiv.org/pdf/2310.01748
```

**查开放获取版本的通用办法**（免翻页）：

```bash
curl -s "https://api.semanticscholar.org/graph/v1/paper/DOI:<DOI>?fields=title,year,openAccessPdf,externalIds"
```
`openAccessPdf.status` 为 `GOLD`/`GREEN`/`BRONZE` 表示有免费版本；`CLOSED` 则无。

## 说明

- 本目录**体积较大（约 9 MB）**。若不想让 PDF 进入 git 历史，可把 `docs/refs/` 加入 `.gitignore`——
  主汇编里已记录每篇的 URL 与 DOI，随时可按上面命令重新下载。
- 整理日期：2026-10-05。
