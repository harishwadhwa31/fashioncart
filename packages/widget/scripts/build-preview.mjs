/**
 * Build a standalone, double-clickable preview of the widget.
 *
 * The brief asks for "a standalone browser preview of the widget with a mock catalog, runnable
 * with no Claude account and no tunnel". This produces exactly that: one HTML file you open
 * from the filesystem.
 *
 * How it works: the built bundle already contains an escape hatch. With no host, connect()
 * never resolves, so main.ts waits 1.2s and then renders `window.__FASHIONCART_PREVIEW__` if it
 * is present. This script takes the real built widget, injects a real search payload built from
 * the real catalog, and writes the pair out as dist/preview.html.
 *
 * It deliberately previews the SHIPPED bundle rather than a separate build. A preview of
 * different code is worse than no preview: it would pass while the real widget was broken.
 *
 * Interactive controls that call tools are inert here, because there is no host to call. The
 * widget already knows this (bridge.isHosted is false) and disables the Add buttons rather than
 * failing silently on click.
 *
 * Images load from the deployed origin, so an internet connection is needed but nothing else.
 *
 * Run: node scripts/build-preview.mjs   (or `npm run preview` after a build)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(HERE, "../dist/mcp-app.html");
const CATALOG = resolve(HERE, "../../../data/catalog.json");
const OUT = resolve(HERE, "../dist/preview.html");

const IMAGE_BASE = process.env.PREVIEW_IMAGE_BASE ?? "http://localhost:3001";
const PAGE_SIZE = 24;

if (!existsSync(BUNDLE)) {
  console.error(`[preview] no bundle at ${BUNDLE}\n          run \`npm run build\` first`);
  process.exit(1);
}
if (!existsSync(CATALOG)) {
  console.error(`[preview] no catalog at ${CATALOG}`);
  process.exit(1);
}

const feed = JSON.parse(readFileSync(CATALOG, "utf-8"));
const all = feed.products;

// Mirror the server's lean projection exactly. If these drift, the preview stops being a
// preview of anything real - so the shape here is the contract, not a convenience.
const MEMBER_DISCOUNT = 10;
const page = all.filter((p) => !p.memberOnly).slice(0, PAGE_SIZE);

function lean(p) {
  const inStockSizes = p.sizes.filter((s) => (p.stockBySize[s] ?? 0) > 0);
  const total = Object.values(p.stockBySize).reduce((a, b) => a + b, 0);
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.price,
    mrp: p.mrp,
    discountPct: p.mrp > p.price ? Math.round(((p.mrp - p.price) * 100) / p.mrp) : 0,
    rating: p.rating,
    reviewCount: p.reviewCount,
    inStock: total > 0,
    memberOnly: p.memberOnly,
    colours: p.colours.map((c) => c.name),
    sizes: inStockSizes.join(","),
    availability: total > 0 ? "2 left at Lower Parel" : "Out of stock",
    memberPrice: Math.round(p.price * (1 - MEMBER_DISCOUNT / 100)),
  };
}

function tally(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

const palette = {};
for (const p of page) for (const c of p.colours) palette[c.name] ??= c.hex;

const payload = {
  kind: "search",
  products: page.map(lean),
  page: 1,
  pageCount: Math.ceil(all.length / PAGE_SIZE),
  total: all.length,
  hasMore: all.length > PAGE_SIZE,
  palette,
  thumbnailTemplate: "/images/{id}/thumb.webp",
  imageBaseUrl: IMAGE_BASE,
  facets: {
    categories: tally(page.map((p) => p.category)),
    brands: tally(page.map((p) => p.brand)),
    colours: tally(page.flatMap((p) => p.colours.map((c) => c.name))),
    sizes: tally(page.flatMap((p) => p.sizes.filter((s) => (p.stockBySize[s] ?? 0) > 0))),
  },
  deliveryTo: "Lower Parel, Mumbai",
  member: { displayName: "Demo Gold Member", tier: "gold", discountPct: MEMBER_DISCOUNT },
  productPageBase: process.env.PREVIEW_MERCHANT_BASE ?? "http://localhost:3002",
};

const banner = `
<div style="font:12px/1.5 ui-sans-serif,system-ui,sans-serif;padding:8px 12px;margin:0 0 6px;
     border:1px dashed rgba(127,127,127,.5);border-radius:8px;color:#6b6b73">
  <strong>Standalone preview.</strong> No MCP host, so Add buttons are disabled and no tool is
  called. Filters, sorting, size selection, swatches and the image fallback ladder are all live.
  Resize the window to see the grid collapse.
</div>`;

let html = readFileSync(BUNDLE, "utf-8");
const inject =
  `<script>window.__FASHIONCART_PREVIEW__ = ${JSON.stringify(payload)};</script>` +
  `<script>addEventListener("DOMContentLoaded",function(){` +
  `var b=document.createElement("div");b.innerHTML=${JSON.stringify(banner)};` +
  `document.body.insertBefore(b.firstElementChild,document.body.firstChild);});</script>`;

if (!html.includes("</head>")) {
  console.error("[preview] bundle has no </head>; cannot inject");
  process.exit(1);
}
html = html.replace("</head>", `${inject}</head>`);
html = html.replace("<title>FashionCart</title>", "<title>FashionCart widget preview</title>");

writeFileSync(OUT, html, "utf-8");
console.log(`[preview] wrote ${OUT}`);
console.log(`[preview] ${payload.products.length} products, images from ${IMAGE_BASE}`);
console.log(`[preview] open it directly in a browser - no server, no host, no Claude account`);
