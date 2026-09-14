import { evidenceIsCurrent } from "./evidence-snapshot";
import { z } from "zod";
import { intakeAnswersSchema } from "./intake";
import { isTargetPreserving } from "./representation";
import { approvalStateHash, grantCoversPlan, validatedManagedPayload } from "./validated-plan";
import { requireFixtureRuntime } from "./access";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import type { AiDomainPermission } from "@/app/generated/prisma/client";
import { isAiCoachPublicationEnabled } from "@/lib/flags/ai-coach";
import { checkPolicyVersionUsable } from "./policy/policy-version";

/**
 * A10 acceptance boundary. All reads and writes run in one short transaction.
 * Lock User → context → profile → candidate, then entitlement/approval/grant.
 * The User lock serializes competing acceptances and deactivation; locking the
 * authority/safety rows also excludes concurrent writers that have not yet
 * adopted the common User-first order. No network I/O belongs here.
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
  | "FORBIDDEN"
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
  | { success: true; alreadyAccepted: boolean; activeVersionId: string | null }
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

  try {
    return await db.$transaction(async (tx): Promise<AcceptPlanVersionAtomicResult> => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${clientId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: clientId }, select: { isDeactivated: true, isClient: true } });
      if (!user || user.isDeactivated || !user.isClient) {
        return { success: false, code: "FORBIDDEN", error: "An active client account is required." };
      }
      await tx.$queryRaw`SELECT "id" FROM "ClientCoachingContext" WHERE "clientId" = ${clientId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "AiCoachProfile" WHERE "clientId" = ${clientId} FOR UPDATE`;

      // Step 0 (idempotency): a replay of the exact same request returns the
      // original receipt with a freshly resolved current active id. A
      // different payload under the same key is a conflict, never a
      // silent re-execution.
      const existingReceipt = await tx.aiPlanAcceptanceReceipt.findUnique({ where: { clientId_requestKey: { clientId, requestKey: input.requestKey } } });
      if (existingReceipt) {
        if (existingReceipt.inputDigest !== inputDigest) {
          return { success: false, code: "REVISION_CONFLICT", error: "This request key was already used for a different acceptance request." };
        }
        // This exact request already completed at some point in the past —
        // from this caller's perspective that is inherently "already accepted,"
        // regardless of whether the original call was the one that performed
        // the acceptance or itself observed a prior acceptance.
        const profile = await tx.aiCoachProfile.findUnique({ where: { clientId } });
        return { success: true, alreadyAccepted: true, activeVersionId: profile?.activePlanVersionId ?? null };
      }

      const owned = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AiPlanVersion" WHERE "id" = ${planVersionId} AND "clientId" = ${clientId} FOR UPDATE`;
      if (owned.length === 0) return { success: false, code: "NOT_FOUND", error: "Plan version not found." };
      await tx.$queryRaw`SELECT "id" FROM "AiPlanReviewerApproval" WHERE "planVersionId" = ${planVersionId} FOR UPDATE`;
      const candidate = await tx.aiPlanVersion.findUnique({ where: { id: planVersionId }, include: { approval: true } });
      if (!candidate || candidate.clientId !== clientId) {
        return { success: false, code: "NOT_FOUND", error: "Plan version not found." };
      }

      // Step 1: an already-accepted candidate (e.g. a second tab) replays its
      // permanent receipt without changing state, ahead of any staleness check.
      if (candidate.acceptedAt !== null) {
        const profile = await tx.aiCoachProfile.findUnique({ where: { clientId } });
        const activeVersionId = profile?.activePlanVersionId ?? null;
        await tx.aiPlanAcceptanceReceipt.upsert({
          where: { clientId_requestKey: { clientId, requestKey: input.requestKey } },
          create: { clientId, requestKey: input.requestKey, inputDigest, planVersionId: candidate.id, alreadyAccepted: true, activeVersionIdAtReceiptTime: activeVersionId },
          update: {},
        });
        return { success: true, alreadyAccepted: true, activeVersionId };
      }

      if (candidate.status !== "PROPOSED") {
        return { success: false, code: "STALE_PROPOSAL", error: `Cannot accept a plan version with status ${candidate.status}.` };
      }

      await tx.$queryRaw`SELECT "id" FROM "AiCoachEntitlement" WHERE "clientId" = ${clientId} FOR UPDATE`;
      if (candidate.approval) {
        await tx.$queryRaw`SELECT "id" FROM "AiCoachReviewerGrant" WHERE "id" = ${candidate.approval.reviewerGrantId} FOR UPDATE`;
      }
      // Step 2: authority, context, entitlement, publication flag, revisions.
      const context = await tx.clientCoachingContext.findUnique({ where: { clientId } });
      if (!context || context.mode !== "AI" || context.resolutionRequired) {
        return { success: false, code: "ENTITLEMENT_REQUIRED", error: "AI is not the current, unambiguous coaching authority for this client." };
      }
      const entitlement = await tx.aiCoachEntitlement.findUnique({ where: { clientId } });
      const now = new Date();
      if (!entitlement || entitlement.revokedAt || (entitlement.expiresAt && entitlement.expiresAt <= now)) {
        return { success: false, code: "ENTITLEMENT_REQUIRED", error: "No valid AI coaching entitlement." };
      }
      if (!isAiCoachPublicationEnabled()) {
        return { success: false, code: "TEMPORARILY_UNAVAILABLE", error: "AI plan publication is currently disabled." };
      }
      const profile = await tx.aiCoachProfile.findUnique({ where: { clientId } });
      if (!profile
        || candidate.contextRevision !== context.revision
        || candidate.profileRevision !== profile.profileRevision
        || candidate.observationRevision !== profile.observationRevision
        || candidate.safetyRevision !== profile.safetyRevision
        || input.expectedContextRevision !== context.revision
        || input.expectedProfileRevision !== profile.profileRevision
        || input.expectedObservationRevision !== profile.observationRevision
        || input.expectedSafetyRevision !== profile.safetyRevision
      ) {
        return { success: false, code: "REVISION_CONFLICT", error: "The client's coaching state has changed since this proposal was computed." };
      }

      if (candidate.validationReport !== null) {
        try { requireFixtureRuntime(); } catch {
          return { success: false, code: "TEMPORARILY_UNAVAILABLE", error: "This plan is only available in the synthetic test environment." };
        }
        if (!await evidenceIsCurrent(tx, clientId, candidate.sourceRefs)) return { success: false, code: "REVISION_CONFLICT", error: "Source evidence changed. Prepare a new review." };
        if (!profile.isSynthetic || !validatedManagedPayload(candidate)) {
          return { success: false, code: "VALIDATION_ERROR", error: "This proposal did not pass content validation." };
        }
        if (candidate.changeClass === "TARGET_PRESERVING") {
          const base = candidate.baseVersionId ? await tx.aiPlanVersion.findFirst({ where: { id: candidate.baseVersionId, clientId } }) : null;
          const basePayload = base && validatedManagedPayload(base);
          const intake = intakeAnswersSchema.safeParse(profile.confirmedIntake);
          if (!basePayload || !intake.success || !isTargetPreserving(basePayload, validatedManagedPayload(candidate)!, intake.data)) {
            return { success: false, code: "VALIDATION_ERROR", error: "This presentation change does not preserve the current prescription." };
          }
        }
        if (candidate.changeClass === "INITIAL" && candidate.reviewerStatus !== "APPROVED") {
          return { success: false, code: "REVIEWER_APPROVAL_REQUIRED", error: "The initial proposal requires qualified review." };
        }
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
        const reviewerGrant = await tx.aiCoachReviewerGrant.findUnique({ where: { id: candidate.approval.reviewerGrantId }, include: { user: { select: { isDeactivated: true } } } });
        if (!reviewerGrant || reviewerGrant.revokedAt || reviewerGrant.user.isDeactivated || (candidate.validationReport !== null && (!grantCoversPlan(reviewerGrant, clientId, candidate.payload) || candidate.approval.stateHash !== approvalStateHash(candidate)))) {
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


      if (candidate.changeClass === "ROUTINE") {
        const reviewWindowKey = candidate.reviewWindowKey ?? reviewWindowKeyFor(candidate.activationStartsAt ?? candidate.createdAt);
        const slot = await tx.aiAdjustmentSlot.findUnique({ where: { clientId_reviewWindowKey: { clientId, reviewWindowKey } } });
        if (slot) return { success: false, code: "ADJUSTMENT_LIMIT_REACHED", error: "A routine change was already accepted for this review window." };
        await tx.aiAdjustmentSlot.create({
          data: { clientId, reviewWindowKey, acceptedPlanVersionId: candidate.id },
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

      const pointer = await tx.aiCoachProfile.updateMany({
        where: {
          clientId, activePlanVersionId: expectedBase,
          profileRevision: candidate.profileRevision,
          observationRevision: candidate.observationRevision,
          safetyRevision: candidate.safetyRevision,
        },
        data: { activePlanVersionId: candidate.id },
      });
      if (pointer.count !== 1) throw new AcceptanceRaceError("STALE_PROPOSAL");

      await tx.aiPlanAcceptanceOutbox.upsert({
        where: { planVersionId: candidate.id },
        create: { planVersionId: candidate.id, clientId },
        update: {},
      });

      await tx.aiPlanAcceptanceReceipt.create({
        data: { clientId, requestKey: input.requestKey, inputDigest, planVersionId: candidate.id, alreadyAccepted: false, activeVersionIdAtReceiptTime: candidate.id },
      });
      return { success: true, alreadyAccepted: false, activeVersionId: candidate.id };
    });
  } catch (err) {
    if (err instanceof AcceptanceRaceError) {
      return { success: false, code: err.code, error: "The proposal changed. Refresh and try again." };
    }
    // A legacy writer may use a different lock order. A deadlock/transaction
    // conflict must roll back completely and give a safe, retryable response.
    if (typeof err === "object" && err !== null && "code" in err &&
        ["P2034", "P2028"].includes(String(err.code))) {
      return { success: false, code: "TEMPORARILY_UNAVAILABLE", error: "The coaching state is being updated. Please try again." };
    }
    throw err;
  }
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
