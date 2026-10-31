#!/usr/bin/env npx tsx
/**
 * Local development entrypoint.
 *
 * Owns process concerns only: binding a port, and printing a working checkout link so the
 * checkout, payment and confirmation pages can be exercised without running the connector
 * alongside. On Vercel this file is never loaded; the platform imports the app from index.ts.
 */

import app from "./index.js";
import { catalog, type Product } from "./catalog.js";
import { formatRupees, priceCart } from "./pricing.js";
import { mintCheckoutToken } from "./token.js";

const PORT = Number.parseInt(process.env.PORT ?? "3002", 10) || 3002;

/**
 * A deterministic two line cart, chosen so the printed link behaves the same on every restart:
 * the two cheapest in stock styles, which also keeps the sample under the free delivery
 * threshold so the delivery fee row is visible while developing.
 */
function sampleCart(): { productId: string; size: string; quantity: number }[] {
  const candidates: Product[] = catalog.products
    .filter((p) => p.inStock && !p.memberOnly)
    .slice()
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))
    .slice(0, 2);

  return candidates.map((p) => ({
    productId: p.id,
    size: p.inStockSizes[0] ?? p.sizes[0],
    quantity: 1,
  }));
}

app.listen(PORT, () => {
  const base = "http://localhost:" + PORT;
  console.log("[fashioncart-merchant] storefront: " + base);
  console.log("[fashioncart-merchant] health:     " + base + "/health");

  if (process.env.NODE_ENV === "production") return;

  const lines = sampleCart();
  const priced = priceCart(lines, "gold-demo");
  const token = mintCheckoutToken({
    cid: "dev-cart",
    l: lines.map((l) => [l.productId, l.size, l.quantity] as [string, string, number]),
    p: "400013",
    m: "gold-demo",
  });

  console.log(
    "[fashioncart-merchant] dev checkout link (Gold member, " +
      formatRupees(priced.total) +
      ", valid 15 minutes):"
  );
  console.log("  " + base + "/checkout?token=" + encodeURIComponent(token));
});
