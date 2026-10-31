/**
 * The payload assertion is the one piece of this server that only ever runs when something has
 * already gone wrong, so it is the piece most likely to be quietly broken. These tests exist to
 * prove it fires, and fires on the right ceiling.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHARS_PER_TOKEN,
  CHAR_CEILING,
  PayloadTooLargeError,
  TOKEN_CEILING,
  assertPayloadWithinCeilings,
  inspectPayload,
  maxPageSize,
} from "./limits.js";

function payloadOfChars(n: number): { blob: string } {
  // JSON.stringify adds {"blob":"..."} = 11 chars of wrapper.
  return { blob: "x".repeat(Math.max(0, n - 11)) };
}

test("a small payload passes both ceilings", () => {
  const r = inspectPayload("t", payloadOfChars(11_048));
  assert.equal(r.breached, false);
  assert.equal(r.warned, false);
});

test("tokens are the binding ceiling for JSON at the measured ratio", () => {
  // 1.7 chars/token against a 25k token budget means tokens bite at ~42,500 chars, well below
  // the 150,000 char ceiling. This is the finding that drove the lean wire shape: the obvious
  // 24-product response measured 6,082 real tokens, a quarter of the budget.
  const r = inspectPayload("t", payloadOfChars(50_000));
  assert.equal(r.bindingCeiling, "tokens");
  assert.ok(r.tokenRatio > r.charRatio);
});

test("the token ceiling is breached before the char ceiling", () => {
  const justOverTokens = Math.ceil(TOKEN_CEILING * CHARS_PER_TOKEN) + 100;
  assert.ok(justOverTokens < CHAR_CEILING, "token ceiling must bite first, or the constant is wrong");

  const r = inspectPayload("t", payloadOfChars(justOverTokens));
  assert.equal(r.breached, true);
  assert.equal(r.charRatio < 1, true, "char ceiling should NOT be the one breached here");
});

test("dev mode throws on breach", () => {
  assert.throws(
    () => assertPayloadWithinCeilings("t", payloadOfChars(CHAR_CEILING + 1), { dev: true }),
    PayloadTooLargeError
  );
});

test("production logs instead of throwing, because a degraded render beats a hard failure", () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    const r = assertPayloadWithinCeilings("t", payloadOfChars(CHAR_CEILING + 1), { dev: false });
    assert.equal(r.breached, true);
    assert.equal(errors.length, 1);
  } finally {
    console.error = original;
  }
});

test("the warning band fires before the breach", () => {
  const chars = Math.floor(TOKEN_CEILING * CHARS_PER_TOKEN * 0.85);
  const r = inspectPayload("t", payloadOfChars(chars));
  assert.equal(r.breached, false);
  assert.equal(r.warned, true);
});

test("the estimate over-counts tokens rather than under-counting", () => {
  // Real measurement was 1.81-1.96 chars/token. The constant must sit BELOW that range, so the
  // estimated token count is always >= the true one. An optimistic constant here would let a
  // real breach through, which is the failure mode that renders an empty widget with no error.
  assert.ok(CHARS_PER_TOKEN < 1.81, `CHARS_PER_TOKEN=${CHARS_PER_TOKEN} must be below the measured minimum of 1.81`);
});

test("maxPageSize leaves headroom and never returns zero", () => {
  // 445 chars/product measured for the filterable shape, 345 for the envelope.
  const n = maxPageSize(445, 345);
  assert.ok(n > 24, `expected room for more than a default page, got ${n}`);
  assert.ok(n < 200, `suspiciously permissive: ${n}`);
  assert.equal(maxPageSize(10_000_000, 345), 1);
});
