/**
 * Catalog querying: filter, sort, paginate, and build facets.
 *
 * Facets are computed over the FILTERED-BEFORE-PAGINATION set, not over the page. The widget
 * filters client-side within the returned page (that is the point of the lean shape carrying
 * colours and sizes), but its chips need to reflect the whole result set or the counts lie.
 */

import type { Catalog, Product } from "./loader.js";

export interface ProductQuery {
  q?: string;
  category?: string;
  brand?: string;
  colour?: string;
  size?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  /** Member-only SKUs are excluded unless the caller is a member. */
  includeMemberOnly?: boolean;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
}

export const SORT_KEYS = [
  "relevance",
  "price-asc",
  "price-desc",
  "rating-desc",
  "discount-desc",
  "newest",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface QueryResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasMore: boolean;
  facets: Facets;
  /** Filters that matched nothing, so the tool can say so in plain text rather than returning
   *  an empty list with no explanation. */
  emptyReason?: string;
}

export interface Facets {
  categories: { value: string; count: number }[];
  brands: { value: string; count: number }[];
  colours: { value: string; count: number }[];
  sizes: { value: string; count: number }[];
  priceBuckets: { label: string; min: number; max: number | null; count: number }[];
}

const PRICE_BUCKETS: { label: string; min: number; max: number | null }[] = [
  { label: "Under Rs 1,000", min: 0, max: 999 },
  { label: "Rs 1,000 - 2,499", min: 1000, max: 2499 },
  { label: "Rs 2,500 - 3,999", min: 2500, max: 3999 },
  { label: "Rs 4,000 and above", min: 4000, max: null },
];

function tally(values: string[]): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function buildFacets(products: Product[]): Facets {
  return {
    categories: tally(products.map((p) => p.category)),
    brands: tally(products.map((p) => p.brand)),
    colours: tally(products.flatMap((p) => p.colours.map((c) => c.name))),
    sizes: tally(products.flatMap((p) => [...p.inStockSizes])),
    priceBuckets: PRICE_BUCKETS.map((b) => ({
      ...b,
      count: products.filter((p) => p.price >= b.min && (b.max === null || p.price <= b.max)).length,
    })),
  };
}

function score(p: Product, terms: string[]): number {
  if (terms.length === 0) return 0;
  let s = 0;
  const name = p.name.toLowerCase();
  const brand = p.brand.toLowerCase();
  for (const t of terms) {
    if (name.includes(t)) s += 10;
    if (brand.includes(t)) s += 6;
    if (p.category.includes(t)) s += 4;
    if (p.searchText.includes(t)) s += 1;
  }
  return s;
}

function comparator(sort: SortKey, terms: string[]): (a: Product, b: Product) => number {
  switch (sort) {
    case "price-asc":
      return (a, b) => a.price - b.price;
    case "price-desc":
      return (a, b) => b.price - a.price;
    case "rating-desc":
      return (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount;
    case "discount-desc":
      return (a, b) => b.discountPct - a.discountPct;
    case "newest":
      // No date in the feed. "newest" is the feed's own order, which is how merchandising
      // teams usually express it. Documented rather than faked with a random date.
      return () => 0;
    case "relevance":
    default:
      return (a, b) => score(b, terms) - score(a, terms) || b.rating - a.rating;
  }
}

export const DEFAULT_PAGE_SIZE = 24;

export function queryProducts(catalog: Catalog, query: ProductQuery, hardMaxPageSize: number): QueryResult {
  const terms = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);

  const appliedFilters: string[] = [];
  let items = [...catalog.products];

  if (!query.includeMemberOnly) {
    items = items.filter((p) => !p.memberOnly);
  }
  if (query.category) {
    const c = query.category.toLowerCase();
    items = items.filter((p) => p.category === c);
    appliedFilters.push(`category=${query.category}`);
  }
  if (query.brand) {
    const b = query.brand.toLowerCase();
    items = items.filter((p) => p.brand.toLowerCase() === b);
    appliedFilters.push(`brand=${query.brand}`);
  }
  if (query.colour) {
    const c = query.colour.toLowerCase();
    items = items.filter((p) => p.colours.some((x) => x.name.toLowerCase() === c));
    appliedFilters.push(`colour=${query.colour}`);
  }
  if (query.size) {
    const s = query.size.toLowerCase();
    items = items.filter((p) => p.inStockSizes.some((x) => x.toLowerCase() === s));
    appliedFilters.push(`size=${query.size}`);
  }
  if (query.minPrice !== undefined) {
    items = items.filter((p) => p.price >= query.minPrice!);
    appliedFilters.push(`minPrice=${query.minPrice}`);
  }
  if (query.maxPrice !== undefined) {
    items = items.filter((p) => p.price <= query.maxPrice!);
    appliedFilters.push(`maxPrice=${query.maxPrice}`);
  }
  if (query.inStockOnly) {
    items = items.filter((p) => p.inStock);
    appliedFilters.push("inStockOnly");
  }
  if (terms.length) {
    items = items.filter((p) => terms.some((t) => p.searchText.includes(t)));
    appliedFilters.push(`q="${query.q}"`);
  }

  const facets = buildFacets(items);
  const total = items.length;

  items.sort(comparator(query.sort ?? "relevance", terms));

  // Clamp rather than trust. pageSize arrives from the model, which will happily ask for 500.
  const requested = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageSize = Math.max(1, Math.min(requested, hardMaxPageSize));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.max(1, Math.min(query.page ?? 1, pageCount));
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  let emptyReason: string | undefined;
  if (total === 0) {
    emptyReason = appliedFilters.length
      ? `No products match ${appliedFilters.join(", ")}.`
      : "No products in the catalog.";
  }

  return {
    items: pageItems,
    total,
    page,
    pageSize,
    pageCount,
    hasMore: start + pageItems.length < total,
    facets,
    emptyReason,
  };
}
