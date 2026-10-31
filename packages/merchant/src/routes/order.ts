/**
 * Order confirmation.
 *
 * Reads the stored order and prints it, and does NOT re-price. The checkout and payment pages
 * recompute from the catalog because nothing is committed yet; once the order exists it records
 * what was actually charged, and a later catalog edit must not silently change what this page
 * says an order cost.
 *
 * Orders live in a per instance Map (see orders.ts), so a link opened against a different
 * serverless instance, or after a redeploy, will not find its order. That path renders a calm
 * explanation rather than a 404 shell, which is also the behaviour a real deployment wants for
 * an order id that is genuinely unknown.
 */

import { Router } from "express";

import { formatRupees } from "../pricing.js";
import { claudeMini, escapeHtml, icon, image, renderMessagePage, renderPage } from "../layout.js";
import { orders, type Order } from "../orders.js";
import { statement, type StatementFigures } from "./checkout.js";

function figuresFromOrder(order: Order): StatementFigures {
  return {
    itemCount: order.itemCount,
    listSubtotal: order.listSubtotal,
    memberDiscount: order.memberDiscount,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    tierLabel: order.tierLabel,
    tierDiscountPct: order.tierDiscountPct,
  };
}

function orderLines(order: Order): string {
  return order.lines
    .map(
      (line) => `<div class="sitem">
  ${image({ src: line.thumbnailUrl, alt: line.name, fallbackWidth: 112, fallbackHeight: 149 })}
  <div>
    <p class="sitem-name">${escapeHtml(line.name)}</p>
    <p class="sitem-meta">${escapeHtml(line.brand)} · Size ${escapeHtml(line.size)} · Qty ${line.quantity}</p>
  </div>
  <div class="sitem-cost">${escapeHtml(formatRupees(line.lineList))}</div>
</div>`
    )
    .join("");
}

export function createOrderRouter(): Router {
  const router = Router();

  router.get("/order/:id", (req, res) => {
    const order = orders.get(req.params.id);

    if (!order) {
      return res.status(404).send(
        renderMessagePage({
          title: "Order not found",
          eyebrow: "Orders",
          heading: "We cannot find that order",
          paragraphs: [
            "Order " +
              req.params.id +
              " is not on this server. Demonstration orders are held in memory only, so they do not survive a restart and are not shared between servers.",
            "In a live store this page would read the order from the database and show it to the signed in shopper.",
          ],
          actions: [{ href: "/", label: "Back to the storefront", primary: true }],
          chrome: "checkout",
        })
      );
    }

    const placed = new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(order.placedAt));

    res.send(
      renderPage({
        title: "Order " + order.id,
        chrome: "checkout",
        body: `<section class="order-head"><div class="wrap">
  <p class="eyebrow">Order confirmed</p>
  <h1>Thank you, ${escapeHtml(order.address.fullName.split(" ")[0] || "shopper")}</h1>
  <p class="muted" style="max-width:52ch">Your order is in. We have sent a confirmation to the
  contact on your account, and you can follow it from your orders page.</p>
  <p class="order-num">${icon("box")} ${escapeHtml(order.id)}</p>
</div></section>

<div class="wrap"><div class="order-grid">
  <section>
    <div class="panel">
      <p class="panel-title">${order.itemCount} item${order.itemCount === 1 ? "" : "s"} on the way</p>
      <div class="sitems">${orderLines(order)}</div>
      ${statement(figuresFromOrder(order))}
    </div>
  </section>

  <aside>
    <div class="panel">
      <p class="panel-title">Delivery</p>
      <div class="eta">${icon("truck")}<div>
        <b>Arriving by ${escapeHtml(order.arrivesBy)}</b>
        <p class="small muted" style="margin:.1rem 0 0">Standard delivery, about ${order.etaDays}
        working day${order.etaDays === 1 ? "" : "s"}. You will get a tracking link when it ships.</p>
      </div></div>
      <p class="panel-title" style="margin:1.4rem 0 .5rem">Address</p>
      <address class="addr">
        <b>${escapeHtml(order.address.fullName)}</b><br>
        ${escapeHtml(order.address.address)}<br>
        ${escapeHtml(order.address.city)} ${escapeHtml(order.address.pincode)}
      </address>
      <p class="tiny muted" style="margin:1.2rem 0 0">Placed ${escapeHtml(placed)}</p>
    </div>

    <div class="panel panel--quiet">
      <div class="assure">${icon("lock")}<span><b>Demonstration order.</b> No payment was taken,
      no payment details were ever collected, and nothing will ship.</span></div>
      <div class="assure">${icon("returns")}<span>30 day returns, collected from your address.</span></div>
      <div class="assure">${icon("support")}<span>1800 000 000, 9am to 9pm, every day.</span></div>
    </div>

    ${claudeMini()}
  </aside>
</div></div>`,
      })
    );
  });

  return router;
}
