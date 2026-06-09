# 📊 财报直达 · Financial Reports Hub

一个能搜**全市场每一只股票**的小网站。搜公司名或代码，点一下，直接跳到它在
官方网站上**已按最新排序的财报列表**（最新的年报 / 季报就在最上面）。再也不用
到处输代码、翻菜单。

覆盖三个市场、全部上市公司，数据全部来自**官方公开名单**：

| 市场 | 公司数（约） | 数据源 |
| --- | --- | --- |
| 美股 US | ~10,000 | [SEC EDGAR](https://www.sec.gov/edgar) |
| A股 CN | ~5,000 | [巨潮资讯 cninfo](https://www.cninfo.com.cn) |
| 港股 HK | ~2,600 | [HKEXnews 披露易](https://www1.hkexnews.hk) |

---

## 它是怎么工作的

```
官方"全部上市公司"名单（3 个文件，允许整体下载）
        │  scripts/fetch_reports.py 每天抓一次
        ▼
site/data.json   全市场目录：每家公司的 代码 / 名称 (+ A股orgId / 港股stockId)
        │
        ▼
site/ (静态网站)   搜索优先；点公司 → 浏览器现拼出官方"最新财报列表"链接并跳转
```

为什么是"目录 + 官方页"而不是"每天给每只股票抓 PDF"：三个市场合计约 1.8 万家，
逐个抓既慢又不礼貌、还容易被限流。官方允许整体下载"全部公司名单"，只要 3 个文件
就能覆盖全市场；每家的链接指向它官方的财报列表页，永远是最新、且永不失效。

> **想要"点一下直接跳到 PDF"？** 那是下一步（B 方案）：加一个 Cloudflare Worker，
> 在你点击时**按需**解析出那家公司最新财报的 PDF 直链并直接跳转——按需解析单家，
> 而不是每天预抓全部。当前仓库已经把全市场目录做好，随时可以在此之上加 Worker。

---

## 上线（GitHub Pages，免费）

1. 把本仓库推到 GitHub。
2. **Settings → Pages → Source** 选 **GitHub Actions**。
3.（推荐）**Settings → Secrets and variables → Actions → Variables** 新建
   `CONTACT_EMAIL` 填你的邮箱——SEC 要求请求带可联系邮箱，更稳定。
4. **Actions** 页手动跑一次 `Refresh reports & deploy`（之后每天 06:00 UTC 自动跑）。
   这一步会下载官方名单、生成全市场目录、部署网站。
5. 访问 `https://<用户名>.github.io/<仓库名>/`。

> 注意：抓取必须在有外网的环境跑（GitHub Actions 即可）。在没有外网的环境里脚本
> 也能跑完，只是市场目录为空，仅保留 `data/companies.json` 里的精选公司。

---

## 精选 / 置顶公司

`data/companies.json` 里的公司会作为**精选**，在网站打开（搜索框为空）时直接显示，
方便你一眼看到最关注的那几家。增删只改这一个文件：

```jsonc
{
  "us": [ { "name": "Apple 苹果", "ticker": "AAPL" } ],
  "cn": [ { "name": "贵州茅台", "code": "600519", "exchange": "sse" } ],
  "hk": [ { "name": "腾讯控股", "code": "00700" } ]
}
```

全市场搜索不依赖这个文件——任意股票都能搜到，无需手动维护。

---

## 本地预览

```bash
python3 scripts/fetch_reports.py          # 需要外网；生成全市场 site/data.json
cd site && python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

---

## 点一下直达 PDF（Cloudflare Worker）

静态站点本身只能链到官方页面，而且 A股/港股需要 `orgId`/`stockId` 才能精确定位，
全市场目录也得在有外网的地方抓。这些都交给一个 Cloudflare Worker（`worker/index.js`）：

- `GET /api/directory` — 全市场目录（美股/A股/港股），抓官方名单并缓存。网站用它搜索**全部股票**。
- `GET /r/<us|cn|hk>/<code>` — 按需解析该公司**最新财报直链并 302 跳转**（解析失败退回官方页）。

### 部署

```bash
npm i -g wrangler          # 或用 npx
wrangler login             # 浏览器登录你的 Cloudflare 账号
wrangler deploy            # 部署，输出形如 https://caibao-resolver.<子域>.workers.dev
```

### 接上网站

把上一步输出的地址填进 `site/config.js`：

```js
window.WORKER_BASE = "https://caibao-resolver.你的子域.workers.dev";
```

重新部署网站即可。之后：搜索覆盖全部股票、点"最新财报"直接打开 PDF、A股/港股不用再输代码。
`WORKER_BASE` 留空时网站退回纯静态模式（仅精选 + 官方页链接），不会报错。

> 自检：浏览器打开 `https://<你的worker地址>/r/cn/600519` 应直接跳到贵州茅台最新年报 PDF；
> `https://<你的worker地址>/api/directory` 应返回三个市场的公司目录。

## 已知限制

- **美股**财报是官方 HTML/iXBRL 文件（SEC 不提供官方 PDF）；链接到官方 10-K（年报）/
  10-Q（季报）列表。
- **港股**目录依赖港交所的全量股票列表 JSON 来拿 `stockId`；若某次取不到，相关公司
  会退回官方搜索页（仍可用）。
- 这里整理的是**链接 + 目录**，不存储、不转载任何报告文件本身。
- 当前为 A 方案（点击→官方最新财报页）。B 方案（点击→直接跳 PDF）见上文，可后续追加。
