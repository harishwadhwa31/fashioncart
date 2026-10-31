/**
 * checkout: mint a signed handoff link to the merchant site.
 *
 * This tool is the boundary the whole demo is built around. It re-prices the cart from the
 * catalog, encodes WHAT the shopper wants into a short-lived signed token, and returns a URL on
 * the merchant's own domain. It never touches payment data. See checkout/token.ts for the full
 * payment-data localisation and PCI-scope rationale.
 *
 * A note on the returned total: it is computed here, server-side, from the catalog. It is
 * included so the assistant can state it in conversation, and it is deliberately NOT part of
 * the signed token. The merchant re-prices independently from its own catalog. If the two ever
 * disagree, the merchant's figure wins, because the merchant is the one taking the money.
 */

import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";

import { priceCart, formatINR } from "../cart/pricing.js";
import { mockSignIn } from "../personalisation/member.js";
import { buildCheckoutUrl, mintCheckoutToken } from "../checkout/token.js";
import { result, type ToolContext } from "./context.js";

export function registerCheckoutTool(server: any, resourceUri: string, ctx: ToolContext): void {
  registerAppTool(
    server,
    "checkout",
    {
      title: "Create a FashionCart checkout link",
      description:
        "Use when the shopper is ready to buy. Examples: checkout, I'm ready to pay, let's buy " +
        "this, place the order, complete my purchase, buy it, order it now. " +
        "Re-prices the cart and returns a short-lived link to the FashionCart merchant site, " +
        "where the shopper enters delivery details and pays. " +
        "This connector never sees payment details and neither do you: do not ask the shopper " +
        "for a card number, UPI id or any payment information, and do not offer to take " +
        "payment in the conversation. Give them the link. " +
        "The link expires, so call this when they are actually ready, not in advance. " +
        "Requires a cartId from add-to-cart.",
      inputSchema: {
        cartId: z.string().describe("Cart handle."),
        pincode: z.string().optional().describe("Delivery pincode to carry over to checkout."),
      },
      annotations: {
        title: "Create checkout link",
        readOnlyHint: false,
        // Creates a link. Removes nothing, and the cart survives.
        destructiveHint: false,
        // Calling twice yields another valid link for the same cart; no double-ordering,
        // because no order is placed here. Placing the order happens on the merchant site.
        idempotentHint: true,
        // The tool itself contacts no external service; it mints a URL from local state. The
        // shopper's browser is what later visits the merchant. Marked false deliberately
        // rather than defensively: annotations should describe the tool, not the journey.
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri, visibility: ["model", "app"] } },
    },
    async (args: any) => {
      const cart = await ctx.carts.get(args.cartId);
      if (!cart) {
        return result("checkout", `Cart "${args.cartId}" not found or expired.`, { error: "cart_not_found" }, { dev: ctx.config.isDev });
      }
      if (args.pincode) {
        cart.pincode = args.pincode;
        await ctx.carts.put(cart);
      }

      const member = mockSignIn(cart.memberId);
      const priced = priceCart(ctx.catalog, cart, member);

      if (priced.lines.length === 0) {
        return result(
          "checkout",
          "The cart is empty, so there is nothing to check out. Add an item first.",
          { error: "empty_cart" },
          { dev: ctx.config.isDev }
        );
      }

      const token = mintCheckoutToken(
        {
          l: priced.lines.map((l) => [l.productId, l.size, l.quantity] as [string, string, number]),
          p: cart.pincode,
          m: cart.memberId,
        },
        ctx.config.checkoutSecret,
        ctx.config.checkoutTtlSeconds
      );

      const url = buildCheckoutUrl(ctx.config.merchantUrl, token);
      const minutes = Math.round(ctx.config.checkoutTtlSeconds / 60);

      const structured = {
        kind: "checkout" as const,
        checkoutUrl: url,
        expiresInSeconds: ctx.config.checkoutTtlSeconds,
        cart: priced,
        currency: ctx.catalog.currency,
        // Stated so the widget can render the reassurance line rather than inventing one.
        paymentNotice:
          "Payment is completed on the FashionCart merchant site. No payment details are handled " +
          "by this connector or shared with the assistant.",
      };

      const text = [
        `Ready to check out: ${priced.itemCount} item${priced.itemCount === 1 ? "" : "s"}, total ${formatINR(priced.total)}.`,
        priced.memberDiscount > 0
          ? `Includes a ${member?.tier} member discount of ${formatINR(priced.memberDiscount)}.`
          : "",
        priced.adjusted ? "Some lines were adjusted to match current stock." : "",
        "",
        `Checkout link (valid for ${minutes} minutes): ${url}`,
        "",
        "Payment happens on the FashionCart site. No card or payment details pass through this connector.",
      ]
        .filter(Boolean)
        .join("\n");

      return result("checkout", text, structured, { dev: ctx.config.isDev });
    }
  );
}
