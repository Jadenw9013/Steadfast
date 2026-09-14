import { requireReviewerCapacity } from "./reviewer-capacity";
import { z } from "zod";
import { db } from "@/lib/db";
import { lockAiClient, AiCoachError, jsonValue } from "./access";
import { contentHash } from "./canonical-json";
import { confirmIntake, intakeAnswersSchema, intakeDraftSchema, saveIntakeDraft } from "./intake";
import { safetyDisclosureSchema, submitSafetyDisclosure } from "./safety";
import { isAiCoachEnrollmentEnabled } from "@/lib/flags/ai-coach";
import type { Prisma } from "@/app/generated/prisma/client";
const common = { requestKey: z.string().uuid(), expectedProfileRevision: z.number().int().nonnegative() };
export const clientCommandSchema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.literal("SAVE_INTAKE"), answers: intakeDraftSchema }).strict(),
  z.object({ ...common, operation: z.literal("CONFIRM_INTAKE"), answers: intakeAnswersSchema }).strict(),
  z.object({ ...common, operation: z.literal("SAFETY"), answers: safetyDisclosureSchema }).strict(),
  z.object({ ...common, operation: z.literal("ALLERGIES"), allergies: z.array(z.string().trim().min(1).max(100)).max(20) }).strict(),
  z.object({ ...common, operation: z.literal("ENROLL"), consent: z.literal(true), expectedContextRevision: z.number().int().nonnegative(), reviewTimezone: z.string().max(100) }).strict(),
  z.object({ ...common, operation: z.literal("PAUSE"), confirmed: z.literal(true), expectedContextRevision: z.number().int().nonnegative() }).strict(),
]);
export async function invalidateAiProposals(tx: Prisma.TransactionClient, clientId: string) {
  await tx.aiPlanVersion.updateMany({ where: { clientId, status: "PROPOSED" }, data: { status: "INVALIDATED" } });
  await tx.aiCoachRun.updateMany({ where: { clientId, status: { in: ["QUEUED", "RUNNING", "RETRY_WAIT"] } }, data: { status: "CANCELED", leaseExpiresAt: null } });
}
export async function applyAiClientCommand(clientId: string, raw: unknown) {
  const parsed = clientCommandSchema.safeParse(raw);
  if (!parsed.success) throw new AiCoachError("VALIDATION_ERROR", "Check the required answers and try again.", 422);
  const input = parsed.data;
  return db.$transaction(async tx => {
    const { profile, context } = await lockAiClient(tx, clientId, false);
    const inputDigest = contentHash(jsonValue(input));
    const receiptKey = { clientId, operation: input.operation, requestKey: input.requestKey };
    const previous = await tx.aiOperationReceipt.findUnique({ where: { clientId_operation_requestKey: receiptKey } });
    if (previous) {
      if (previous.inputDigest !== inputDigest) throw new AiCoachError("REVISION_CONFLICT", "This request key has already been used.");
      return previous.result;
    }
    // New concerns must take effect even when a tab has an outdated intake.
    if (!["SAFETY", "ALLERGIES"].includes(input.operation) && profile.profileRevision !== input.expectedProfileRevision) throw new AiCoachError("REVISION_CONFLICT", "Your intake changed elsewhere. Reload before saving.");
    let result: Prisma.InputJsonValue = { saved: true };
    if (input.operation === "SAVE_INTAKE") {
      // Allergies have a separate immediate safety command; no alternate draft
      // writer is allowed to hide them until confirmation.
      if (input.answers.allergies !== undefined) throw new AiCoachError("VALIDATION_ERROR", "Save allergy disclosures separately before continuing.", 422);
      const saved = await saveIntakeDraft(clientId, input.answers, tx);
      if (!saved.success) throw new AiCoachError("VALIDATION_ERROR", "Could not save intake.", 422);
    }
    if (input.operation === "ALLERGIES") {
      const current = intakeAnswersSchema.safeParse(profile.confirmedIntake);
      const previousAllergies = current.success ? current.data.allergies : [];
      const newConcern = input.allergies.some(a => !previousAllergies.some(b => a.toLowerCase() === b.toLowerCase()));
      await saveIntakeDraft(clientId, { allergies: input.allergies }, tx);
      if (newConcern && profile.confirmedIntake !== null) {
        await tx.aiCoachProfile.update({ where: { clientId }, data: { nutritionPermission: "PAUSED", safetyDisposition: ["CLEAR", "CLARIFY"].includes(profile.safetyDisposition) ? "RESTRICTED" : profile.safetyDisposition, safetyRevision: { increment: 1 } } });
        await invalidateAiProposals(tx, clientId);
      } else if (newConcern) {
        await tx.aiCoachProfile.update({ where: { clientId }, data: { safetyRevision: { increment: 1 } } });
        await invalidateAiProposals(tx, clientId);
      }
    }
    if (input.operation === "SAFETY") {
      const saved = await submitSafetyDisclosure(clientId, input.answers, tx);
      if (!saved.success) throw new AiCoachError("VALIDATION_ERROR", saved.error, 422);
      await invalidateAiProposals(tx, clientId);
      result = { saved: true, disposition: saved.disposition, safetyRevision: saved.safetyRevision };
    }
    if (input.operation === "CONFIRM_INTAKE") {
      const draft = await tx.aiIntakeDraft.findUnique({ where: { clientId } });
      const savedDraft = intakeDraftSchema.safeParse(draft?.answers);
      if (!savedDraft.success || contentHash(input.answers.allergies) !== contentHash(savedDraft.data.allergies ?? [])) throw new AiCoachError("VALIDATION_ERROR", "Save current allergy disclosures before confirming intake.", 422);
      if (!await tx.aiSafetyDisclosureEvent.findFirst({ where: { clientId }, select: { id: true } })) throw new AiCoachError("VALIDATION_ERROR", "Complete the safety questions first.", 422);
      const saved = await confirmIntake(clientId, input.answers, tx);
      if (!saved.success) throw new AiCoachError("VALIDATION_ERROR", "Complete the intake before confirming.", 422);
      await invalidateAiProposals(tx, clientId);
      result = { saved: true, profileRevision: saved.profileRevision };
    }
    if (input.operation === "ENROLL") {
      await requireReviewerCapacity(tx, clientId, true);
      if (!isAiCoachEnrollmentEnabled()) throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "Enrollment is paused.", 503);
      if ((context?.revision ?? 0) !== input.expectedContextRevision || context?.mode === "HUMAN") throw new AiCoachError("REVISION_CONFLICT", "Complete the current provider transition before enrolling.");
      if (!intakeAnswersSchema.safeParse(profile.confirmedIntake).success) throw new AiCoachError("VALIDATION_ERROR", "Confirm your intake before enrolling.", 422);
      try { new Intl.DateTimeFormat("en", { timeZone: input.reviewTimezone }); } catch { throw new AiCoachError("VALIDATION_ERROR", "Choose a valid review timezone.", 422); }
      if (profile.reviewTimezone && profile.reviewTimezone !== input.reviewTimezone) throw new AiCoachError("REVISION_CONFLICT", "Your established review timezone cannot be changed during the pilot.");
      await tx.aiCoachProfile.update({ where: { clientId }, data: { consentedAt: profile.consentedAt ?? new Date(), reviewTimezone: input.reviewTimezone } });
      if (context?.mode !== "AI") await tx.clientCoachingContext.upsert({ where: { clientId }, create: { clientId, mode: "AI", revision: 1 }, update: { mode: "AI", activeCoachClientId: null, revision: { increment: 1 } } });
    }
    if (input.operation === "PAUSE") {
      if (context?.revision !== input.expectedContextRevision || context.mode !== "AI") throw new AiCoachError("REVISION_CONFLICT", "Your coaching provider changed.");
      await tx.clientCoachingContext.update({ where: { clientId }, data: { mode: "NONE", revision: { increment: 1 } } });
      await invalidateAiProposals(tx, clientId);
    }
    await tx.aiOperationReceipt.create({ data: { ...receiptKey, inputDigest, result } });
    return result;
  });
}
