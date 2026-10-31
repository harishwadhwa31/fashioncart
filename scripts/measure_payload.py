"""
Measure a realistic search-products response against both payload ceilings.

Two ceilings apply and they are different in kind:

  A. ~25,000 tokens  - the brief's budget. Binds first in practice.
  B. ~150,000 chars  - claude.ai swaps the result for a code-execution file pointer above this.
                       The widget then receives no structuredContent and renders empty, with no
                       error anywhere. Silent failure, so it must be asserted against, not hoped.

This script reports exact character and byte counts. Token counts are NOT estimated here; an
estimate would be a fabricated measurement. See the note printed at the end.

Run:  python scripts/measure_payload.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

CATALOG = json.loads((DATA / "catalog.json").read_text(encoding="utf-8"))
FULFILMENT = json.loads((DATA / "fulfilment.json").read_text(encoding="utf-8"))
PRODUCTS = CATALOG["products"]
LOCATIONS = {loc["pincode"]: loc for loc in FULFILMENT["locations"]}


# --- derived values (never stored in the feed) -------------------------------------------

def discount_pct(p):
    """Derived at load. Storing it would let the feed contradict itself."""
    if not p["mrp"] or p["mrp"] <= p["price"]:
        return 0
    return round((p["mrp"] - p["price"]) * 100 / p["mrp"])


def total_stock(p):
    return sum(p["stockBySize"].values())


def in_stock_sizes(p):
    return [s for s, n in p["stockBySize"].items() if n > 0]


def availability_text(p, pincode):
    """Derived from stockBySize plus fulfilment.json. Deterministic, not random."""
    loc = LOCATIONS.get(pincode)
    if loc is None:
        return None
    if total_stock(p) == 0:
        return "Out of stock"
    if loc["hasStore"]:
        # Deterministic per (sku, pincode) so the demo repeats identically.
        seed = sum(ord(c) for c in p["id"] + pincode)
        at_store = seed % 5
        if at_store > 0:
            return f"{at_store} left at {loc['area']}"
    eta = loc["etaDays"]
    return f"Ships in {eta} day" + ("s" if eta != 1 else "")


# --- the two candidate thin shapes ---------------------------------------------------------

def thin_minimal(p, pincode=None):
    """12 fields. No client-side filtering beyond category/price/brand."""
    d = {
        "id": p["id"],
        "name": p["name"],
        "brand": p["brand"],
        "category": p["category"],
        "price": p["price"],
        "mrp": p["mrp"],
        "discountPct": discount_pct(p),
        "thumbnailUrl": p["thumbnailUrl"],
        "rating": p["rating"],
        "reviewCount": p["reviewCount"],
        "inStock": total_stock(p) > 0,
        "memberOnly": p["memberOnly"],
    }
    if pincode:
        d["availability"] = availability_text(p, pincode)
    return d


def thin_filterable(p, pincode=None):
    """Adds colours and in-stock sizes so filter chips and swatches work CLIENT-SIDE,
    without a tool round-trip per filter click."""
    d = thin_minimal(p, pincode)
    d["colours"] = p["colours"]
    d["sizes"] = in_stock_sizes(p)
    return d


def thin_lean(p, pincode=None):
    """Same information as `filterable`, cheaper on the wire.

    Three changes, each measured rather than assumed:
      - colour hex codes move to a palette carried ONCE in the envelope; the product carries
        only colour names. Hex strings like "#D8C7A9" tokenize badly and repeat across SKUs.
      - sizes become one comma-joined string instead of an array of quoted strings, removing
        two tokens of punctuation per size.
      - thumbnailUrl becomes the bare SKU; the envelope carries a urlTemplate the widget
        expands. Saves the repeated "/images/" and "/thumb.webp" on every row.
    """
    d = thin_minimal(p, pincode)
    del d["thumbnailUrl"]
    d["colours"] = [c["name"] for c in p["colours"]]
    d["sizes"] = ",".join(in_stock_sizes(p))
    return d


def envelope(items, shape_name, pincode=None):
    cats = sorted({i["category"] for i in items})
    brands = sorted({i["brand"] for i in items})
    body = {
        "shape": shape_name,
        "page": 1,
        "pageSize": len(items),
        "total": len(PRODUCTS),
        "hasMore": len(items) < len(PRODUCTS),
        "currency": "INR",
        "facets": {
            "categories": cats,
            "brands": brands,
            "priceBuckets": [
                {"label": "Under Rs 1,000", "min": 0, "max": 999},
                {"label": "Rs 1,000 - 2,499", "min": 1000, "max": 2499},
                {"label": "Rs 2,500 - 3,999", "min": 2500, "max": 3999},
                {"label": "Rs 4,000+", "min": 4000, "max": None},
            ],
        },
        "products": items,
    }
    if shape_name == "lean":
        body["thumbnailTemplate"] = "/images/{id}/thumb.webp"
        body["palette"] = {c[0]: c[1] for c in [
            ("Indigo", "#33456B"), ("Ivory", "#F3EFE6"), ("Charcoal", "#3A3A3C"),
            ("Marigold", "#E8A33D"), ("Rust", "#A4462F"), ("Olive", "#6B6B47"),
            ("Powder Blue", "#A9C3D6"), ("Black", "#1C1C1E"), ("Sage", "#9BAE96"),
            ("Maroon", "#6E2639"), ("Sand", "#D8C7A9"), ("Teal", "#1F6F6B"),
        ]}
    if pincode:
        loc = LOCATIONS.get(pincode)
        body["pincode"] = pincode
        body["deliveryTo"] = f"{loc['area']}, {loc['city']}" if loc else None
    return body


def measure(label, obj):
    compact = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    pretty = json.dumps(obj, ensure_ascii=False, indent=2)
    return {
        "label": label,
        "compact_chars": len(compact),
        "compact_bytes": len(compact.encode("utf-8")),
        "pretty_chars": len(pretty),
    }


def main():
    rows = []
    page = PRODUCTS[:24]

    rows.append(measure("24 x minimal, no pincode",
                        envelope([thin_minimal(p) for p in page], "minimal")))
    rows.append(measure("24 x minimal, with pincode",
                        envelope([thin_minimal(p, "400013") for p in page], "minimal", "400013")))
    rows.append(measure("24 x filterable, with pincode",
                        envelope([thin_filterable(p, "400013") for p in page], "filterable", "400013")))
    rows.append(measure("40 x filterable, with pincode",
                        envelope([thin_filterable(p, "400013") for p in PRODUCTS[:40]], "filterable", "400013")))
    rows.append(measure("60 x filterable (whole catalog)",
                        envelope([thin_filterable(p, "400013") for p in PRODUCTS], "filterable", "400013")))
    rows.append(measure("1 x get-product-details (full record)", PRODUCTS[0]))
    rows.append(measure("whole raw catalog.json (for reference)", CATALOG))

    w = max(len(r["label"]) for r in rows)
    print(f"{'payload':<{w}}  {'chars':>9}  {'bytes':>9}  {'% of 150k':>10}  {'per item':>9}")
    print("-" * (w + 45))
    for r in rows:
        n = 1
        for k, v in (("24 x", 24), ("40 x", 40), ("60 x", 60)):
            if r["label"].startswith(k):
                n = v
        pct = 100.0 * r["compact_chars"] / 150_000
        print(f"{r['label']:<{w}}  {r['compact_chars']:>9,}  {r['compact_bytes']:>9,}  "
              f"{pct:>9.1f}%  {r['compact_chars'] // n:>9,}")

    print()
    print("Per-item marginal cost, compact JSON:")
    base = measure("x", envelope([], "minimal"))["compact_chars"]
    m24 = measure("x", envelope([thin_minimal(p, "400013") for p in page], "minimal", "400013"))["compact_chars"]
    f24 = measure("x", envelope([thin_filterable(p, "400013") for p in page], "filterable", "400013"))["compact_chars"]
    print(f"  envelope alone            : {base:,} chars")
    print(f"  minimal    per product    : {(m24 - base) // 24:,} chars")
    print(f"  filterable per product    : {(f24 - base) // 24:,} chars")
    print(f"  filterable premium        : {(f24 - m24) // 24:,} chars/product "
          f"({100.0 * (f24 - m24) / m24:.0f}% larger overall)")

    print()
    print("Headroom against ceiling B (150,000 chars, silent-failure threshold):")
    per = (f24 - base) // 24
    print(f"  max products per response at filterable shape: ~{(150_000 - base) // per:,}")
    print()
    print("NOTE: token counts are deliberately NOT printed. Chars/token varies with tokenizer")
    print("and this JSON is dense with short ASCII keys, so any local estimate would be a")
    print("guess presented as a measurement. Exact counts require Anthropic's count_tokens")
    print("endpoint (free, but an authenticated API call).")


if __name__ == "__main__":
    main()
