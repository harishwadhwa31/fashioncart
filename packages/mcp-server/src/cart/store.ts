/**
 * CartStore.
 *
 * MCP 2025-11-25 has no protocol session, and the transport runs stateless
 * (sessionIdGenerator: undefined), so there is no per-connection place to hang a cart. State
 * therefore travels the way the core spec's own guidance describes: a server-minted handle
 * returned by a creation call and passed back as an ordinary tool argument.
 *
 * Concretely: every cart operation takes an explicit cartId. There is no "current cart" and no
 * module-level mutable default.
 *
 * That matters more than it looks on Vercel. It is easy to assume module-scope memory does NOT
 * persist between invocations; the opposite is true - Fluid compute deliberately shares one
 * process across concurrent invocations (measured during development).
 * So a module-level "current cart" would not merely be lost, it would LEAK BETWEEN USERS. The
 * explicit-handle rule is a correctness requirement, not tidiness.
 *
 * InMemoryCartStore is for local development and the harness. RedisCartStore is the shape a
 * real deployment uses; it is deliberately left as an interface-conforming stub rather than a
 * half-working implementation, because a silently broken cart is worse than an absent one.
 */

export interface CartLine {
  productId: string;
  size: string;
  colour: string | null;
  quantity: number;
  /** Captured when the line was added, for display only. Checkout re-prices from the catalog. */
  addedAtPrice: number;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  pincode: string | null;
  memberId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CartStore {
  create(seed?: Partial<Pick<Cart, "pincode" | "memberId">>): Promise<Cart>;
  get(cartId: string): Promise<Cart | null>;
  put(cart: Cart): Promise<Cart>;
  delete(cartId: string): Promise<void>;
}

export class CartNotFoundError extends Error {
  constructor(cartId: string) {
    super(
      `Cart "${cartId}" not found or expired. Carts live for a limited time; start a new one ` +
        `with add-to-cart and no cartId.`
    );
    this.name = "CartNotFoundError";
  }
}

export function newCartId(): string {
  // Not a security boundary: the checkout token is signed separately. This only needs to be
  // unguessable enough that two demo sessions do not collide.
  return `cart_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function emptyCart(seed: Partial<Pick<Cart, "pincode" | "memberId">> = {}): Cart {
  const now = Date.now();
  return {
    id: newCartId(),
    lines: [],
    pincode: seed.pincode ?? null,
    memberId: seed.memberId ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface InMemoryCartStoreOptions {
  /** Carts older than this are evicted on access. Default 6 hours. */
  ttlMs?: number;
  /** Hard cap so a long-lived process cannot grow without bound. Default 1000. */
  maxCarts?: number;
}

export class InMemoryCartStore implements CartStore {
  private readonly carts = new Map<string, Cart>();
  private readonly ttlMs: number;
  private readonly maxCarts: number;

  constructor(opts: InMemoryCartStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 6 * 60 * 60 * 1000;
    this.maxCarts = opts.maxCarts ?? 1000;
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, cart] of this.carts) {
      if (cart.updatedAt < cutoff) this.carts.delete(id);
    }
    // Oldest-first eviction if still over the cap.
    if (this.carts.size > this.maxCarts) {
      const ordered = [...this.carts.values()].sort((a, b) => a.updatedAt - b.updatedAt);
      for (const cart of ordered.slice(0, this.carts.size - this.maxCarts)) {
        this.carts.delete(cart.id);
      }
    }
  }

  async create(seed?: Partial<Pick<Cart, "pincode" | "memberId">>): Promise<Cart> {
    this.evictExpired();
    const cart = emptyCart(seed);
    this.carts.set(cart.id, cart);
    return structuredClone(cart);
  }

  async get(cartId: string): Promise<Cart | null> {
    this.evictExpired();
    const cart = this.carts.get(cartId);
    return cart ? structuredClone(cart) : null;
  }

  async put(cart: Cart): Promise<Cart> {
    const next = { ...cart, updatedAt: Date.now() };
    this.carts.set(next.id, structuredClone(next));
    return next;
  }

  async delete(cartId: string): Promise<void> {
    this.carts.delete(cartId);
  }
}

/**
 * Redis-backed store. Interface-complete, intentionally not implemented.
 *
 * Wiring this up is the single change required to run FashionCart across more than one
 * serverless instance. It is left unimplemented rather than stubbed with a working-looking
 * no-op so that choosing it without providing a client fails immediately and loudly.
 */
export class RedisCartStore implements CartStore {
  constructor(private readonly _client: unknown, private readonly _ttlSeconds = 21_600) {}

  private notImplemented(): never {
    throw new Error(
      "RedisCartStore is not implemented. Provide a Redis client and implement create/get/put/" +
        "delete, keying on `fashioncart:cart:<id>` with a TTL. Until then use InMemoryCartStore."
    );
  }

  async create(): Promise<Cart> {
    this.notImplemented();
  }
  async get(): Promise<Cart | null> {
    this.notImplemented();
  }
  async put(): Promise<Cart> {
    this.notImplemented();
  }
  async delete(): Promise<void> {
    this.notImplemented();
  }
}
