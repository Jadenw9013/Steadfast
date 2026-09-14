import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";
import { AiCoachError, lockAiClient } from "./access";
import { invalidateAiProposals } from "./client-commands";
import { contentHash } from "./canonical-json";

/** Explicit concern disclosure is independent of the rest of a logging form. */
export async function applyEvidenceConcern(clientId: string, raw: unknown) {
  const parsed = z.object({ requestKey: z.string().uuid(), payload: z.object({ safetyChanged: z.enum(["YES", "NO", "UNSURE"]) }).passthrough() }).passthrough().safeParse(raw);
  if (!parsed.success || parsed.data.payload.safetyChanged === "NO") return;
  const { requestKey, payload } = parsed.data;
  await db.$transaction(async tx => {
    const { profile } = await lockAiClient(tx, clientId, false);
    const key = { clientId, operation: "EVIDENCE_CONCERN", requestKey };
    const digest = contentHash(payload);
    const receipt = await tx.aiOperationReceipt.findUnique({ where: { clientId_operation_requestKey: key } });
    if (receipt) {
      if (receipt.inputDigest !== digest) throw new AiCoachError("REVISION_CONFLICT", "This concern request key was already used.");
      return;
    }
    await tx.aiCoachProfile.update({ where: { clientId }, data: { safetyRevision: { increment: 1 }, safetyDisposition: ["REFER", "URGENT"].includes(profile.safetyDisposition) ? profile.safetyDisposition : "RESTRICTED", nutritionPermission: "PAUSED", strengthPermission: "PAUSED", cardioPermission: "PAUSED" } });
    await tx.aiSafetyDisclosureEvent.create({ data: { clientId, structuredAnswers: { source: "EVIDENCE", concern: payload.safetyChanged }, dispositionAfter: ["REFER", "URGENT"].includes(profile.safetyDisposition) ? profile.safetyDisposition : "RESTRICTED", nutritionPermissionAfter: "PAUSED", strengthPermissionAfter: "PAUSED", cardioPermissionAfter: "PAUSED", safetyRevisionAfter: profile.safetyRevision + 1 } });
    await invalidateAiProposals(tx, clientId);
    await tx.aiOperationReceipt.create({ data: { ...key, inputDigest: digest, result: { restricted: true } } });
  });
}
export function observationDigest(row: { id: string; revision: number; payload: unknown; occurredAt: Date; submitted: boolean; deletedAt: Date | null }) {
  return contentHash({ id: row.id, revision: row.revision, payload: row.payload, occurredAt: row.occurredAt.toISOString(), submitted: row.submitted, deletedAt: row.deletedAt?.toISOString() ?? null });
}
/** Corrections to referenced data and late reports inside a frozen review
 * invalidate the relevant pending result. Ordinary post-cutoff logs do not.
 */
export async function invalidateForEvidence(tx: Prisma.TransactionClient, clientId: string, kind: "CHECK_IN" | "SESSION", id: string, occurredAt: Date, correction: boolean) {
  const affected = correction
    ? await tx.aiCoachRun.count({ where: { clientId, inputSnapshot: { path: ["sourceRefs"], array_contains: [{ kind, id }] } } })
    : await tx.aiCoachRun.count({ where: { clientId, kind: "WEEKLY_REVIEW", status: { in: ["QUEUED", "RUNNING", "RETRY_WAIT", "COMPLETED"] }, lookbackStart: { lte: occurredAt }, lookbackEnd: { gt: occurredAt }, snapshotCutoffAt: { gt: occurredAt } } });
  if (affected) {
    await tx.aiCoachProfile.update({ where: { clientId }, data: { observationRevision: { increment: 1 } } });
    await invalidateAiProposals(tx, clientId);
  }
}
