/**
 * Server configuration.
 *
 * Includes the host-dialect switch. Two rules from Phase 1 research shape it:
 *
 *   1. ChatGPT has been "fully compatible with the MCP Apps spec" since 2026-02-22 and the
 *      string "text/html+skybridge" appears nowhere in OpenAI's current documentation. So the
 *      second MIME registration is OFF by default. It stays behind a flag rather than being
 *      deleted, because the dual-registration question was never verified either way and the
 *      cost of keeping the seam is one environment variable.
 *
 *   2. OpenAI explicitly instructs against runtime host detection: "Avoid branching on a host
 *      or product name. Test for the capability your UI needs." So nothing in this codebase
 *      branches on a host name. The widget branches on app.getHostCapabilities(); the server
 *      branches on the client's declared UI capability via getUiCapability().
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Where the catalog feed lives.
 *
 * Locally the feed is shared at <repo>/data. On Vercel the function root is this package, so
 * anything outside it is not bundled - `npm run predeploy` copies the feed to ./data and this
 * resolver prefers that copy when present. Deliberately a lookup rather than a build-time
 * constant, so the same code runs in both places without a flag.
 */
function resolveDataDir(): string {
  const explicit = process.env.DATA_DIR;
  if (explicit) return explicit;

  const local = resolve(HERE, "../data");        // deployment copy, written by predeploy
  const shared = resolve(HERE, "../../../data"); // repo-shared feed, the authored source

  // Order matters. The staged copy must win ONLY on Vercel. Preferring it unconditionally
  // would mean that once predeploy has run, local edits to the authored feed silently stop
  // taking effect - a stale-data bug that looks exactly like a caching problem.
  if (process.env.VERCEL && existsSync(join(local, "catalog.json"))) return local;
  if (existsSync(join(shared, "catalog.json"))) return shared;
  return local;
}

/**
 * Where the built widget bundle lives.
 *
 * Same shape as resolveDataDir, and for the same reason: the authored build output sits in a
 * sibling package that a Vercel function root cannot see, so predeploy stages a copy inside
 * this package. The staged copy must win ONLY on Vercel - preferring it locally would serve a
 * stale widget after any predeploy, which looks exactly like a caching bug.
 */
function resolveWidgetDir(): string {
  const explicit = process.env.WIDGET_DIST_DIR;
  if (explicit) return explicit;

  const staged = resolve(HERE, "../data/widget");   // written by scripts/copy-data.mjs
  const built = resolve(HERE, "../../widget/dist"); // the authored build output

  if (process.env.VERCEL && existsSync(join(staged, "mcp-app.html"))) return staged;
  if (existsSync(join(built, "mcp-app.html"))) return built;
  return staged;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export interface AppConfig {
  port: number;
  /** Public origin of THIS server. Also the origin images are served from, so it is what goes
   *  into _meta.ui.csp.resourceDomains. */
  publicUrl: string;
  /** Public origin of the mock merchant site, where checkout lands. */
  merchantUrl: string;
  dataDir: string;
  widgetDistDir: string;
  checkoutSecret: string;
  checkoutTtlSeconds: number;
  isDev: boolean;
  /** Register the UI resource a second time under ChatGPT's legacy MIME. Off by default. */
  enableChatGptMime: boolean;
  defaultPageSize: number;
  maxPageSize: number;
}

export const CHATGPT_LEGACY_MIME = "text/html+skybridge";

/**
 * The public origin of this deployment.
 *
 * This is NOT cosmetic: it is what goes into _meta.ui.csp.resourceDomains, so if it is wrong or
 * missing the widget's images are blocked by CSP and fail silently. That is precisely the
 * failure the Phase 2 gate exists to detect, so it must not be caused by our own config.
 *
 * PUBLIC_URL would otherwise be chicken-and-egg on a first deploy: you cannot know the URL until
 * after the deploy that needs it. Vercel injects its own, so fall back to that and the problem
 * disappears. Preference order:
 *
 *   1. PUBLIC_URL             - explicit, and what a custom domain would use
 *   2. the stable production domain injected by Vercel
 *   3. the per-deployment URL injected by Vercel (changes every deploy; fine for previews)
 *   4. localhost              - local development
 *
 * Vercel's injected values have no scheme, hence the https:// prefix.
 */
function resolvePublicUrl(port: number): string {
  const explicit = process.env.PUBLIC_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  return `http://localhost:${port}`;
}

export function loadConfig(): AppConfig {
  const isDev = process.env.NODE_ENV !== "production";
  const port = envInt("PORT", 3001);

  const checkoutSecret = envStr("CHECKOUT_SECRET", "");
  if (!checkoutSecret && !isDev) {
    throw new Error(
      "CHECKOUT_SECRET must be set in production. Without it, checkout links could be forged."
    );
  }

  return {
    port,
    publicUrl: resolvePublicUrl(port),
    merchantUrl: envStr("MERCHANT_URL", "http://localhost:3002").replace(/\/+$/, ""),
    dataDir: resolveDataDir(),
    widgetDistDir: resolveWidgetDir(),
    // Dev-only fallback. Rotating it invalidates in-flight links, which is correct behaviour.
    checkoutSecret: checkoutSecret || "dev-only-insecure-checkout-secret",
    checkoutTtlSeconds: envInt("CHECKOUT_TTL_SECONDS", 15 * 60),
    isDev,
    enableChatGptMime: envBool("ENABLE_CHATGPT_MIME", false),
    defaultPageSize: envInt("DEFAULT_PAGE_SIZE", 24),
    maxPageSize: envInt("MAX_PAGE_SIZE", 40),
  };
}

/**
 * Origins the widget must be allowed to reach.
 *
 * resourceDomains feeds img-src/script-src/style-src/font-src/media-src; connectDomains feeds
 * connect-src. MEASURED against the reference host on 2026-09-06.
 *
 * Both list this server's own origin, and that is not redundant. The widget executes on a
 * host-controlled sandbox origin, so 'self' in the enforced CSP never means this deployment.
 * Images served from /images are cross-origin from inside the view.
 *
 * connectDomains is what makes fallback rung 2 possible: if claude.ai turns out not to honour
 * resourceDomains for img-src (ext-apps issue #761), the widget can still fetch() the bytes and
 * render them through a blob: URL, which the default CSP already permits.
 */
export function cspFor(config: AppConfig): {
  resourceDomains: string[];
  connectDomains: string[];
} {
  const origins = new Set<string>();
  if (/^https?:\/\//.test(config.publicUrl)) origins.add(config.publicUrl);

  return {
    resourceDomains: [...origins],
    connectDomains: [...origins],
  };
}
