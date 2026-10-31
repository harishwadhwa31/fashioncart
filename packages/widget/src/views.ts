/**
 * The smaller views: cart, checkout, single product, and the fallback for an unknown payload.
 *
 * All deliberately thin. The cart view shows what the server priced and nothing more; it does
 * not recompute a total, because the iframe is never the authority on money. The checkout view
 * is a single button, because everything after it happens on the merchant's domain.
 */

import { bridge } from "./bridge.js";
import { h, mount } from "./dom.js";
import { rupees, thumbUrl, withImageFallback } from "./format.js";

interface PricedLine {
  productId: string;
  name: string;
  brand: string;
  size: string;
  quantity: number;
  unitPrice: number;
  unitMemberPrice: number | null;
  lineTotal: number;
  adjustment?: { requestedQuantity: number; availableQuantity: number; reason: string };
}

interface PricedCart {
  cartId: string;
  lines: PricedLine[];
  itemCount: number;
  listSubtotal: number;
  subtotal: number;
  memberDiscount: number;
  youSave: number;
  deliveryFee: number;
  total: number;
  memberTier: string | null;
  removed: { productId: string; size: string; reason: string }[];
  adjusted: boolean;
}

function moneyRow(label: string, value: string, strong = false): HTMLElement {
  return h(
    "div",
    { class: "foot", style: "margin:0;padding:4px 0;border:0;justify-content:space-between" },
    h(strong ? "strong" : "span", {}, label),
    h(strong ? "strong" : "span", {}, value)
  );
}

export function renderCart(root: HTMLElement, data: Record<string, any>): void {
  const cart = data.cart as PricedCart | undefined;
  if (!cart || cart.lines.length === 0) {
    mount(root, h("div", { class: "empty" }, "Your bag is empty. Ask me to find something."));
    bridge.reportHeight(root.getBoundingClientRect().height + 16);
    return;
  }

  const base = String(data.imageBaseUrl ?? "");
  const tpl = String(data.thumbnailTemplate ?? "/images/{id}/thumb.webp");

  const lines = cart.lines.map((l) => {
    const img = h("img", { alt: l.name, style: "width:44px;aspect-ratio:4/5;border-radius:6px" });
    withImageFallback(img, thumbUrl(base, tpl, l.productId));
    const unit = l.unitMemberPrice ?? l.unitPrice;
    return h(
      "div",
      { style: "display:flex;gap:9px;align-items:center;padding:7px 0;border-top:1px solid var(--border)" },
      img,
      h(
        "div",
        { style: "flex:1;min-width:0" },
        h("div", { class: "name" }, l.name),
        h("div", { class: "meta" }, `${l.brand} · size ${l.size} · qty ${l.quantity}`),
        // A silently shrunk cart is the kind of thing that surfaces on stage. Say it.
        l.adjustment
          ? h("div", { class: "meta err" }, `Reduced from ${l.adjustment.requestedQuantity}; only ${l.adjustment.availableQuantity} left`)
          : null
      ),
      h("div", {}, h("div", { class: "now" }, rupees(l.lineTotal)), h("div", { class: "meta" }, `${rupees(unit)} each`))
    );
  });

  mount(
    root,
    h(
      "div",
      { class: "wrap" },
      h("div", { class: "bar" }, h("h2", {}, "Your bag"), h("span", { class: "count" }, `${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"}`)),
      ...lines,
      h("div", { style: "height:8px" }),
      // Subtotal is deliberately PRE-discount so the four rows visibly add up. Showing an
      // already-discounted subtotal above a discount line is arithmetic that does not
      // reconcile on the page, and it was a real bug earlier in this build.
      moneyRow("Subtotal", rupees(cart.listSubtotal)),
      cart.memberDiscount > 0 ? moneyRow(`${cart.memberTier ?? "Member"} discount`, `- ${rupees(cart.memberDiscount)}`) : null,
      moneyRow("Delivery", cart.deliveryFee === 0 ? "Free" : rupees(cart.deliveryFee)),
      moneyRow("Total", rupees(cart.total), true),
      cart.youSave > 0 ? h("div", { class: "meta", style: "color:var(--ok);padding-top:4px" }, `You save ${rupees(cart.youSave)} against MRP`) : null,
      cart.removed.length
        ? h("div", { class: "meta err", style: "padding-top:6px" }, `Removed: ${cart.removed.map((r) => `${r.productId} (${r.reason})`).join(", ")}`)
        : null,
      h(
        "div",
        { class: "foot" },
        h("span", { class: "mono" }, cart.cartId),
        h("span", { class: "spacer" }),
        bridge.can.openLinks || bridge.can.updateModelContext
          ? h("button", { class: "link", type: "button", onclick: () => void goToCheckout(cart.cartId) }, "Check out")
          : null
      )
    )
  );
  bridge.reportHeight(root.getBoundingClientRect().height + 16);
}

/**
 * The cart's "Check out" used to call tellModel and hope the model took the hint, so a
 * click frequently looked like nothing had happened. The widget can call the tool itself,
 * exactly as it does for add-to-cart, which makes the button deterministic. tellModel is
 * kept as the fallback for a host that cannot open links.
 */
async function goToCheckout(cartId: string): Promise<void> {
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

export function renderCheckout(root: HTMLElement, data: Record<string, any>): void {
  const cart = data.cart as PricedCart | undefined;
  const url = String(data.checkoutUrl ?? "");
  const mins = Math.round(Number(data.expiresInSeconds ?? 900) / 60);

  mount(
    root,
    h(
      "div",
      { class: "wrap" },
      h("div", { class: "bar" }, h("h2", {}, "Ready to pay")),
      cart ? moneyRow("Total", rupees(cart.total), true) : null,
      h(
        "div",
        { class: "meta", style: "padding:6px 0" },
        String(data.paymentNotice ?? "Payment is completed on the FashionCart site.")
      ),
      h(
        "button",
        {
          class: "chip",
          type: "button",
          style: "background:var(--accent);color:var(--accent-ink);border-color:var(--accent);padding:9px 14px;font-size:12.5px",
          disabled: !bridge.can.openLinks || !url,
          onclick: () => void bridge.openLink(url),
        },
        cart ? `Pay ${rupees(cart.total)} on FashionCart` : "Continue to FashionCart"
      ),
      h("div", { class: "meta", style: "padding-top:6px" }, `Link valid for ${mins} minutes. Claude will ask before it opens.`)
    )
  );
  bridge.reportHeight(root.getBoundingClientRect().height + 16);
}

export function renderProduct(root: HTMLElement, data: Record<string, any>): void {
  const p = data.product as Record<string, any> | undefined;
  if (!p) {
    mount(root, h("div", { class: "empty" }, String(data.error ?? "Product not found.")));
    return;
  }
  const img = h("img", { alt: String(p.name), style: "width:150px;aspect-ratio:4/5;border-radius:10px" });
  withImageFallback(img, String(data.thumbnailUrl ?? "").startsWith("http") ? String(data.thumbnailUrl) : `${data.imageBaseUrl}${data.thumbnailUrl}`);

  mount(
    root,
    h(
      "div",
      { class: "wrap", style: "display:flex;gap:12px" },
      img,
      h(
        "div",
        { style: "flex:1;min-width:0" },
        h("div", { class: "brand" }, String(p.brand)),
        h("h2", { style: "margin:2px 0 6px;font-size:15px" }, String(p.name)),
        h(
          "div",
          { class: "price" },
          h("span", { class: "now" }, rupees(Number(p.memberPrice ?? p.price))),
          Number(p.mrp) > Number(p.price) ? h("span", { class: "was" }, rupees(Number(p.mrp))) : null
        ),
        h("div", { class: "meta", style: "padding-top:6px" }, String(p.shortDescription ?? "")),
        h("div", { class: "meta" }, `${p.attributes?.fabric ?? ""} · ${p.attributes?.fit ?? ""}`),
        h("div", { class: "meta" }, `In stock: ${(p.inStockSizes ?? []).join(", ") || "nothing"}`),
        p.availability ? h("div", { class: "meta" }, String(p.availability)) : null,
        data.productPageUrl && bridge.can.openLinks
          ? h("button", { class: "link", style: "margin-top:8px", type: "button", onclick: () => void bridge.openLink(String(data.productPageUrl)) }, "View full details")
          : null
      )
    )
  );
  bridge.reportHeight(root.getBoundingClientRect().height + 16);
}

export function renderUnknown(root: HTMLElement, data: Record<string, any>): void {
  mount(
    root,
    h(
      "div",
      { class: "wrap" },
      h("div", { class: "empty" }, String(data.error ?? "Nothing to show for this result.")),
      h(
        "div",
        { class: "meta mono", style: "text-align:center" },
        "If this persists, see docs/TROUBLESHOOTING.md"
      )
    )
  );
  bridge.reportHeight(root.getBoundingClientRect().height + 16);
}
