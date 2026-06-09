#!/usr/bin/env python3
"""
构建"全市场上市公司目录"，生成 site/data.json。
Build a full directory of ALL listed companies (US / A-share / HK) into
site/data.json, so the website can search every stock and link each one to
its official latest-filings page.

为什么是目录而不是逐个抓 PDF / Why a directory instead of per-company fetch:
  三个市场合计约 1.8 万家公司。每天逐个去抓每家的最新财报 PDF 会非常慢、
  对数据源不礼貌、且容易被限流。官方却允许"全部上市公司名单"整体下载——
  只需 3 个文件就能覆盖全市场。每家公司的链接指向它的官方财报列表页
  （已按最新排序，最新那份在最上面）。"点一下直接跳 PDF"由后续的
  Cloudflare Worker 按需解析（见 README 的 B 方案）。

数据源 / Data sources (all official, bulk-downloadable):
  - 美股 US:  https://www.sec.gov/files/company_tickers.json
  - A股 CN:   http://www.cninfo.com.cn/new/data/szse_stock.json  (+ sse_stock.json)
  - 港股 HK:  https://www1.hkexnews.hk/ncms/json/eds/stocklist_active_main_c.json

纯标准库 / Standard library only.

离线行为 / Offline: 没有外网时，市场目录为空，但 featured（精选）仍会
从本地 data/companies.json 生成，输出仍是合法的 data.json。
"""

import json
import os
import sys
import time
import datetime
import urllib.request
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANIES_FILE = os.path.join(ROOT, "data", "companies.json")
OUTPUT_FILE = os.path.join(ROOT, "site", "data.json")

UA_EMAIL = os.environ.get("CONTACT_EMAIL", "finance-reports@example.com")
SEC_HEADERS = {"User-Agent": f"finance-reports (+{UA_EMAIL})", "Accept-Encoding": "gzip, deflate"}
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Encoding": "gzip, deflate",
}
TIMEOUT = 30


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


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# 美股 / US — SEC EDGAR 全部 ticker→CIK
# --------------------------------------------------------------------------- #
def directory_us():
    """-> list of [ticker, name]"""
    raw = http_get_json("https://www.sec.gov/files/company_tickers.json", headers=SEC_HEADERS)
    out = []
    for v in raw.values():
        ticker = str(v.get("ticker", "")).strip().upper()
        name = str(v.get("title", "")).strip()
        if ticker:
            out.append([ticker, name])
    out.sort(key=lambda x: x[0])
    return out


# --------------------------------------------------------------------------- #
# A股 / CN — 巨潮资讯 全部 code→orgId
# --------------------------------------------------------------------------- #
def directory_cn():
    """-> list of [code, name, orgId]"""
    out = []
    seen = set()
    for url in ("http://www.cninfo.com.cn/new/data/szse_stock.json",
                "http://www.cninfo.com.cn/new/data/sse_stock.json"):
        try:
            data = http_get_json(url)
        except Exception as e:  # noqa: BLE001
            log(f"[CN] {url} failed: {e}")
            continue
        for it in data.get("stockList", []):
            code = str(it.get("code", "")).strip()
            if not code or code in seen:
                continue
            seen.add(code)
            name = str(it.get("zwjc") or it.get("zwmc") or "").strip()
            org = str(it.get("orgId", "")).strip()
            out.append([code, name, org])
    out.sort(key=lambda x: x[0])
    return out


# --------------------------------------------------------------------------- #
# 港股 / HK — 港交所 全部 code→stockId
# --------------------------------------------------------------------------- #
def directory_hk():
    """-> list of [code, name, stockId]"""
    endpoints = (
        "https://www1.hkexnews.hk/ncms/json/eds/stocklist_active_main_c.json",
        "https://www1.hkexnews.hk/ncms/json/eds/stocklist_active_main_e.json",
    )
    out = []
    seen = set()
    for url in endpoints:
        try:
            data = http_get_json(url, headers=BROWSER_HEADERS)
        except Exception as e:  # noqa: BLE001
            log(f"[HK] {url} failed: {e}")
            continue
        items = data.get("stock") if isinstance(data, dict) else data
        for it in (items or []):
            code = str(it.get("c") or it.get("code") or "").strip().zfill(5)
            sid = str(it.get("i") or it.get("stockId") or "").strip()
            name = str(it.get("n") or it.get("name") or "").strip()
            if code and code not in seen:
                seen.add(code)
                out.append([code, name, sid])
        if out:
            break  # 一个端点成功就够
    out.sort(key=lambda x: x[0])
    return out


# --------------------------------------------------------------------------- #
# 精选 / featured — 来自 data/companies.json（不需要联网）
# --------------------------------------------------------------------------- #
def build_featured(companies):
    feat = []
    for c in companies.get("us", []):
        feat.append(["us", str(c.get("ticker", "")).upper(), c.get("name", "")])
    for c in companies.get("cn", []):
        feat.append(["cn", str(c.get("code", "")), c.get("name", "")])
    for c in companies.get("hk", []):
        feat.append(["hk", str(c.get("code", "")).zfill(5), c.get("name", "")])
    return [f for f in feat if f[1]]


# --------------------------------------------------------------------------- #
def main():
    with open(COMPANIES_FILE, encoding="utf-8") as f:
        companies = json.load(f)

    us = cn = hk = []
    try:
        us = directory_us()
    except Exception as e:  # noqa: BLE001
        log(f"[US] directory failed: {e}")
    try:
        cn = directory_cn()
    except Exception as e:  # noqa: BLE001
        log(f"[CN] directory failed: {e}")
    try:
        hk = directory_hk()
    except Exception as e:  # noqa: BLE001
        log(f"[HK] directory failed: {e}")

    out = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "counts": {"us": len(us), "cn": len(cn), "hk": len(hk)},
        "featured": build_featured(companies),
        "us": us,
        "cn": cn,
        "hk": hk,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    log(f"Done: US={len(us)} CN={len(cn)} HK={len(hk)} featured={len(out['featured'])} "
        f"-> {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
