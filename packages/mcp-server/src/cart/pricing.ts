/**
 * Server-side pricing.
 *
 * The iframe never supplies a total. Every figure below is recomputed from the catalog and the
 * cart lines at the moment it is asked for, including at checkout. A price that arrived from
 * the widget is treated as display state, not as input.
 *
 * All money is integer rupees. No floats touch a total.
 */

import type { Catalog, Product } from "../catalog/loader.js";
import type { Cart, CartLine } from "./store.js";
import type { Member } from "../personalisation/member.js";

export interface PricedLine {
  productId: string;
  name: string;
  brand: string;
  size: string;
  colour: string | null;
  quantity: number;
  unitPrice: number;
  unitMrp: number;
  /** Member unit price when a tier discount applies, else null. */
  unitMemberPrice: number | null;
  /** unitPrice (or member price) x quantity. */
  lineTotal: number;
  /** Set when the requested quantity exceeds stock. The line is clamped, not dropped. */
  adjustment?: {
    requestedQuantity: number;
    availableQuantity: number;
    reason: "insufficient_stock" | "size_unavailable" | "product_unavailable";
  };
}

export interface PricedCart {
  cartId: string;
  currency: string;
  lines: PricedLine[];
  itemCount: number;
  /** Sum of list unit prices x quantity, BEFORE any member discount. */
  listSubtotal: number;
  /** listSubtotal minus memberDiscount. What the shopper actually pays for goods. */
  subtotal: number;
  memberDiscount: number;
  mrpTotal: number;
  youSave: number;
  deliveryFee: number;
  total: number;
  pincode: string | null;
  memberTier: string | null;
  /** Lines that could not be priced at all, with a reason. Never silently dropped. */
  removed: { productId: string; size: string; reason: string }[];
  adjusted: boolean;
}

export const FREE_DELIVERY_THRESHOLD = 1499;
export const DELIVERY_FEE = 99;

function unitFor(product: Product, member: Member | null): { price: number; memberPrice: number | null } {
  const price = product.price;
  if (!member || member.discountPct <= 0) return { price, memberPrice: null };
  const memberPrice = Math.round(price * (1 - member.discountPct / 100));
  return { price, memberPrice: memberPrice < price ? memberPrice : null };
}

/**
 * Re-price a cart from scratch.
 *
 * Lines whose product has vanished from the feed, or whose size no longer exists, are moved to
 * `removed` with a reason rather than dropped. Lines whose quantity exceeds current stock are
 * clamped and annotated. Both are visible to the caller, because a cart that quietly shrinks
 * between the widget and the checkout page is exactly the sort of thing that surfaces on stage.
 */
export function priceCart(catalog: Catalog, cart: Cart, member: Member | null): PricedCart {
  const lines: PricedLine[] = [];
  const removed: PricedCart["removed"] = [];
  let adjusted = false;

  for (const line of cart.lines) {
    const product = catalog.byId.get(line.productId);
    if (!product) {
      removed.push({ productId: line.productId, size: line.size, reason: "product_unavailable" });
      adjusted = true;
      continue;
    }
    if (!product.sizes.includes(line.size)) {
      removed.push({ productId: line.productId, size: line.size, reason: "size_unavailable" });
      adjusted = true;
      continue;
    }

    const available = product.stockBySize[line.size] ?? 0;
    const quantity = Math.max(0, Math.min(line.quantity, available));

    if (quantity === 0) {
      removed.push({ productId: line.productId, size: line.size, reason: "out_of_stock" });
      adjusted = true;
      continue;
    }

    const { price, memberPrice } = unitFor(product, member);
    const effective = memberPrice ?? price;

    const priced: PricedLine = {
      productId: product.id,
      name: product.name,
      brand: product.brand,
      size: line.size,
      colour: line.colour,
      quantity,
      unitPrice: price,
      unitMrp: product.mrp,
      unitMemberPrice: memberPrice,
      lineTotal: effective * quantity,
    };

    if (quantity < line.quantity) {
      priced.adjustment = {
        requestedQuantity: line.quantity,
        availableQuantity: available,
        reason: "insufficient_stock",
      };
      adjusted = true;
    }

    lines.push(priced);
  }

  const itemCount = lines.reduce((n, l) => n + l.quantity, 0);
  const listSubtotal = lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
  const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
  const memberDiscount = listSubtotal - subtotal;
  const mrpTotal = lines.reduce((n, l) => n + l.unitMrp * l.quantity, 0);
  const deliveryFee = subtotal === 0 || subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;

  return {
    cartId: cart.id,
    currency: catalog.currency,
    lines,
    itemCount,
    listSubtotal,
    subtotal,
    memberDiscount,
    mrpTotal,
    youSave: mrpTotal - subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    pincode: cart.pincode,
    memberTier: member?.tier ?? null,
    removed,
    adjusted,
  };
}

export function formatINR(amount: number): string {
  // en-IN grouping (lakh/crore) without pulling in a formatting dependency.
  const s = String(Math.abs(amount));
  if (s.length <= 3) return `${amount < 0 ? "-" : ""}Rs ${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${amount < 0 ? "-" : ""}Rs ${rest},${last3}`;
}
