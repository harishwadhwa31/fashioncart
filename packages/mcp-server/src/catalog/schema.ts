/**
 * The catalog feed contract.
 *
 * This file IS the interface described in data/SCHEMA.md. A client's real catalog is swapped in
 * by replacing data/catalog.json; nothing here should need to change to accept it.
 *
 * Validation is strict and fails the process at startup rather than serving a half-broken
 * catalog. That follows the house rule: a measurement failure yields insufficient_data and
 * exclusion, never a false zero. A silently dropped SKU is a false zero.
 */

import { z } from "zod";

export const CATEGORIES = [
  "shirts",
  "trousers",
  "kurtas",
  "dresses",
  "footwear",
  "accessories",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const colourSchema = z.object({
  name: z.string().min(1),
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "hex must be #RRGGBB"),
});

export const creditSchema = z.object({
  source: z.string(),
  author: z.string(),
  licence: z.string(),
  url: z.string().nullable(),
});

export const attributesSchema = z
  .object({
    fabric: z.string(),
    care: z.string(),
    fit: z.string(),
    occasion: z.string(),
    pattern: z.string(),
  })
  // Unknown extra attributes are preserved and displayed as-is, so a client can add
  // "sleeveLength" or "neckline" without a code change.
  .catchall(z.string());

export const productSchema = z
  .object({
    id: z.string().min(1).regex(/^[A-Za-z0-9._-]+$/, "id must be URL-safe"),
    name: z.string().min(1),
    brand: z.string().min(1),
    category: z.enum(CATEGORIES),
    price: z.number().int().nonnegative(),
    mrp: z.number().int().nonnegative(),
    colours: z.array(colourSchema).min(1),
    sizes: z.array(z.string().min(1)).min(1),
    stockBySize: z.record(z.string(), z.number().int().nonnegative()),
    thumbnailUrl: z.string().min(1),
    galleryUrls: z.array(z.string()),
    credit: creditSchema,
    shortDescription: z.string().min(1),
    longDescription: z.string().min(1),
    attributes: attributesSchema,
    rating: z.number().min(0).max(5),
    reviewCount: z.number().int().nonnegative(),
    memberOnly: z.boolean(),
    tags: z.array(z.string()),
  })
  .superRefine((p, ctx) => {
    if (p.mrp < p.price) {
      ctx.addIssue({
        code: "custom",
        path: ["mrp"],
        message: `mrp (${p.mrp}) is below price (${p.price}) for ${p.id}`,
      });
    }
    const declared = new Set(p.sizes);
    for (const size of Object.keys(p.stockBySize)) {
      if (!declared.has(size)) {
        ctx.addIssue({
          code: "custom",
          path: ["stockBySize", size],
          message: `stockBySize key "${size}" is not in sizes for ${p.id}`,
        });
      }
    }
  });

export const feedSchema = z
  .object({
    feedVersion: z.string(),
    currency: z.string().length(3),
    locale: z.string().min(2),
    productCount: z.number().int().optional(),
    products: z.array(productSchema).min(1),
  })
  .superRefine((feed, ctx) => {
    const seen = new Set<string>();
    for (const p of feed.products) {
      if (seen.has(p.id)) {
        ctx.addIssue({ code: "custom", path: ["products"], message: `duplicate SKU id: ${p.id}` });
      }
      seen.add(p.id);
    }
    const major = feed.feedVersion.split(".")[0];
    if (major !== "1") {
      ctx.addIssue({
        code: "custom",
        path: ["feedVersion"],
        message: `unsupported feed major version "${feed.feedVersion}"; this loader understands 1.x`,
      });
    }
  });

export const locationSchema = z.object({
  pincode: z.string().regex(/^\d{6}$/, "Indian pincodes are 6 digits"),
  city: z.string().min(1),
  area: z.string().min(1),
  storeName: z.string().nullable(),
  hasStore: z.boolean(),
  etaDays: z.number().int().positive(),
});

export const fulfilmentSchema = z.object({
  feedVersion: z.string(),
  locations: z.array(locationSchema).min(1),
});

export type RawProduct = z.infer<typeof productSchema>;
export type Feed = z.infer<typeof feedSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Fulfilment = z.infer<typeof fulfilmentSchema>;
export type Colour = z.infer<typeof colourSchema>;
