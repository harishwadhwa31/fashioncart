/**
 * Placed orders.
 *
 * IN MEMORY, PER INSTANCE. This Map lives in the process, so an order placed on one serverless
 * instance is invisible to another, and everything is lost on redeploy or cold start. That is
 * acceptable for a single presenter demo and nothing else. In production this is a database
 * row written in the same transaction as the payment authorisation, and /order/:id reads it
 * back by id with an ownership check. The confirmation route already handles "not found"
 * gracefully, which is the behaviour a real deployment needs anyway.
 *
 * An order is a SNAPSHOT, deliberately. The checkout and payment pages re-price from the
 * catalog every time because nothing has been committed yet. Once the order exists it records
 * what was actually charged, so a later catalog edit must not change what the confirmation
 * page says. Re-pricing an order after the fact would be rewriting history.
 */

import { randomBytes } from "node:crypto";

export interface OrderLine {
  productId: string;
  name: string;
  brand: string;
  size: string;
  quantity: number;
  /**
   * Both figures are kept. lineList is what the confirmation prints, because the statement
   * underneath opens with a subtotal BEFORE the member discount and then deducts it on its own
   * row; printing member prices per line above that subtotal would show the discount twice and
   * leave the lines not summing to the total. linePaid is what was actually charged for the
   * line, which is what a refund or a support query needs.
   */
  unitList: number;
  lineList: number;
  unitPaid: number;
  linePaid: number;
  thumbnailUrl: string;
}

export interface DeliveryAddress {
  fullName: string;
  address: string;
  city: string;
  pincode: string;
}

export interface Order {
  id: string;
  placedAt: number;
  cartId: string;
  lines: OrderLine[];
  address: DeliveryAddress;
  itemCount: number;
  listSubtotal: number;
  memberDiscount: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  tierLabel: string | null;
  tierDiscountPct: number | null;
  etaDays: number;
  arrivesBy: string;
}

/**
 * Order numbers a presenter can read off a screen and an audience can follow.
 *
 * The alphabet drops characters that are ambiguous out loud or in a screenshot: I, O, 0, 1, B,
 * 8. Not a security boundary, so the modulo bias in the mapping does not matter; orders are
 * looked up by exact id and hold nothing sensitive.
 */
const ID_ALPHABET = "ACDEFGHJKLMNPQRSTUVWXYZ234567";

export function newOrderId(): string {
  const bytes = randomBytes(6);
  let suffix = "";
  for (const b of bytes) suffix += ID_ALPHABET[b % ID_ALPHABET.length];
  return "FC-" + suffix;
}

/** Old orders are evicted so a long running instance cannot grow without bound. */
const MAX_RETAINED_ORDERS = 500;

class OrderStore {
  private readonly orders = new Map<string, Order>();

  put(order: Order): Order {
    this.orders.set(order.id, order);
    while (this.orders.size > MAX_RETAINED_ORDERS) {
      // Map iteration is insertion ordered, so the first key is the oldest order.
      const oldest = this.orders.keys().next();
      if (oldest.done) break;
      this.orders.delete(oldest.value);
    }
    return order;
  }

  get(id: string): Order | null {
    return this.orders.get(id) ?? null;
  }

  get size(): number {
    return this.orders.size;
  }
}

export const orders = new OrderStore();
