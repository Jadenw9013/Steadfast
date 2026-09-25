import { consumeQuota } from "@/lib/security/quota";

/**
 * A05 — spend/rate limiting ahead of a provider call.
 *
 * *** ENGINEERING SAFETY DEFAULT — NOT A MEASURED DOLLAR BUDGET ***
 * Real per-token dollar costs require gate G05's "evaluated provider
 * pricing" (docs/ai-coach/13-Sources-and-Open-Decisions.md); until that
 * exists this enforces a call-rate cap per client/operation/period (reusing
 * the existing quota primitive) and a conservative per-call token ceiling,
 * as a safety backstop rather than a cost control.
 *
 * T-996: `estimateSpendMinorUnits` below is a per-token *estimate*, not an
 * invoice. The prices it multiplies by now come from the live-launch
 * packet's `runtimeConfiguration.provider.pricing` (set by Jaden at packet
 * authoring time, never invented here) so `operations.maximumSpendMinorUnitsPerWindow`
 * has a real number to compare against; it still is not a measured dollar
 * budget or a vendor billing reconciliation.
 */

const MAX_MODEL_CALLS_PER_CLIENT_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_SECONDS = 3600;
export const MAX_TOKENS_PER_STAGE_CALL = 20_000;

/**
 * T-996: the non-streaming Anthropic Messages API response cap. Lives here
 * (a leaf module with no imports from `live-launch/` or `provider/adapter.ts`)
 * so both `live-launch/schema.ts` (packet `maxOutputTokens` validation) and
 * `provider/anthropic-provider.ts` (`max_tokens` on the request) import the
 * same constant instead of keeping two copies that could drift — a schema.ts
 * -> anthropic-provider.ts import would cycle back through
 * `live-launch/repository.ts` -> `live-launch/schema.ts`.
 */
export const MAX_NON_STREAMING_OUTPUT_TOKENS = 16_000;

/** Checked before every provider call — never after. */
export async function checkProviderRateLimit(
  clientId: string,
  operation: string
): Promise<boolean> {
  return consumeQuota(
    `ai-coach-provider:${operation}`,
    clientId,
    MAX_MODEL_CALLS_PER_CLIENT_PER_WINDOW,
    RATE_LIMIT_WINDOW_SECONDS
  );
}

export function isWithinTokenCeiling(tokensUsed: number): boolean {
  return tokensUsed <= MAX_TOKENS_PER_STAGE_CALL;
}

export type ProviderTokenPricing = {
  currency: string;
  inputMinorUnitsPerMillionTokens: number;
  outputMinorUnitsPerMillionTokens: number;
};

function nonNegativeFiniteOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Rounds up so a real spend can never be under-counted against
 * `operations.maximumSpendMinorUnitsPerWindow`. Never negative; garbage
 * (non-finite or negative) token counts are treated as zero.
 */
export function estimateSpendMinorUnits(
  usage: { inputTokens: number; outputTokens: number },
  pricing: ProviderTokenPricing
): number {
  const inputTokens = nonNegativeFiniteOrZero(usage.inputTokens);
  const outputTokens = nonNegativeFiniteOrZero(usage.outputTokens);
  const rawMinorUnits =
    (inputTokens * pricing.inputMinorUnitsPerMillionTokens +
      outputTokens * pricing.outputMinorUnitsPerMillionTokens) /
    1_000_000;
  return Math.max(0, Math.ceil(rawMinorUnits));
}
