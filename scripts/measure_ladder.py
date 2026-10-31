"""
Image fallback ladder, costed against the LEAN wire shape that the tools actually ship.

Supersedes an earlier ladder table, which was costed against
the older `filterable` shape and, more importantly, contained a mistake: it charged the inline
SVG placeholder per product. The placeholder is a single constant in the widget bundle, so it
costs nothing in the payload. Corrected here.

Char counts are exact. Token counts are estimated at the ratio MEASURED for this exact shape
(1.89 chars/token for lean payloads, from scripts/count_tokens.py on 2026-09-06) and are marked
as estimates until confirmed against count_tokens.

Run:  python scripts/measure_ladder.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from measure_payload import PRODUCTS, envelope, thin_lean  # noqa: E402

PAGE = 24
PINCODE = "400013"

# Measured chars-per-token for the lean shape (count_tokens, claude-sonnet-5, 2026-09-06).
LEAN_CH_PER_TOK = 1.89
TOKEN_CEILING = 25_000
CHAR_CEILING = 150_000

# data: URI sizes measured in scripts/measure_images.py. REAL-ish rows, i.e. high-entropy images
# that bracket an actual garment photograph, NOT the smooth synthetic ones.
COST_PER_PRODUCT = {
    "1. same-origin URL (resourceDomains)": 0,
    "2. fetch-to-blob (connectDomains)": 0,
    "3. LQIP data URI 20x25 + rung 2": 219,
    "4a. data URI 160x200 webp q60": 10_851,
    "4b. data URI 320x400 webp q60": 41_415,
    "5. inline SVG placeholder only": 0,
}

NOTES = {
    "1. same-origin URL (resourceDomains)": "thumbnail derived from template + SKU; nothing extra on the wire",
    "2. fetch-to-blob (connectDomains)": "bytes travel outside the payload entirely",
    "3. LQIP data URI 20x25 + rung 2": "per product: each SKU needs its own blurred preview",
    "4a. data URI 160x200 webp q60": "smallest usable thumbnail, realistic photo entropy",
    "4b. data URI 320x400 webp q60": "2x density for retina cards",
    "5. inline SVG placeholder only": "one constant in the widget bundle, not sent per product",
}


def main() -> None:
    base_obj = envelope([thin_lean(p, PINCODE) for p in PRODUCTS[:PAGE]], "lean", PINCODE)
    base = len(json.dumps(base_obj, ensure_ascii=False, separators=(",", ":")))

    print(f"Baseline: {PAGE} products, LEAN shape, with pincode = {base:,} chars")
    print(f"Measured: {base:,} chars = 4,293 tokens (count_tokens), {100*4293/TOKEN_CEILING:.1f}% of ceiling A\n")

    w = max(len(k) for k in COST_PER_PRODUCT)
    print(f"{'rung':<{w}} {'chars':>9} {'~tokens':>9} {'% of A':>8} {'% of B':>8}  verdict")
    print("-" * (w + 50))

    for rung, per in COST_PER_PRODUCT.items():
        chars = base + per * PAGE
        toks = round(chars / LEAN_CH_PER_TOK)
        pct_a = 100.0 * toks / TOKEN_CEILING
        pct_b = 100.0 * chars / CHAR_CEILING

        if pct_a >= 100 or pct_b >= 100:
            verdict = "BREACHES"
        elif pct_a >= 60 or pct_b >= 60:
            verdict = "TIGHT"
        else:
            verdict = "OK"

        print(f"{rung:<{w}} {chars:>9,} {toks:>9,} {pct_a:>7.1f}% {pct_b:>7.1f}%  {verdict}")

    print()
    print("Notes:")
    for rung, note in NOTES.items():
        print(f"  {rung}: {note}")

    print()
    print("Max products per response, by rung (ceiling A binds first in every case):")
    per_product_base = (base - len(json.dumps(envelope([], "lean"), ensure_ascii=False, separators=(",", ":")))) / PAGE
    for rung, per in COST_PER_PRODUCT.items():
        total_per = per_product_base + per
        by_tokens = int((TOKEN_CEILING * LEAN_CH_PER_TOK) / total_per)
        by_chars = int(CHAR_CEILING / total_per)
        print(f"  {rung:<{w}} {min(by_tokens, by_chars):>5} products  (tokens {by_tokens}, chars {by_chars})")


if __name__ == "__main__":
    main()
