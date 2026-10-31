#!/usr/bin/env npx tsx
/**
 * Local entrypoint.
 *
 * Remote streamable HTTP, stateless. Not stdio (except behind --stdio for Inspector), not
 * mcp-remote.
 *
 * The Express app itself lives in app.ts so the identical app can be exported as a Vercel
 * serverless handler from api/index.ts. This file only owns process concerns: loading the
 * catalog, choosing a transport, and binding a port.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { loadCatalog } from "./catalog/loader.js";
import { InMemoryCartStore } from "./cart/store.js";
import { createServer } from "./mcp-server.js";
import { createApp } from "./http-app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const catalog = loadCatalog(config.dataDir);
  const carts = new InMemoryCartStore();

  console.log(
    `[fashioncart] catalog: ${catalog.products.length} products, ${catalog.brands.length} brands, ` +
      `${catalog.categories.length} categories, ${catalog.locations.size} pincodes`
  );

  if (process.argv.includes("--stdio")) {
    const server = createServer(catalog, carts, config);
    await server.connect(new StdioServerTransport());
    return;
  }

  const app = createApp(catalog, carts, config);

  app.listen(config.port, () => {
    console.log(`[fashioncart] MCP endpoint:  ${config.publicUrl}/mcp`);
    console.log(`[fashioncart] images:        ${config.publicUrl}/images`);
    console.log(`[fashioncart] merchant site: ${config.merchantUrl}`);
    if (config.isDev) {
      console.log("[fashioncart] dev mode: payload ceilings are ASSERTED and will throw on breach");
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
