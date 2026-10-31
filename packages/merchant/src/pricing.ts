/**
 * Server side re-pricing.
 *
 * The checkout token says WHAT the shopper wants: product ids, sizes, quantities. It carries no
 * money at all. Every figure this site prints is recomputed here from the catalog at the moment
 * it is asked for, on the checkout page, on the payment page and again when the order is
 * placed. A price that arrived over the wire is not input, it is not even a hint.
 *
 * All money is integer rupees. There is no float anywhere in a total, and formatRupees() throws
 * rather than print one, because a rounding artefact on a total is the kind of defect that only
 * ever shows up in front of an audience.
 */

import { catalog, fulfilment, type Product } from "./catalog.js";

export interface MemberTier {
  /** The id as it appears in the token's `m` field. */
  readonly id: string;
  /** Display label, for example "Gold". */
  readonly label: string;
  readonly discountPct: number;
}

/**
 * Demo tiers, matching the connector's mock member directory. This is a price multiplier and
 * nothing else: it is not authentication, it grants no access, and a real deployment replaces
 * it with the merchant's own identity provider.
 */
const MEMBER_TIERS: Record<string, MemberTier> = {
  "gold-demo": { id: "gold-demo", label: "Gold", discountPct: 10 },
  "silver-demo": { id: "silver-demo", label: "Silver", discountPct: 5 },
};

export function resolveMemberTier(memberId: string | null | undefined): MemberTier | null {
  if (!memberId) return null;
  return MEMBER_TIERS[memberId] ?? null;
}

export const FREE_DELIVERY_THRESHOLD = 1499;
export const DELIVERY_FEE = 99;

/** Quoted when the pincode is unknown to the fulfilment feed. Stated, not measured. */
export const DEFAULT_ETA_DAYS = 4;

export interface RequestedLine {
  productId: string;
  size: string;
  quantity: number;
}

export interface PricedLine {
  product: Product;
  size: string;
  /** Quantity actually being sold, after clamping to stock. */
  quantity: number;
  unitList: number;
  /** unitList after the member discount, rounded to the nearest rupee. Equals unitList if none. */
  unitPaid: number;
  unitMrp: number;
  /** unitList * quantity. This is what appears in the subtotal, BEFORE the discount line. */
  lineList: number;
  /** unitPaid * quantity. */
  linePaid: number;
  lineMrp: number;
  /** Set when stock forced a smaller quantity than the token asked for. */
  clampedFrom: number | null;
}

export interface DroppedLine {
  productId: string;
  name: string | null;
  size: string;
  reason: "product_unavailable" | "size_unavailable" | "out_of_stock";
}

export interface PricedCart {
  lines: PricedLine[];
  /** Lines that could not be sold. Surfaced, never silently dropped. */
  dropped: DroppedLine[];
  itemCount: number;
  /** Sum of catalog prices x quantity, BEFORE any member discount. */
  listSubtotal: number;
  memberDiscount: number;
  /** listSubtotal minus memberDiscount. What the goods cost. */
  subtotal: number;
  /** Sum of MRP x quantity, for the "you save" line against the crossed out prices. */
  mrpTotal: number;
  deliveryFee: number;
  /** Rupees still needed to reach free delivery, or null when it is already free. */
  freeDeliveryShortfall: number | null;
  total: number;
  tier: MemberTier | null;
  /** True when any line was clamped or dropped, so pages can show a calm notice. */
  adjusted: boolean;
}

/**
 * Round per unit, then multiply.
 *
 * Rounding the line total instead would put this site a rupee away from the figure the
 * assistant quoted in conversation on some carts, and the two disagreeing on stage is the whole
 * problem the demo is meant to avoid. The connector rounds per unit, so this does too.
 */
function memberUnitPrice(price: number, tier: MemberTier | null): number {
  if (!tier || tier.discountPct <= 0) return price;
  const discounted = Math.round(price * (1 - tier.discountPct / 100));
  return Math.min(discounted, price);
}

export function priceCart(lines: readonly RequestedLine[], memberId: string | null): PricedCart {
  const tier = resolveMemberTier(memberId);
  const priced: PricedLine[] = [];
  const dropped: DroppedLine[] = [];

  for (const requested of lines) {
    const product = catalog.byId.get(requested.productId);
    if (!product) {
      dropped.push({
        productId: requested.productId,
        name: null,
        size: requested.size,
        reason: "product_unavailable",
      });
      continue;
    }
    if (!product.sizes.includes(requested.size)) {
      dropped.push({
        productId: product.id,
        name: product.name,
        size: requested.size,
        reason: "size_unavailable",
      });
      continue;
    }

    const available = product.stockBySize[requested.size] ?? 0;
    const quantity = Math.max(0, Math.min(requested.quantity, available));
    if (quantity === 0) {
      dropped.push({
        productId: product.id,
        name: product.name,
        size: requested.size,
        reason: "out_of_stock",
      });
      continue;
    }

    const unitPaid = memberUnitPrice(product.price, tier);
    priced.push({
      product,
      size: requested.size,
      quantity,
      unitList: product.price,
      unitPaid,
      unitMrp: product.mrp,
      lineList: product.price * quantity,
      linePaid: unitPaid * quantity,
      lineMrp: product.mrp * quantity,
      clampedFrom: quantity < requested.quantity ? requested.quantity : null,
    });
  }

  const itemCount = priced.reduce((n, l) => n + l.quantity, 0);
  const listSubtotal = priced.reduce((n, l) => n + l.lineList, 0);
  const subtotal = priced.reduce((n, l) => n + l.linePaid, 0);
  const memberDiscount = listSubtotal - subtotal;
  const mrpTotal = priced.reduce((n, l) => n + l.lineMrp, 0);

  // Threshold tested against the post discount subtotal, matching the connector. If the two
  // sides tested different bases, a cart near the threshold would be quoted free delivery by
  // the assistant and charged 99 here.
  const deliveryFee = subtotal === 0 || subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
  const total = subtotal + deliveryFee;

  // The checkout page prints these four numbers as an addition the shopper can follow. Assert
  // the arithmetic here rather than trusting it: if a future change breaks the identity, this
  // fails in the request that broke it and not in a screenshot.
  if (listSubtotal - memberDiscount + deliveryFee !== total) {
    throw new Error(
      "Price statement does not balance: " +
        listSubtotal +
        " - " +
        memberDiscount +
        " + " +
        deliveryFee +
        " != " +
        total
    );
  }

  return {
    lines: priced,
    dropped,
    itemCount,
    listSubtotal,
    memberDiscount,
    subtotal,
    mrpTotal,
    deliveryFee,
    freeDeliveryShortfall:
      deliveryFee > 0 ? Math.max(0, FREE_DELIVERY_THRESHOLD - subtotal) : null,
    total,
    tier,
    adjusted: dropped.length > 0 || priced.some((l) => l.clampedFrom !== null),
  };
}

export interface DeliveryEstimate {
  etaDays: number;
  /** "Mumbai" when the pincode is known, otherwise null. Never guessed. */
  city: string | null;
  area: string | null;
  /** Formatted arrival date, for example "Thu, 11 Sep". */
  arrivesBy: string;
}

export function deliveryEstimate(pincode: string | null | undefined): DeliveryEstimate {
  const location = pincode ? fulfilment.get(pincode) : undefined;
  const etaDays = location?.etaDays ?? DEFAULT_ETA_DAYS;

  const arrival = new Date(Date.now() + etaDays * 24 * 60 * 60 * 1000);
  const arrivesBy = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(arrival);

  return {
    etaDays,
    city: location?.city ?? null,
    area: location?.area ?? null,
    arrivesBy,
  };
}

/**
 * Indian digit grouping (lakh and crore), done by hand rather than through Intl.
 *
 * Intl.NumberFormat with en-IN would also be correct, but it can emit a non breaking space
 * before the value and a currency glyph depending on the ICU build, and this project's house
 * style is a plain "Rs " prefix. Doing the grouping here makes the output identical everywhere.
 */
export function groupIndian(value: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(value));
  const grouped =
    digits.length <= 3
      ? digits
      : digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + digits.slice(-3);
  return (negative ? "-" : "") + grouped;
}

export function formatRupees(amount: number): string {
  if (!Number.isInteger(amount)) {
    throw new TypeError("Money must be integer rupees, received " + amount);
  }
  return "Rs " + groupIndian(amount);
}

/** Plain grouped integer with no currency prefix, for review counts and similar. */
export function formatCount(value: number): string {
  return groupIndian(Math.round(value));
}
