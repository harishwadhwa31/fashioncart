/**
 * Liveness and a sanity check on the feed.
 *
 * The product count is here rather than a bare `{ok:true}` because the failure this endpoint
 * actually needs to catch is a deployment that booted fine but bundled no catalog. A storefront
 * serving zero products would answer every other check happily.
 */

import { Router } from "express";

import { catalog } from "../catalog.js";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, products: catalog.products.length });
  });

  return router;
}
