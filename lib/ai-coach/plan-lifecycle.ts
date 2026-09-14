import { db } from "@/lib/db";
import { createHash } from "crypto";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * AiPlanVersion / AiAdjustmentSlot storage-level invariants (A02).
 *
 * This module implements only the atomicity and immutability guarantees
 * that belong to the data model itself: a version's content and hash
 * never change, at most one ROUTINE adjustment slot exists per client per
 * review window ever, acceptance is idempotent on replay, and accepting a
 * new version supersedes exactly the one it replaces.
 *
 * It deliberately does NOT implement the full accept/decline SERVICE from
 * docs/ai-coach/05's "Atomic acceptance" algorithm — that requires policy
 * availability, safety/domain permission, entitlement, and reviewer
 * approval checks that don't exist until A04 (policy)/A08
 * (safety)/A11 (reviewer queue). That full, policy-aware service is A10's
 * explicit deliverable ("Implement before enabling any real candidate").
 * Calling acceptPlanVersion here without those gates in front of it would
 * let a candidate activate before its required approvals exist — every
 * caller until A10 lands MUST be a synthetic-fixture test, never a real
 * user-facing accept action.
 */

export function hashPlanPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export type AcceptPlanVersionResult =
  | { success: true; alreadyAccepted: boolean; activeVersionId: string }
  | { success: false; error: string };

/**
 * Storage-level accept: idempotent on replay, supersedes the prior active
 * version, inserts the adjustment slot exactly once per (client, window)
 * for a ROUTINE change, and updates AiCoachProfile.activePlanVersionId —
 * all in one transaction. Does not check policy, safety, entitlement, or
 * reviewer approval; callers (A10) must do that first.
 */
export async function acceptPlanVersion(
  clientId: string,
  planVersionId: string,
  reviewWindowKey: string
): Promise<AcceptPlanVersionResult> {
  const candidate = await db.aiPlanVersion.findUnique({ where: { id: planVersionId } });
  if (!candidate || candidate.clientId !== clientId) {
    return { success: false, error: "Plan version not found." };
  }

  // Replay: report current state without reactivating anything.
  if (candidate.status === "ACCEPTED") {
    const profile = await db.aiCoachProfile.findUnique({ where: { clientId } });
    return { success: true, alreadyAccepted: true, activeVersionId: profile?.activePlanVersionId ?? candidate.id };
  }

  if (candidate.status !== "PROPOSED") {
    return { success: false, error: `Cannot accept a plan version with status ${candidate.status}.` };
  }

  try {
    await db.$transaction(async (tx) => {
      if (candidate.changeClass === "ROUTINE") {
        // Unique per (clientId, reviewWindowKey) forever — insert failure
        // (P2002) means a routine slot for this window already exists,
        // which the caller must treat as a hard stop, not a retry target.
        await tx.aiAdjustmentSlot.create({
          data: { clientId, reviewWindowKey, acceptedPlanVersionId: candidate.id },
        });
      }

      const now = new Date();
      // Supersede whatever was previously active for this client (if
      // anything) — never more than one ACCEPTED version active at a time.
      await tx.aiPlanVersion.updateMany({
        where: { clientId, status: "ACCEPTED", id: { not: candidate.id } },
        data: { status: "SUPERSEDED" },
      });

      const updated = await tx.aiPlanVersion.updateMany({
        where: { id: candidate.id, status: "PROPOSED" },
        data: { status: "ACCEPTED", acceptedAt: now },
      });
      if (updated.count === 0) {
        throw new Error("STALE_CANDIDATE");
      }

      await tx.aiCoachProfile.upsert({
        where: { clientId },
        create: { clientId, activePlanVersionId: candidate.id },
        update: { activePlanVersionId: candidate.id },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "STALE_CANDIDATE") {
      return { success: false, error: "This proposal was already changed by someone else — refresh and try again." };
    }
    const isUniqueRace =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
    if (isUniqueRace) {
      return { success: false, error: "A routine change was already accepted for this review window." };
    }
    throw err;
  }

  return { success: true, alreadyAccepted: false, activeVersionId: candidate.id };
}

/** Creates a PROPOSED plan version. Content is immutable once created — a correction is a new row, never an edit. */
export async function createProposedPlanVersion(input: {
  clientId: string;
  baseVersionId?: string;
  payload: Prisma.InputJsonValue;
  changeClass?: "INITIAL" | "ROUTINE" | "TARGET_PRESERVING" | "PROTECTIVE";
  contextRevision: number;
  profileRevision: number;
  observationRevision: number;
  safetyRevision: number;
  policyVersion: string;
  catalogVersions: Prisma.InputJsonValue;
  activationStartsAt?: Date;
  activationEndsAt?: Date;
}): Promise<{ id: string; version: number }> {
  const latest = await db.aiPlanVersion.findFirst({
    where: { clientId: input.clientId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;

  const created = await db.aiPlanVersion.create({
    data: {
      clientId: input.clientId,
      version,
      baseVersionId: input.baseVersionId,
      payload: input.payload,
      payloadHash: hashPlanPayload(input.payload),
      changeClass: input.changeClass,
      contextRevision: input.contextRevision,
      profileRevision: input.profileRevision,
      observationRevision: input.observationRevision,
      safetyRevision: input.safetyRevision,
      policyVersion: input.policyVersion,
      catalogVersions: input.catalogVersions,
      activationStartsAt: input.activationStartsAt,
      activationEndsAt: input.activationEndsAt,
    },
    select: { id: true, version: true },
  });
  return created;
}
