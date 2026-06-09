#!/usr/bin/env python3
"""
抓取美股 / A股 / 港股每家公司的最新财报链接，生成 site/data.json。
Fetch the latest financial-report links for US / A-share / HK companies
and write them to site/data.json.

数据源 / Data sources (all official & public):
  - 美股 US:  SEC EDGAR        https://www.sec.gov  +  https://data.sec.gov
  - A股 CN:   巨潮资讯 cninfo   http://www.cninfo.com.cn
  - 港股 HK:  港交所 HKEXnews   https://www1.hkexnews.hk

设计原则 / Design principle:
  每家公司总是带一个"官方兜底链接"(official_url)，它永远指向该公司
  的官方财报列表（已按最新排序）。脚本再尽力把它升级为"直达最新 PDF"
  的链接。任何单家公司的网络失败都不会中断整个运行。
  Every company always carries an official fallback link; the script then
  best-effort upgrades it to a direct-to-latest-document link. A failure
  for one company never aborts the whole run.

纯标准库 / Standard library only — no pip install needed.
"""

import json
import os
import sys
import time
import datetime
import urllib.request
import urllib.parse
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANIES_FILE = os.path.join(ROOT, "data", "companies.json")
OUTPUT_FILE = os.path.join(ROOT, "site", "data.json")

# SEC 要求每个请求带一个能联系到的 User-Agent / SEC requires a contactable UA
UA_EMAIL = os.environ.get("CONTACT_EMAIL", "finance-reports@example.com")
SEC_HEADERS = {"User-Agent": f"finance-reports (+{UA_EMAIL})", "Accept-Encoding": "gzip, deflate"}
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
}

TIMEOUT = 20


# --------------------------------------------------------------------------- #
# HTTP helpers
# --------------------------------------------------------------------------- #
def _read(resp):
    data = resp.read()
    if resp.headers.get("Content-Encoding") == "gzip":
        import gzip
        data = gzip.decompress(data)
    return data


def http_get(url, headers=None, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers or BROWSER_HEADERS)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return _read(resp).decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def http_get_json(url, headers=None, retries=3):
    return json.loads(http_get(url, headers=headers, retries=retries))


def http_post_json(url, data, headers=None, retries=3):
    body = urllib.parse.urlencode(data).encode()
    hdrs = dict(headers or BROWSER_HEADERS)
    hdrs["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=hdrs)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(_read(resp).decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# 美股 / US — SEC EDGAR
# --------------------------------------------------------------------------- #
_SEC_TICKER_MAP = None


def _sec_ticker_map():
    global _SEC_TICKER_MAP
    if _SEC_TICKER_MAP is None:
        raw = http_get_json("https://www.sec.gov/files/company_tickers.json", headers=SEC_HEADERS)
        _SEC_TICKER_MAP = {}
        for v in raw.values():
            _SEC_TICKER_MAP[str(v["ticker"]).upper()] = v
    return _SEC_TICKER_MAP


def _sec_pick(recent, cik, form):
    """recent 是按时间倒序的并行数组，取第一个匹配 form 的申报。"""
    forms = recent.get("form", [])
    for i, f in enumerate(forms):
        if f == form:
            acc = recent["accessionNumber"][i]
            acc_nodash = acc.replace("-", "")
            doc = recent["primaryDocument"][i]
            base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc_nodash}"
            return {
                "title": recent.get("primaryDocDescription", [""] * len(forms))[i] or form,
                "form": form,
                "date": recent["filingDate"][i],
                "doc_url": f"{base}/{doc}" if doc else f"{base}/",
                "index_url": f"{base}/",
            }
    return None


def fetch_us(companies):
    results = []
    tmap = None
    try:
        tmap = _sec_ticker_map()
    except Exception as e:  # noqa: BLE001
        log(f"[US] ticker map failed: {e}")
    for c in companies:
        ticker = str(c["ticker"]).upper()
        official = (f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
                    f"&CIK={urllib.parse.quote(ticker)}&type=10-K&dateb=&owner=include&count=10")
        entry = {"name": c["name"], "code": ticker, "market": "us",
                 "official_url": official, "annual": None, "quarterly": None}
        try:
            info = (tmap or {}).get(ticker) or (tmap or {}).get(ticker.replace("-", "."))
            if info:
                cik = int(info["cik_str"])
                sub = http_get_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json",
                                    headers=SEC_HEADERS)
                recent = sub["filings"]["recent"]
                entry["annual"] = _sec_pick(recent, cik, "10-K")
                entry["quarterly"] = _sec_pick(recent, cik, "10-Q")
                time.sleep(0.2)  # SEC fair-use rate limit
            else:
                log(f"[US] ticker not found in SEC map: {ticker}")
        except Exception as e:  # noqa: BLE001
            log(f"[US] {ticker} failed: {e}")
        results.append(entry)
    return results


# --------------------------------------------------------------------------- #
# A股 / CN — 巨潮资讯 cninfo
# --------------------------------------------------------------------------- #
_CNINFO_ORG = None


def _cninfo_org_map():
    """code(6位) -> orgId，覆盖深市+沪市。"""
    global _CNINFO_ORG
    if _CNINFO_ORG is None:
        _CNINFO_ORG = {}
        for url in ("http://www.cninfo.com.cn/new/data/szse_stock.json",
                    "http://www.cninfo.com.cn/new/data/sse_stock.json"):
            try:
                data = http_get_json(url)
                for item in data.get("stockList", []):
                    _CNINFO_ORG[item["code"]] = item["orgId"]
            except Exception as e:  # noqa: BLE001
                log(f"[CN] org map {url} failed: {e}")
    return _CNINFO_ORG


# 巨潮公告分类 / cninfo announcement categories
_CN_CAT_ANNUAL = "category_ndbg_szsh"   # 年度报告
_CN_CAT_Q = "category_sjdbg_szsh"       # 三季度报告 (最近的季报)


def _cninfo_query(code, org, column, category):
    res = http_post_json(
        "http://www.cninfo.com.cn/new/hisAnnouncement/query",
        data={
            "stock": f"{code},{org}",
            "tabName": "fulltext",
            "pageSize": "5",
            "pageNum": "1",
            "column": column,
            "category": category,
            "plate": "",
            "seDate": "",
            "searchkey": "",
            "secid": "",
            "isHLtitle": "true",
        },
    )
    anns = res.get("announcements") or []
    if not anns:
        return None
    a = anns[0]
    adj = a.get("adjunctUrl", "")
    pdf = f"http://static.cninfo.com.cn/{adj}" if adj else None
    ts = a.get("announcementTime")
    date = ""
    if ts:
        try:
            date = datetime.datetime.fromtimestamp(int(ts) / 1000).strftime("%Y-%m-%d")
        except Exception:  # noqa: BLE001
            date = ""
    return {
        "title": (a.get("announcementTitle") or "").replace("　", " ").strip(),
        "form": category,
        "date": date,
        "doc_url": pdf,
        "index_url": pdf,
    }


def fetch_cn(companies):
    results = []
    org_map = {}
    try:
        org_map = _cninfo_org_map()
    except Exception as e:  # noqa: BLE001
        log(f"[CN] org map failed: {e}")
    for c in companies:
        code = str(c["code"])
        column = c.get("exchange") or ("sse" if code.startswith("6") else "szse")
        org = org_map.get(code, "")
        official = (f"http://www.cninfo.com.cn/new/disclosure/stock?"
                    f"stockCode={code}&orgId={org}")
        entry = {"name": c["name"], "code": code, "market": "cn",
                 "official_url": official, "annual": None, "quarterly": None}
        if org:
            try:
                entry["annual"] = _cninfo_query(code, org, column, _CN_CAT_ANNUAL)
            except Exception as e:  # noqa: BLE001
                log(f"[CN] {code} annual failed: {e}")
            try:
                entry["quarterly"] = _cninfo_query(code, org, column, _CN_CAT_Q)
            except Exception as e:  # noqa: BLE001
                log(f"[CN] {code} quarterly failed: {e}")
            time.sleep(0.3)
        else:
            log(f"[CN] orgId not found for {code}")
        results.append(entry)
    return results


# --------------------------------------------------------------------------- #
# 港股 / HK — 港交所 HKEXnews
# --------------------------------------------------------------------------- #
_HKEX_STOCK_MAP = None


def _hkex_stock_map():
    """5位代码 -> 港交所内部 stockId。best-effort。"""
    global _HKEX_STOCK_MAP
    if _HKEX_STOCK_MAP is None:
        _HKEX_STOCK_MAP = {}
        try:
            data = http_get_json(
                "https://www1.hkexnews.hk/ncms/json/eds/stocklist_active_main_c.json",
                headers=BROWSER_HEADERS)
            # 结构: { "stock": [ {"c": "00700", "i": "8030", ...}, ... ] } 视版本而定
            items = data.get("stock") if isinstance(data, dict) else data
            for it in (items or []):
                code = str(it.get("c") or it.get("code") or "").zfill(5)
                sid = str(it.get("i") or it.get("stockId") or "")
                if code and sid:
                    _HKEX_STOCK_MAP[code] = sid
        except Exception as e:  # noqa: BLE001
            log(f"[HK] stock map failed (will use fallback links): {e}")
    return _HKEX_STOCK_MAP


# 港交所文件类型 / HKEX document type codes
_HK_ANNUAL = ("40000", "40100")    # t1code, t2code: Financial Statements/ESG -> Annual Report
_HK_INTERIM = ("40000", "40200")   # Interim/Half-year Report


def _hkex_search(stock_id, t1code, t2code):
    url = ("https://www1.hkexnews.hk/search/titleSearchServlet.do?"
           + urllib.parse.urlencode({
               "sortDir": "0", "sortByOptions": "DateTime", "category": "0",
               "market": "SEHK", "stockId": stock_id, "documentType": "-1",
               "fromDate": "", "toDate": "", "title": "", "searchType": "1",
               "t1code": t1code, "t2Gcode": "-2", "t2code": t2code,
               "rowRange": "5", "lang": "zh",
           }))
    raw = http_get(url, headers=BROWSER_HEADERS)
    payload = json.loads(raw)
    rows = payload.get("result")
    if isinstance(rows, str):
        rows = json.loads(rows)
    if not rows:
        return None
    r = rows[0]
    file_link = r.get("FILE_LINK") or r.get("fileLink") or ""
    pdf = f"https://www1.hkexnews.hk{file_link}" if file_link.startswith("/") else file_link
    return {
        "title": (r.get("TITLE") or r.get("title") or "").strip(),
        "form": t2code,
        "date": (r.get("DATE_TIME") or r.get("dateTime") or "").split(" ")[0],
        "doc_url": pdf or None,
        "index_url": pdf or None,
    }


def fetch_hk(companies):
    results = []
    smap = {}
    try:
        smap = _hkex_stock_map()
    except Exception as e:  # noqa: BLE001
        log(f"[HK] stock map failed: {e}")
    for c in companies:
        code = str(c["code"]).zfill(5)
        official = ("https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=zh"
                    f"&stockId=&searchType=0&t1code=40000&category=0&market=SEHK")
        entry = {"name": c["name"], "code": code, "market": "hk",
                 "official_url": official, "annual": None, "quarterly": None}
        sid = smap.get(code)
        if sid:
            try:
                entry["annual"] = _hkex_search(sid, *_HK_ANNUAL)
            except Exception as e:  # noqa: BLE001
                log(f"[HK] {code} annual failed: {e}")
            try:
                entry["quarterly"] = _hkex_search(sid, *_HK_INTERIM)
            except Exception as e:  # noqa: BLE001
                log(f"[HK] {code} interim failed: {e}")
            time.sleep(0.3)
        else:
            log(f"[HK] stockId not found for {code} (using fallback link)")
        results.append(entry)
    return results


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main():
    with open(COMPANIES_FILE, encoding="utf-8") as f:
        companies = json.load(f)

    out = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "markets": {
            "us": fetch_us(companies.get("us", [])),
            "cn": fetch_cn(companies.get("cn", [])),
            "hk": fetch_hk(companies.get("hk", [])),
        },
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    n = sum(len(v) for v in out["markets"].values())
    hits = sum(1 for v in out["markets"].values() for e in v if e["annual"] or e["quarterly"])
    log(f"Done: {n} companies, {hits} with resolved report links -> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
