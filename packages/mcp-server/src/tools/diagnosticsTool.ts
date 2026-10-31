/**
 * run-diagnostics: the Phase 2 gate tool.
 *
 * Exists solely to give the diagnostic widget something to render from, and to hand it the one
 * piece of information it cannot derive on its own: the absolute URL of a real product image on
 * this deployment. The widget then probes whether that image is reachable from inside the host's
 * sandbox, which is the question the whole gate turns on.
 *
 * Remove this tool once the gate has passed. It is scaffolding, not product, and every tool
 * carrying ui-family _meta is appended to host-side tool_search results whether or not it is
 * relevant, so an idle diagnostic tool is not free.
 */

import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";

import { cspFor } from "../config.js";
import { result, type ToolContext } from "./context.js";

export function registerDiagnosticsTool(server: any, resourceUri: string, ctx: ToolContext): void {
  registerAppTool(
    server,
    "run-diagnostics",
    {
      title: "Run FashionCart display diagnostics",
      description:
        "TROUBLESHOOTING ONLY. Use this ONLY when the user explicitly asks to test, check, " +
        "debug or run diagnostics on the FashionCart connector itself. " +
        "Renders a technical card reporting whether images load in the app sandbox, the " +
        "sandbox origin, host capabilities and context, and whether external links prompt. " +
        "This is NOT a shopping tool. Never call it for any request about products, browsing, " +
        "prices, carts or orders; use search-products for those.",
      inputSchema: {
        productId: z
          .string()
          .optional()
          .describe("SKU whose thumbnail to probe with. Defaults to the first product."),
      },
      annotations: {
        title: "Run diagnostics",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri, visibility: ["model", "app"] } },
    },
    async (args: any) => {
      const product = ctx.catalog.byId.get(args.productId ?? "") ?? ctx.catalog.products[0];
      const csp = cspFor(ctx.config);
      const probeImageUrl = `${ctx.config.publicUrl}${product.thumbnailUrl}`;

      const structured = {
        kind: "diagnostics" as const,
        serverVersion: "0.1.0",
        protocol: "2025-11-25",
        uiProtocol: "2026-01-26",
        imageBaseUrl: ctx.config.publicUrl,
        probeImageUrl,
        probeProductId: product.id,
        // Echoed so the widget can show what the server ASKED for, next to what the host
        // actually enforced. The gap between the two is the finding.
        declaredCsp: csp,
        productCount: ctx.catalog.products.length,
      };

      const text = [
        "FashionCart diagnostics",
        `server ${structured.serverVersion}, MCP ${structured.protocol}, UI ${structured.uiProtocol}`,
        `catalog: ${structured.productCount} products`,
        `images: ${structured.imageBaseUrl}/images/...`,
        `probe image: ${probeImageUrl}`,
        `declared resourceDomains: ${csp.resourceDomains.join(", ") || "(none)"}`,
        `declared connectDomains: ${csp.connectDomains.join(", ") || "(none)"}`,
        "",
        "If the interactive card is not visible above, this connector reached the model but the " +
          "app did not render. That is itself the finding.",
      ].join("\n");

      return result("run-diagnostics", text, structured, { dev: ctx.config.isDev });
    }
  );
}
