/**
 * Vercel entrypoint (Express framework preset).
 *
 * Vercel detects Express from the dependency list, then looks for an entrypoint at exactly:
 *
 *   app|index|server.{js,cjs,mjs,ts,cts,mts}
 *   src/app|src/index|src/server.{js,cjs,mjs,ts,cts,mts}
 *
 * It does NOT look at api/index.ts - an earlier attempt used the generic Node-function layout
 * and failed with "No entrypoint found", listing those six paths.
 *
 * It then requires the entrypoint to import express DIRECTLY. Re-exporting an app built in
 * another module is not enough: the second attempt failed with "No entrypoint found which
 * imports express. Found possible entrypoint: src/index.ts". The check is static, so the
 * import has to be here and has to be used.
 *
 * Hence the root app below. It is not ceremony: it gives the detector a real express import,
 * and it keeps createApp() shared with main.ts so local dev and production run the same
 * routing code rather than two drifting copies.
 *
 * The preset accepts a default-exported app or a port listener. Default export is used here,
 * because a serverless function is invoked rather than bound.
 */

import express from "express";

import { loadConfig } from "./config.js";
import { loadCatalog } from "./catalog/loader.js";
import { InMemoryCartStore } from "./cart/store.js";
import { createApp } from "./http-app.js";

const config = loadConfig();

// Parsed and validated once per instance at cold start, then reused across invocations on that
// instance. Roughly 100 KB of JSON; far cheaper done once than per request.
const catalog = loadCatalog(config.dataDir);

// Module scope, deliberately. On Vercel Fluid compute this genuinely persists between concurrent
// invocations on the same instance - which is exactly why every cart operation takes an explicit
// cartId and there is no ambient "current cart" to leak between users. It does NOT persist
// across instances, so a cart minted on one is invisible to another. Fine for a single-presenter
// demo; swap in RedisCartStore for anything else. See cart/store.ts.
const carts = new InMemoryCartStore();

const root = express();
root.use(createApp(catalog, carts, config));

export default root;
