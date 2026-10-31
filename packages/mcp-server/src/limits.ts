/**
 * Payload ceilings.
 *
 * Two apply, they are different in kind, and BOTH must be asserted against.
 *
 *   A. ~25,000 tokens   the brief's budget. MEASURED to bind first (see below).
 *   B. ~150,000 chars   claude.ai writes a result larger than this to the code-execution
 *                       sandbox filesystem and hands the app a FILE POINTER instead of
 *                       structuredContent. The widget never hydrates. No error is raised
 *                       anywhere: it simply renders empty.
 *
 * Ceiling B is the reason this module exists. A silent failure that only appears in a live
 * demo is not something to leave to code review.
 *
 * On the tokens-per-char constant: measured, not assumed. Anthropic's count_tokens endpoint
 * was run against real search-products payloads built from the real catalog on 2026-09-06
 * (see scripts/count_tokens.py). Result: 1.81 to 1.96 characters per
 * token across every payload shape, clustering at 1.82 for list responses. JSON tokenizes far
 * worse than prose because of quote/brace punctuation, SKU codes like "FC-SHT-001" and hex
 * colours like "#D8C7A9".
 *
 * We cannot call count_tokens at runtime (latency, and it needs a key), so the assertion
 * estimates from characters using a DELIBERATELY PESSIMISTIC ratio: 1.7 chars/token, below the
 * lowest figure measured. An estimate that errs low on chars-per-token errs high on tokens,
 * which is the safe direction for a budget check.
 */

export const CHAR_CEILING = 150_000;
export const TOKEN_CEILING = 25_000;

/** Measured 1.81-1.96. Held below the minimum so the estimate over-counts tokens. */
export const CHARS_PER_TOKEN = 1.7;

/** Warn well before the cliff. 0.8 of budget still leaves room for the conversation. */
export const WARN_RATIO = 0.8;

export interface PayloadReport {
  chars: number;
  estimatedTokens: number;
  charRatio: number;
  tokenRatio: number;
  breached: boolean;
  warned: boolean;
  bindingCeiling: "tokens" | "chars";
  detail: string;
}

export function inspectPayload(toolName: string, value: unknown): PayloadReport {
  const chars = JSON.stringify(value)?.length ?? 0;
  const estimatedTokens = Math.ceil(chars / CHARS_PER_TOKEN);

  const charRatio = chars / CHAR_CEILING;
  const tokenRatio = estimatedTokens / TOKEN_CEILING;
  const bindingCeiling = tokenRatio >= charRatio ? "tokens" : "chars";

  const breached = charRatio >= 1 || tokenRatio >= 1;
  const warned = !breached && (charRatio >= WARN_RATIO || tokenRatio >= WARN_RATIO);

  const detail =
    `${toolName}: ${chars.toLocaleString()} chars ` +
    `(${(charRatio * 100).toFixed(1)}% of ${CHAR_CEILING.toLocaleString()}), ` +
    `~${estimatedTokens.toLocaleString()} tokens ` +
    `(${(tokenRatio * 100).toFixed(1)}% of ${TOKEN_CEILING.toLocaleString()}), ` +
    `binding ceiling: ${bindingCeiling}`;

  return { chars, estimatedTokens, charRatio, tokenRatio, breached, warned, bindingCeiling, detail };
}

export class PayloadTooLargeError extends Error {
  constructor(public readonly report: PayloadReport) {
    super(
      `Tool result exceeds a payload ceiling. ${report.detail}. ` +
        `Above ${CHAR_CEILING.toLocaleString()} characters claude.ai replaces structuredContent ` +
        `with a file pointer and the widget renders empty with NO error. Reduce pageSize or ` +
        `move fields out of the list shape.`
    );
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Assert a tool result is within both ceilings.
 *
 * In development this THROWS, loudly, at the point of construction. In production it logs and
 * lets the response through, because a degraded render beats a hard failure in front of a
 * client. Either way the breach is recorded rather than silent, which is the whole point.
 */
export function assertPayloadWithinCeilings(
  toolName: string,
  value: unknown,
  opts: { dev?: boolean; onReport?: (r: PayloadReport) => void } = {}
): PayloadReport {
  const dev = opts.dev ?? process.env.NODE_ENV !== "production";
  const report = inspectPayload(toolName, value);
  opts.onReport?.(report);

  if (report.breached) {
    if (dev) throw new PayloadTooLargeError(report);
    console.error(`[limits] BREACH ${report.detail}`);
  } else if (report.warned) {
    console.warn(`[limits] approaching ceiling: ${report.detail}`);
  } else if (dev) {
    console.debug(`[limits] ok: ${report.detail}`);
  }

  return report;
}

/**
 * Largest page size that stays within both ceilings for a given measured per-item cost.
 * Used by the search tool to clamp a caller-supplied pageSize rather than trusting it.
 */
export function maxPageSize(perItemChars: number, envelopeChars: number, safety = 0.5): number {
  const charBudget = CHAR_CEILING * safety - envelopeChars;
  const tokenBudget = TOKEN_CEILING * CHARS_PER_TOKEN * safety - envelopeChars;
  const budget = Math.min(charBudget, tokenBudget);
  return Math.max(1, Math.floor(budget / perItemChars));
}
