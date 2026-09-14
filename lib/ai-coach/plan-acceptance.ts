import { z } from "zod";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import type { AiDomainPermission } from "@/app/generated/prisma/client";
import { isAiCoachPublicationEnabled } from "@/lib/flags/ai-coach";
import { checkPolicyVersionUsable } from "./policy/policy-version";

/**
 * A10 — atomic proposal acceptance/decline service.
 *
 * This is the full, policy/safety/entitlement/reviewer-gated service that
 * docs/ai-coach/05's "Atomic acceptance" algorithm describes and that
 * A02's plan-lifecycle.ts explicitly deferred here. It must be the ONLY
 * path a real user-facing accept action ever calls; plan-lifecycle.ts's
 * acceptPlanVersion remains a lower-level storage primitive used by tests
 * and by this file's own transaction.
 *
 * Concurrency: this codebase's established pattern (A02's runs.ts and
 * plan-lifecycle.ts) is optimistic — conditional `updateMany` calls
 * guarded by current status/id inside one transaction, not explicit
 * `SELECT ... FOR UPDATE` locks. The unique adjustment-slot constraint
 * plus the status-guarded ACCEPTED transition give the same serialization
 * guarantee docs/ai-coach/05 describes as "lock the client row first."
 */

export const acceptPlanVersionInputSchema = z.object({
  requestKey: z.string().min(1).max(200),
  expectedBaseVersionId: z.string().nullable(),
  expectedContextRevision: z.number().int(),
  expectedProfileRevision: z.number().int(),
  expectedObservationRevision: z.number().int(),
  expectedSafetyRevision: z.number().int(),
}).strict();
export type AcceptPlanVersionInput = z.infer<typeof acceptPlanVersionInputSchema>;

export type AcceptPlanVersionErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "STALE_PROPOSAL"
  | "WINDOW_CLOSED"
  | "SAFETY_RESTRICTED"
  | "ENTITLEMENT_REQUIRED"
  | "POLICY_UNAVAILABLE"
  | "REVIEWER_APPROVAL_REQUIRED"
  | "ADJUSTMENT_LIMIT_REACHED"
  | "TEMPORARILY_UNAVAILABLE";

export type AcceptPlanVersionAtomicResult =
  | { success: true; alreadyAccepted: boolean; activeVersionId: string }
  | { success: false; code: AcceptPlanVersionErrorCode; error: string };

function computeAcceptanceInputDigest(planVersionId: string, input: AcceptPlanVersionInput): string {
  return createHash("sha256").update(JSON.stringify({ planVersionId, ...input })).digest("hex");
}

function domainsTouchedByPayload(payload: unknown): { nutrition: boolean; strength: boolean; cardio: boolean } {
  const p = payload as { nutrition?: unknown; strength?: unknown[]; cardio?: unknown[] } | null;
  return {
    nutrition: !!p?.nutrition,
    strength: Array.isArray(p?.strength) && p.strength.length > 0,
    cardio: Array.isArray(p?.cardio) && p.cardio.length > 0,
  };
}

/** Every domain the candidate actually touches must currently be ALLOW — never HOLD_ONLY or PAUSED. */
function checkSafetyPermitsCandidate(payload: unknown, permissions: { nutrition: AiDomainPermission; strength: AiDomainPermission; cardio: AiDomainPermission }): boolean {
  const touched = domainsTouchedByPayload(payload);
  if (touched.nutrition && permissions.nutrition !== "ALLOW") return false;
  if (touched.strength && permissions.strength !== "ALLOW") return false;
  if (touched.cardio && permissions.cardio !== "ALLOW") return false;
  return true;
}

/**
 * Full atomic acceptance per docs/ai-coach/05's algorithm. `clientId` is
 * trusted caller input — the caller (API route/action) is responsible for
 * resolving it from the authenticated session, never from a request body.
 */
export async function acceptPlanVersionAtomic(
  clientId: string,
  planVersionId: string,
  rawInput: unknown
): Promise<AcceptPlanVersionAtomicResult> {
  const parsed = acceptPlanVersionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, code: "VALIDATION_ERROR", error: "Invalid acceptance request." };
  }
  const input = parsed.data;
  const inputDigest = computeAcceptanceInputDigest(planVersionId, input);

  // Step 0 (idempotency): a replay of the exact same request returns the
  // original receipt with a freshly resolved current active id. A
  // different payload under the same key is a conflict, never a
  // silent re-execution.
  const existingReceipt = await db.aiPlanAcceptanceReceipt.findUnique({ where: { clientId_requestKey: { clientId, requestKey: input.requestKey } } });
  if (existingReceipt) {
    if (existingReceipt.inputDigest !== inputDigest) {
      return { success: false, code: "REVISION_CONFLICT", error: "This request key was already used for a different acceptance request." };
    }
    // This exact request already completed at some point in the past —
    // from this caller's perspective that is inherently "already accepted,"
    // regardless of whether the original call was the one that performed
    // the acceptance or itself observed a prior acceptance.
    const profile = await db.aiCoachProfile.findUnique({ where: { clientId } });
    return { success: true, alreadyAccepted: true, activeVersionId: profile?.activePlanVersionId ?? existingReceipt.planVersionId };
  }

  const candidate = await db.aiPlanVersion.findUnique({ where: { id: planVersionId }, include: { approval: true } });
  if (!candidate || candidate.clientId !== clientId) {
    return { success: false, code: "NOT_FOUND", error: "Plan version not found." };
  }

  // Step 1: an already-accepted candidate (e.g. a second tab) replays its
  // permanent receipt without changing state, ahead of any staleness check.
  if (candidate.status === "ACCEPTED") {
    const profile = await db.aiCoachProfile.findUnique({ where: { clientId } });
    const activeVersionId = profile?.activePlanVersionId ?? candidate.id;
    await db.aiPlanAcceptanceReceipt.upsert({
      where: { clientId_requestKey: { clientId, requestKey: input.requestKey } },
      create: { clientId, requestKey: input.requestKey, inputDigest, planVersionId: candidate.id, alreadyAccepted: true, activeVersionIdAtReceiptTime: activeVersionId },
      update: {},
    });
    return { success: true, alreadyAccepted: true, activeVersionId };
  }

  if (candidate.status !== "PROPOSED") {
    return { success: false, code: "STALE_PROPOSAL", error: `Cannot accept a plan version with status ${candidate.status}.` };
  }

  // Step 2: authority, context, entitlement, publication flag, revisions.
  const context = await db.clientCoachingContext.findUnique({ where: { clientId } });
  if (!context || context.mode !== "AI" || context.resolutionRequired) {
    return { success: false, code: "ENTITLEMENT_REQUIRED", error: "AI is not the current, unambiguous coaching authority for this client." };
  }
  const entitlement = await db.aiCoachEntitlement.findUnique({ where: { clientId } });
  const now = new Date();
  if (!entitlement || entitlement.revokedAt || (entitlement.expiresAt && entitlement.expiresAt <= now)) {
    return { success: false, code: "ENTITLEMENT_REQUIRED", error: "No valid AI coaching entitlement." };
  }
  if (!isAiCoachPublicationEnabled()) {
    return { success: false, code: "TEMPORARILY_UNAVAILABLE", error: "AI plan publication is currently disabled." };
  }
  const profile = await db.aiCoachProfile.findUnique({ where: { clientId } });
  if (!profile
    || candidate.contextRevision !== context.revision
    || candidate.profileRevision !== profile.profileRevision
    || candidate.observationRevision !== profile.observationRevision
    || candidate.safetyRevision !== profile.safetyRevision
  ) {
    return { success: false, code: "REVISION_CONFLICT", error: "The client's coaching state has changed since this proposal was computed." };
  }

  // Step 3: policy availability, safety/domain permission, reviewer
  // approval, exact base version, activation window.
  const policyCheck = checkPolicyVersionUsable(candidate.policyVersion);
  if (!policyCheck.usable) {
    return { success: false, code: "POLICY_UNAVAILABLE", error: "The policy this proposal was built against is no longer usable." };
  }
  if (!checkSafetyPermitsCandidate(candidate.payload, { nutrition: profile.nutritionPermission, strength: profile.strengthPermission, cardio: profile.cardioPermission })) {
    return { success: false, code: "SAFETY_RESTRICTED", error: "A current safety restriction blocks a domain this proposal touches." };
  }
  if (candidate.reviewerStatus === "PENDING" || candidate.reviewerStatus === "REJECTED") {
    return { success: false, code: "REVIEWER_APPROVAL_REQUIRED", error: "This proposal has not been approved by a qualified reviewer." };
  }
  if (candidate.reviewerStatus === "APPROVED") {
    if (!candidate.approval || !candidate.approval.approved || candidate.approval.approvedHash !== candidate.payloadHash) {
      return { success: false, code: "REVIEWER_APPROVAL_REQUIRED", error: "The recorded reviewer approval no longer matches this proposal's exact content." };
    }
    const reviewerGrant = await db.aiCoachReviewerGrant.findUnique({ where: { id: candidate.approval.reviewerGrantId } });
    if (!reviewerGrant || reviewerGrant.revokedAt) {
      return { success: false, code: "REVIEWER_APPROVAL_REQUIRED", error: "The reviewer who approved this proposal no longer holds an active grant." };
    }
  }
  const expectedBase = profile.activePlanVersionId ?? null;
  if (candidate.baseVersionId !== expectedBase || input.expectedBaseVersionId !== expectedBase) {
    return { success: false, code: "STALE_PROPOSAL", error: "This proposal was built against a base plan that is no longer the active one." };
  }
  if (candidate.activationStartsAt && candidate.activationStartsAt > now) {
    return { success: false, code: "WINDOW_CLOSED", error: "This proposal's activation window has not started yet." };
  }
  if (candidate.activationEndsAt && candidate.activationEndsAt <= now) {
    return { success: false, code: "WINDOW_CLOSED", error: "This proposal's activation window has closed." };
  }

  // Step 4/5: accept, supersede, update pointer, insert the routine slot
  // (if applicable) and the deduplicated outbox event, atomically.
  // Cumulative policy-bound limits beyond the one-slot-per-window rule are
  // A09's deterministic controller's responsibility — not guessed here.
  try {
    await db.$transaction(async (tx) => {
      if (candidate.changeClass === "ROUTINE") {
        await tx.aiAdjustmentSlot.create({
          data: { clientId, reviewWindowKey: reviewWindowKeyFor(candidate.activationStartsAt ?? candidate.createdAt), acceptedPlanVersionId: candidate.id },
        });
      }

      await tx.aiPlanVersion.updateMany({
        where: { clientId, status: "ACCEPTED", id: { not: candidate.id } },
        data: { status: "SUPERSEDED" },
      });

      const updated = await tx.aiPlanVersion.updateMany({
        where: { id: candidate.id, status: "PROPOSED" },
        data: { status: "ACCEPTED", acceptedAt: now },
      });
      if (updated.count === 0) throw new AcceptanceRaceError("STALE_PROPOSAL");

      await tx.aiCoachProfile.upsert({
        where: { clientId },
        create: { clientId, activePlanVersionId: candidate.id },
        update: { activePlanVersionId: candidate.id },
      });

      await tx.aiPlanAcceptanceOutbox.upsert({
        where: { planVersionId: candidate.id },
        create: { planVersionId: candidate.id, clientId },
        update: {},
      });

      await tx.aiPlanAcceptanceReceipt.create({
        data: { clientId, requestKey: input.requestKey, inputDigest, planVersionId: candidate.id, alreadyAccepted: false, activeVersionIdAtReceiptTime: candidate.id },
      });
    });
  } catch (err) {
    if (err instanceof AcceptanceRaceError) {
      // A concurrent racer (e.g. two tabs) may have won and legitimately
      // accepted THIS SAME candidate between our read and our write — that
      // is not a real conflict, it's the "two tabs accept" case, and this
      // loser should gracefully replay the winner's outcome rather than
      // erroring. Any other resulting status (e.g. a concurrent decline)
      // is a genuine stale proposal.
      const recheck = await db.aiPlanVersion.findUniqueOrThrow({ where: { id: candidate.id } });
      if (recheck.status === "ACCEPTED") {
        const profileNow = await db.aiCoachProfile.findUnique({ where: { clientId } });
        const activeVersionId = profileNow?.activePlanVersionId ?? recheck.id;
        await db.aiPlanAcceptanceReceipt.upsert({
          where: { clientId_requestKey: { clientId, requestKey: input.requestKey } },
          create: { clientId, requestKey: input.requestKey, inputDigest, planVersionId: candidate.id, alreadyAccepted: true, activeVersionIdAtReceiptTime: activeVersionId },
          update: {},
        });
        return { success: true, alreadyAccepted: true, activeVersionId };
      }
      return { success: false, code: err.code, error: "This proposal was already changed by someone else — refresh and try again." };
    }
    const isUniqueRace = typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
    if (isUniqueRace) {
      return { success: false, code: "ADJUSTMENT_LIMIT_REACHED", error: "A routine change was already accepted for this review window." };
    }
    throw err;
  }

  return { success: true, alreadyAccepted: false, activeVersionId: candidate.id };
}

class AcceptanceRaceError extends Error {
  constructor(public readonly code: AcceptPlanVersionErrorCode) { super(code); }
}

/** ISO week key, e.g. "2026-W12" — a placeholder review-window derivation until A09 owns server-derived activation windows. */
function reviewWindowKeyFor(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type DeclinePlanVersionResult = { success: true } | { success: false; error: string };

const declineReasonSchema = z.string().max(500).optional();

/** Idempotent decline of an owned PROPOSED candidate. */
export async function declinePlanVersion(clientId: string, planVersionId: string, rawReason?: unknown): Promise<DeclinePlanVersionResult> {
  const reasonParsed = declineReasonSchema.safeParse(rawReason);
  if (!reasonParsed.success) {
    return { success: false, error: "Decline reason is too long." };
  }

  const candidate = await db.aiPlanVersion.findUnique({ where: { id: planVersionId } });
  if (!candidate || candidate.clientId !== clientId) {
    return { success: false, error: "Plan version not found." };
  }
  if (candidate.status === "DECLINED") {
    return { success: true };
  }
  if (candidate.status !== "PROPOSED") {
    return { success: false, error: `Cannot decline a plan version with status ${candidate.status}.` };
  }

  const updated = await db.aiPlanVersion.updateMany({
    where: { id: planVersionId, status: "PROPOSED" },
    data: { status: "DECLINED", declineReason: reasonParsed.data ?? null },
  });
  if (updated.count === 0) {
    // Raced with another status change between the read and the write — reread to give an accurate idempotent-vs-error answer.
    const recheck = await db.aiPlanVersion.findUniqueOrThrow({ where: { id: planVersionId } });
    return recheck.status === "DECLINED" ? { success: true } : { success: false, error: `Cannot decline a plan version with status ${recheck.status}.` };
  }
  return { success: true };
}
