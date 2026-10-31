"""
FashionCart catalog feed generator.

Emits data/catalog.json, data/catalog.csv and data/fulfilment.json.

This is a DEV TOOL, not part of the runtime. The runtime loader reads data/catalog.json and
never imports from here. A client's real catalog replaces the JSON/CSV file; this generator
exists only so the demo feed is reproducible and regenerable.

Deterministic: fixed seed, no timestamps in the product records. Re-running produces a
byte-identical catalog.json, so payload measurements stay comparable across runs.

All brands, product names and imagery are FICTIONAL. No real retailer or brand is referenced.

Run:  python scripts/generate_catalog.py
"""

import csv
import json
import random
from pathlib import Path

SEED = 20260906
FEED_VERSION = "1.0"
CURRENCY = "INR"

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# ---------------------------------------------------------------------------
# Brand. Every product is FashionCart's own label: no other brand name appears in the feed.
# ---------------------------------------------------------------------------
BRANDS_IN = ["FashionCart"]
BRANDS_INTL = ["FashionCart"]
BRANDS = BRANDS_IN + BRANDS_INTL

CATEGORIES = {
    "shirts": ("SHT", [
        "Oxford Button-Down Shirt", "Linen Resort Shirt", "Chambray Work Shirt",
        "Mandarin Collar Shirt", "Printed Camp Shirt", "Poplin Slim-Fit Shirt",
        "Khadi Half-Sleeve Shirt", "Corduroy Overshirt", "Seersucker Striped Shirt",
        "Twill Utility Shirt",
    ]),
    "trousers": ("TRS", [
        "Tapered Chino", "Pleated Wide-Leg Trouser", "Slim Stretch Jean",
        "Linen Drawstring Trouser", "Cargo Utility Pant", "Wool-Blend Formal Trouser",
        "Cotton Jogger", "Straight-Fit Denim", "Cropped Culotte",
        "Herringbone Flat-Front Trouser",
    ]),
    "kurtas": ("KUR", [
        "Chikankari Cotton Kurta", "Silk-Blend Bandhgala Kurta", "Block-Print Anarkali Kurta",
        "Mul Cotton Straight Kurta", "Angrakha Cotton Kurta", "Ikat Weave Kurta",
        "Bandhani Print Kurta", "Linen Nehru Kurta", "Zari Border Festive Kurta",
        "Handloom Khadi Kurta",
    ]),
    "dresses": ("DRS", [
        "Tiered Cotton Midi Dress", "Wrap Georgette Dress", "Floral Maxi Dress",
        "Linen Shirt Dress", "A-Line Kalamkari Dress", "Smocked Bodice Sundress",
        "Pleated Satin Slip Dress", "Ruched Jersey Dress", "Empire-Waist Chiffon Dress",
        "Cotton Poplin Skater Dress",
    ]),
    "footwear": ("FTW", [
        "Leather Kolhapuri Sandal", "Suede Chukka Boot", "Canvas Court Sneaker",
        "Embroidered Juti Flat", "Block Heel Sandal", "Mesh Running Trainer",
        "Penny Loafer", "Espadrille Slip-On", "Ankle-Strap Wedge", "Chunky Sole Sneaker",
    ]),
    "accessories": ("ACC", [
        "Woven Leather Belt", "Silk-Blend Scarf", "Jute Tote Bag",
        "Beaded Statement Necklace", "Cotton Canvas Cap", "Oxidised Silver Jhumka",
        "Leather Card Holder", "Bandhani Dupatta", "Analog Strap Watch",
        "Acetate Sunglasses",
    ]),
}

SIZE_SETS = {
    "shirts": ["XS", "S", "M", "L", "XL", "XXL"],
    "kurtas": ["XS", "S", "M", "L", "XL", "XXL"],
    "dresses": ["XS", "S", "M", "L", "XL", "XXL"],
    "trousers": ["28", "30", "32", "34", "36", "38"],
    "footwear": ["UK6", "UK7", "UK8", "UK9", "UK10", "UK11"],
    "accessories": ["One Size"],
}
# A few accessory types genuinely carry sizes.
SIZED_ACCESSORIES = {"Woven Leather Belt": ["S", "M", "L", "XL"]}

COLOURS = [
    ("Indigo", "#33456B"), ("Ivory", "#F3EFE6"), ("Charcoal", "#3A3A3C"),
    ("Marigold", "#E8A33D"), ("Rust", "#A4462F"), ("Olive", "#6B6B47"),
    ("Powder Blue", "#A9C3D6"), ("Black", "#1C1C1E"), ("Sage", "#9BAE96"),
    ("Maroon", "#6E2639"), ("Sand", "#D8C7A9"), ("Teal", "#1F6F6B"),
]

FABRICS = {
    "shirts": ["100% Cotton", "Linen Blend", "Cotton Chambray", "Cotton Poplin", "Corduroy Cotton"],
    "trousers": ["Cotton Twill", "Stretch Denim", "Linen Blend", "Wool Blend", "Cotton Jersey"],
    "kurtas": ["Mul Cotton", "Handloom Khadi", "Silk Blend", "Cotton Voile", "Linen"],
    "dresses": ["Cotton Poplin", "Georgette", "Rayon Blend", "Linen", "Satin Weave"],
    "footwear": ["Full-Grain Leather", "Suede", "Cotton Canvas", "Recycled Mesh", "Jute and Canvas"],
    "accessories": ["Full-Grain Leather", "Silk Blend", "Jute", "Brass Alloy", "Cotton Canvas"],
}
CARE = [
    "Machine wash cold, tumble dry low",
    "Hand wash separately in cold water",
    "Dry clean only",
    "Machine wash gentle, line dry in shade",
    "Wipe clean with a dry cloth",
]
FITS = {
    "shirts": ["Slim Fit", "Regular Fit", "Relaxed Fit", "Boxy Fit"],
    "trousers": ["Slim Fit", "Tapered Fit", "Wide Leg", "Straight Fit"],
    "kurtas": ["Straight Fit", "A-Line", "Relaxed Fit"],
    "dresses": ["Regular Fit", "Relaxed Fit", "Bodycon", "A-Line"],
    "footwear": ["True to Size", "Runs Narrow", "Runs Wide"],
    "accessories": ["One Size", "Adjustable"],
}
OCCASIONS = ["Everyday", "Workwear", "Festive", "Weekend", "Occasion Wear", "Travel"]
PATTERNS = ["Solid", "Striped", "Block Print", "Floral", "Checked", "Textured", "Embroidered"]

# Apparel tolerates "breathable" and "Indian summers"; jewellery and footwear do not.
APPAREL = {"shirts", "trousers", "kurtas", "dresses"}

TEMPLATES_COMMON = [
    "{fabric} {noun} cut for {occ}, finished {det}.",
    "A {noun} in {fabric_l}, made for {occ}.",
    "{pattern} {noun} in {fabric_l}, {det}.",
]
TEMPLATES_APPAREL_ONLY = [
    "{pattern} {noun} in breathable {fabric_l}, {det}.",
    "Lightweight {fabric_l} {noun} {det}, built for Indian summers.",
]

NOUN_OVERRIDES = {
    "Leather Card Holder": "card holder",
    "Cargo Utility Pant": "cargo pant",
    "Straight-Fit Denim": "jean",
    "Jute Tote Bag": "tote bag",
    "Acetate Sunglasses": "pair of sunglasses",
    "Embroidered Juti Flat": "juti",
    "Espadrille Slip-On": "espadrille",
}

OCCASION_PHRASE = {
    "Everyday": "everyday wear",
    "Workwear": "the office",
    "Festive": "festive dressing",
    "Weekend": "weekends",
    "Occasion Wear": "occasion dressing",
    "Travel": "travel",
}


def with_detail(detail):
    """Return a grammatical 'with ...' clause.

    Plural details take no article. Details that already carry their own article (used for
    uncountable nouns, where the pool entry has to spell out the phrasing) are passed through
    untouched, otherwise they would come out as 'with a a tonal-thread yoke'.
    """
    if detail.startswith(("a ", "an ", "the ")):
        return f"with {detail}"
    if detail.endswith("s") and not detail.endswith("ss"):
        return f"with {detail}"
    consonant_sounding = ("one", "uni", "eu", "use")
    vowel = detail[0].lower() in "aeiou" and not detail.lower().startswith(consonant_sounding)
    return f"with {'an' if vowel else 'a'} {detail}"
# Details must be category-appropriate. A shared pool produces nonsense such as a shirt with a
# belt loop, which is exactly the kind of thing a shopper notices first.
DETAILS = {
    "shirts": [
        "coconut-shell button placket", "curved shirt-tail hem", "single-needle topstitch",
        "reinforced side gusset", "one-piece back yoke", "tonal horn buttons",
    ],
    "trousers": [
        "self-fabric belt loop", "French-seamed inseam", "hidden hook-and-bar closure",
        "reinforced coin pocket", "tapered ankle opening", "curtained waistband",
    ],
    "kurtas": [
        "hand-finished side slit", "covered placket", "contrast piping at the neckline",
        "a tonal-thread yoke", "wooden button placket", "rolled hem",
    ],
    "dresses": [
        "concealed side zip", "bias-cut yoke", "self-tie waist",
        "lined bodice", "elasticated smocked back", "hand-finished hem",
    ],
    "footwear": [
        "cushioned latex footbed", "hand-stitched welt", "non-marking rubber outsole",
        "padded topline", "leather-lined heel counter", "stacked block heel",
    ],
    "accessories": [
        "solid brass hardware", "hand-rolled edge", "reinforced base panel",
        "antique-finish clasp", "hand-knotted fringe", "edge-painted trim",
    ],
}

# Where the product name already names a fabric or weave, the attribute must agree with it.
FABRIC_HINTS = [
    ("Oxford", "Cotton Oxford"), ("Chambray", "Cotton Chambray"), ("Poplin", "Cotton Poplin"),
    ("Corduroy", "Cotton Corduroy"), ("Seersucker", "Cotton Seersucker"), ("Twill", "Cotton Twill"),
    ("Khadi", "Handloom Khadi"), ("Linen", "Linen"), ("Silk", "Silk Blend"),
    ("Mul Cotton", "Mul Cotton"), ("Wool", "Wool Blend"), ("Denim", "Stretch Denim"),
    ("Jean", "Stretch Denim"), ("Georgette", "Georgette"), ("Chiffon", "Chiffon"),
    ("Satin", "Satin Weave"), ("Suede", "Suede"), ("Canvas", "Cotton Canvas"),
    ("Leather", "Full-Grain Leather"), ("Mesh", "Recycled Mesh"), ("Jute", "Jute"),
    ("Acetate", "Acetate"), ("Silver", "Sterling Silver"), ("Herringbone", "Wool Blend"),
    ("Chikankari", "Cotton Voile"), ("Kalamkari", "Cotton Poplin"), ("Ikat", "Handloom Cotton"),
    ("Cargo", "Cotton Twill"), ("Chino", "Cotton Twill"), ("Jogger", "Cotton Jersey"),
    ("Culotte", "Linen Blend"),
    ("Sandal", "Full-Grain Leather"), ("Boot", "Suede"), ("Sneaker", "Recycled Mesh"),
    ("Trainer", "Recycled Mesh"), ("Loafer", "Full-Grain Leather"), ("Espadrille", "Jute and Canvas"),
    ("Wedge", "Full-Grain Leather"), ("Juti", "Embroidered Silk"),
    ("Bandhani", "Cotton Voile"), ("Jersey", "Cotton Jersey"),
]

# Likewise the pattern attribute must not contradict the name.
PATTERN_HINTS = [
    ("Printed", "Printed"), ("Block-Print", "Block Print"), ("Floral", "Floral"),
    ("Striped", "Striped"), ("Checked", "Checked"), ("Bandhani", "Bandhani"),
    ("Ikat", "Ikat"), ("Chikankari", "Embroidered"), ("Kalamkari", "Hand Painted"),
    ("Embroidered", "Embroidered"), ("Beaded", "Embellished"), ("Herringbone", "Herringbone"),
    ("Zari", "Embroidered"), ("Corduroy", "Textured"), ("Seersucker", "Textured"),
]
LONG_EXTRA = [
    "Cut and stitched in a family-run unit in Tiruppur, with a pre-shrunk finish so it holds "
    "its shape past the first few washes.",
    "Woven on handlooms in Bhagalpur; slight irregularities in the weave are characteristic of "
    "the process rather than defects.",
    "Dyed in small batches using low-water azo-free dyes, so colour varies very slightly "
    "between production runs.",
    "Designed in Bengaluru and produced in an independently audited facility in Noida.",
    "Finished with a soft enzyme wash, which is why it feels broken-in from the first wear.",
]

PINCODES = [
    ("400013", "Mumbai", "Lower Parel", "FashionCart Lower Parel", 1),
    ("110016", "New Delhi", "Hauz Khas", "FashionCart Hauz Khas", 1),
    ("560038", "Bengaluru", "Indiranagar", "FashionCart Indiranagar", 1),
    ("600028", "Chennai", "R.A. Puram", "FashionCart R.A. Puram", 2),
    ("500034", "Hyderabad", "Banjara Hills", "FashionCart Banjara Hills", 2),
    ("700019", "Kolkata", "Ballygunge", "FashionCart Ballygunge", 2),
    ("411001", "Pune", "Camp", "FashionCart Camp", 3),
    ("380009", "Ahmedabad", "Navrangpura", None, 4),
    ("302001", "Jaipur", "MI Road", None, 4),
    ("682016", "Kochi", "Panampilly Nagar", None, 5),
]


def price_point(rng, category):
    """Realistic Indian apparel price ladders. Returns (price, mrp) in whole rupees."""
    bands = {
        "shirts": [(899, 1899), (1299, 2499), (1799, 3299)],
        "trousers": [(1199, 2299), (1699, 3199), (2299, 4299)],
        "kurtas": [(799, 1699), (1499, 2999), (2499, 4999)],
        "dresses": [(1299, 2699), (1999, 3999), (2799, 4999)],
        "footwear": [(1499, 2999), (2299, 4499), (3299, 4999)],
        "accessories": [(699, 1399), (999, 1999), (1799, 3499)],
    }
    lo, hi = rng.choice(bands[category])
    price = rng.randrange(lo, hi, 100)  # band floors end in 99, so steps of 100 stay on ...99
    mrp_mult = rng.choice([1.2, 1.3, 1.4, 1.5, 1.6, 1.8])
    mrp = int(round(price * mrp_mult / 100.0)) * 100 - 1
    if mrp <= price:
        mrp = price + 300
    return price, mrp


def build_products():
    rng = random.Random(SEED)
    products = []
    member_only_slots = set(rng.sample(range(60), 6))
    idx = 0

    for category, (prefix, names) in CATEGORIES.items():
        for n, base_name in enumerate(names, start=1):
            brand = rng.choice(BRANDS)
            sku = f"FC-{prefix}-{n:03d}"

            if category == "accessories" and base_name in SIZED_ACCESSORIES:
                sizes = list(SIZED_ACCESSORIES[base_name])
            else:
                sizes = list(SIZE_SETS[category])

            # Stock: deliberately include sold-out sizes and one fully sold-out SKU.
            stock = {}
            for s in sizes:
                roll = rng.random()
                if roll < 0.18:
                    stock[s] = 0
                elif roll < 0.35:
                    stock[s] = rng.randint(1, 3)
                else:
                    stock[s] = rng.randint(4, 40)
            if idx == 17:  # one entirely out-of-stock SKU, on purpose
                stock = {s: 0 for s in sizes}

            n_col = rng.randint(2, 4)
            colours = [{"name": c[0], "hex": c[1]} for c in rng.sample(COLOURS, n_col)]

            price, mrp = price_point(rng, category)

            # Name-implied fabric and pattern win over the random pool, so the attributes
            # never contradict the product name.
            fabric = next(
                (f for kw, f in FABRIC_HINTS if kw.lower() in base_name.lower()),
                rng.choice(FABRICS[category]),
            )
            pattern = next(
                (p for kw, p in PATTERN_HINTS if kw.lower() in base_name.lower()),
                rng.choice(["Solid", "Solid", "Textured", "Striped", "Checked"])
                if category in APPAREL else rng.choice(["Solid", "Solid", "Textured"]),
            )
            fit = rng.choice(FITS[category])
            occasion = rng.choice(OCCASIONS)
            detail = rng.choice(DETAILS[category])

            noun = NOUN_OVERRIDES.get(base_name, base_name.split()[-1].lower())
            pool = TEMPLATES_COMMON + (TEMPLATES_APPAREL_ONLY if category in APPAREL else [])
            short = rng.choice(pool).format(
                fabric=fabric, fabric_l=fabric.lower(), noun=noun,
                occ=OCCASION_PHRASE[occasion], fit_l=fit.lower(),
                pattern=pattern, det=with_detail(detail),
            )
            long = f"{short} {rng.choice(LONG_EXTRA)}"

            n_gallery = rng.randint(3, 5)
            products.append({
                "id": sku,
                "name": f"{base_name}",
                "brand": brand,
                "category": category,
                "price": price,
                "mrp": mrp,
                "colours": colours,
                "sizes": sizes,
                "stockBySize": stock,
                "thumbnailUrl": f"/images/{sku}/thumb.webp",
                "galleryUrls": [f"/images/{sku}/{i:02d}.webp" for i in range(1, n_gallery + 1)],
                "credit": {
                    "source": "generated",
                    "author": "FashionCart demo asset pipeline",
                    "licence": "CC0-1.0",
                    "url": None,
                },
                "shortDescription": short,
                "longDescription": long,
                "attributes": {
                    "fabric": fabric,
                    "care": rng.choice(CARE),
                    "fit": fit,
                    "occasion": occasion,
                    "pattern": pattern,
                },
                "rating": round(rng.uniform(3.4, 4.9), 1),
                "reviewCount": rng.choice([12, 34, 58, 96, 141, 203, 377, 512, 864, 1290, 2411]),
                "memberOnly": idx in member_only_slots,
                "tags": rng.sample(
                    ["new-in", "bestseller", "sustainable", "handloom", "limited",
                     "festive-edit", "office-edit", "summer"],
                    rng.randint(1, 3),
                ),
            })
            idx += 1

    return products


def write_json(products):
    feed = {
        "feedVersion": FEED_VERSION,
        "currency": CURRENCY,
        "locale": "en-IN",
        "productCount": len(products),
        "products": products,
    }
    path = DATA / "catalog.json"
    path.write_text(json.dumps(feed, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


CSV_COLUMNS = [
    "id", "name", "brand", "category", "price", "mrp", "colours", "sizes",
    "stockBySize", "thumbnailUrl", "galleryUrls", "credit", "shortDescription",
    "longDescription", "attributes", "rating", "reviewCount", "memberOnly", "tags",
]
NESTED = {"colours", "sizes", "stockBySize", "galleryUrls", "credit", "attributes", "tags"}


def write_csv(products):
    path = DATA / "catalog.csv"
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        w.writeheader()
        for p in products:
            row = {}
            for col in CSV_COLUMNS:
                v = p[col]
                if col in NESTED:
                    row[col] = json.dumps(v, ensure_ascii=False, separators=(",", ":"))
                elif isinstance(v, bool):
                    row[col] = "true" if v else "false"
                else:
                    row[col] = v
            w.writerow(row)
    return path


def write_fulfilment():
    entries = []
    for pincode, city, area, store, eta in PINCODES:
        entries.append({
            "pincode": pincode,
            "city": city,
            "area": area,
            "storeName": store,
            "hasStore": store is not None,
            "etaDays": eta,
        })
    path = DATA / "fulfilment.json"
    path.write_text(
        json.dumps({"feedVersion": FEED_VERSION, "locations": entries}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return path


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    products = build_products()
    pj = write_json(products)
    pc = write_csv(products)
    pf = write_fulfilment()

    cats = {}
    for p in products:
        cats[p["category"]] = cats.get(p["category"], 0) + 1
    oos_sizes = sum(1 for p in products for v in p["stockBySize"].values() if v == 0)
    fully_oos = sum(1 for p in products if all(v == 0 for v in p["stockBySize"].values()))
    member = sum(1 for p in products if p["memberOnly"])

    print(f"products      : {len(products)}")
    print(f"categories    : {cats}")
    print(f"member-only   : {member}")
    print(f"sold-out sizes: {oos_sizes}")
    print(f"fully sold out: {fully_oos}")
    print(f"price range   : Rs {min(p['price'] for p in products)} - Rs {max(p['price'] for p in products)}")
    print(f"brands used   : {len(set(p['brand'] for p in products))}")
    print(f"wrote {pj.name} ({pj.stat().st_size:,} bytes)")
    print(f"wrote {pc.name} ({pc.stat().st_size:,} bytes)")
    print(f"wrote {pf.name} ({pf.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
