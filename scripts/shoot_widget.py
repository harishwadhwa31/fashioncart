"""
Screenshot the widget preview in light, dark and mobile.

The brief requires the widget to be tested in all three. Eyeballing one is not testing three,
and theme bugs are exactly the kind that survive review: an unfallback'd CSS custom property
renders fine in the theme you happened to look at.

Renders packages/widget/dist/preview.html, which is the SHIPPED bundle with a real catalog
payload injected. Previewing different code would be worse than not previewing.

Run: python scripts/shoot_widget.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "packages" / "widget" / "dist" / "preview.html"
OUT = ROOT / ".shots"

SHOTS = [
    # name,                width, height, colour scheme
    ("widget-light",        760,  1400, "light"),
    ("widget-dark",         760,  1400, "dark"),
    ("widget-mobile",       390,  1600, "light"),
    ("widget-mobile-dark",  390,  1600, "dark"),
]


def main() -> None:
    if not PREVIEW.exists():
        raise SystemExit(f"no preview at {PREVIEW}\nrun: npm --prefix packages/widget run preview")

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("playwright not importable in this interpreter")

    OUT.mkdir(exist_ok=True)
    url = PREVIEW.as_uri()

    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception as err:
            raise SystemExit(
                f"could not launch chromium: {err}\n"
                f"try: {sys.executable} -m playwright install chromium"
            )

        for name, w, hgt, scheme in SHOTS:
            ctx = browser.new_context(
                viewport={"width": w, "height": hgt},
                color_scheme=scheme,
                device_scale_factor=1,
            )
            page = ctx.new_page()
            errors: list[str] = []
            page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

            page.goto(url)
            # The preview escape hatch waits 1.2s for a host before rendering.
            page.wait_for_timeout(2200)
            # Give the image ladder a chance to resolve (direct -> blob -> svg).
            page.wait_for_timeout(2500)

            cards = page.locator("article.card").count()
            chips = page.locator("button.chip").count()
            imgs_loaded = page.evaluate(
                "Array.from(document.images).filter(i => i.complete && i.naturalWidth > 0).length"
            )
            imgs_total = page.evaluate("document.images.length")

            path = OUT / f"{name}.png"
            page.screenshot(path=str(path), full_page=True)
            print(
                f"{name:<20} {w}x{hgt} {scheme:<5} cards={cards:<3} chips={chips:<3} "
                f"images={imgs_loaded}/{imgs_total}  {'ERRORS: ' + '; '.join(errors[:2]) if errors else 'no console errors'}"
            )
            ctx.close()

        browser.close()

    print(f"\nwrote {len(SHOTS)} screenshots to {OUT}")


if __name__ == "__main__":
    main()
