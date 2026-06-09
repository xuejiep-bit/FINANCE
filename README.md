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

> **点一下直接跳到 PDF** 由 Cloudflare Worker（`worker/index.js`）实现：点击时
> **按需**解析出那家公司最新财报的 PDF 直链并直接跳转（按需解析单家，而不是每天
> 预抓全部）。同一个 Worker 还托管网站本身，见下方部署。

---

## 部署到 Cloudflare（网站 + 接口，一起部署）

整个东西就是**一个 Cloudflare Worker**：它既托管网站（`site/`），又提供接口
（`/api/directory` 全市场目录、`/r/<市场>/<代码>` 直达最新财报 PDF）。所以只要
部署这一个 Worker，网站和功能就全有了，**不用再分两处、不用手填地址**。

### 方式一：一条命令（手动）

```bash
npx wrangler login     # 浏览器登录你的 Cloudflare 账号
npx wrangler deploy    # 部署，输出形如 https://finance.<你的子域>.workers.dev
```

打开输出的地址就是完整网站。**注意：`git push` 只进 GitHub，不会自动更新
Cloudflare**——每次想让线上生效，都要再跑一次 `wrangler deploy`（或用方式二自动化）。

### 方式二：push 自动部署（一次性配置，之后全自动）

仓库里已带 `.github/workflows/deploy.yml`。配置一次令牌，以后每次 push 自动部署：

1. Cloudflare 控制台 → **My Profile → API Tokens → Create Token**，用
   **“Edit Cloudflare Workers”** 模板创建一个令牌，复制。
2. GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**，
   新建 `CLOUDFLARE_API_TOKEN` = 刚才的令牌。（账号下有多个时再加 `CLOUDFLARE_ACCOUNT_ID`。）
3. 完成。之后每次有人 push，GitHub 就自动 `wrangler deploy` 到 Cloudflare。

> 想换部署名字/域名，改 `wrangler.toml` 里的 `name`。当前为 `finance`，对应
> `https://finance.<你的子域>.workers.dev`。

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

## 部署后自检

浏览器打开（把 `finance.你的子域` 换成你的实际地址）：

- `https://finance.你的子域.workers.dev/` — 网站本体，能搜全部股票。
- `https://finance.你的子域.workers.dev/api/directory` — 应返回一大坨公司目录 JSON。
- `https://finance.你的子域.workers.dev/r/cn/600519` — 应直接跳到贵州茅台最新年报 PDF。
- `https://finance.你的子域.workers.dev/r/hk/00700` — 应直接跳到腾讯最新财报 PDF。

`/r/<us|cn|hk>/<代码>` 按需解析最新财报直链并 302 跳转；解析失败时退回官方页面，链接永不死。

## 已知限制

- **美股**财报是官方 HTML/iXBRL 文件（SEC 不提供官方 PDF）；链接到官方 10-K（年报）/
  10-Q（季报）列表。
- **港股**目录依赖港交所的全量股票列表 JSON 来拿 `stockId`；若某次取不到，相关公司
  会退回官方搜索页（仍可用）。
- 这里整理的是**链接 + 目录**，不存储、不转载任何报告文件本身。
- 当前为 A 方案（点击→官方最新财报页）。B 方案（点击→直接跳 PDF）见上文，可后续追加。
