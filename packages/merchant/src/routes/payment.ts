/**
 * ==============================================================================================
 * MOCK PAYMENT STEP. THERE IS NO PAYMENT DATA IN THIS FILE, OR ANYWHERE IN THIS PACKAGE.
 * ==============================================================================================
 *
 * No card number, no expiry, no CVV, no UPI handle, no bank reference, no saved instrument. Not
 * collected, not stored, not logged, and not present as an unused input on the form. The button
 * below charges nothing. That is an architectural boundary the demo is built to show, not a
 * corner that was cut.
 *
 * Two independent reasons, both of which survive the demo becoming a real product.
 *
 * 1. PAYMENT DATA LOCALISATION.
 *    India's payment-data storage rules require payment system data for transactions
 *    in India to be stored only on systems located in India. This storefront is a globally
 *    deployed serverless function whose region is a deployment setting, and it is reached from
 *    an assistant that may run anywhere. The moment payment data entered this process, the
 *    topology of the deployment would become a data residency question, and so would every log
 *    line and every trace. Keeping the real payment step inside the merchant's existing,
 *    already compliant payment stack means this surface never enters that scope at all.
 *
 * 2. PCI DSS SCOPE STAYS WITH THE MERCHANT.
 *    Any system that stores, processes or transmits cardholder data is in PCI DSS scope, and so
 *    is anything connected to it. A single card field on this page would pull in this function,
 *    its logs, the platform it runs on, and by extension the assistant transcript that led here.
 *    Handing the shopper to the merchant's own payment page, or to a hosted field owned by the
 *    payment service provider, leaves scope exactly where it already sits.
 *
 * What a real implementation puts here: a redirect or a hosted iframe from the PSP, an order
 * created in "pending" state before the shopper leaves, and a server to server webhook that
 * flips it to "paid". The pieces around that boundary, re-pricing from the catalog, the address,
 * the order record, are all real in this file already. Only the instrument is absent.
 *
 * ==============================================================================================
 *
 * Flow, and why it re-prices twice.
 *
 *   POST /payment          validate the address, re-price, render the amount and one button
 *   POST /payment/confirm  re-verify the token, re-price AGAIN, write the order, redirect
 *
 * The second re-price is not redundant. Everything between the two requests came back through
 * the browser as form fields, including the token, so the amount rendered on the payment page
 * is display state by the time it returns. The figure written to the order is computed from the
 * catalog inside the confirm request and never read from the posted form.
 */

import { Router } from "express";

import { deliveryEstimate, formatRupees, priceCart, type PricedCart } from "../pricing.js";
import { escapeHtml, icon, renderMessagePage, renderPage } from "../layout.js";
import { newOrderId, orders, type Order } from "../orders.js";
import { CheckoutTokenError, verifyCheckoutToken, type CheckoutPayload } from "../token.js";
import {
  readAddress,
  renderCheckoutPage,
  renderEmptyCart,
  figuresFrom,
  renderTokenRejection,
  statement,
  validateAddress,
  type AddressValues,
} from "./checkout.js";

/** How long the mock "authorisation" appears to take. Long enough to read, short enough to
 *  keep a stage demo moving. */
const SPINNER_MS = 1500;

interface ResumedCart {
  token: string;
  payload: CheckoutPayload;
  priced: PricedCart;
}

/**
 * Rebuild the cart from the posted token, or return the page that explains why we cannot.
 * Shared by both POST routes so neither can accidentally skip a check the other makes.
 */
function resume(
  body: unknown
): { ok: true; cart: ResumedCart } | { ok: false; status: number; html: string } {
  const token = typeof (body as any)?.token === "string" ? (body as any).token : "";

  let payload: CheckoutPayload;
  try {
    payload = verifyCheckoutToken(token);
  } catch (err) {
    if (err instanceof CheckoutTokenError) {
      return {
        ok: false,
        status: err.reason === "expired" ? 410 : 400,
        html: renderTokenRejection(err),
      };
    }
    throw err;
  }

  const priced = priceCart(
    payload.l.map(([productId, size, quantity]) => ({ productId, size, quantity })),
    payload.m
  );

  if (priced.lines.length === 0) {
    return { ok: false, status: 409, html: renderEmptyCart() };
  }

  return { ok: true, cart: { token, payload, priced } };
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function addressSummary(values: AddressValues): string {
  return `<address class="addr">
  <b>${escapeHtml(values.fullName)}</b><br>
  ${escapeHtml(values.address)}<br>
  ${escapeHtml(values.city)} ${escapeHtml(values.pincode)}
</address>`;
}

function renderPaymentPage(cart: ResumedCart, values: AddressValues): string {
  const amount = formatRupees(cart.priced.total);

  return renderPage({
    title: "Payment",
    chrome: "checkout",
    body: `<div class="wrap"><div class="pay-wrap">
  <div class="panel pay-card">
    <p class="steps" style="justify-content:center">
      <span class="is-done">Bag</span> › <span class="is-done">Delivery</span> › <span class="is-now">Payment</span>
    </p>
    <span class="badge-demo">${icon("lock")} Demo, no real payment</span>
    <h1>Pay ${escapeHtml(amount)}</h1>
    <p class="pay-sub">${cart.priced.itemCount} item${cart.priced.itemCount === 1 ? "" : "s"},
    delivered to ${escapeHtml(values.city)} ${escapeHtml(values.pincode)}.</p>

    <div class="pay-lines">${statement(figuresFrom(cart.priced))}</div>

    <div style="text-align:left;margin-bottom:1.4rem">
      <p class="panel-title" style="margin-bottom:.5rem">Delivering to</p>
      ${addressSummary(values)}
    </div>

    <form method="post" action="/payment/confirm" id="payForm">
      ${hidden("token", cart.token)}
      ${hidden("fullName", values.fullName)}
      ${hidden("address", values.address)}
      ${hidden("city", values.city)}
      ${hidden("pincode", values.pincode)}
      <button class="btn btn--primary btn--lg btn--block" type="submit" id="payBtn">
        Pay ${escapeHtml(amount)}
      </button>
    </form>

    <div class="spinner-wrap" id="paySpinner" hidden>
      <div class="spinner" role="status" aria-live="polite"></div>
      <p class="spinner-text">Confirming your order</p>
    </div>

    <p class="pay-note">This is a demonstration checkout. No card, UPI or bank details are asked
    for, taken or stored anywhere on this site, and nothing will be charged or shipped. In a
    live store this step hands over to the merchant's own payment provider.</p>
  </div>
</div></div>
<script>
(function(){
  var form=document.getElementById('payForm');
  var btn=document.getElementById('payBtn');
  var spinner=document.getElementById('paySpinner');
  if(!form||!btn||!spinner)return;
  form.addEventListener('submit',function(e){
    e.preventDefault();
    btn.disabled=true;
    btn.textContent='Processing';
    spinner.hidden=false;
    // form.submit() does not re-fire this handler, so there is no loop to guard against.
    window.setTimeout(function(){form.submit();},${SPINNER_MS});
  });
})();
</script>`,
  });
}

export function createPaymentRouter(): Router {
  const router = Router();

  /**
   * A refresh or a back button lands here with no body. Without this route Express would answer
   * a bare 404, which on a stage reads as a broken site rather than an expired step.
   */
  router.get("/payment", (_req, res) => {
    res.status(405).send(
      renderMessagePage({
        title: "Payment",
        eyebrow: "Checkout",
        heading: "This payment step has timed out",
        paragraphs: [
          "The payment page is built from the checkout form, so it cannot be reloaded on its own. Nothing has been charged.",
          "Open your checkout link again, or ask your assistant for a fresh one, and your bag will be waiting.",
        ],
        actions: [{ href: "/", label: "Browse the storefront", primary: true }],
        chrome: "checkout",
      })
    );
  });

  router.post("/payment", (req, res) => {
    const resumed = resume(req.body);
    if (!resumed.ok) return res.status(resumed.status).send(resumed.html);

    const values = readAddress(req.body);
    const errors = validateAddress(values);

    // Straight back to the checkout page with the fields as typed. Bouncing a shopper to a bare
    // error page and making them start the address again is how carts get abandoned.
    if (Object.keys(errors).length > 0) {
      return res.status(422).send(
        renderCheckoutPage({
          token: resumed.cart.token,
          payload: resumed.cart.payload,
          priced: resumed.cart.priced,
          values,
          errors,
        })
      );
    }

    res.send(renderPaymentPage(resumed.cart, values));
  });

  router.post("/payment/confirm", (req, res) => {
    const resumed = resume(req.body);
    if (!resumed.ok) return res.status(resumed.status).send(resumed.html);

    const values = readAddress(req.body);
    const errors = validateAddress(values);
    if (Object.keys(errors).length > 0) {
      return res.status(422).send(
        renderCheckoutPage({
          token: resumed.cart.token,
          payload: resumed.cart.payload,
          priced: resumed.cart.priced,
          values,
          errors,
        })
      );
    }

    const { priced, payload } = resumed.cart;
    const eta = deliveryEstimate(values.pincode);

    const order: Order = {
      id: newOrderId(),
      placedAt: Date.now(),
      // `cid` is optional as of the v2 token format. It is correlation metadata only: the
      // order is identified by the id this site mints, never by the assistant's cart id.
      cartId: payload.cid ?? "(not supplied)",
      address: values,
      lines: priced.lines.map((line) => ({
        productId: line.product.id,
        name: line.product.name,
        brand: line.product.brand,
        size: line.size,
        quantity: line.quantity,
        unitList: line.unitList,
        lineList: line.lineList,
        unitPaid: line.unitPaid,
        linePaid: line.linePaid,
        thumbnailUrl: line.product.thumbnailUrl,
      })),
      itemCount: priced.itemCount,
      listSubtotal: priced.listSubtotal,
      memberDiscount: priced.memberDiscount,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      total: priced.total,
      tierLabel: priced.tier?.label ?? null,
      tierDiscountPct: priced.tier?.discountPct ?? null,
      etaDays: eta.etaDays,
      arrivesBy: eta.arrivesBy,
    };

    orders.put(order);

    // 303 so a refresh of the confirmation page re-runs a GET and cannot re-post the form.
    res.redirect(303, "/order/" + encodeURIComponent(order.id));
  });

  return router;
}
