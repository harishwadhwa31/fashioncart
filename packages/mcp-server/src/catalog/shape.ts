/**
 * Wire shapes.
 *
 * Two, and only two:
 *   lean  - the list shape returned by search-products. MEASURED at ~179 tokens per product.
 *   full  - the single-product shape returned by get-product-details. ~541 tokens.
 *
 * The lean shape exists because ceiling A (25,000 tokens) binds well before ceiling B
 * (150,000 chars). Measured 2026-09-06 with Anthropic count_tokens against the real catalog:
 * JSON runs about 1.82 characters per token, so 24 products in the obvious shape cost 6,082
 * tokens, a quarter of the whole budget for one search. Three deliberate economies bring that
 * to 4,293 (17.2%) with no information lost:
 *
 *   1. colour hex codes are sent ONCE in envelope.palette; products carry colour names only
 *   2. sizes are a comma-joined string, not an array of quoted strings
 *   3. thumbnails are derived by the widget from envelope.thumbnailTemplate and the SKU id
 *
 * Every one of those is reversible in the widget with no server round trip.
 */

import type { Catalog, Product } from "./loader.js";
import type { Location } from "./schema.js";

export const THUMBNAIL_TEMPLATE = "/images/{id}/thumb.webp";
export const GALLERY_TEMPLATE = "/images/{id}/{n}.webp";

export function expandTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

/**
 * Availability string for a pincode.
 *
 * Derived from stockBySize plus fulfilment.json, never stored: a per-SKU-per-pincode table
 * would be 60 x N rows that go stale the moment stock moves.
 *
 * Deterministic on (sku, pincode) so a demo repeats identically. Returns null for an unknown
 * pincode rather than throwing, and the widget then omits the line - an unknown location is
 * insufficient_data, not "unavailable".
 */
export function availabilityFor(product: Product, location: Location | undefined): string | null {
  if (!location) return null;
  if (!product.inStock) return "Out of stock";

  if (location.hasStore) {
    let seed = 0;
    const key = product.id + location.pincode;
    for (let i = 0; i < key.length; i++) seed = (seed + key.charCodeAt(i)) | 0;
    const atStore = Math.abs(seed) % 5;
    if (atStore > 0) return `${atStore} left at ${location.area}`;
  }

  return `Ships in ${location.etaDays} day${location.etaDays === 1 ? "" : "s"}`;
}

export interface LeanProduct {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  discountPct: number;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  memberOnly: boolean;
  colours: string[];
  /** Comma-joined in-stock sizes, e.g. "S,M,L". Empty string when nothing is in stock. */
  sizes: string;
  availability?: string | null;
  /** Present only when member pricing applied. Absent, not null, to save the key on every row. */
  memberPrice?: number;
}

export function toLean(
  product: Product,
  opts: { location?: Location; memberPrice?: number } = {}
): LeanProduct {
  const lean: LeanProduct = {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    price: product.price,
    mrp: product.mrp,
    discountPct: product.discountPct,
    rating: product.rating,
    reviewCount: product.reviewCount,
    inStock: product.inStock,
    memberOnly: product.memberOnly,
    colours: product.colours.map((c) => c.name),
    sizes: product.inStockSizes.join(","),
  };

  if (opts.location) lean.availability = availabilityFor(product, opts.location);
  if (opts.memberPrice !== undefined && opts.memberPrice < product.price) {
    lean.memberPrice = opts.memberPrice;
  }

  return lean;
}

export interface FullProduct extends Omit<LeanProduct, "colours" | "sizes"> {
  colours: { name: string; hex: string }[];
  sizes: string[];
  stockBySize: Record<string, number>;
  inStockSizes: string[];
  thumbnailUrl: string;
  galleryUrls: string[];
  shortDescription: string;
  longDescription: string;
  attributes: Record<string, string>;
  credit: { source: string; author: string; licence: string; url: string | null };
  tags: string[];
}

export function toFull(
  product: Product,
  opts: { location?: Location; memberPrice?: number } = {}
): FullProduct {
  const lean = toLean(product, opts);
  return {
    ...lean,
    colours: product.colours.map((c) => ({ name: c.name, hex: c.hex })),
    sizes: [...product.sizes],
    stockBySize: { ...product.stockBySize },
    inStockSizes: [...product.inStockSizes],
    thumbnailUrl: product.thumbnailUrl,
    galleryUrls: [...product.galleryUrls],
    shortDescription: product.shortDescription,
    longDescription: product.longDescription,
    attributes: { ...product.attributes },
    credit: { ...product.credit },
    tags: [...product.tags],
  };
}

/**
 * The palette needed by a given page. Sending the whole catalog palette would waste tokens on
 * colours no visible card uses.
 */
export function paletteFor(catalog: Catalog, products: readonly Product[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of products) {
    for (const c of p.colours) out[c.name] ??= c.hex;
  }
  return out;
}
