/**
 * 财报直达 · Resolver Worker
 *
 * 提供两个能力，专治静态站点搞不定的部分：
 *   1) GET /api/directory
 *      返回全市场上市公司目录（美股 / A股 / 港股），从官方名单抓取并缓存。
 *      网站用它来搜索全部股票（不再只有精选）。
 *   2) GET /r/<market>/<code>[?type=annual|quarterly]
 *      按需解析该公司"最新财报"的直链，302 跳转过去。
 *      market = us | cn | hk。解析失败时退回官方页面（链接永不死）。
 *
 * 数据源（官方公开）:
 *   美股 SEC EDGAR · A股 巨潮资讯 cninfo · 港股 港交所 HKEXnews
 *
 * 部署: npx wrangler deploy  （详见仓库 README）
 */

const SEC_UA = "caibao-reports (contact: " + "admin@example.com" + ")";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const SEC_HEADERS = { "User-Agent": SEC_UA, "Accept-Encoding": "gzip" };

// ---- 小工具 ----------------------------------------------------------------
const CORS = { "access-control-allow-origin": "*" };

function json(obj, maxAge = 3600) {
  return new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json; charset=utf-8",
               "cache-control": `public, max-age=${maxAge}`, ...CORS },
  });
}

// 带边缘缓存的 GET（cf.cacheEverything 让 Cloudflare 缓存子请求）
async function getJSON(url, headers, ttl) {
  const res = await fetch(url, { headers, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// 官方页面兜底链接（与网站一致）
function officialUrl(m, code, x) {
  if (m === "us")
    return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(code)}&type=10-K&dateb=&owner=include&count=40`;
  if (m === "cn")
    return x
      ? `https://www.cninfo.com.cn/new/disclosure/stock?stockCode=${encodeURIComponent(code)}&orgId=${encodeURIComponent(x)}`
      : `https://www.cninfo.com.cn/new/fulltextSearch?keyWord=${encodeURIComponent(code)}`;
  return `https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh&category=0&market=SEHK&searchType=0&t1code=40000`;
}

// ---- 目录: 美股 ------------------------------------------------------------
let _secTickerMap = null;
async function secTickerMap() {
  if (_secTickerMap) return _secTickerMap;
  const raw = await getJSON("https://www.sec.gov/files/company_tickers.json", SEC_HEADERS, 86400);
  const map = {};
  for (const k in raw) {
    const v = raw[k];
    const t = String(v.ticker || "").toUpperCase();
    if (t) map[t] = v;
  }
  _secTickerMap = map;
  return map;
}
async function dirUS() {
  const map = await secTickerMap();
  const out = [];
  for (const t in map) out.push([t, String(map[t].title || "")]);
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

// ---- 目录: A股 -------------------------------------------------------------
let _cninfoOrg = null;
async function cninfoOrgMap() {
  if (_cninfoOrg) return _cninfoOrg;
  const map = {};
  for (const url of ["https://www.cninfo.com.cn/new/data/szse_stock.json",
                     "https://www.cninfo.com.cn/new/data/sse_stock.json"]) {
    try {
      const data = await getJSON(url, { "User-Agent": BROWSER_UA }, 86400);
      for (const it of data.stockList || []) {
        const code = String(it.code || "");
        if (code && !map[code]) map[code] = { org: String(it.orgId || ""), name: String(it.zwjc || it.zwmc || "") };
      }
    } catch (e) { /* 单个名单失败不致命 */ }
  }
  _cninfoOrg = map;
  return map;
}
async function dirCN() {
  const map = await cninfoOrgMap();
  const out = [];
  for (const code in map) out.push([code, map[code].name, map[code].org]);
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

// ---- 目录: 港股 ------------------------------------------------------------
let _hkMap = null;
async function hkStockMap() {
  if (_hkMap) return _hkMap;
  const map = {};
  for (const url of ["https://www1.hkexnews.hk/ncms/json/eds/stocklist_active_main_c.json",
                     "https://www1.hkexnews.hk/ncms/json/eds/stocklist_active_main_e.json"]) {
    try {
      const data = await getJSON(url, { "User-Agent": BROWSER_UA }, 86400);
      const items = Array.isArray(data) ? data : data.stock;
      for (const it of items || []) {
        const code = String(it.c || it.code || "").padStart(5, "0");
        const sid = String(it.i || it.stockId || "");
        const name = String(it.n || it.name || "");
        if (code && !map[code]) map[code] = { sid, name };
      }
      if (Object.keys(map).length) break;
    } catch (e) { /* 退回 prefix.do 按需解析 */ }
  }
  _hkMap = map;
  return map;
}
async function dirHK() {
  const map = await hkStockMap();
  const out = [];
  for (const code in map) out.push([code, map[code].name, map[code].sid]);
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

// ---- 目录: 合并 + 缓存 -----------------------------------------------------
async function buildDirectory() {
  const [us, cn, hk] = await Promise.all([
    dirUS().catch(() => []),
    dirCN().catch(() => []),
    dirHK().catch(() => []),
  ]);
  return {
    generated_at: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    counts: { us: us.length, cn: cn.length, hk: hk.length },
    us, cn, hk,
  };
}

async function handleDirectory(request, ctx) {
  const cache = caches.default;
  const key = new Request(new URL("/api/directory", request.url).toString(), { method: "GET" });
  let hit = await cache.match(key);
  if (hit) return hit;
  const dir = await buildDirectory();
  const resp = json(dir, 21600); // 6h
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}

// ---- 解析: 最新财报直链 ----------------------------------------------------
async function resolveUS(code, type) {
  const map = await secTickerMap();
  const info = map[code] || map[code.replace(/[.\-]/g, "")];
  if (!info) return null;
  const cikNum = parseInt(info.cik_str, 10);
  const sub = await getJSON(`https://data.sec.gov/submissions/CIK${String(cikNum).padStart(10, "0")}.json`, SEC_HEADERS, 3600);
  const r = sub.filings.recent;
  const form = type === "quarterly" ? "10-Q" : "10-K";
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === form) {
      const acc = r.accessionNumber[i].replace(/-/g, "");
      const doc = r.primaryDocument[i];
      const base = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}`;
      return doc ? `${base}/${doc}` : `${base}/`;
    }
  }
  return null;
}

async function resolveCN(code) {
  const map = await cninfoOrgMap();
  const org = map[code] && map[code].org;
  if (!org) return null;
  const column = /^[69]/.test(code) ? "sse" : "szse";
  const body = new URLSearchParams({
    stock: `${code},${org}`, tabName: "fulltext", pageSize: "5", pageNum: "1",
    column, category: "category_ndbg_szsh", plate: "", seDate: "", searchkey: "",
  });
  const res = await fetch("https://www.cninfo.com.cn/new/hisAnnouncement/query", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
               "User-Agent": BROWSER_UA, "Referer": "https://www.cninfo.com.cn/" },
    body,
  });
  const j = await res.json();
  const a = (j.announcements || [])[0];
  if (!a || !a.adjunctUrl) return null;
  return `https://static.cninfo.com.cn/${a.adjunctUrl}`;
}

async function hkStockId(code) {
  const padded = code.padStart(5, "0");
  const map = await hkStockMap();
  if (map[padded] && map[padded].sid) return map[padded].sid;
  // 名单没拿到 → 用 prefix.do 按代码现查
  try {
    const res = await fetch(`https://www1.hkexnews.hk/search/prefix.do?lang=zh&type=A&name=${encodeURIComponent(padded)}`,
                            { headers: { "User-Agent": BROWSER_UA } });
    const j = await res.json();
    const list = j.stockInfo || j.stock || j || [];
    for (const it of list) {
      const sc = String(it.code || it.c || "").padStart(5, "0");
      if (sc === padded) return String(it.stockId || it.i || "");
    }
  } catch (e) { /* ignore */ }
  return null;
}

async function resolveHK(code) {
  const sid = await hkStockId(code);
  if (!sid) return null;
  const url = "https://www1.hkexnews.hk/search/titleSearchServlet.do?" + new URLSearchParams({
    sortDir: "0", sortByOptions: "DateTime", category: "0", market: "SEHK",
    stockId: sid, documentType: "-1", fromDate: "", toDate: "", title: "",
    searchType: "1", t1code: "40000", t2Gcode: "-2", t2code: "40100",
    rowRange: "5", lang: "zh",
  });
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch (e) { return null; }
  let rows = payload.result;
  if (typeof rows === "string") { try { rows = JSON.parse(rows); } catch (e) { return null; } }
  const r = (rows || [])[0];
  const link = r && (r.FILE_LINK || r.fileLink);
  if (!link) return null;
  return link.startsWith("/") ? `https://www1.hkexnews.hk${link}` : link;
}

async function handleResolve(market, code, type) {
  let direct = null;
  try {
    if (market === "us") direct = await resolveUS(code, type);
    else if (market === "cn") direct = await resolveCN(code);
    else if (market === "hk") direct = await resolveHK(code);
  } catch (e) { direct = null; }
  const target = direct || officialUrl(market, code);
  return Response.redirect(target, 302);
}

// ---- 入口 ------------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: { ...CORS, "access-control-allow-methods": "GET, OPTIONS" } });

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts.length === 0)
      return json({ ok: true, endpoints: ["/api/directory", "/r/<us|cn|hk>/<code>?type=annual|quarterly"] });

    if (parts[0] === "api" && parts[1] === "directory")
      return handleDirectory(request, ctx);

    if (parts[0] === "r" && parts.length >= 3) {
      const market = parts[1].toLowerCase();
      const code = decodeURIComponent(parts[2]).toUpperCase();
      const type = url.searchParams.get("type") === "quarterly" ? "quarterly" : "annual";
      if (["us", "cn", "hk"].includes(market)) return handleResolve(market, code, type);
    }

    return new Response("Not found", { status: 404, headers: CORS });
  },
};
