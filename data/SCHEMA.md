# FashionCart catalog feed schema

`data/catalog.json` is the interface. The runtime loader reads this file; it never imports a
TypeScript array. To pitch with a client's real catalog, replace this file (and
`fulfilment.json`) and change nothing else.

`data/catalog.csv` carries identical content in a flat form for catalog tooling that is
spreadsheet-shaped. Either file can be the source; the loader accepts both.

All brands, product names and imagery in the shipped demo feed are **fictional**.

---

## Envelope

```json
{
  "feedVersion": "1.0",
  "currency": "INR",
  "locale": "en-IN",
  "productCount": 60,
  "products": [ /* Product[] */ ]
}
```

| field | type | required | notes |
|---|---|---|---|
| `feedVersion` | string | yes | Loader rejects a major version it does not know. |
| `currency` | ISO 4217 | yes | All money fields are in this currency. |
| `locale` | BCP 47 | yes | Drives number and date formatting. |
| `productCount` | int | no | Advisory. The loader trusts `products.length`, not this. |
| `products` | Product[] | yes | |

## Product

| field | type | required | notes |
|---|---|---|---|
| `id` | string | yes | Stable SKU. Format in the demo feed is `FC-<CAT>-<nnn>`, but any stable unique string is valid. Used in URLs, so keep it URL-safe. |
| `name` | string | yes | Product name without the brand. |
| `brand` | string | yes | |
| `category` | enum | yes | `shirts` \| `trousers` \| `kurtas` \| `dresses` \| `footwear` \| `accessories`. Extending this list is a code change in the filter chips, not just a data change. |
| `price` | int | yes | **Whole rupees**, the selling price. No paise, no floats - money never touches a float in this codebase. |
| `mrp` | int | yes | Whole rupees, the list price. Must be `>= price`. |
| `colours` | `{name, hex}[]` | yes | `hex` drives the swatch. At least one. |
| `sizes` | string[] | yes | Ordered for display. Apparel `XS..XXL`, trousers `28..38`, footwear `UK6..UK11`, accessories often `["One Size"]`. |
| `stockBySize` | `{[size]: int}` | yes | Keys must be a subset of `sizes`. `0` means that size is sold out. All-zero means the SKU is sold out. |
| `thumbnailUrl` | string | yes | Path or absolute URL. See **Images** below. |
| `galleryUrls` | string[] | yes | 3 to 5 in the demo feed. May be empty. |
| `credit` | `{source, author, licence, url}` | yes | Provenance for the image asset. `url` may be `null`. Present so anyone swapping in their own photography records its rights position in the feed rather than in a side channel. |
| `shortDescription` | string | yes | One sentence. Shown on cards. |
| `longDescription` | string | yes | Two or three sentences. Shown on the product page and returned by `get-product-details`. |
| `attributes` | object | yes | `fabric`, `care`, `fit`, `occasion`, `pattern`. Free-form strings; unknown extra keys are preserved and displayed as-is. |
| `rating` | number | yes | 0 to 5, one decimal. |
| `reviewCount` | int | yes | |
| `memberOnly` | bool | yes | Gated behind the mocked Gold tier. |
| `tags` | string[] | yes | Free-form merchandising tags. May be empty. |

### Not in the feed, derived at load

These are deliberately **not** stored, so the feed cannot contradict itself:

| derived | from | why not stored |
|---|---|---|
| `discountPct` | `round((mrp - price) * 100 / mrp)` | A stored discount can disagree with the prices beside it. Every such field eventually does. |
| `inStock` | `sum(stockBySize) > 0` | Same reason. |
| `inStockSizes` | sizes whose stock is `> 0` | |
| `availability` string | `stockBySize` + `fulfilment.json` + requested pincode | 60 SKUs x N pincodes would be a combinatorial table that goes stale. |

## fulfilment.json

```json
{
  "feedVersion": "1.0",
  "locations": [
    { "pincode": "400013", "city": "Mumbai", "area": "Lower Parel",
      "storeName": "FashionCart Lower Parel", "hasStore": true, "etaDays": 1 }
  ]
}
```

Availability strings are derived, not stored: a pincode with a store and stock yields
`"3 left at Lower Parel"`, otherwise `"Ships in 4 days"`, and a sold-out SKU yields
`"Out of stock"`. The per-store count is a deterministic function of `(sku, pincode)` so the demo
repeats identically.

An unknown pincode yields `null` availability rather than an error, and the widget omits the line.

## Images

Values in `thumbnailUrl` / `galleryUrls` are **paths** in the demo feed (`/images/<sku>/thumb.webp`)
and resolve against the deployment origin. Absolute URLs are also accepted.

Two constraints the loader enforces, both from measured findings:

1. Whatever origin these resolve to **must** be declared in `_meta.ui.csp.resourceDomains`. The
   widget runs on a host-controlled sandbox origin, so `'self'` in the enforced CSP never means
   the deployment.
2. The loader tolerates a missing or unreachable image and falls back to an inline SVG
   placeholder. A broken image never blanks a card.

## CSV form

`catalog.csv` has one row per product and the same column names. Nested fields
(`colours`, `sizes`, `stockBySize`, `galleryUrls`, `credit`, `attributes`, `tags`) are stored as
compact JSON strings inside the cell. `memberOnly` is `true` / `false` lowercase.

## Validation

The loader validates with zod at startup and fails loudly with the offending SKU id. Rules beyond
the types above:

- `mrp >= price`
- `stockBySize` keys are a subset of `sizes`
- `colours` non-empty
- `id` unique across the feed
- `rating` within 0 to 5

A feed that fails validation stops the server rather than serving a half-broken catalog. This is
the `insufficient_data` rule from the house style: a measurement failure is never a false zero.
