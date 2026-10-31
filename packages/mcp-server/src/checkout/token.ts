/**
 * Signed, short-lived checkout handoff token.
 *
 * ============================================================================================
 * WHY NO PAYMENT DATA EXISTS ANYWHERE IN THIS SERVER
 * ============================================================================================
 *
 * There is no card number, no UPI handle, no bank reference and no payment instrument of any
 * kind in this codebase: not in the server, not in the widget, not in any tool response, and
 * not in this token. That is a deliberate architectural boundary, and it is the point of the
 * demo rather than an omission from it.
 *
 * Two reasons, and they are independent.
 *
 * 1. PAYMENT DATA LOCALISATION.
 *    India's payment-data storage rules require that payment system data relating
 *    to transactions in India be stored only on systems located in India. An MCP connector is
 *    a globally-deployed serverless surface reached through an assistant host that may itself
 *    run anywhere. If payment data crossed this boundary, the deployment topology of the
 *    connector - and of the assistant - would become a data-residency question. Keeping the
 *    payment step entirely on the merchant's own domain means this server never enters that
 *    scope, and the merchant's existing, already-compliant checkout keeps handling it.
 *
 * 2. PCI DSS SCOPE STAYS WITH THE MERCHANT.
 *    Any system that stores, processes or transmits cardholder data is in PCI DSS scope, along
 *    with anything connected to it. Accepting payment details in a tool argument would pull
 *    this connector, its logs, its host platform and the assistant transcript into that scope.
 *    Handing off to the merchant's own checkout leaves scope exactly where it already is.
 *
 * What crosses the boundary instead is this token: an integrity-protected description of WHAT
 * the shopper wants to buy, never HOW they will pay. The merchant site resumes the cart from
 * it, re-prices server-side, and runs its own payment flow on its own domain.
 *
 * The signature is not confidentiality. The payload is base64url and readable by anyone holding
 * the link; it contains only product ids, sizes, quantities and a pincode. The signature exists
 * so the merchant can trust that the cart contents were not edited in the URL bar between the
 * assistant and the checkout page. Prices are NOT trusted from this token either - the merchant
 * re-prices from its own catalog. The token says what, not what it costs.
 * ============================================================================================
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutPayload {
  /** Lines: [productId, size, quantity]. Positional to keep the URL short. */
  l: [string, string, number][];
  /** Delivery pincode, or null. */
  p: string | null;
  /** Member id, or null. Determines tier pricing on the merchant side too. */
  m: string | null;
  /** Expiry, epoch seconds. */
  exp: number;
}

/**
 * Signature length, in base64url characters. 22 chars is 132 bits.
 *
 * The full HMAC-SHA256 is 43 characters. It was truncated because the whole token is displayed
 * to the shopper in Claude's "Open external link" confirmation modal, at the exact moment the
 * design promises "payment never touches the assistant". A wall of base64 reads as something being
 * smuggled, which is the opposite of the intended effect.
 *
 * 132 bits is far beyond what this token needs to resist. It authenticates a 15-minute,
 * single-purpose message that carries no credential and no price: the merchant re-prices every
 * line from its own catalogue, so forging one buys an attacker nothing but a cart they could
 * have built by hand.
 */
export const SIG_CHARS = 22;

export class CheckoutTokenError extends Error {
  constructor(message: string, readonly reason: "malformed" | "bad_signature" | "expired") {
    super(message);
    this.name = "CheckoutTokenError";
  }
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

export const DEFAULT_TTL_SECONDS = 15 * 60;

export function mintCheckoutToken(
  payload: Omit<CheckoutPayload, "exp">,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000);
  // `iat` was dropped along with `cid`: neither is read by the merchant, and both cost URL
  // characters in a string the shopper is shown. `exp` alone carries the freshness guarantee.
  const full: CheckoutPayload = { ...payload, exp: now + ttlSeconds };
  const body = b64urlEncode(Buffer.from(JSON.stringify(full), "utf-8"));
  return `${body}.${sign(body, secret).slice(0, SIG_CHARS)}`;
}

export function verifyCheckoutToken(token: string, secret: string): CheckoutPayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new CheckoutTokenError("Checkout token is malformed.", "malformed");
  }
  const [body, providedSig] = parts;

  // Compare the first SIG_CHARS only, so a token minted with a full-length signature still
  // verifies. Both sides agree that 132 bits is the security parameter; extra characters are
  // surplus, not stronger.
  const expected = sign(body, secret).slice(0, SIG_CHARS);
  const a = Buffer.from(expected);
  const b = Buffer.from(providedSig.slice(0, SIG_CHARS));
  if (providedSig.length < SIG_CHARS || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new CheckoutTokenError("Checkout token signature does not verify.", "bad_signature");
  }

  let payload: CheckoutPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf-8"));
  } catch {
    throw new CheckoutTokenError("Checkout token payload is not valid JSON.", "malformed");
  }

  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new CheckoutTokenError(
      "Checkout link has expired. Ask the assistant for a fresh checkout link.",
      "expired"
    );
  }

  return payload;
}

/**
 * Build the handoff URL with the token as a PATH SEGMENT, not a query parameter.
 *
 * Claude shows the full destination in its confirmation modal, and users read the start of a
 * URL, not the end. `/checkout/<token>` leads with the merchant domain and the word "checkout"
 * before the opaque part; `?token=eyJ...` leads with an equals sign and base64.
 *
 * base64url uses only A-Z a-z 0-9 - _ so it is already path-safe and needs no escaping.
 */
export function buildCheckoutUrl(merchantBaseUrl: string, token: string): string {
  const base = merchantBaseUrl.replace(/\/+$/, "");
  return `${base}/checkout/${token}`;
}
