// 财报直达 — 前端渲染。读取 data.json（由 scripts/fetch_reports.py 生成）。
const MARKET_LABEL = { us: "美股", cn: "A股", hk: "港股" };

let ALL = [];          // 扁平化后的全部公司
let market = "all";    // 当前筛选
let keyword = "";

const grid = document.getElementById("grid");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// 一份财报的一行：优先给直达链接(doc_url)，没有就退回官方页面。
function reportRow(label, rpt, fallback) {
  if (rpt_has(rpt)) {
    const url = rpt.doc_url || rpt.index_url || fallback;
    const title = rpt.title || "查看";
    const date = rpt.date ? `<span class="date">${esc(rpt.date)}</span>` : "";
    return `
      <div class="report-row">
        <span class="label">${label}</span>
        <div class="info">
          <div class="title" title="${esc(title)}">${esc(title)}</div>
          ${date}
        </div>
        <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">打开</a>
      </div>`;
  }
  // 没抓到具体文件 → 用官方列表兜底
  return `
    <div class="report-row">
      <span class="label">${label}</span>
      <div class="info"><div class="date">暂无直达，去官方列表查看</div></div>
      <a class="btn ghost" href="${esc(fallback)}" target="_blank" rel="noopener">官方页</a>
    </div>`;
}

function rpt_has(r) { return r && (r.doc_url || r.index_url); }

function card(c) {
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-name">${esc(c.name)}</div>
          <div class="card-code">${esc(c.code)}</div>
        </div>
        <span class="badge ${c.market}">${MARKET_LABEL[c.market] || c.market}</span>
      </div>
      ${reportRow("年报", c.annual, c.official_url)}
      ${reportRow("季报", c.quarterly, c.official_url)}
      <div class="card-foot">
        <a href="${esc(c.official_url)}" target="_blank" rel="noopener">↗ 该公司全部官方披露</a>
      </div>
    </div>`;
}

function render() {
  const kw = keyword.trim().toLowerCase();
  const list = ALL.filter((c) => {
    if (market !== "all" && c.market !== market) return false;
    if (!kw) return true;
    return (c.name + " " + c.code).toLowerCase().includes(kw);
  });
  grid.innerHTML = list.length
    ? list.map(card).join("")
    : `<div class="empty">没有匹配的公司。试试别的关键词，或在 data/companies.json 里添加。</div>`;
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

fetch("data.json", { cache: "no-store" })
  .then((r) => r.json())
  .then((data) => {
    const m = data.markets || {};
    ALL = [...(m.us || []), ...(m.cn || []), ...(m.hk || [])];
    document.getElementById("updated").textContent = data.generated_at || "—";
    render();
  })
  .catch((err) => {
    grid.innerHTML = `<div class="empty">无法加载 data.json：${esc(err.message)}</div>`;
  });
