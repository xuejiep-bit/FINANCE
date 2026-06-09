# 📊 财报直达 · Financial Reports Hub

一个把**公司最新财报链接**整理在一起的小网站。点一个链接，直接打开该公司
**最新的年报 / 季报**（PDF 或官方文件），不用再到处输股票代码、翻菜单。

支持三个市场，全部用**官方公开数据源**：

| 市场 | 数据源 | 说明 |
| --- | --- | --- |
| 美股 US | [SEC EDGAR](https://www.sec.gov/edgar) | 10-K（年报）、10-Q（季报），官方文件为 HTML/iXBRL |
| A股 CN | [巨潮资讯 cninfo](http://www.cninfo.com.cn) | 年度报告、季度报告，PDF |
| 港股 HK | [HKEXnews 披露易](https://www1.hkexnews.hk) | 年报、中期报告，PDF |

---

## 它是怎么工作的

```
data/companies.json     你关注的公司清单（增删公司只改这一个文件）
        │
        ▼
scripts/fetch_reports.py  抓取每家公司最新财报的"直达链接"
        │
        ▼
site/data.json          生成的数据
        │
        ▼
site/ (静态网站)         浏览器打开，点链接直达
```

**关键设计：永不失效的兜底链接。** 每家公司都带一个 `official_url`，永远
指向它在官方网站上的财报列表（已按最新排序）。脚本再尽力把它升级成"直达
最新文件"的链接。即使某个接口临时抽风，链接也不会坏——最差也能跳到官方页面。

---

## 上线（GitHub Pages，免费）

1. 把本仓库推到 GitHub。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
3.（可选但推荐）**Settings → Secrets and variables → Actions → Variables** 新建
   `CONTACT_EMAIL`，填你的邮箱——SEC 要求请求带可联系邮箱，更稳定。
4. 到 **Actions** 页手动跑一次 `Refresh reports & deploy`（或等每天 06:00 UTC 自动跑）。
5. 完成后访问 `https://<你的用户名>.github.io/<仓库名>/`。

之后每天会自动抓取一次最新财报链接并重新部署，你不用管。

---

## 添加 / 删除公司

只改 `data/companies.json`：

```jsonc
{
  "us": [ { "name": "Apple 苹果", "ticker": "AAPL" } ],          // 美股：填 ticker
  "cn": [ { "name": "贵州茅台", "code": "600519", "exchange": "sse" } ], // A股：6位代码 + sse/szse
  "hk": [ { "name": "腾讯控股", "code": "00700" } ]              // 港股：5位代码
}
```

- A股 `exchange`：`6` 开头一般是 `sse`（上交所），`0/3` 开头是 `szse`（深交所）。不填也会自动猜。
- 改完推上去，Action 会自动重新抓取并部署。

---

## 本地预览

```bash
python3 scripts/fetch_reports.py     # 需要外网；生成 site/data.json
cd site && python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

> 注意：在没有外网的环境里脚本也能跑完，只是 `annual`/`quarterly` 为空、
> 全部走官方兜底链接。

---

## 已知限制

- **美股**财报是官方 HTML/iXBRL 文件（SEC 不提供官方 PDF），链接指向官方主文档。
- **港股** 5位代码 → 港交所内部 stockId 的映射是 best-effort；映射不到时退回官方搜索页（仍可用）。
- 这里整理的是**链接**，不是财务数据库；不存储、不转载任何报告文件本身。
