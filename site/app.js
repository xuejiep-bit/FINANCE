// 财报直达 — 前端。读取 data.json（全市场目录），搜索优先，链接在浏览器里现拼。
const MARKET_LABEL = { us: "美股", cn: "A股", hk: "港股" };
const MAX_RESULTS = 80;

let ALL = [];        // [{m, c, n, x}]  x = orgId(cn) / stockId(hk)
let INDEX = {};      // "m:code" -> entry，供 featured 解析完整链接
let FEATURED = [];   // [{m, c, n, x}]
let market = "all";
let keyword = "";

// API 地址。site/config.js 里 WORKER_BASE 留空 = 同源（网站就由 Worker 托管）。
// 若网站和 Worker 不同源，则在 config.js 填 Worker 地址。
const WB = (window.WORKER_BASE || "").replace(/\/+$/, "");
let hasWorker = false; // 运行时探测：成功拿到 /api/directory 就说明 Worker 在线

const grid = document.getElementById("grid");
const countEl = document.getElementById("result-count");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
const enc = encodeURIComponent;

// 拼出该公司在官方网站上"已过滤+按最新排序"的财报列表页。
function officialUrl(m, code, x) {
  if (m === "us")
    return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${enc(code)}&type=10-K&dateb=&owner=include&count=40`;
  if (m === "cn")
    return x
      ? `https://www.cninfo.com.cn/new/disclosure/stock?stockCode=${enc(code)}&orgId=${enc(x)}`
      : `https://www.cninfo.com.cn/new/fulltextSearch?keyWord=${enc(code)}`;
  if (m === "hk")
    return x
      ? `https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh&category=0&market=SEHK&searchType=1&t1code=40000&stockId=${enc(x)}`
      : `https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh&category=0&market=SEHK&searchType=0&t1code=40000`;
}
// 美股季报 10-Q 单独一个链接
function usQuarterlyUrl(code) {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${enc(code)}&type=10-Q&dateb=&owner=include&count=40`;
}

// 主链接：Worker 在线就走 Worker（直达 PDF），否则用官方页面。
function annualLink(e) {
  return hasWorker ? `${WB}/r/${e.m}/${enc(e.c)}` : officialUrl(e.m, e.c, e.x);
}
function quarterlyLink(e) {
  return hasWorker ? `${WB}/r/${e.m}/${enc(e.c)}?type=quarterly` : usQuarterlyUrl(e.c);
}

function card(e) {
  const extra = e.m === "us"
    ? `<a class="btn ghost" href="${esc(quarterlyLink(e))}" target="_blank" rel="noopener">季报 10-Q</a>`
    : "";
  const primaryLabel = e.m === "us" ? "年报 10-K" : "最新财报";
  // 始终保留一个"官方页"安全入口（即使直达解析偶尔失败也能用）
  const safety = `<a class="btn ghost" href="${esc(officialUrl(e.m, e.c, e.x))}" target="_blank" rel="noopener">官方页</a>`;
  return `
    <div class="card">
      <div class="card-head">
        <div class="card-id">
          <div class="card-name" title="${esc(e.n)}">${esc(e.n || e.c)}</div>
          <div class="card-code">${esc(e.c)}</div>
        </div>
        <span class="badge ${e.m}">${MARKET_LABEL[e.m]}</span>
      </div>
      <div class="card-actions">
        <a class="btn" href="${esc(annualLink(e))}" target="_blank" rel="noopener">📄 ${primaryLabel}</a>
        ${extra}
        ${safety}
      </div>
    </div>`;
}

function render() {
  const kw = keyword.trim().toLowerCase();

  // 空搜索 → 显示精选；有搜索 → 在全市场过滤
  let pool = kw ? ALL : FEATURED;
  if (market !== "all") pool = pool.filter((e) => e.m === market);

  let list = pool;
  if (kw) {
    list = [];
    for (const e of pool) {
      if (e.c.toLowerCase().includes(kw) || (e.n && e.n.toLowerCase().includes(kw))) {
        list.push(e);
        if (list.length >= MAX_RESULTS + 1) break;
      }
    }
  }

  const more = list.length > MAX_RESULTS;
  const shown = more ? list.slice(0, MAX_RESULTS) : list;

  if (!shown.length) {
    grid.innerHTML = `<div class="empty">${kw ? "没有匹配的公司，换个关键词试试。" : "暂无精选公司。直接在上面搜索全部股票。"}</div>`;
  } else {
    grid.innerHTML = shown.map(card).join("");
  }

  if (!kw) {
    countEl.textContent = FEATURED.length
      ? `精选 ${pool.length} 家 · 直接搜索可覆盖全部股票`
      : "在上方搜索全部股票";
  } else {
    countEl.textContent = more
      ? `匹配较多，仅显示前 ${MAX_RESULTS} 条，请输入更具体的关键词`
      : `找到 ${shown.length} 家`;
  }
}

document.getElementById("search").addEventListener("input", (e) => {
  keyword = e.target.value;
  render();
});

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  market = btn.dataset.market;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b === btn));
  render();
});

function resolveFeatured(f) {
  // f = [market, code, name]；尽量从目录里补上 orgId/stockId
  const [m, c, n] = f;
  const hit = INDEX[`${m}:${c}`];
  return { m, c, n: n || (hit && hit.n) || c, x: hit && hit.x };
}

function loadDirectory(data) {
  ALL = [];
  INDEX = {};
  const push = (arr, m) => {
    for (const row of arr || []) {
      const e = { m, c: row[0], n: row[1], x: row[2] };
      ALL.push(e);
      INDEX[`${m}:${e.c}`] = e;
    }
  };
  push(data.us, "us");
  push(data.cn, "cn");
  push(data.hk, "hk");

  const cnt = data.counts || { us: 0, cn: 0, hk: 0 };
  const total = (cnt.us || 0) + (cnt.cn || 0) + (cnt.hk || 0);
  document.getElementById("total").textContent = total
    ? `美股 ${cnt.us} · A股 ${cnt.cn} · 港股 ${cnt.hk}（共 ${total.toLocaleString()} 家）`
    : "仅精选可用 · 部署 Worker 后覆盖全部股票并直达 PDF";
  document.getElementById("updated").textContent = data.generated_at || "—";
}

async function init() {
  // 精选始终来自本地 data.json（用于空搜索时置顶显示）
  let local = { featured: [], us: [], cn: [], hk: [], counts: {}, generated_at: "" };
  try {
    local = await (await fetch("data.json", { cache: "no-store" })).json();
  } catch (e) { /* 没有本地数据也能靠 Worker */ }

  // 探测 Worker：拿到 /api/directory 就用全市场目录、并让链接走直达解析
  let dir = local;
  try {
    const res = await fetch(`${WB}/api/directory`, { cache: "no-store" });
    if (res.ok) {
      dir = await res.json();
      hasWorker = true;
    }
  } catch (e) { /* 没有 Worker，退回本地精选 + 官方页链接 */ }

  loadDirectory(dir);
  FEATURED = (local.featured || []).map(resolveFeatured);
  render();
}

init();
