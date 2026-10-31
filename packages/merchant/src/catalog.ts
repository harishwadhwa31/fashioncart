/**
 * Catalog and fulfilment feed.
 *
 * Read once from disk at startup and held immutably for the life of the instance. Swapping in a
 * real catalog is a file swap: nothing here imports a TypeScript array.
 *
 * Derived values (discountPct, inStock, inStockSizes, totalStock) are computed HERE and nowhere
 * else, so no page can derive them differently and the feed cannot contradict itself.
 * discountPct in particular is never stored, by instruction.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));

export interface Colour {
  readonly name: string;
  readonly hex: string;
}

export interface Credit {
  readonly source: string;
  readonly author: string;
  readonly licence: string;
  readonly url: string | null;
}

export interface ProductAttributes {
  readonly fabric: string;
  readonly care: string;
  readonly fit: string;
  readonly occasion: string;
  readonly pattern: string;
}

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  /** Integer rupees. Never a float, at any point in the pipeline. */
  readonly price: number;
  readonly mrp: number;
  readonly colours: readonly Colour[];
  readonly sizes: readonly string[];
  readonly stockBySize: Readonly<Record<string, number>>;
  /** Absolute, pointing at the image deployment. See IMAGE_BASE_URL below. */
  readonly thumbnailUrl: string;
  readonly galleryUrls: readonly string[];
  readonly credit: Credit;
  readonly shortDescription: string;
  readonly longDescription: string;
  readonly attributes: ProductAttributes;
  readonly rating: number;
  readonly reviewCount: number;
  readonly memberOnly: boolean;
  readonly tags: readonly string[];

  /** Derived: round((mrp - price) * 100 / mrp), 0 when there is no reduction. */
  readonly discountPct: number;
  readonly totalStock: number;
  readonly inStock: boolean;
  readonly inStockSizes: readonly string[];
}

export interface Catalog {
  readonly feedVersion: string;
  readonly currency: string;
  readonly locale: string;
  readonly products: readonly Product[];
  readonly byId: ReadonlyMap<string, Product>;
  readonly categories: readonly string[];
  readonly brands: readonly string[];
}

export interface FulfilmentLocation {
  readonly pincode: string;
  readonly city: string;
  readonly area: string;
  readonly storeName: string | null;
  readonly hasStore: boolean;
  readonly etaDays: number;
}

export class CatalogLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogLoadError";
  }
}

/**
 * Images are served by the OTHER deployment (the MCP connector), which owns /images. This site
 * ships no image bytes at all, so each catalog path is rewritten to an absolute URL once here,
 * rather than being concatenated at every one of the places a thumbnail gets rendered.
 */
export const IMAGE_BASE_URL = (
  process.env.IMAGE_BASE_URL || "http://localhost:3001"
).replace(/\/+$/, "");

function absoluteImageUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return IMAGE_BASE_URL + (path.startsWith("/") ? path : "/" + path);
}

/**
 * Where the feed lives.
 *
 * src/ and dist/ sit at the same depth under the package root, so both relative paths below are
 * correct whether this file runs through tsx or as compiled JavaScript.
 *
 * The staged copy must win ONLY on Vercel. Preferring it unconditionally would mean that once
 * `npm run predeploy` has run, local edits to the authored feed silently stop taking effect,
 * which presents exactly like a caching bug.
 */
function resolveDataDir(): string {
  const explicit = process.env.DATA_DIR;
  if (explicit) return explicit;

  const staged = resolve(HERE, "../data"); // packages/merchant/data, written by predeploy
  const shared = resolve(HERE, "../../../data"); // <repo>/data, the authored source

  if (process.env.VERCEL && existsSync(join(staged, "catalog.json"))) return staged;
  if (existsSync(join(shared, "catalog.json"))) return shared;
  return staged;
}

export const DATA_DIR = resolveDataDir();

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new CatalogLoadError("Could not read or parse " + path + ": " + (err as Error).message);
  }
}

/**
 * Validate before deriving.
 *
 * A partly valid catalog is worse than no catalog: a dropped SKU becomes an invisible zero in
 * every count downstream, and a float price becomes a total ending in .0000001 on a slide. So
 * this fails the process at startup rather than serving a damaged feed.
 */
function assertProductShape(raw: any, index: number): void {
  const at = "products[" + index + "]";
  const strings = [
    "id",
    "name",
    "brand",
    "category",
    "thumbnailUrl",
    "shortDescription",
    "longDescription",
  ];
  for (const key of strings) {
    if (typeof raw?.[key] !== "string" || raw[key].length === 0) {
      throw new CatalogLoadError(at + "." + key + " must be a non-empty string");
    }
  }
  for (const key of ["price", "mrp"]) {
    if (!Number.isInteger(raw[key]) || raw[key] < 0) {
      throw new CatalogLoadError(at + "." + key + " must be a non-negative integer of rupees");
    }
  }
  if (raw.mrp < raw.price) {
    throw new CatalogLoadError(at + ": mrp (" + raw.mrp + ") is below price (" + raw.price + ")");
  }
  if (typeof raw.rating !== "number" || !Number.isInteger(raw.reviewCount)) {
    throw new CatalogLoadError(at + ": rating must be a number and reviewCount an integer");
  }
  if (!Array.isArray(raw.sizes) || raw.sizes.some((s: unknown) => typeof s !== "string")) {
    throw new CatalogLoadError(at + ".sizes must be an array of strings");
  }
  if (!raw.stockBySize || typeof raw.stockBySize !== "object") {
    throw new CatalogLoadError(at + ".stockBySize must be an object");
  }
  for (const [size, qty] of Object.entries(raw.stockBySize)) {
    if (!Number.isInteger(qty) || (qty as number) < 0) {
      throw new CatalogLoadError(at + ".stockBySize." + size + " must be a non-negative integer");
    }
  }
  if (!Array.isArray(raw.colours) || raw.colours.length === 0) {
    throw new CatalogLoadError(at + ".colours must be a non-empty array");
  }
  if (!Array.isArray(raw.galleryUrls)) {
    throw new CatalogLoadError(at + ".galleryUrls must be an array");
  }
  if (!raw.attributes || typeof raw.attributes !== "object") {
    throw new CatalogLoadError(at + ".attributes must be an object");
  }
  if (!raw.credit || typeof raw.credit.author !== "string") {
    throw new CatalogLoadError(at + ".credit.author must be a string");
  }
}

function toProduct(raw: any): Product {
  const stockBySize: Record<string, number> = { ...raw.stockBySize };
  const totalStock = Object.values(stockBySize).reduce((a, b) => a + b, 0);
  const inStockSizes = (raw.sizes as string[]).filter((s) => (stockBySize[s] ?? 0) > 0);

  return {
    id: raw.id,
    name: raw.name,
    brand: raw.brand,
    category: raw.category,
    price: raw.price,
    mrp: raw.mrp,
    colours: (raw.colours as Colour[]).map((c) => ({ name: c.name, hex: c.hex })),
    sizes: [...raw.sizes],
    stockBySize,
    thumbnailUrl: absoluteImageUrl(raw.thumbnailUrl),
    galleryUrls: (raw.galleryUrls as string[]).map(absoluteImageUrl),
    credit: {
      source: raw.credit.source ?? "",
      author: raw.credit.author,
      licence: raw.credit.licence ?? "",
      url: raw.credit.url ?? null,
    },
    shortDescription: raw.shortDescription,
    longDescription: raw.longDescription,
    attributes: {
      fabric: raw.attributes.fabric ?? "",
      care: raw.attributes.care ?? "",
      fit: raw.attributes.fit ?? "",
      occasion: raw.attributes.occasion ?? "",
      pattern: raw.attributes.pattern ?? "",
    },
    rating: raw.rating,
    reviewCount: raw.reviewCount,
    memberOnly: Boolean(raw.memberOnly),
    tags: Array.isArray(raw.tags) ? [...raw.tags] : [],

    discountPct: raw.mrp > raw.price ? Math.round(((raw.mrp - raw.price) * 100) / raw.mrp) : 0,
    totalStock,
    inStock: totalStock > 0,
    inStockSizes,
  };
}

export function loadCatalog(dataDir: string = DATA_DIR): Catalog {
  const path = resolve(dataDir, "catalog.json");
  const feed = readJson(path) as any;

  if (!feed || !Array.isArray(feed.products) || feed.products.length === 0) {
    throw new CatalogLoadError(path + " has no products array");
  }
  feed.products.forEach(assertProductShape);

  const products: Product[] = feed.products.map(toProduct);
  const byId = new Map(products.map((p) => [p.id, p] as const));

  // Category order follows the feed, not the alphabet: the feed is authored in the order a
  // merchandiser would want them in a nav, and sorting would put accessories first.
  const categories: string[] = [];
  for (const p of products) if (!categories.includes(p.category)) categories.push(p.category);

  return {
    feedVersion: String(feed.feedVersion ?? "unknown"),
    currency: String(feed.currency ?? "INR"),
    locale: String(feed.locale ?? "en-IN"),
    products,
    byId,
    categories,
    brands: [...new Set(products.map((p) => p.brand))].sort(),
  };
}

/**
 * Delivery locations. Optional on purpose: if the file is absent the site still works and every
 * order quotes the national standard lead time instead of a city specific one.
 */
export function loadFulfilment(
  dataDir: string = DATA_DIR
): ReadonlyMap<string, FulfilmentLocation> {
  const path = resolve(dataDir, "fulfilment.json");
  if (!existsSync(path)) return new Map();

  const raw = readJson(path) as any;
  const rows: FulfilmentLocation[] = Array.isArray(raw?.locations) ? raw.locations : [];
  return new Map(rows.filter((l) => typeof l?.pincode === "string").map((l) => [l.pincode, l]));
}

/**
 * Loaded eagerly at module scope, once per instance.
 *
 * Safe as a singleton because it is read only. Unlike the connector's cart store there is no
 * per shopper state here that could leak between concurrent invocations sharing a process.
 * Order state, which IS per shopper, lives in orders.ts and is documented there.
 */
export const catalog: Catalog = loadCatalog();
export const fulfilment: ReadonlyMap<string, FulfilmentLocation> = loadFulfilment();

export function findProduct(id: string): Product | null {
  if (!id) return null;
  return catalog.byId.get(id) ?? catalog.byId.get(id.toUpperCase()) ?? null;
}
