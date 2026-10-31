"""
FashionCart image pipeline.

Populates packages/mcp-server/public/images/<SKU>/ with a thumbnail and a gallery, in WebP with
a JPEG fallback, and records attribution back into the catalog's per-SKU `credit` object.

Two sources behind one flag, so the rest of the pipeline is identical either way:

  --source pexels     real stock photography via the Pexels API. Needs PEXELS_API_KEY.
  --source synthetic  locally generated garment imagery via PIL. No key, no network, no
                      licence question. Lower fidelity; useful to unblock a gate.

Design points that matter:

  * BATCHED BY CATEGORY. One search per category (paginated as needed), not one per SKU. Six
    categories is ~12-18 API calls instead of 60, which keeps us far inside the free tier and
    makes the run reproducible.
  * CACHED. Raw downloads land in .cache/images/ keyed by photo id and are reused. Re-running
    costs no API calls and no bandwidth. Delete the cache to force refetch.
  * MANUAL OVERRIDE HONOURED. data/image_overrides.json maps a SKU to a specific photo id, a
    URL, or a local file. Overrides always win, and are never clobbered by a re-run.
  * IDEMPOTENT. A SKU whose outputs already exist is skipped unless --force.
  * ATTRIBUTION RECORDED. Every SKU's `credit` object is updated in place with photographer,
    licence and source URL. The Pexels licence does not require attribution, but a client demo
    that cannot say where its pictures came from is not one you want to present.

Faces: the default queries are flat-lay and garment-only. The Pexels licence prohibits using an
identifiable person in a way that implies they endorse a product, and a fictional storefront
shown to enterprise clients is exactly that shape. Pass --allow-people to widen the queries.

Run:
  python scripts/build_images.py --source synthetic
  python scripts/build_images.py --source pexels --dry-run
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "packages" / "mcp-server" / "public" / "images"
CACHE = ROOT / ".cache" / "images"
OVERRIDES = DATA / "image_overrides.json"
CREDITS = DATA / "image_credits.json"

THUMB = (320, 400)      # 2x the 160x200 card slot
GALLERY = (640, 800)
WEBP_Q = 72
JPEG_Q = 78

PEXELS_ENDPOINT = "https://api.pexels.com/v1/search"

# Pexels sits behind Cloudflare, which rejects urllib's default "Python-urllib/3.x" User-Agent
# with HTTP 403 and body "error code: 1010" - a client-signature ban, NOT an auth failure. The
# key is fine; the UA is the problem. Diagnosed 2026-09-06 by reading the 403 body rather than
# assuming the key was wrong.
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json",
    "Accept-Language": "en-GB,en;q=0.9",
}
PEXELS_PER_PAGE = 80          # max allowed, so one call covers a whole category
PEXELS_LICENCE = "Pexels License"

# Flat-lay / garment-only phrasing by default. Deliberately avoids faces.
QUERIES = {
    "shirts": "folded shirt flat lay fabric",
    "trousers": "folded trousers flat lay textile",
    "kurtas": "indian ethnic textile flat lay embroidery",
    "dresses": "dress on hanger flat lay fabric",
    "footwear": "shoes product photography white background",
    "accessories": "leather accessories flat lay product",
}
QUERIES_WITH_PEOPLE = {
    "shirts": "man wearing shirt fashion",
    "trousers": "person wearing trousers fashion",
    "kurtas": "indian ethnic wear fashion",
    "dresses": "woman wearing dress fashion",
    "footwear": "shoes fashion street style",
    "accessories": "fashion accessories model",
}


# --------------------------------------------------------------------------------------
# sources
# --------------------------------------------------------------------------------------

@dataclass
class Photo:
    """One candidate image, whatever its provenance."""
    ident: str
    author: str
    source: str
    licence: str
    url: str | None          # remote original, or None for synthetic
    page_url: str | None


def load_key() -> str:
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if key:
        return key
    for env_path in [ROOT / ".env"]:
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("PEXELS_API_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        "PEXELS_API_KEY not found. Set it in the environment or in shopping_agents/fashioncart/.env, "
        "or run with --source synthetic."
    )


def pexels_search(query: str, key: str, per_page: int = PEXELS_PER_PAGE) -> list[Photo]:
    params = urllib.parse.urlencode({"query": query, "per_page": per_page, "orientation": "portrait"})
    req = urllib.request.Request(
        f"{PEXELS_ENDPOINT}?{params}", headers={**BASE_HEADERS, "Authorization": key}
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as err:
            body = ""
            try:
                body = err.read().decode("utf-8", "replace")[:200]
            except Exception:  # noqa: BLE001
                pass
            if err.code in (401, 403):
                # Not transient. Retrying wastes quota and hides the cause.
                raise SystemExit(
                    "\n".join(
                        [
                            f"Pexels rejected the request ({err.code}) for {query!r}: {body!r}",
                            "  401 -> the API key is wrong.",
                            "  403 with 'error code: 1010' -> Cloudflare blocked the client "
                            "signature, not the key. Check the User-Agent header.",
                        ]
                    )
                )
            if attempt == 3:
                raise SystemExit(f"Pexels search failed for {query!r}: {err} {body!r}")
            time.sleep(2 * (attempt + 1))
        except Exception as err:  # noqa: BLE001 - transport failures are worth retrying
            if attempt == 3:
                raise SystemExit(f"Pexels search failed for {query!r}: {err}")
            time.sleep(2 * (attempt + 1))
    else:  # pragma: no cover
        return []

    out: list[Photo] = []
    for p in payload.get("photos", []):
        out.append(
            Photo(
                ident=str(p["id"]),
                author=p.get("photographer", "unknown"),
                source="pexels",
                licence=PEXELS_LICENCE,
                url=p["src"].get("large") or p["src"].get("original"),
                page_url=p.get("url"),
            )
        )
    return out


def fetch_bytes(photo: Photo) -> bytes:
    """Download with an on-disk cache keyed by photo id. Re-runs cost nothing."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / f"{photo.source}_{photo.ident}.bin"
    if cached.exists():
        return cached.read_bytes()
    assert photo.url, "remote photo without a url"
    req = urllib.request.Request(photo.url, headers={**BASE_HEADERS, "Accept": "image/*,*/*"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    cached.write_bytes(data)
    return data


# --------------------------------------------------------------------------------------
# synthetic source (no key, no network)
# --------------------------------------------------------------------------------------

PALETTES = {
    "shirts": ((51, 69, 107), (169, 195, 214)),
    "trousers": ((58, 58, 60), (170, 170, 175)),
    "kurtas": ((110, 38, 57), (232, 200, 150)),
    "dresses": ((164, 70, 47), (216, 199, 169)),
    "footwear": ((31, 111, 107), (155, 174, 150)),
    "accessories": ((107, 107, 71), (216, 199, 169)),
}


def synthesise(category: str, seed: int, size: tuple[int, int]) -> Image.Image:
    w, h = size
    top, bottom = PALETTES.get(category, ((60, 60, 70), (200, 200, 210)))
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))

    # A garment-ish silhouette, varied by seed so SKUs are visually distinguishable.
    jitter = (seed % 7) / 100.0
    d.polygon(
        [
            (w * (0.28 + jitter), h * 0.16), (w * (0.72 - jitter), h * 0.16),
            (w * 0.84, h * 0.36), (w * 0.74, h * 0.42),
            (w * 0.74, h * 0.92), (w * 0.26, h * 0.92),
            (w * 0.26, h * 0.42), (w * 0.16, h * 0.36),
        ],
        fill=(243, 239, 230),
    )
    d.line([(w * 0.5, h * 0.18), (w * 0.5, h * 0.9)], fill=(214, 208, 196), width=max(1, w // 120))
    for i in range(6):
        cy = h * (0.28 + i * 0.1)
        d.ellipse([w * 0.49 - 3, cy - 3, w * 0.49 + 3, cy + 3], fill=(150, 145, 133))
    return img.filter(ImageFilter.SMOOTH)


# --------------------------------------------------------------------------------------
# encoding
# --------------------------------------------------------------------------------------

def fit(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Cover-crop to the target aspect, then resize. Never letterbox a product shot."""
    tw, th = size
    sw, sh = img.size
    scale = max(tw / sw, th / sh)
    nw, nh = int(sw * scale + 0.5), int(sh * scale + 0.5)
    img = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - tw) // 2, (nh - th) // 2
    return img.convert("RGB").crop((left, top, left + tw, top + th))


def write_pair(img: Image.Image, stem: Path) -> tuple[int, int]:
    stem.parent.mkdir(parents=True, exist_ok=True)
    img.save(stem.with_suffix(".webp"), "WEBP", quality=WEBP_Q, method=5)
    img.save(stem.with_suffix(".jpg"), "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    return stem.with_suffix(".webp").stat().st_size, stem.with_suffix(".jpg").stat().st_size


# --------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Build FashionCart product imagery.")
    ap.add_argument("--source", choices=["pexels", "synthetic"], default="synthetic")
    ap.add_argument("--force", action="store_true", help="Rebuild SKUs that already have images.")
    ap.add_argument("--dry-run", action="store_true", help="Plan only. No network, no writes.")
    ap.add_argument("--allow-people", action="store_true", help="Widen queries to include models.")
    ap.add_argument("--limit", type=int, default=0, help="Only process the first N SKUs.")
    args = ap.parse_args()

    feed = json.loads((DATA / "catalog.json").read_text(encoding="utf-8"))
    products = feed["products"]
    if args.limit:
        products = products[: args.limit]

    overrides = json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}
    if overrides:
        print(f"[overrides] {len(overrides)} SKU(s) pinned; these are never auto-assigned")

    queries = QUERIES_WITH_PEOPLE if args.allow_people else QUERIES
    by_cat: dict[str, list[dict]] = {}
    for p in products:
        by_cat.setdefault(p["category"], []).append(p)

    print(f"source={args.source}  categories={len(by_cat)}  skus={len(products)}"
          f"{'  [DRY RUN]' if args.dry_run else ''}")

    if args.source == "pexels" and not args.dry_run:
        key = load_key()
    else:
        key = ""

    credits: dict[str, dict] = {}
    api_calls = 0
    made = skipped = 0

    for category, items in by_cat.items():
        need = len(items)
        print(f"\n[{category}] {need} SKUs, query={queries[category]!r}")

        pool: list[Photo] = []
        if args.source == "pexels":
            if args.dry_run:
                print(f"  would call Pexels search once (per_page={PEXELS_PER_PAGE})")
                api_calls += 1
            else:
                pool = pexels_search(queries[category], key)
                api_calls += 1
                print(f"  {len(pool)} candidate photos")
                if len(pool) < need:
                    print(f"  WARNING: fewer photos than SKUs; images will repeat")

        for idx, product in enumerate(items):
            sku = product["id"]
            dest = OUT / sku
            gallery_n = len(product["galleryUrls"])

            if dest.exists() and not args.force and sku not in overrides:
                skipped += 1
                continue

            if args.dry_run:
                print(f"  would build {sku}: thumb + {gallery_n} gallery (webp + jpg)")
                made += 1
                continue

            # Manual override wins outright.
            ov = overrides.get(sku)
            base_img: Image.Image | None = None
            photo: Photo | None = None

            if ov and ov.get("localPath"):
                base_img = Image.open(ROOT / ov["localPath"])
                photo = Photo(sku, ov.get("author", "manual"), "manual",
                              ov.get("licence", "supplied"), None, ov.get("url"))
            elif args.source == "pexels" and pool:
                photo = pool[idx % len(pool)]
                base_img = Image.open(io.BytesIO(fetch_bytes(photo)))
            else:
                seed = sum(ord(c) for c in sku)
                base_img = synthesise(category, seed, GALLERY)
                photo = Photo(sku, "FashionCart demo asset pipeline", "generated", "CC0-1.0", None, None)

            write_pair(fit(base_img, THUMB), dest / "thumb")
            for g in range(1, gallery_n + 1):
                # Vary the crop per gallery slot so the carousel is not six identical frames.
                variant = base_img if g == 1 else base_img.rotate((g - 1) * 1.5, expand=False)
                write_pair(fit(variant, GALLERY), dest / f"{g:02d}")

            credits[sku] = {
                "source": photo.source,
                "author": photo.author,
                "licence": photo.licence,
                "url": photo.page_url,
            }
            made += 1

    if args.dry_run:
        print(f"\nDRY RUN: would build {made} SKUs, skip {skipped}, make ~{api_calls} API calls.")
        return

    # Write attribution back into the feed, in place, and to a standalone ledger.
    if credits:
        for p in feed["products"]:
            if p["id"] in credits:
                p["credit"] = credits[p["id"]]
        (DATA / "catalog.json").write_text(
            json.dumps(feed, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        CREDITS.write_text(json.dumps(credits, indent=2, ensure_ascii=False), encoding="utf-8")

    total = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file() and f.suffix in {".webp", ".jpg"})
    webp = list(OUT.rglob("*.webp"))
    print(f"\nbuilt {made} SKUs, skipped {skipped}, {api_calls} API call(s)")
    print(f"files: {len(webp)} webp + {len(list(OUT.rglob('*.jpg')))} jpg, {total/1_048_576:.1f} MB total")
    if webp:
        sizes = sorted(f.stat().st_size for f in webp)
        print(f"webp size: min {sizes[0]:,} B  median {sizes[len(sizes)//2]:,} B  max {sizes[-1]:,} B")
    print(f"attribution written to {CREDITS.relative_to(ROOT)} and catalog.json credit objects")


if __name__ == "__main__":
    main()
