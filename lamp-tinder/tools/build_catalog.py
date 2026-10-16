"""
Build the real-lamp catalog for Lamp Tinder from public store feeds.

    python tools/build_catalog.py          (any Python 3.9+, stdlib only)

Writes:
    data/catalog.json      products: store, brand, name, url, image URL, price, type
    catalog_img/<id>.jpg   temporary thumbnails for the fingerprint step; tools/server.py deletes
                           them as soon as data/embeddings.json is saved (the site hot-links store images)
"""
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
IMG = os.path.join(ROOT, "catalog_img")
LOG = os.path.join(DATA, "catalog_log.txt")

# Shopify stores expose /products.json; currency is fixed per store.
SHOPIFY = [
    # (key, display name, base url, currency, max pages of 250)
    ("montreallighting", "Montreal Lighting & Hardware", "https://www.montreallighting.com", "CAD", 40),
    ("hutk", "HUTK", "https://hutk.ca", "CAD", 20),
    ("eq3", "EQ3", "https://www.eq3.com", "CAD", 10),
    ("mobilia", "Mobilia", "https://www.mobilia.ca", "CAD", 10),
    ("bouclair", "Bouclair", "https://www.bouclair.com", "CAD", 20),
    ("schoolhouse", "Schoolhouse", "https://www.schoolhouse.com", "USD", 10),
    ("aplusr", "A+R", "https://aplusrstore.com", "USD", 20),
    ("illuminee", "Illuminee", "https://www.illuminee.com", "USD", 10),
    ("luluandgeorgia", "Lulu and Georgia", "https://www.luluandgeorgia.com", "USD", 20),
]
IKEA_QUERIES = ["table lamp", "floor lamp", "pendant lamp", "work lamp", "desk lamp"]
USD_TO_CAD = 1.38          # rough, only used for the budget filter
MAX_PER_STORE = 220        # keep the catalog balanced between stores

EXCLUDE = re.compile(
    r"sconce|wall|flush|ceiling mount|semi-?flush|bulb|lampshade|\bshade only|replacement|cord set|canopy kit|"
    r"\bkit\b|accessor|track|vanity|bath|outdoor|exterior|landscape|picture light|under.?cabinet|linear|recessed|"
    r"chandelier|cluster|multi-?light|\d-light|tier|string light|fairy|candle|lantern|mirror|swatch|sample|gift card|"
    r"base only|shade for|glass for|diffuser|dimmer|adapter|battery|extension|clip-?on bulb|spare",
    re.I)


def log(*a):
    msg = " ".join(str(x) for x in a)
    print(msg, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(msg + "\n")


CTX = ssl.create_default_context()


def get(url, binary=False, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LampTinderCatalog/1.0",
                "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
                data = r.read()
            return data if binary else json.loads(data.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(2 + 2 * i)


def _kind(t):
    if re.search(r"floor|torchi?ere|standing lamp|arc lamp", t):
        return "floor"
    if re.search(r"pendant|suspension|hanging", t):
        return "pendant"
    if re.search(r"desk|task|work lamp|swing.?arm|architect|clamp|anglepoise|tolomeo|bestlite", t):
        return "arm"
    if re.search(r"table|portable|bedside|accent lamp|\blamp\b|\blamps\b", t):
        return "table"
    return None


LIGHTING = re.compile(r"lamp|light|pendant|suspension|torch", re.I)


def lamp_type(title, category=""):
    """Classify from the product title first (most specific), then the store's category.
    Each source only counts if it actually talks about lighting, so 'Coffee Tables' or a
    'Floor Cushion' never become lamps."""
    if EXCLUDE.search(f"{category} | {title}") or re.search(r"ceiling", title, re.I):
        return None
    for text in (title, category):
        if LIGHTING.search(text) and not re.search(r"lamp table|side table|light ?wood|lightweight", text, re.I):
            k = _kind(text.lower())
            if k:
                return k
    return None


def shopify(key, store, base, cur, max_pages):
    out = []
    for page in range(1, max_pages + 1):
        try:
            js = get(f"{base}/products.json?limit=250&page={page}")
        except Exception as e:  # noqa: BLE001
            log(f"  {key}: page {page} failed: {e}")
            break
        prods = js.get("products", [])
        if not prods:
            break
        for p in prods:
            ptype = p.get("product_type") or ""
            tags = p.get("tags") or []
            if isinstance(tags, str):
                tags = [tags]
            # product_type is the most reliable signal; fall back to title + tags
            typ = lamp_type(p.get("title", ""), ptype or " ".join(tags[:20]))
            if typ is None:
                continue
            imgs = p.get("images") or []
            prices = [float(v["price"]) for v in p.get("variants", []) if v.get("price") and v.get("available", True)]
            if not prices:
                prices = [float(v["price"]) for v in p.get("variants", []) if v.get("price")]
            if not imgs or not prices or min(prices) <= 0:
                continue
            price = min(prices)
            title = re.sub(r"\s*\|\s*Showroom Model", "", p["title"]).strip()
            vendor = (p.get("vendor") or store).split("•")[0].strip()
            if vendor.lower().startswith("tms_") or vendor.lower() == store.lower():
                vendor = ""
            out.append({
                "id": f"{key}-{p['id']}",
                "store": store, "brand": vendor, "name": title,
                "url": f"{base}/products/{p['handle']}",
                "image": imgs[0]["src"],
                "price": round(price, 2), "currency": cur,
                "price_cad": round(price * (USD_TO_CAD if cur == "USD" else 1)),
                "type": typ, "category": ptype,
            })
        log(f"  {key}: page {page} -> {len(out)} lamps so far")
        time.sleep(0.8)
    return out


def ikea():
    out, seen = [], set()
    for q in IKEA_QUERIES:
        url = ("https://sik.search.blue.cdtapps.com/ca/en/search-result-page?"
               + urllib.parse.urlencode({"q": q, "size": 120, "types": "PRODUCT"}))
        try:
            js = get(url)
        except Exception as e:  # noqa: BLE001
            log(f"  ikea '{q}' failed: {e}")
            continue
        items = js.get("searchResultPage", {}).get("products", {}).get("main", {}).get("items", [])
        for it in items:
            p = it.get("product") or {}
            pid = p.get("id") or p.get("itemNo")
            if not pid or pid in seen:
                continue
            typ = lamp_type(p.get("typeName", ""), p.get("name", ""))
            img = p.get("mainImageUrl")
            price = (p.get("salesPrice") or {}).get("numeral")
            if not typ or not img or not price:
                continue
            seen.add(pid)
            out.append({
                "id": f"ikea-{pid}", "store": "IKEA Canada", "brand": "IKEA",
                "name": f"{p.get('name', '').title()} {p.get('typeName', '').lower()}".strip(),
                "url": p.get("pipUrl"), "image": img,
                "price": float(price), "currency": "CAD", "price_cad": round(float(price)), "type": typ,
            })
        log(f"  ikea '{q}' -> {len(out)} lamps so far")
        time.sleep(0.8)
    return out


def thumb_url(item):
    u = item["image"]
    if "cdn.shopify.com" in u or "/cdn/shop/" in u:
        sep = "&" if "?" in u else "?"
        return f"{u}{sep}width=400"
    return u


def previous_catalog():
    try:
        with open(os.path.join(DATA, "catalog.json"), encoding="utf-8") as f:
            return json.load(f)["products"]
    except Exception:  # noqa: BLE001
        return []


def keep_or_fallback(store, fresh, prev):
    """If a store's feed failed or shrank by more than half (blocked, rate-limited, site change),
    keep last time's listings for that store instead of dropping them."""
    old = [p for p in prev if p["store"] == store]
    if old and len(fresh) < 0.5 * len(old):
        log(f"  {store}: only {len(fresh)} lamps this time vs {len(old)} before -> keeping previous listings")
        return old
    return fresh


def main():
    os.makedirs(DATA, exist_ok=True)
    prev = previous_catalog()
    if not os.environ.get("LT_NO_IMAGES"):
        os.makedirs(IMG, exist_ok=True)
    open(LOG, "w").close()
    items = []
    for key, store, base, cur, pages in SHOPIFY:
        log(f"{store} ...")
        got = shopify(key, store, base, cur, pages)
        # balance: keep a spread of types, cap per store
        by_type = {}
        for it in got:
            by_type.setdefault(it["type"], []).append(it)
        kept = []
        while len(kept) < MAX_PER_STORE and any(by_type.values()):
            for t in list(by_type):
                if by_type[t]:
                    kept.append(by_type[t].pop(0))
        log(f"  {store}: {len(got)} lamps, kept {len(kept)}")
        items += keep_or_fallback(store, kept[:MAX_PER_STORE], prev)
    log("IKEA Canada ...")
    items += keep_or_fallback("IKEA Canada", ikea(), prev)

    # de-duplicate identical listings (same brand + name) keeping the cheapest
    best = {}
    for it in items:
        k = re.sub(r"[^a-z0-9]", "", (it["brand"] + it["name"]).lower())
        if k not in best or it["price_cad"] < best[k]["price_cad"]:
            best[k] = it
    items = list(best.values())

    if os.environ.get("LT_NO_IMAGES"):
        # CI mode: tools/embed_new.mjs fetches images into memory itself, nothing is saved here
        ok = items
    else:
        ok = download_thumbs(items)

    # last line of defence: never replace a catalog with one that lost a big chunk of products
    if prev and len(ok) < 0.8 * len(prev) and not os.environ.get("LT_ALLOW_SHRINK"):
        log(f"ABORT: new catalog has {len(ok)} products vs {len(prev)} before; not writing it (set LT_ALLOW_SHRINK=1 to override)")
        return 1

    counts = {}
    for it in ok:
        counts[it["type"]] = counts.get(it["type"], 0) + 1
    with open(os.path.join(DATA, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump({"usd_to_cad": USD_TO_CAD, "built": time.strftime("%Y-%m-%d"), "products": ok}, f, indent=0)
    log(f"DONE: {len(ok)} products {counts}")


def download_thumbs(items):
    log(f"Downloading {len(items)} thumbnails (8 at a time) ...")
    from concurrent.futures import ThreadPoolExecutor

    def fetch(it):
        path = os.path.join(IMG, it["id"] + ".jpg")
        if os.path.exists(path) and os.path.getsize(path) > 1000:
            return it
        try:
            data = get(thumb_url(it), binary=True)
            with open(path, "wb") as f:
                f.write(data)
            return it
        except Exception as e:  # noqa: BLE001
            log(f"  image failed for {it['id']}: {e}")
            return None

    ok = []
    with ThreadPoolExecutor(8) as pool:
        for i, it in enumerate(pool.map(fetch, items)):
            if it:
                ok.append(it)
            if (i + 1) % 100 == 0:
                log(f"  {i + 1}/{len(items)}")

    return ok


if __name__ == "__main__":
    sys.exit(main())
