/**
 * Express app factory.
 *
 * Split out of main.ts so the same app can be driven two ways:
 *   - locally, by main.ts calling app.listen()
 *   - on Vercel, by api/index.ts exporting it as a serverless handler
 *
 * A serverless function cannot call listen(), so the factory must not. Everything below is
 * request-scoped or read-only; the only mutable thing is the cart store, which is keyed by an
 * explicit cartId precisely because module scope IS shared across concurrent invocations on
 * Vercel Fluid compute (see cart/store.ts).
 */

import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { AppConfig } from "./config.js";
import type { Catalog } from "./catalog/loader.js";
import type { CartStore } from "./cart/store.js";
import { createServer } from "./mcp-server.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));

export function createApp(catalog: Catalog, carts: CartStore, config: AppConfig): Express {
  const app = express();

  app.use(cors({ exposedHeaders: ["Mcp-Session-Id", "MCP-Protocol-Version"] }));
  app.use(express.json({ limit: "4mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      products: catalog.products.length,
      feedVersion: catalog.feedVersion,
      publicUrl: config.publicUrl,
      merchantUrl: config.merchantUrl,
      protocol: "2025-11-25",
      uiProtocol: "2026-01-26",
    });
  });

  // Local static serving. On Vercel this route is normally never reached: files under
  // public/ are served straight from the CDN, which also keeps image bytes away from the
  // 4.5 MB function response limit. Kept so local dev and Vercel behave identically.
  app.use(
    "/images",
    express.static(resolve(HERE, "../public/images"), { maxAge: "7d", fallthrough: true })
  );

  app.all("/mcp", async (req: Request, res: Response) => {
    // Fresh server and transport per request. sessionIdGenerator: undefined is what makes the
    // transport stateless - no Mcp-Session-Id is minted or expected.
    const server = createServer(catalog, carts, config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[fashioncart] request failed:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  return app;
}
