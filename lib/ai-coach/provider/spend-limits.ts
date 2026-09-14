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
 */

const MAX_MODEL_CALLS_PER_CLIENT_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_SECONDS = 3600;
export const MAX_TOKENS_PER_STAGE_CALL = 20_000;

/** Checked before every provider call — never after. */
export async function checkProviderRateLimit(clientId: string, operation: string): Promise<boolean> {
  return consumeQuota(`ai-coach-provider:${operation}`, clientId, MAX_MODEL_CALLS_PER_CLIENT_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
}

export function isWithinTokenCeiling(tokensUsed: number): boolean {
  return tokensUsed <= MAX_TOKENS_PER_STAGE_CALL;
}
