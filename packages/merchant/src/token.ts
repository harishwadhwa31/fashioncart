/**
 * Checkout handoff token: the merchant side of the boundary.
 *
 * The connector mints this token; this file verifies it. The scheme is duplicated here rather
 * than imported, because the two are separate deployments with separate dependency trees and
 * the merchant must not take a build dependency on the connector. The cost of that choice is
 * that the two copies have to stay in lockstep. The authoritative copy is
 * packages/mcp-server/src/checkout/token.ts, and any change there is a breaking change here.
 *
 * Format:  <base64url(JSON payload)>.<base64url(HMAC-SHA256(body, secret))>
 *
 * The signature covers the base64url BODY STRING, not the raw JSON. Signing the decoded JSON
 * instead would make verification depend on both sides serialising identically, which they have
 * no way to guarantee.
 *
 * What the signature is and is not:
 *   - it is integrity, so the cart cannot be edited in the URL bar between the assistant and
 *     this page
 *   - it is NOT confidentiality: the payload is base64url and readable by anyone with the link
 *   - it is NOT a price quote. The payload carries product ids, sizes and quantities only. What
 *     the cart costs is recomputed here from the catalog, every time. See pricing.ts.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutPayload {
  /** Lines: [productId, size, quantity]. Positional, to keep the URL short. */
  l: [string, string, number][];
  /** Delivery pincode, or null. */
  p: string | null;
  /** Member id, or null. Drives tier pricing on this side too. */
  m: string | null;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Cart id. Dropped from the v2 format; still accepted so older links keep working. */
  cid?: string;
  /** Issued at. Dropped from the v2 format; `exp` alone carries freshness. */
  iat?: number;
}

/**
 * Signature length in base64url characters, MUST match the connector's SIG_CHARS.
 *
 * 22 chars is 132 bits. The connector truncates because the whole token is shown to the shopper
 * in Claude's "Open external link" modal, and a shorter URL reads as less suspicious at exactly
 * the moment trust matters most. Comparing only the first 22 characters means a token minted
 * with the older full-length signature still verifies.
 */
export const SIG_CHARS = 22;

export type TokenRejection = "missing" | "malformed" | "bad_signature" | "expired";

export class CheckoutTokenError extends Error {
  constructor(
    message: string,
    readonly reason: TokenRejection
  ) {
    super(message);
    this.name = "CheckoutTokenError";
  }
}

/**
 * Read at call time rather than at module load, so a process that sets the variable after
 * import (a test, or a dev script) is not silently signing with the fallback.
 *
 * The dev fallback matches the connector's. Rotating the real secret invalidates in flight
 * links, which is the correct behaviour.
 */
export function checkoutSecret(): string {
  const configured = process.env.CHECKOUT_SECRET;
  return configured && configured.length > 0 ? configured : "dev-only-insecure-checkout-secret";
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(body: string, secret: string): string {
  return b64urlEncode(createHmac("sha256", secret).update(body).digest());
}

/**
 * Shape check on the decoded payload.
 *
 * A valid signature proves the payload was not edited in transit. It does not prove the other
 * deployment is on the same version of the schema, so the shape is still checked before any
 * page reads it. Treating "signed" as "well formed" is how a schema change on one side turns
 * into a stack trace on the other.
 */
function assertPayloadShape(value: unknown): asserts value is CheckoutPayload {
  const p = value as Partial<CheckoutPayload> | null;
  if (!p || typeof p !== "object") {
    throw new CheckoutTokenError("Checkout token payload is not an object.", "malformed");
  }
  // `cid` is optional as of the v2 format. Requiring it here would reject every token the
  // current connector mints, which is exactly the kind of lockstep break the header warns about.
  if (!Array.isArray(p.l)) {
    throw new CheckoutTokenError("Checkout token payload is missing cart fields.", "malformed");
  }
  for (const line of p.l) {
    if (
      !Array.isArray(line) ||
      line.length !== 3 ||
      typeof line[0] !== "string" ||
      typeof line[1] !== "string" ||
      !Number.isInteger(line[2]) ||
      (line[2] as number) < 1
    ) {
      throw new CheckoutTokenError("Checkout token has a malformed cart line.", "malformed");
    }
  }
  if (p.p !== null && typeof p.p !== "string") {
    throw new CheckoutTokenError("Checkout token pincode is malformed.", "malformed");
  }
  if (p.m !== null && typeof p.m !== "string") {
    throw new CheckoutTokenError("Checkout token member id is malformed.", "malformed");
  }
  if (typeof p.exp !== "number") {
    throw new CheckoutTokenError("Checkout token has no expiry.", "malformed");
  }
}

export function verifyCheckoutToken(
  token: string | undefined | null,
  secret: string = checkoutSecret()
): CheckoutPayload {
  if (!token) {
    throw new CheckoutTokenError("No checkout token was supplied.", "missing");
  }

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CheckoutTokenError("Checkout token is malformed.", "malformed");
  }
  const [body, providedSig] = parts;

  // Signature first, payload second, matching the connector. Parsing untrusted bytes before
  // authenticating them widens the attack surface for no benefit.
  // Compare the first SIG_CHARS only. The connector truncates its signature to that length; a
  // token minted with the older full-length signature still verifies, because the prefix of a
  // digest is the same digest either way.
  const expected = Buffer.from(sign(body, secret).slice(0, SIG_CHARS));
  const provided = Buffer.from(providedSig.slice(0, SIG_CHARS));
  if (
    providedSig.length < SIG_CHARS ||
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new CheckoutTokenError("Checkout token signature does not verify.", "bad_signature");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(body).toString("utf-8"));
  } catch {
    throw new CheckoutTokenError("Checkout token payload is not valid JSON.", "malformed");
  }
  assertPayloadShape(parsed);

  if (parsed.exp < Math.floor(Date.now() / 1000)) {
    throw new CheckoutTokenError("Checkout link has expired.", "expired");
  }

  return parsed;
}

/**
 * Minting lives here for local development only, and no route calls it.
 *
 * In the real flow the connector is the only minter. Without this, testing the checkout page
 * locally would mean running the connector too, so main.ts prints one sample link at startup in
 * dev. Production never reaches this function.
 */
export function mintCheckoutToken(
  payload: Omit<CheckoutPayload, "exp">,
  secret: string = checkoutSecret(),
  ttlSeconds = 15 * 60
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: CheckoutPayload = { ...payload, exp: now + ttlSeconds };
  const body = b64urlEncode(Buffer.from(JSON.stringify(full), "utf-8"));
  return body + "." + sign(body, secret);
}
