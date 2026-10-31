/**
 * Shared tool plumbing.
 *
 * Every tool result goes through `result()`, which does three things without exception:
 *
 *   1. returns BOTH `content` and `structuredContent`
 *   2. asserts the payload against both ceilings
 *   3. keeps the plain-text fallback genuinely useful
 *
 * On (1): the core spec makes `content` REQUIRED on CallToolResult and `structuredContent`
 * optional, and returning the serialized JSON alongside it is a SHOULD for backwards
 * compatibility rather than a MUST (MCP tools specification). So this is a house rule, not
 * a spec requirement, and it is worth keeping for a reason the spec does state: the MCP Apps
 * extension is opt-in and default-off, and "a server offering UI-enhanced tools should still
 * return meaningful text content for clients that don't support the UI extension."
 *
 * The text fallback is therefore written for a human reading a transcript, not as a dump of the
 * JSON. A client without MCP Apps support gets a usable answer, not a wall of braces.
 */

import type { Catalog } from "../catalog/loader.js";
import type { CartStore } from "../cart/store.js";
import type { AppConfig } from "../config.js";

export interface ToolContext {
  catalog: Catalog;
  carts: CartStore;
  config: AppConfig;
}

export interface McpToolResult {
  // The SDK's CallToolResult carries an index signature; without one here the handler return
  // type is not assignable to it.
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

import { assertPayloadWithinCeilings } from "../limits.js";

export function result(
  toolName: string,
  text: string,
  structured: Record<string, unknown>,
  opts: { dev?: boolean; meta?: Record<string, unknown> } = {}
): McpToolResult {
  // Assert on the whole result, not just structuredContent: the text fallback counts too.
  const payload = { content: [{ type: "text", text }], structuredContent: structured };
  assertPayloadWithinCeilings(toolName, payload, { dev: opts.dev });

  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
    ...(opts.meta ? { _meta: opts.meta } : {}),
  };
}

export function errorResult(toolName: string, message: string): McpToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message, tool: toolName },
    isError: true,
  };
}

/** Truncate a list for the text fallback so it stays readable in a transcript. */
export function summariseList(lines: string[], max = 8): string {
  if (lines.length <= max) return lines.join("\n");
  const shown = lines.slice(0, max).join("\n");
  return `${shown}\n... and ${lines.length - max} more`;
}
