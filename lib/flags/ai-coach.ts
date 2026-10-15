/**
 * AI Coach enrollment/generation/publication flags (A01, CB10).
 *
 * lib/flags/check.ts's generic checkFeatureEnabled() defaults an unset
 * feature to `true` — a reasonable convention for the existing feature
 * flags it already gates, but wrong for these three: an AI capability
 * must be explicitly turned on, never on-by-default because nobody set an
 * env var yet. These are separate, narrow checks rather than a change to
 * that shared helper's default, so existing flags keep their current
 * behavior.
 */

function isExplicitlyEnabled(envVar: string): boolean {
  return process.env[envVar] === "true";
}

/** Whether a client may attempt AI Coach enrollment at all (still also requires AiCoachEntitlement). */
export function isAiCoachEnrollmentEnabled(): boolean {
  return isExplicitlyEnabled("FEATURE_AI_COACH_ENROLLMENT");
}

/** Whether AI Coach may run generation jobs (initial plans, weekly reviews). */
export function isAiCoachGenerationEnabled(): boolean {
  return isExplicitlyEnabled("FEATURE_AI_COACH_GENERATION");
}

/** Whether an AI-generated candidate may become an active, client-visible plan. */
export function isAiCoachPublicationEnabled(): boolean {
  return isExplicitlyEnabled("FEATURE_AI_COACH_PUBLICATION");
}
