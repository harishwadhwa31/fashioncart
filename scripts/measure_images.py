"""
Measure the image fallback ladder with real encoded files.

Context: the widget runs on a host-controlled sandbox origin ({hash}.claudemcpcontent.com on
claude.ai), so 'self' in the enforced CSP never means our deployment. The spec default is:

    img-src 'self' data: blob:

Declared resourceDomains SHOULD widen img-src. Anthropic's docs imply it does; ext-apps issue
#761 (2026-08-27) reports it does not on claude.ai web. Unresolved. This script prices every
rung of the ladder so the fallback is a config change, not a redesign, whichever way the Phase 2
test lands.

Generates synthetic product-ish thumbnails (no real photography) and reports encoded sizes,
base64 sizes, and the resulting cost for a 24-product response.

Run:  python scripts/measure_images.py
"""

import base64
import io
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".measure" / "images"

PALETTE = [((51, 69, 107), (169, 195, 214)), ((164, 70, 47), (216, 199, 169)),
           ((31, 111, 107), (155, 174, 150)), ((110, 38, 57), (232, 163, 61))]


def synth(w, h, seed=0):
    """A synthetic garment-ish image: vertical gradient, a draped shape, some texture.
    Stands in for a real product photo for sizing purposes only."""
    top, bottom = PALETTE[seed % len(PALETTE)]
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)],
               fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    # a garment silhouette so the encoder sees real edges, not just a smooth ramp
    d.polygon([(w * 0.28, h * 0.16), (w * 0.72, h * 0.16), (w * 0.84, h * 0.36),
               (w * 0.74, h * 0.42), (w * 0.74, h * 0.92), (w * 0.26, h * 0.92),
               (w * 0.26, h * 0.42), (w * 0.16, h * 0.36)],
              fill=(243, 239, 230))
    d.line([(w * 0.5, h * 0.18), (w * 0.5, h * 0.9)], fill=(214, 208, 196), width=max(1, w // 120))
    for i in range(6):
        d.ellipse([w * 0.49 - 2, h * (0.28 + i * 0.1) - 2, w * 0.49 + 2, h * (0.28 + i * 0.1) + 2],
                  fill=(150, 145, 133))
    return img


def enc(img, fmt, **kw):
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


def row(label, data, note=""):
    b64 = base64.b64encode(data)
    # data: URI prefix, e.g. "data:image/webp;base64,"
    uri_len = len(b64) + 23
    return {"label": label, "bytes": len(data), "b64": len(b64), "uri": uri_len, "note": note}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []

    big = synth(640, 800, 0)      # gallery / PDP
    card2x = synth(320, 400, 1)   # card thumbnail at 2x
    card1x = synth(160, 200, 2)   # card thumbnail at 1x
    lqip = synth(20, 25, 3).filter(ImageFilter.GaussianBlur(1))

    # The synthetic images above are smooth gradients plus flat shapes, which WebP compresses
    # far better than a real garment photograph (fabric weave, folds, shadow gradients, studio
    # noise). Quoting only those numbers would understate the real cost by roughly an order of
    # magnitude. These high-entropy variants bracket the upper bound.
    import random as _r
    _r.seed(7)

    def detailed(w, h, seed=0):
        img = synth(w, h, seed)
        px = img.load()
        for y in range(h):
            for x in range(w):
                r, g, b = px[x, y]
                n = _r.randint(-26, 26)
                m = int(14 * math.sin(x * 0.7) * math.cos(y * 0.5))  # weave-like texture
                px[x, y] = (max(0, min(255, r + n + m)),
                            max(0, min(255, g + n + m)),
                            max(0, min(255, b + n + m)))
        return img

    detail2x = detailed(320, 400, 1)
    detail1x = detailed(160, 200, 2)

    specs = [
        ("REAL-ish 320x400 webp q75", detail2x, "WEBP", {"quality": 75}),
        ("REAL-ish 320x400 webp q60", detail2x, "WEBP", {"quality": 60}),
        ("REAL-ish 160x200 webp q60", detail1x, "WEBP", {"quality": 60}),
        ("gallery  640x800 webp q80", big, "WEBP", {"quality": 80}),
        ("thumb 2x 320x400 webp q75", card2x, "WEBP", {"quality": 75}),
        ("thumb 2x 320x400 webp q60", card2x, "WEBP", {"quality": 60}),
        ("thumb 1x 160x200 webp q75", card1x, "WEBP", {"quality": 75}),
        ("thumb 1x 160x200 webp q50", card1x, "WEBP", {"quality": 50}),
        ("thumb 1x 160x200 jpeg q70", card1x, "JPEG", {"quality": 70, "optimize": True}),
        ("LQIP    20x25  webp q40", lqip, "WEBP", {"quality": 40}),
    ]
    for label, img, fmt, kw in specs:
        data = enc(img, fmt, **kw)
        rows.append(row(label, data))
        (OUT / (label.split()[0] + "_" + label.split()[1] + "." + fmt.lower())).write_bytes(data)

    # Inline SVG placeholder: no bitmap at all, drawn from the product's own colour swatch.
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200" role="img" '
        'aria-label="Image unavailable">'
        '<rect width="160" height="200" fill="#EEE9E0"/>'
        '<path d="M46 32h68l18 30-14 8v92H42V70l-14-8z" fill="#D8D2C6"/>'
        '<circle cx="80" cy="150" r="3" fill="#B9B1A2"/></svg>'
    )
    rows.append(row("inline SVG placeholder", svg.encode("utf-8"), "no bitmap"))

    w = max(len(r["label"]) for r in rows)
    print(f"{'asset':<{w}}  {'file B':>8}  {'base64 B':>9}  {'data: URI':>10}  {'x24 URI':>10}")
    print("-" * (w + 44))
    for r in rows:
        print(f"{r['label']:<{w}}  {r['bytes']:>8,}  {r['b64']:>9,}  {r['uri']:>10,}  "
              f"{r['uri'] * 24:>10,}")

    print()
    print("Ladder cost inside a 24-product search-products response")
    print("(baseline: filterable shape with URL references = 11,048 chars)")
    base = 11_048
    url_cost = 24 * 40  # ~40 chars per same-origin URL, already counted in the baseline
    for r in rows:
        if r["label"].startswith(("thumb", "REAL-ish", "LQIP", "inline")):
            total = base - url_cost + r["uri"] * 24
            pct150 = 100.0 * total / 150_000
            verdict = "OK" if pct150 < 40 else ("TIGHT" if pct150 < 80 else "BREAKS CEILING B")
            print(f"  {r['label']:<{w}} -> {total:>9,} chars  ({pct150:>5.1f}% of 150k)  {verdict}")

    print()
    print(f"Files written to {OUT}")


if __name__ == "__main__":
    main()
