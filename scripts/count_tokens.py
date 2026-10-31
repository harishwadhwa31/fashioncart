"""
Exact ceiling-A measurement: token counts for real search-products payloads.

Uses Anthropic's Messages count_tokens endpoint, which is NOT billed. Key is read from
ANTHROPIC_API_KEY or the repository's .env; it is never printed.

Counts the payload as it actually reaches the model: the tool result content block. The number
that matters for the 25,000-token budget is the delta a payload adds, so a baseline empty
request is measured first and subtracted.

Run:  python scripts/count_tokens.py
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"

sys.path.insert(0, str(ROOT / "scripts"))
from measure_payload import (  # noqa: E402
    PRODUCTS, envelope, thin_minimal, thin_filterable, thin_lean,
)

MODEL = "claude-sonnet-5"


def load_key():
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    if not ENV.exists():
        raise SystemExit(f"No ANTHROPIC_API_KEY in env and no {ENV}")
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("ANTHROPIC_API_KEY"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("ANTHROPIC_API_KEY not found in .env")


def main():
    import anthropic

    client = anthropic.Anthropic(api_key=load_key())

    page24 = PRODUCTS[:24]
    cases = [
        ("baseline (empty payload)", ""),
        ("24 x minimal, no pincode",
         envelope([thin_minimal(p) for p in page24], "minimal")),
        ("24 x minimal, with pincode",
         envelope([thin_minimal(p, "400013") for p in page24], "minimal", "400013")),
        ("24 x filterable, with pincode",
         envelope([thin_filterable(p, "400013") for p in page24], "filterable", "400013")),
        ("40 x filterable, with pincode",
         envelope([thin_filterable(p, "400013") for p in PRODUCTS[:40]], "filterable", "400013")),
        ("60 x filterable (whole catalog)",
         envelope([thin_filterable(p, "400013") for p in PRODUCTS], "filterable", "400013")),
        ("24 x LEAN, with pincode",
         envelope([thin_lean(p, "400013") for p in page24], "lean", "400013")),
        ("40 x LEAN, with pincode",
         envelope([thin_lean(p, "400013") for p in PRODUCTS[:40]], "lean", "400013")),
        ("1 x get-product-details", PRODUCTS[0]),
    ]

    print(f"model: {MODEL}   endpoint: messages.count_tokens (not billed)")
    print(f"{'payload':<34} {'chars':>8} {'tokens':>8} {'delta':>8} {'ch/tok':>7} {'% of 25k':>9}")
    print("-" * 80)

    baseline = None
    for label, obj in cases:
        text = "" if obj == "" else json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        resp = client.messages.count_tokens(
            model=MODEL,
            messages=[{"role": "user", "content": text or "x"}],
        )
        tok = resp.input_tokens
        if baseline is None:
            baseline = tok
            print(f"{label:<34} {len(text):>8,} {tok:>8,} {'-':>8} {'-':>7} {'-':>9}")
            continue
        delta = tok - baseline
        ratio = len(text) / delta if delta else 0
        pct = 100.0 * delta / 25_000
        print(f"{label:<34} {len(text):>8,} {tok:>8,} {delta:>8,} {ratio:>7.2f} {pct:>8.1f}%")

    print()
    print("delta = tokens attributable to the payload itself (baseline subtracted).")
    print("ch/tok = characters per token for this JSON shape, measured, not assumed.")


if __name__ == "__main__":
    main()
