export class AiCoachError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409
  ) {
    super(message);
  }
}

/**
 * S-26/S-27 — added, not a repurposing of `TEMPORARILY_UNAVAILABLE`.
 *
 * Before this, five unrelated failure classes all threw
 * `AiCoachError("TEMPORARILY_UNAVAILABLE", "AI coaching is not available for
 * live use yet.", 503)`: fixture mode disabled/production
 * (`requireFixtureRuntime`), a LIVE binding with no usable release or
 * artifacts (`runtime-binding.ts`), a run's frozen artifact set no longer
 * matching its snapshot (`managed-executor.ts` binding-mismatch), and — the
 * one this code exists to separate out — the account's runtime binding
 * resolved fine but **this environment has never published a usable
 * reviewed/fixture artifact set at all** (`ArtifactLoadError` with code
 * `ARTIFACT_MISSING` or `ARTIFACT_NOT_EFFECTIVE`, surfaced from
 * `composeManagedInitialPlan`'s `loadReviewedArtifactSet` call). That last
 * one is a one-time environment setup gap (`pnpm ai-coach:seed-fixtures`
 * fixes it); the other four are transient or governance pauses. An operator
 * reading `AiCoachRun.lastError`, or the client UI mapping it to copy,
 * could not previously tell them apart — see docs/ai-coach/14-Handoff-Status.md.
 *
 * Only `composeManagedInitialPlan`'s `ARTIFACT_MISSING`/`ARTIFACT_NOT_EFFECTIVE`
 * branch throws this code. Every other site listed above keeps
 * `TEMPORARILY_UNAVAILABLE` unchanged — this is additive, not a rename, so no
 * existing call site or test that asserts `TEMPORARILY_UNAVAILABLE` moves.
 */
export const RUNTIME_ARTIFACTS_UNPUBLISHED = "RUNTIME_ARTIFACTS_UNPUBLISHED";
