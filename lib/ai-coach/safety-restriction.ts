import type { AiDomainPermission, AiSafetyDisposition } from "@/app/generated/prisma/client";

/**
 * S-19 dead end 1 — the single description of "this account is currently
 * safety-restricted", shared by the server guard that refuses a plan request
 * and by the client-facing workspace DTO that has to explain the refusal.
 *
 * Before this module the guard lived only inside `requestAiRun`: nothing a
 * client could read told them an account was restricted, so the first sign of
 * it was a 409 on the next plan request ("Resolve the current safety
 * restriction before preparing a new plan") with no stated cause and no exit.
 *
 * This module deliberately does **not** lift anything. A restriction is
 * lifted only by `resolveAiSafety` (`lib/ai-coach/safety-resolution.ts`), by
 * an authorized reviewer holding an `AiCoachReviewerGrant` that covers the
 * client and every domain being cleared. `submitSafetyDisclosure` ratchets
 * monotonically and stores no per-cause provenance, so nothing here can tell
 * which of several possible causes produced the current state — and a
 * re-derivation that guessed would silently undo a reviewer's decision. The
 * honest product answer is therefore to state the situation plainly rather
 * than offer the client a button that clears a safety gate.
 */

export const AI_COACH_DOMAINS = ["NUTRITION", "STRENGTH", "CARDIO"] as const;
export type AiCoachDomain = (typeof AI_COACH_DOMAINS)[number];

/** The exact message `requestAiRun` returns with `SAFETY_RESTRICTED` (409). */
export const SAFETY_RESTRICTED_PLAN_MESSAGE =
  "Resolve the current safety restriction before preparing a new plan.";

export interface AiCoachDomainPermissions {
  nutrition: AiDomainPermission;
  strength: AiDomainPermission;
  cardio: AiDomainPermission;
}

/**
 * The plan-request gate. Historically inlined in `requestAiRun`; it is a
 * named export so the UI can show the same answer the server will give
 * instead of letting the client discover it as a 409.
 */
export function planRequestIsSafetyBlocked(permissions: AiCoachDomainPermissions): boolean {
  return [permissions.nutrition, permissions.strength, permissions.cardio].some(
    (permission) => permission !== "ALLOW"
  );
}

export interface AiSafetyRestrictionNotice {
  disposition: AiSafetyDisposition;
  /** Domains whose permission is not `ALLOW`, in a stable order. */
  restrictedDomains: AiCoachDomain[];
  /** True when `requestAiRun` would refuse a new plan request right now. */
  planRequestBlocked: boolean;
  /**
   * Always `false`. There is no client-facing action that clears a safety
   * restriction, and there must not be one: a client asserting they are safe
   * would turn the gate into a checkbox.
   */
  clientCanResolve: false;
  /** Who can lift it. Mirrors `resolveAiSafety`'s authorization. */
  resolvedBy: "AUTHORIZED_REVIEWER";
}

/**
 * Projects the client-readable restriction state, or `null` when the account
 * is clear. Structured only: wording stays in the presentation layer so no
 * unreviewed prose is minted in the data layer.
 */
export function deriveSafetyRestriction(input: {
  disposition: AiSafetyDisposition;
  permissions: AiCoachDomainPermissions;
}): AiSafetyRestrictionNotice | null {
  const byDomain: Record<AiCoachDomain, AiDomainPermission> = {
    NUTRITION: input.permissions.nutrition,
    STRENGTH: input.permissions.strength,
    CARDIO: input.permissions.cardio,
  };
  const restrictedDomains = AI_COACH_DOMAINS.filter((domain) => byDomain[domain] !== "ALLOW");
  const planRequestBlocked = planRequestIsSafetyBlocked(input.permissions);
  // A disposition that is not CLEAR is reported even if every domain happens
  // to permit, so the notice can never be narrower than the amber banner the
  // client already sees.
  if (input.disposition === "CLEAR" && !planRequestBlocked) return null;
  return {
    disposition: input.disposition,
    restrictedDomains: [...restrictedDomains],
    planRequestBlocked,
    clientCanResolve: false,
    resolvedBy: "AUTHORIZED_REVIEWER",
  };
}
