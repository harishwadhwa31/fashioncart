/**
 * Checkout: resume the cart the assistant handed over.
 *
 * The token says what the shopper wants. It does not say what any of it costs, and nothing here
 * would believe it if it did. priceCart() recomputes every figure from the catalog on this
 * request, and again on the payment page, and again when the order is written.
 *
 * The order summary is built so the arithmetic is followable on screen: the subtotal is the sum
 * of the line costs BEFORE any member discount, the discount is its own line, delivery is its
 * own line, and the total is their sum. A subtotal with the discount already folded into it,
 * printed above a discount line, silently double counts and is the classic bug here.
 *
 * This module also exports the pieces the payment route needs, so the checkout page can be
 * re-rendered with validation errors without a second copy of the markup.
 */

import { Router, type Request } from "express";

import { deliveryEstimate, formatRupees, priceCart, type PricedCart } from "../pricing.js";
import {
  escapeHtml,
  icon,
  image,
  renderMessagePage,
  renderPage,
} from "../layout.js";
import { CheckoutTokenError, verifyCheckoutToken, type CheckoutPayload } from "../token.js";

export interface AddressValues {
  fullName: string;
  address: string;
  city: string;
  pincode: string;
}

export type AddressErrors = Partial<Record<keyof AddressValues, string>>;

const EMPTY_ADDRESS: AddressValues = { fullName: "", address: "", city: "", pincode: "" };

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readAddress(body: unknown): AddressValues {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    fullName: str(b.fullName).slice(0, 120),
    address: str(b.address).slice(0, 400),
    city: str(b.city).slice(0, 80),
    pincode: str(b.pincode).slice(0, 10),
  };
}

/** Indian pincodes are six digits and never start with zero. */
const PINCODE = /^[1-9][0-9]{5}$/;

export function validateAddress(values: AddressValues): AddressErrors {
  const errors: AddressErrors = {};
  if (values.fullName.length < 2) errors.fullName = "Please enter the name for the delivery.";
  if (values.address.length < 8) errors.address = "Please enter the full street address.";
  if (values.city.length < 2) errors.city = "Please enter a city.";
  if (!PINCODE.test(values.pincode)) errors.pincode = "Please enter a six digit pincode.";
  return errors;
}

export function lineItems(priced: PricedCart): string {
  return priced.lines
    .map((line) => {
      const strike =
        line.lineMrp > line.lineList
          ? `<s>${escapeHtml(formatRupees(line.lineMrp))}</s>`
          : "";
      const clamped =
        line.clampedFrom !== null
          ? `<p class="sitem-meta">Reduced from ${line.clampedFrom} to ${line.quantity}, that is all we have left.</p>`
          : "";

      return `<div class="sitem">
  ${image({ src: line.product.thumbnailUrl, alt: line.product.name, fallbackWidth: 112, fallbackHeight: 149 })}
  <div>
    <p class="sitem-name">${escapeHtml(line.product.name)}</p>
    <p class="sitem-meta">${escapeHtml(line.product.brand)} · Size ${escapeHtml(line.size)} · Qty ${line.quantity}</p>
    ${clamped}
  </div>
  <div class="sitem-cost">${strike}${escapeHtml(formatRupees(line.lineList))}</div>
</div>`;
    })
    .join("");
}

/**
 * Money statement figures.
 *
 * Deliberately a plain shape rather than a PricedCart, because three pages print this block and
 * one of them, the confirmation, reads a stored order rather than a live re-price. Two renderers
 * for the same four rows would be two chances for them to drift apart.
 */
export interface StatementFigures {
  itemCount: number;
  /** BEFORE any member discount. This is the row the shopper can add up. */
  listSubtotal: number;
  memberDiscount: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  tierLabel: string | null;
  tierDiscountPct: number | null;
  /** Enables the "you save against MRP" banner. Absent on a stored order. */
  mrpTotal?: number | null;
  freeDeliveryShortfall?: number | null;
}

export function figuresFrom(priced: PricedCart): StatementFigures {
  return {
    itemCount: priced.itemCount,
    listSubtotal: priced.listSubtotal,
    memberDiscount: priced.memberDiscount,
    subtotal: priced.subtotal,
    deliveryFee: priced.deliveryFee,
    total: priced.total,
    tierLabel: priced.tier?.label ?? null,
    tierDiscountPct: priced.tier?.discountPct ?? null,
    mrpTotal: priced.mrpTotal,
    freeDeliveryShortfall: priced.freeDeliveryShortfall,
  };
}

/**
 * The four line statement. priceCart() has already asserted that
 * listSubtotal - memberDiscount + deliveryFee equals total, so these rows always add up on the
 * page rather than merely looking as though they do.
 */
export function statement(f: StatementFigures): string {
  const tierSuffix = f.tierDiscountPct !== null ? ` (${f.tierDiscountPct}%)` : "";
  const discountRow =
    f.memberDiscount > 0 && f.tierLabel
      ? `<div class="srow srow--credit">
      <span>${escapeHtml(f.tierLabel)} member discount${tierSuffix}</span>
      <span>- ${escapeHtml(formatRupees(f.memberDiscount))}</span>
    </div>`
      : "";

  const deliveryRow =
    f.deliveryFee === 0
      ? `<div class="srow srow--free"><span>Delivery</span><span>Free</span></div>`
      : `<div class="srow"><span>Delivery</span><span>${escapeHtml(formatRupees(f.deliveryFee))}</span></div>`;

  const savedVsMrp = f.mrpTotal ? f.mrpTotal - f.subtotal : 0;
  const saved =
    savedVsMrp > 0
      ? `<p class="saved">You save ${escapeHtml(formatRupees(savedVsMrp))} against MRP on this order</p>`
      : "";

  const shortfall =
    f.freeDeliveryShortfall !== null &&
    f.freeDeliveryShortfall !== undefined &&
    f.freeDeliveryShortfall > 0
      ? `<p class="tiny muted" style="margin:.6rem 0 0">Add ${escapeHtml(formatRupees(f.freeDeliveryShortfall))} more to qualify for free delivery.</p>`
      : "";

  return `<div class="statement">
  <div class="srow">
    <span>Subtotal (${f.itemCount} item${f.itemCount === 1 ? "" : "s"})</span>
    <span>${escapeHtml(formatRupees(f.listSubtotal))}</span>
  </div>
  ${discountRow}
  ${deliveryRow}
  <div class="srow srow--total"><span>Total</span><span>${escapeHtml(formatRupees(f.total))}</span></div>
  ${saved}
  ${shortfall}
</div>`;
}

export function summaryPanel(priced: PricedCart, pincode: string | null): string {
  const eta = deliveryEstimate(pincode);
  const place = eta.area && eta.city ? `${eta.area}, ${eta.city}` : null;

  const tierPill = priced.tier
    ? `<span class="pill">${icon("spark")} ${escapeHtml(priced.tier.label)} member · ${priced.tier.discountPct}% off</span>`
    : `<span class="pill pill--quiet">Guest checkout</span>`;

  return `<div class="panel">
  <p class="panel-title">Order summary</p>
  <div style="margin:-.4rem 0 1rem">${tierPill}</div>
  <div class="sitems">${lineItems(priced)}</div>
  ${statement(figuresFrom(priced))}
  <div class="eta">${icon("truck")}<div class="small muted">
    Arriving by <b>${escapeHtml(eta.arrivesBy)}</b>${place ? " to " + escapeHtml(place) : ""}.
  </div></div>
</div>`;
}

function assurancePanel(): string {
  return `<div class="panel panel--quiet">
  <div class="assure">${icon("lock")}<span>Delivery details and payment stay on FashionCart. Your
  assistant never sees them.</span></div>
  <div class="assure">${icon("returns")}<span>30 day returns, collected from your address.</span></div>
  <div class="assure">${icon("support")}<span>Questions? 1800 000 000, 9am to 9pm, every day.</span></div>
</div>`;
}

function adjustmentNotice(priced: PricedCart): string {
  if (!priced.adjusted) return "";

  const dropped = priced.dropped
    .map((d) => `${escapeHtml(d.name ?? d.productId)} in size ${escapeHtml(d.size)}`)
    .join(", ");

  const parts: string[] = [];
  if (priced.dropped.length > 0) {
    parts.push(
      `We had to remove ${dropped} because ${priced.dropped.length === 1 ? "it is" : "they are"} no longer available.`
    );
  }
  if (priced.lines.some((l) => l.clampedFrom !== null)) {
    parts.push("Some quantities were reduced to match the stock we have left.");
  }

  return `<div class="notice notice--warn"><b>Your bag changed since the assistant priced it.</b>
  ${parts.join(" ")} The total below is the current one.</div>`;
}

function field(
  name: keyof AddressValues,
  label: string,
  values: AddressValues,
  errors: AddressErrors,
  opts: { type?: "text" | "textarea"; autocomplete?: string; inputmode?: string; maxlength?: number } = {}
): string {
  const error = errors[name];
  const cls = error ? "field has-error" : "field";
  const common =
    `id="${name}" name="${name}" ` +
    (opts.autocomplete ? `autocomplete="${opts.autocomplete}" ` : "") +
    (opts.inputmode ? `inputmode="${opts.inputmode}" ` : "") +
    (opts.maxlength ? `maxlength="${opts.maxlength}" ` : "") +
    (error ? `aria-invalid="true" aria-describedby="${name}-error" ` : "");

  const control =
    opts.type === "textarea"
      ? `<textarea ${common}rows="3" required>${escapeHtml(values[name])}</textarea>`
      : `<input ${common}type="text" value="${escapeHtml(values[name])}" required>`;

  return `<div class="${cls}">
  <label for="${name}">${escapeHtml(label)}</label>
  ${control}
  ${error ? `<p class="field-error" id="${name}-error">${escapeHtml(error)}</p>` : ""}
</div>`;
}

export interface CheckoutViewOptions {
  token: string;
  payload: CheckoutPayload;
  priced: PricedCart;
  values?: AddressValues;
  errors?: AddressErrors;
}

export function renderCheckoutPage(opts: CheckoutViewOptions): string {
  const errors = opts.errors ?? {};
  const values = opts.values ?? { ...EMPTY_ADDRESS, pincode: opts.payload.p ?? "" };
  const hasErrors = Object.keys(errors).length > 0;

  return renderPage({
    title: "Checkout",
    chrome: "checkout",
    body: `<div class="wrap"><div class="checkout-grid">
  <section>
    <p class="steps"><span class="is-done">Bag</span> › <span class="is-now">Delivery</span> › <span>Payment</span></p>
    <h1>Delivery details</h1>
    <p class="muted small" style="margin-bottom:1.6rem">Your assistant passed over
    ${opts.priced.itemCount} item${opts.priced.itemCount === 1 ? "" : "s"}. Tell us where to send
    ${opts.priced.itemCount === 1 ? "it" : "them"}, and we will take payment on the next step.</p>

    ${adjustmentNotice(opts.priced)}
    ${hasErrors ? '<div class="notice notice--warn"><b>Almost there.</b> Please check the highlighted fields below.</div>' : ""}

    <form class="panel" method="post" action="/payment" novalidate>
      <input type="hidden" name="token" value="${escapeHtml(opts.token)}">
      ${field("fullName", "Full name", values, errors, { autocomplete: "name", maxlength: 120 })}
      ${field("address", "Address", values, errors, { type: "textarea", autocomplete: "street-address", maxlength: 400 })}
      <div class="field-row">
        ${field("city", "City", values, errors, { autocomplete: "address-level2", maxlength: 80 })}
        ${field("pincode", "Pincode", values, errors, { autocomplete: "postal-code", inputmode: "numeric", maxlength: 6 })}
      </div>
      <div class="form-foot">
        <button class="btn btn--primary btn--lg btn--block" type="submit">
          Continue to payment · ${escapeHtml(formatRupees(opts.priced.total))}
        </button>
        <p class="tiny muted" style="margin:0">We collect no card, UPI or bank details on this
        page. Payment happens on the next step, on FashionCart.</p>
      </div>
    </form>
  </section>

  <aside class="co-side">
    ${summaryPanel(opts.priced, values.pincode || opts.payload.p)}
    ${assurancePanel()}
  </aside>
</div></div>`,
  });
}

/** One friendly page per rejection reason. A shopper must never meet a stack trace. */
export function renderTokenRejection(err: CheckoutTokenError): string {
  switch (err.reason) {
    case "missing":
      return renderMessagePage({
        title: "Checkout",
        eyebrow: "Checkout",
        heading: "This page needs a checkout link",
        paragraphs: [
          "Checkout opens from a link your assistant creates once your bag is ready.",
          "Ask it to check out, then open the link it gives you.",
        ],
        actions: [{ href: "/", label: "Browse the storefront", primary: true }],
      });
    case "expired":
      return renderMessagePage({
        title: "Link expired",
        eyebrow: "Checkout",
        heading: "This checkout link has expired",
        paragraphs: [
          "Checkout links are short lived on purpose, so a link left open in a tab cannot be used later.",
          "Your bag is safe. Ask your assistant for a fresh checkout link and it will pick up where you left off.",
        ],
        actions: [{ href: "/", label: "Browse the storefront", primary: true }],
      });
    default:
      return renderMessagePage({
        title: "Link not valid",
        eyebrow: "Checkout",
        heading: "We could not read this checkout link",
        paragraphs: [
          "The link looks incomplete or altered, so we have not loaded a bag from it. Nothing has been charged.",
          "This usually means the address was truncated on the way here. Ask your assistant for a new checkout link.",
        ],
        actions: [{ href: "/", label: "Browse the storefront", primary: true }],
      });
  }
}

export function renderEmptyCart(): string {
  return renderMessagePage({
    title: "Nothing to check out",
    eyebrow: "Checkout",
    heading: "Nothing in this bag is still available",
    paragraphs: [
      "Everything the assistant sent across has sold out since it was added, so there is nothing left to buy here.",
      "Nothing has been charged. Ask your assistant to find alternatives and it can send a new link.",
    ],
    actions: [{ href: "/", label: "Browse the storefront", primary: true }],
  });
}

export function createCheckoutRouter(): Router {
  const router = Router();

  // Two shapes, one handler. `/checkout/<token>` is what the connector mints now, because the
  // shopper is shown the whole URL in Claude's confirmation modal and a path segment puts the
  // merchant domain and the word "checkout" before the opaque part. `?token=` is still accepted
  // so any link already in flight keeps working.
  const readToken = (req: Request): string => {
    const fromPath = typeof req.params.token === "string" ? req.params.token : "";
    if (fromPath) return fromPath;
    return typeof req.query.token === "string" ? req.query.token : "";
  };

  router.get(["/checkout", "/checkout/:token"], (req, res) => {
    const token = readToken(req);

    let payload: CheckoutPayload;
    try {
      payload = verifyCheckoutToken(token);
    } catch (err) {
      if (err instanceof CheckoutTokenError) {
        // 400 for a bad link, 410 for one that was valid and has aged out.
        return res.status(err.reason === "expired" ? 410 : 400).send(renderTokenRejection(err));
      }
      throw err;
    }

    const priced = priceCart(
      payload.l.map(([productId, size, quantity]) => ({ productId, size, quantity })),
      payload.m
    );

    if (priced.lines.length === 0) {
      return res.status(409).send(renderEmptyCart());
    }

    res.send(renderCheckoutPage({ token, payload, priced }));
  });

  return router;
}
