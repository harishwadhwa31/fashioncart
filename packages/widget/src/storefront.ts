/**
 * The storefront view: grid, carousel, client-side filters, per-card quantity stepper.
 *
 * Scope discipline, straight from the brief: browse and adjust quantities. Nothing else. No
 * checkout, no address form, no product Q&A. Those stay in the conversation, where the model
 * can actually help. A widget that reimplements the whole shop is a worse shop AND a worse
 * assistant.
 *
 * FILTERING AND SORTING ARE CLIENT-SIDE, over the set already returned. A filter chip must never
 * cost a tool round trip: the payload is already in memory, the user expects instant feedback,
 * and every round trip spends context budget. The server's facets tell us what the FULL result
 * set contains, so the chips can say "Kurtas 10" even when only 24 of 60 rows are loaded.
 */

import { bridge } from "./bridge.js";
import { h, mount } from "./dom.js";
import { rupees, pct, thumbUrl, withImageFallback } from "./format.js";

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
  sizes: string;
  availability?: string | null;
  memberPrice?: number;
}

export interface SearchPayload {
  products: LeanProduct[];
  page: number;
  pageCount: number;
  total: number;
  hasMore: boolean;
  palette: Record<string, string>;
  thumbnailTemplate: string;
  imageBaseUrl: string;
  facets?: {
    categories: { value: string; count: number }[];
    brands: { value: string; count: number }[];
    colours: { value: string; count: number }[];
    sizes: { value: string; count: number }[];
  };
  deliveryTo?: string | null;
  member?: { displayName: string; tier: string; discountPct: number } | null;
  productPageBase?: string;
}

type Sort = "relevance" | "price-asc" | "price-desc" | "rating" | "discount";

const filters = { category: "", colour: "", size: "", inStockOnly: false };
let sort: Sort = "relevance";

/**
 * How many cards to render before requiring an explicit expand.
 *
 * MEASURED: the host reports containerDimensions.maxHeight = 5000 and CLIPS beyond it with no
 * warning. 24 cards in three columns measured 4,230px - inside the cap, but with no room for a
 * taller card or a wrapped chip row. Twelve keeps a comfortable margin at every width, and the
 * rest are one click away rather than silently cut off.
 */
const INITIAL_ROWS = 12;
let showAll = false;
let cartId: string | null = null;
const qty = new Map<string, number>();
const chosenSize = new Map<string, string>();

export function setCartId(id: string | null): void {
  cartId = id;
}

/**
 * Tell the model what the widget just did to the cart.
 *
 * A tool call the WIDGET makes never reaches the conversation, so the model cannot see it. Adding
 * two kurtas with the Add buttons therefore produced a real server cart the model had never heard
 * of: asked to check out, it had no cartId, so it asked which product and size and started a
 * SECOND cart with one item. The shopper watched their basket silently reset.
 *
 * Debounced, because a stepper is clicked in bursts and one message per click would flood the
 * transcript. One update once the shopper stops.
 */
async function checkOutNow(): Promise<void> {
  if (!cartId) return;
  if (bridge.can.openLinks) {
    const r = await bridge.callTool("checkout", { cartId });
    const url = r && typeof r.checkoutUrl === "string" ? r.checkoutUrl : "";
    if (url) {
      await bridge.openLink(url);
      return;
    }
  }
  if (bridge.can.updateModelContext) {
    await bridge.tellModel(`Ready to check out cart ${cartId}.`);
  }
}

let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifyModelOfCart(summary: () => string): void {
  if (!bridge.can.updateModelContext) return;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    void bridge.tellModel(summary());
  }, 900);
}

function visible(items: LeanProduct[]): LeanProduct[] {
  let out = items.filter((p) => {
    if (filters.category && p.category !== filters.category) return false;
    if (filters.colour && !p.colours.includes(filters.colour)) return false;
    if (filters.size && !p.sizes.split(",").includes(filters.size)) return false;
    if (filters.inStockOnly && !p.inStock) return false;
    return true;
  });
  const by: Record<Sort, (a: LeanProduct, b: LeanProduct) => number> = {
    relevance: () => 0,
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    rating: (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
    discount: (a, b) => b.discountPct - a.discountPct,
  };
  out = [...out].sort(by[sort]);
  return out;
}

function chip(label: string, count: number | null, active: boolean, onClick: () => void): HTMLElement {
  return h(
    "button",
    { class: "chip", type: "button", "aria-pressed": String(active), onclick: onClick },
    label,
    count !== null ? h("span", { class: "n" }, String(count)) : null
  );
}

function stepper(p: LeanProduct, data: SearchPayload, rerender: () => void): HTMLElement {
  const sizes = p.sizes ? p.sizes.split(",") : [];
  const current = qty.get(p.id) ?? 0;
  const size = chosenSize.get(p.id) ?? sizes[0] ?? "";
  const buyable = p.inStock && sizes.length > 0 && bridge.isHosted;

  async function change(next: number): Promise<void> {
    const clamped = Math.max(0, Math.min(next, 10));
    qty.set(p.id, clamped);
    rerender();

    // Optimistic UI, authoritative server. The widget never computes a total; it asks.
    if (clamped === 0 && cartId) {
      const r = await bridge.callTool("remove-from-cart", { cartId, productId: p.id, size });
      if (r?.cart) cartId = (r.cart as any).cartId;
    } else if (current === 0) {
      const r = await bridge.callTool("add-to-cart", {
        productId: p.id,
        size,
        quantity: clamped,
        cartId: cartId ?? undefined,
        memberId: data.member ? "demo" : undefined,
      });
      if (r?.cart) cartId = (r.cart as any).cartId;
    } else if (cartId) {
      const r = await bridge.callTool("set-quantity", { cartId, productId: p.id, size, quantity: clamped });
      if (r?.cart) cartId = (r.cart as any).cartId;
    }
    rerender();

    // The model cannot see the call above. Without this it does not know the cart exists.
    notifyModelOfCart(() => {
      const lines = [...qty.entries()].filter(([, n]) => n > 0).length;
      return cartId
        ? `The shopper is using the FashionCart storefront and has ${lines} line(s) in cart ` +
            `${cartId}. Use that exact cartId for every cart or checkout call. Do not start a ` +
            `new cart and do not ask them what is in it; call get-cart if you need the contents.`
        : "The shopper emptied their FashionCart bag.";
    });
  }

  if (current === 0) {
    return h(
      "div",
      { class: "step" },
      h(
        "button",
        {
          class: "add",
          type: "button",
          disabled: !buyable,
          title: !bridge.isHosted ? "Preview mode: no host to call" : p.inStock ? "" : "Out of stock",
          onclick: () => void change(1),
        },
        p.inStock ? "Add" : "Sold out"
      )
    );
  }

  return h(
    "div",
    { class: "step" },
    h("button", { type: "button", onclick: () => void change(current - 1), "aria-label": "Decrease" }, "−"),
    h("div", { class: "q" }, String(current)),
    h("button", { type: "button", disabled: current >= 10, onclick: () => void change(current + 1), "aria-label": "Increase" }, "+")
  );
}

function card(p: LeanProduct, data: SearchPayload, rerender: () => void): HTMLElement {
  const sizes = p.sizes ? p.sizes.split(",") : [];
  const selected = chosenSize.get(p.id) ?? sizes[0] ?? "";
  const img = h("img", { alt: p.name, loading: "lazy" });
  withImageFallback(img, thumbUrl(data.imageBaseUrl, data.thumbnailTemplate, p.id));

  const shot = h(
    "div",
    { class: "shot" },
    img,
    p.memberOnly ? h("span", { class: "flag" }, "MEMBER") : null,
    !p.inStock ? h("span", { class: "flag oos" }, "SOLD OUT") : null
  );

  // The whole image is the affordance to leave. Verified: this triggers Claude's
  // "Open external link" modal every time, which is expected and is part of the design.
  shot.style.cursor = bridge.can.openLinks ? "pointer" : "default";
  shot.addEventListener("click", () => {
    const base = data.productPageBase;
    if (base) void bridge.openLink(`${base}/product/${encodeURIComponent(p.id)}`);
  });

  // The three numbers on a price row must reconcile. `discountPct` from the server is computed
  // against the LIST price, so printing it beside a member price shows a percentage that does
  // not describe either of the visible figures. Recompute against what is actually displayed.
  const effective = p.memberPrice ?? p.price;
  const shownOff = p.mrp > effective ? Math.round(((p.mrp - effective) * 100) / p.mrp) : 0;
  const isMemberPrice = p.memberPrice !== undefined && p.memberPrice < p.price;

  return h(
    "article",
    { class: "card" },
    shot,
    h(
      "div",
      { class: "body" },
      h("div", { class: "brand" }, p.brand),
      h("div", { class: "name" }, p.name),
      h(
        "div",
        { class: "price" },
        h("span", { class: "now" }, rupees(effective)),
        p.mrp > effective ? h("span", { class: "was" }, rupees(p.mrp)) : null,
        shownOff > 0 ? h("span", { class: "off" }, pct(shownOff)) : null,
        isMemberPrice ? h("span", { class: "meta" }, "member") : null
      ),
      p.colours.length
        ? h(
            "div",
            { class: "swatches" },
            ...p.colours.slice(0, 5).map((name) =>
              h("span", { class: "sw", title: name, style: `background:${data.palette[name] ?? "#ccc"}` })
            )
          )
        : null,
      sizes.length
        ? h(
            "div",
            { class: "sizes" },
            ...sizes.slice(0, 6).map((s) =>
              h(
                "button",
                {
                  class: "size",
                  type: "button",
                  "aria-pressed": String(s === selected),
                  onclick: () => {
                    chosenSize.set(p.id, s);
                    rerender();
                  },
                },
                s
              )
            )
          )
        : null,
      h("div", { class: "meta" }, `${p.rating.toFixed(1)} ★ (${p.reviewCount})`),
      p.availability ? h("div", { class: "meta" }, p.availability) : null,
      stepper(p, data, rerender)
    )
  );
}

export function renderStorefront(root: HTMLElement, data: SearchPayload): void {
  const rerender = () => renderStorefront(root, data);
  const all = visible(data.products);
  const items = showAll ? all : all.slice(0, INITIAL_ROWS);
  const hidden = all.length - items.length;
  const facets = data.facets;

  // Carousel for a small set, grid for a large one. Claude's own design guidance names 3 to 8
  // items as the carousel case, so that is the threshold.
  const useCarousel = items.length <= 8;

  const chips: HTMLElement[] = [];
  if (facets?.categories?.length) {
    chips.push(chip("All", data.total, filters.category === "", () => { filters.category = ""; rerender(); }));
    for (const c of facets.categories.slice(0, 6)) {
      chips.push(
        chip(c.value, c.count, filters.category === c.value, () => {
          filters.category = filters.category === c.value ? "" : c.value;
          rerender();
        })
      );
    }
  }
  if (facets?.sizes?.length) {
    for (const s of facets.sizes.slice(0, 6)) {
      chips.push(
        chip(s.value, null, filters.size === s.value, () => {
          filters.size = filters.size === s.value ? "" : s.value;
          rerender();
        })
      );
    }
  }
  chips.push(
    chip("In stock", null, filters.inStockOnly, () => {
      filters.inStockOnly = !filters.inStockOnly;
      rerender();
    })
  );

  const sortSel = h(
    "select",
    {
      class: "sort",
      onchange: (e: Event) => {
        sort = (e.target as HTMLSelectElement).value as Sort;
        rerender();
      },
    },
    ...(
      [
        ["relevance", "Sort: relevance"],
        ["price-asc", "Price: low to high"],
        ["price-desc", "Price: high to low"],
        ["rating", "Top rated"],
        ["discount", "Biggest discount"],
      ] as [Sort, string][]
    ).map(([v, label]) => h("option", { value: v, selected: sort === v }, label))
  );

  const inCart = [...qty.values()].reduce((a, b) => a + b, 0);

  mount(
    root,
    h(
      "div",
      { class: "wrap" },
      h(
        "div",
        { class: "bar" },
        h("h2", {}, data.member ? `For ${data.member.displayName}` : "FashionCart"),
        h(
          "span",
          { class: "count" },
          items.length === data.products.length
            ? `${data.total} item${data.total === 1 ? "" : "s"}`
            : `${all.length} of ${data.products.length} match`
        ),
        h("span", { class: "spacer" }),
        sortSel
      ),
      h("div", { class: "chips" }, ...chips),
      all.length === 0
        ? h("div", { class: "empty" }, "Nothing matches those filters. Clear one to see more.")
        : h("div", { class: useCarousel ? "carousel" : "grid" }, ...items.map((p) => card(p, data, rerender))),
      h(
        "div",
        { class: "foot" },
        data.deliveryTo ? h("span", {}, `Delivering to ${data.deliveryTo}`) : null,
        inCart > 0 ? h("strong", {}, `${inCart} in bag`) : null,
        hidden > 0
          ? h("button", { class: "link", type: "button", onclick: () => { showAll = true; rerender(); } }, `Show ${hidden} more`)
          : null,
        h("span", { class: "spacer" }),
        data.hasMore ? h("span", {}, `Page ${data.page} of ${data.pageCount}. Ask for more.`) : null,
        inCart > 0 && (bridge.can.openLinks || bridge.can.updateModelContext)
          ? h(
              "button",
              {
                class: "link",
                type: "button",
                // Mints the link and opens it, the same way the cart view does. It used to only
                // nudge the model, which was unreliable and read as the single next step. The
                // shopper can keep adding instead: the bag count beside this is the state, this
                // is just the exit.
                onclick: () => void checkOutNow(),
              },
              "Check out"
            )
          : null
      )
    )
  );

  bridge.reportHeight(root.getBoundingClientRect().height + 16);
}
