/**
 * Cart tools: add-to-cart, set-quantity, remove-from-cart, get-cart.
 *
 * Four separate tools rather than one cart tool with an `action` parameter. Directory review
 * auto-rejects the multiplexed form, and the annotations differ: only remove-from-cart is
 * destructive, and only add-to-cart is non-idempotent.
 *
 * Every one takes an explicit cartId. There is no ambient "current cart" anywhere in this
 * server; see cart/store.ts for why that is a correctness requirement on Vercel rather than a
 * style choice.
 */

import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";

import { priceCart, formatINR, type PricedCart } from "../cart/pricing.js";
import { mockSignIn } from "../personalisation/member.js";
import { THUMBNAIL_TEMPLATE } from "../catalog/shape.js";
import { result, type ToolContext } from "./context.js";

function cartStructured(ctx: ToolContext, priced: PricedCart) {
  return {
    kind: "cart" as const,
    cart: priced,
    currency: ctx.catalog.currency,
    imageBaseUrl: ctx.config.publicUrl,
    thumbnailTemplate: THUMBNAIL_TEMPLATE,
  };
}

function cartText(priced: PricedCart): string {
  if (priced.lines.length === 0) {
    return `Cart ${priced.cartId} is empty.`;
  }
  const lines = priced.lines.map((l) => {
    const unit = l.unitMemberPrice ?? l.unitPrice;
    const adj = l.adjustment
      ? ` (reduced from ${l.adjustment.requestedQuantity}; only ${l.adjustment.availableQuantity} in stock)`
      : "";
    // productId and size together are the key set-quantity and remove-from-cart take.
    // Omitting the id here forced the model to guess it, the same defect that put a
    // wrong item in the basket from search results.
    return `- ${l.quantity} x ${l.name} [${l.productId}], size ${l.size}, ${formatINR(unit)} each = ${formatINR(l.lineTotal)}${adj}`;
  });

  const parts = [
    `Cart ${priced.cartId}: ${priced.itemCount} item${priced.itemCount === 1 ? "" : "s"}`,
    ...lines,
    "",
    `Subtotal: ${formatINR(priced.listSubtotal)}`,
  ];
  if (priced.memberDiscount > 0) {
    parts.push(`Member discount (${priced.memberTier}): -${formatINR(priced.memberDiscount)}`);
  }
  parts.push(
    priced.deliveryFee === 0 ? "Delivery: free" : `Delivery: ${formatINR(priced.deliveryFee)}`,
    `Total: ${formatINR(priced.total)}`
  );
  if (priced.youSave > 0) parts.push(`You save ${formatINR(priced.youSave)} against MRP.`);
  if (priced.removed.length) {
    parts.push(
      "",
      `Removed: ${priced.removed.map((r) => `${r.productId} (${r.size}, ${r.reason})`).join("; ")}`
    );
  }
  return parts.join("\n");
}

const CART_ID = z.string().optional().describe("Cart handle from a previous cart tool. Omit to start a new cart.");

export function registerCartTools(server: any, resourceUri: string, ctx: ToolContext): void {
  registerAppTool(
    server,
    "add-to-cart",
    {
      title: "Add an item to the FashionCart basket",
      description:
        "Use when the shopper wants to buy, add, take, order or put something in their bag or " +
        "basket. Examples: add two of those, I'll take the medium, put it in my bag, get me one. " +
        "Adds one product in one size. Returns a cartId which EVERY later cart call needs, so " +
        "keep it for the rest of the conversation. Omit cartId to start a fresh cart. " +
        "Quantity is clamped to available stock and the response says when that happened. " +
        "Requires a productId from search-products and a size that is actually in stock.",
      inputSchema: {
        productId: z.string().describe('SKU id, e.g. "FC-SHT-001". Copy it verbatim from search-products; never construct one.'),
        expectedName: z
          .string()
          .optional()
          .describe(
            "The product name you believe this id belongs to, copied from the search "  +
              "results. The server checks it against productId and refuses the call if "  +
              "they disagree, so a mis-remembered id is caught before it becomes a wrong "  +
              "item in the basket."
          ),
        size: z.string().describe("Size label. Must be one of the product's in-stock sizes."),
        quantity: z.number().int().positive().max(10).optional().describe("Defaults to 1."),
        colour: z.string().optional().describe("Colour name, for display on the line."),
        cartId: CART_ID,
        pincode: z.string().optional(),
        memberId: z.string().optional(),
      },
      annotations: {
        title: "Add to cart",
        readOnlyHint: false,
        destructiveHint: false,
        // Calling twice adds twice. Genuinely not idempotent, and saying otherwise would
        // mislead a host that retries on timeout.
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri, visibility: ["model", "app"] } },
    },
    async (args: any) => {
      const product = ctx.catalog.byId.get(args.productId);
      if (!product) {
        return result("add-to-cart", `No product with id "${args.productId}".`, { error: "not_found" }, { dev: ctx.config.isDev });
      }
      // Defence in depth for the guessed-id defect. The model always knows the NAME it
      // means, so a disagreement between name and id is detectable here and correctable
      // in one retry. Without this the only signal is a wrong line in the basket.
      if (args.expectedName) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (norm(product.name) !== norm(args.expectedName)) {
          const match = ctx.catalog.products.find((p) => norm(p.name) === norm(args.expectedName));
          const hint = match
            ? ` The id for "${args.expectedName}" is ${match.id}. Retry with that id.`
            : ` No product is named "${args.expectedName}". Call search-products and copy the id verbatim.`;
          return result(
            "add-to-cart",
            `Nothing was added. Id ${product.id} is "${product.name}", not "${args.expectedName}".${hint}`,
            {
              error: "id_name_mismatch",
              productId: product.id,
              actualName: product.name,
              expectedName: args.expectedName,
              suggestedId: match?.id ?? null,
            },
            { dev: ctx.config.isDev }
          );
        }
      }

      const member = mockSignIn(args.memberId);
      if (product.memberOnly && !member?.canSeeMemberOnly) {
        return result("add-to-cart", `"${product.name}" is a member-only style.`, { error: "member_only" }, { dev: ctx.config.isDev });
      }
      if (!product.sizes.includes(args.size)) {
        return result(
          "add-to-cart",
          `Size "${args.size}" does not exist for ${product.name}. Sizes: ${product.sizes.join(", ")}.`,
          { error: "unknown_size", sizes: product.sizes },
          { dev: ctx.config.isDev }
        );
      }
      const available = product.stockBySize[args.size] ?? 0;
      if (available === 0) {
        return result(
          "add-to-cart",
          `${product.name} in size ${args.size} is sold out. In stock: ${product.inStockSizes.join(", ") || "nothing"}.`,
          { error: "out_of_stock", inStockSizes: product.inStockSizes },
          { dev: ctx.config.isDev }
        );
      }

      let cart = args.cartId ? await ctx.carts.get(args.cartId) : null;
      if (!cart) {
        cart = await ctx.carts.create({
          pincode: args.pincode ?? member?.pincode ?? null,
          memberId: member?.id ?? null,
        });
      }
      if (args.pincode) cart.pincode = args.pincode;
      if (member) cart.memberId = member.id;

      const wanted = args.quantity ?? 1;
      const existing = cart.lines.find((l) => l.productId === product.id && l.size === args.size);
      if (existing) {
        existing.quantity = Math.min(existing.quantity + wanted, available);
      } else {
        cart.lines.push({
          productId: product.id,
          size: args.size,
          colour: args.colour ?? null,
          quantity: Math.min(wanted, available),
          addedAtPrice: product.price,
        });
      }

      const saved = await ctx.carts.put(cart);
      const priced = priceCart(ctx.catalog, saved, mockSignIn(saved.memberId));
      return result("add-to-cart", `Added ${product.name} (${args.size}).\n\n${cartText(priced)}`, cartStructured(ctx, priced), { dev: ctx.config.isDev });
    }
  );

  registerAppTool(
    server,
    "set-quantity",
    {
      title: "Set the quantity of a FashionCart line",
      description:
        "Use when the shopper changes how many of something they want. Examples: make that " +
        "three, just one instead, change it to 2, take one off, I only want two. " +
        "Sets an EXACT quantity on a line already in the cart, so pass the final number, not " +
        "the difference. Setting 0 removes the line. " +
        "Requires a cartId from add-to-cart. To add something new, use add-to-cart instead.",
      inputSchema: {
        cartId: z.string().describe("Cart handle."),
        productId: z.string(),
        size: z.string(),
        quantity: z.number().int().nonnegative().max(10).describe("Exact quantity. 0 removes the line."),
      },
      annotations: {
        title: "Set quantity",
        readOnlyHint: false,
        // Setting a quantity can remove a line when quantity is 0, but the intent is an
        // update, and the operation is safe to repeat.
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri, visibility: ["model", "app"] } },
    },
    async (args: any) => {
      const cart = await ctx.carts.get(args.cartId);
      if (!cart) {
        return result("set-quantity", `Cart "${args.cartId}" not found or expired.`, { error: "cart_not_found" }, { dev: ctx.config.isDev });
      }
      const idx = cart.lines.findIndex((l) => l.productId === args.productId && l.size === args.size);
      if (idx === -1) {
        return result(
          "set-quantity",
          `No line for ${args.productId} in size ${args.size}.`,
          { error: "line_not_found" },
          { dev: ctx.config.isDev }
        );
      }

      if (args.quantity === 0) {
        cart.lines.splice(idx, 1);
      } else {
        const product = ctx.catalog.byId.get(args.productId);
        const available = product?.stockBySize[args.size] ?? 0;
        cart.lines[idx].quantity = Math.max(1, Math.min(args.quantity, available));
      }

      const saved = await ctx.carts.put(cart);
      const priced = priceCart(ctx.catalog, saved, mockSignIn(saved.memberId));
      return result("set-quantity", cartText(priced), cartStructured(ctx, priced), { dev: ctx.config.isDev });
    }
  );

  registerAppTool(
    server,
    "remove-from-cart",
    {
      title: "Remove a line from the FashionCart basket",
      description:
        "Use when the shopper wants something taken out of their bag. Examples: remove the " +
        "shirt, take that out, I don't want the kurta any more, drop the trousers. " +
        "Removes a line entirely. To reduce a quantity rather than remove it, use set-quantity. " +
        "Requires a cartId from add-to-cart.",
      inputSchema: {
        cartId: z.string().describe("Cart handle."),
        productId: z.string(),
        size: z.string(),
      },
      annotations: {
        title: "Remove from cart",
        readOnlyHint: false,
        // Genuinely destructive: it deletes state the shopper created.
        destructiveHint: true,
        // Removing an already-removed line leaves the same state.
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri, visibility: ["model", "app"] } },
    },
    async (args: any) => {
      const cart = await ctx.carts.get(args.cartId);
      if (!cart) {
        return result("remove-from-cart", `Cart "${args.cartId}" not found or expired.`, { error: "cart_not_found" }, { dev: ctx.config.isDev });
      }
      const before = cart.lines.length;
      cart.lines = cart.lines.filter((l) => !(l.productId === args.productId && l.size === args.size));
      const saved = await ctx.carts.put(cart);
      const priced = priceCart(ctx.catalog, saved, mockSignIn(saved.memberId));
      const note = before === cart.lines.length ? "That line was not in the cart. " : "";
      return result("remove-from-cart", `${note}${cartText(priced)}`, cartStructured(ctx, priced), { dev: ctx.config.isDev });
    }
  );

  registerAppTool(
    server,
    "get-cart",
    {
      title: "Get the FashionCart basket",
      description:
        "Use when the shopper asks what is in their bag, basket or cart, or what it comes to. " +
        "Examples: what's in my bag, how much is that, show me my cart, what's my total. " +
        "Returns every line re-priced from the live catalogue, with subtotal, member discount, " +
        "delivery and total. Prices are always recomputed server-side, so this is the " +
        "authoritative total; never add up line items yourself. " +
        "Requires a cartId from add-to-cart.",
      inputSchema: {
        cartId: z.string().describe("Cart handle."),
      },
      annotations: {
        title: "Get cart",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri, visibility: ["model", "app"] } },
    },
    async (args: any) => {
      const cart = await ctx.carts.get(args.cartId);
      if (!cart) {
        return result("get-cart", `Cart "${args.cartId}" not found or expired.`, { error: "cart_not_found" }, { dev: ctx.config.isDev });
      }
      const priced = priceCart(ctx.catalog, cart, mockSignIn(cart.memberId));
      return result("get-cart", cartText(priced), cartStructured(ctx, priced), { dev: ctx.config.isDev });
    }
  );
}
