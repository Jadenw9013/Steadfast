import { z } from "zod";
import { db } from "@/lib/db";
import { lockAiClient, AiCoachError, jsonValue, requireFixtureRuntime } from "./access";
import { contentHash } from "./canonical-json";
import {
  allergenDeclarationsSchema,
  confirmIntake,
  intakeAnswersSchema,
  intakeDraftSchema,
  isV2Intake,
  saveIntakeDraft,
} from "./intake";
import { canonicalDeclarations, deriveLegacyAllergyTokens, EMPTY_ALLERGEN_DECLARATIONS } from "./intake-allergens";
import {
  hasRecordedSafetyDisclosure,
  safetyDisclosureSchema,
  SAFETY_DISCLOSURE_REQUIRED_MESSAGE,
  submitSafetyDisclosure,
} from "./safety";
import { isAiCoachEnrollmentEnabled } from "@/lib/flags/ai-coach";
import type { Prisma } from "@/app/generated/prisma/client";
const common = {
  requestKey: z.string().uuid(),
  expectedProfileRevision: z.number().int().nonnegative(),
};
export const clientCommandSchema = z.discriminatedUnion("operation", [
  z.object({ ...common, operation: z.literal("SAVE_INTAKE"), answers: intakeDraftSchema }).strict(),
  // `answers` is validated by the version-appropriate schema
  // (`intakeAnswersSchema` for v1, `intakeV2ConfirmSchema` for v2) inside
  // `confirmIntake` — see the `CONFIRM_INTAKE` branch below for why this
  // can't be a single static Zod schema at this outer layer.
  z
    .object({ ...common, operation: z.literal("CONFIRM_INTAKE"), answers: z.record(z.string(), z.unknown()) })
    .strict(),
  z.object({ ...common, operation: z.literal("SAFETY"), answers: safetyDisclosureSchema }).strict(),
  // Two-shape command: exactly one of `allergies` (v1, unchanged) or
  // `allergenDeclarations` (v2) must be present.
  z
    .object({
      ...common,
      operation: z.literal("ALLERGIES"),
      allergies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
      allergenDeclarations: allergenDeclarationsSchema.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      const hasV1 = value.allergies !== undefined;
      const hasV2 = value.allergenDeclarations !== undefined;
      if (hasV1 === hasV2) {
        ctx.addIssue({
          code: "custom",
          path: ["allergies"],
          message: "Send exactly one of allergies or allergenDeclarations.",
        });
      }
    }),
  z
    .object({
      ...common,
      operation: z.literal("ENROLL"),
      consent: z.literal(true),
      expectedContextRevision: z.number().int().nonnegative(),
      reviewTimezone: z.string().max(100),
      consentConfigurationId: z.string().min(1).max(180).optional(),
      consentConfigurationVersion: z.number().int().positive().optional(),
      privacyNoticeVersion: z.string().min(1).max(180).optional(),
      consentTextDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      operation: z.literal("PAUSE"),
      confirmed: z.literal(true),
      expectedContextRevision: z.number().int().nonnegative(),
    })
    .strict(),
]);
export async function invalidateAiProposals(tx: Prisma.TransactionClient, clientId: string) {
  await tx.aiPlanVersion.updateMany({
    where: { clientId, status: "PROPOSED" },
    data: { status: "INVALIDATED" },
  });
  await tx.aiCoachRun.updateMany({
    where: { clientId, status: { in: ["QUEUED", "RUNNING", "RETRY_WAIT"] } },
    data: { status: "CANCELED", leaseExpiresAt: null },
  });
}
/** True if `value` is a plain object carrying `key` with a defined value. */
function hasKey(value: unknown, key: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)[key] !== undefined
  );
}
/** Reads `allergenDeclarations` off a raw stored JSON blob (confirmed intake
 * or draft answers), which may or may not be schema-shaped. */
function extractAllergenDeclarations(value: unknown): unknown {
  return hasKey(value, "allergenDeclarations")
    ? (value as Record<string, unknown>).allergenDeclarations
    : undefined;
}
export async function applyAiClientCommand(clientId: string, raw: unknown) {
  const parsed = clientCommandSchema.safeParse(raw);
  if (!parsed.success)
    throw new AiCoachError("VALIDATION_ERROR", "Check the required answers and try again.", 422);
  const input = parsed.data;
  return db.$transaction(async (tx) => {
    const { profile, context, liveRelease } = await lockAiClient(tx, clientId, false);
    const inputDigest = contentHash(jsonValue(input));
    const receiptKey = { clientId, operation: input.operation, requestKey: input.requestKey };
    const previous = await tx.aiOperationReceipt.findUnique({
      where: { clientId_operation_requestKey: receiptKey },
    });
    if (previous) {
      if (previous.inputDigest !== inputDigest)
        throw new AiCoachError("REVISION_CONFLICT", "This request key has already been used.");
      return previous.result;
    }
    // New concerns must take effect even when a tab has an outdated intake.
    if (
      !["SAFETY", "ALLERGIES"].includes(input.operation) &&
      profile.profileRevision !== input.expectedProfileRevision
    )
      throw new AiCoachError(
        "REVISION_CONFLICT",
        "Your intake changed elsewhere. Reload before saving."
      );
    let result: Prisma.InputJsonValue = { saved: true };
    if (input.operation === "SAVE_INTAKE") {
      // Allergies have a separate immediate safety command; no alternate draft
      // writer is allowed to hide them until confirmation.
      if (input.answers.allergies !== undefined)
        throw new AiCoachError(
          "VALIDATION_ERROR",
          "Save allergy disclosures separately before continuing.",
          422
        );
      // v2 allergen state only ever moves through the ALLERGIES command.
      if (input.answers.allergenDeclarations !== undefined)
        throw new AiCoachError(
          "VALIDATION_ERROR",
          "Save allergy disclosures separately before continuing.",
          422
        );
      if (input.answers.dietaryRestrictions !== undefined) {
        const existingDraft = await tx.aiIntakeDraft.findUnique({ where: { clientId } });
        if (hasKey(profile.confirmedIntake, "dietaryPattern") || hasKey(existingDraft?.answers, "dietaryPattern"))
          throw new AiCoachError(
            "VALIDATION_ERROR",
            "Save your dietary pattern through the food step.",
            422
          );
      }
      const saved = await saveIntakeDraft(clientId, input.answers, tx);
      if (!saved.success) throw new AiCoachError("VALIDATION_ERROR", "Could not save intake.", 422);
    }
    if (input.operation === "ALLERGIES") {
      const draft = await tx.aiIntakeDraft.findUnique({ where: { clientId } });
      // Mirrors the CONFIRM_INTAKE guard: an old app build's v1-shaped
      // ALLERGIES must never become a second writer of the derived
      // projection once the client holds v2 state (T-2002 Blast radius §3)
      // — checked against both the confirmed profile and a v2 draft in
      // progress (a client who started the wizard on web, then opened an
      // older app build, still has v2 `allergenDeclarations` worth
      // protecting even before anything is confirmed).
      if (
        input.allergies !== undefined &&
        (isV2Intake(profile.confirmedIntake) || hasKey(draft?.answers, "allergenDeclarations"))
      )
        throw new AiCoachError("VALIDATION_ERROR", "Update Steadfast to change your intake.", 422);
      let newConcern: boolean;
      if (input.allergies !== undefined) {
        // v1 shape, unchanged: lowercased token-string comparison.
        const current = intakeAnswersSchema.safeParse(profile.confirmedIntake);
        const previousAllergies = current.success ? (current.data.allergies ?? []) : [];
        newConcern = input.allergies.some(
          (a) => !previousAllergies.some((b) => a.toLowerCase() === b.toLowerCase())
        );
        await saveIntakeDraft(clientId, { allergies: input.allergies }, tx);
      } else {
        // v2 shape: newConcern is hash-based so a narrowing (adding
        // specificity under an already-declared category) still counts —
        // the string comparison above would miss it (dossier §5.6: any
        // difference at all counts as a new concern).
        const declarations = input.allergenDeclarations!;
        const previousDeclarations =
          extractAllergenDeclarations(profile.confirmedIntake) ??
          extractAllergenDeclarations(draft?.answers) ??
          EMPTY_ALLERGEN_DECLARATIONS;
        newConcern =
          contentHash(canonicalDeclarations(declarations)) !==
          contentHash(canonicalDeclarations(previousDeclarations));
        await saveIntakeDraft(
          clientId,
          { allergenDeclarations: declarations, allergies: deriveLegacyAllergyTokens(declarations) },
          tx
        );
      }
      if (newConcern && profile.confirmedIntake !== null) {
        await tx.aiCoachProfile.update({
          where: { clientId },
          data: {
            nutritionPermission: "PAUSED",
            safetyDisposition: ["CLEAR", "CLARIFY"].includes(profile.safetyDisposition)
              ? "RESTRICTED"
              : profile.safetyDisposition,
            safetyRevision: { increment: 1 },
          },
        });
        await invalidateAiProposals(tx, clientId);
      } else if (newConcern) {
        await tx.aiCoachProfile.update({
          where: { clientId },
          data: { safetyRevision: { increment: 1 } },
        });
        await invalidateAiProposals(tx, clientId);
      }
    }
    if (input.operation === "SAFETY") {
      const saved = await submitSafetyDisclosure(clientId, input.answers, tx);
      if (!saved.success) throw new AiCoachError("VALIDATION_ERROR", saved.error, 422);
      await invalidateAiProposals(tx, clientId);
      result = {
        saved: true,
        disposition: saved.disposition,
        safetyRevision: saved.safetyRevision,
      };
    }
    if (input.operation === "CONFIRM_INTAKE") {
      const confirmV2 = isV2Intake(input.answers);
      // An old app build's v1-shaped confirm must never silently overwrite
      // a v2 confirmed profile and drop every structured answer.
      if (!confirmV2 && isV2Intake(profile.confirmedIntake))
        throw new AiCoachError("VALIDATION_ERROR", "Update Steadfast to change your intake.", 422);
      const draft = await tx.aiIntakeDraft.findUnique({ where: { clientId } });
      const savedDraft = intakeDraftSchema.safeParse(draft?.answers);
      // `contentHash` throws (`canonicalJson`: "Only finite JSON values can
      // be hashed.") on `undefined`. A confirm payload missing the field
      // entirely is an ordinary validation mistake (a v1 confirm with no
      // `allergies` is exactly what the shipped iOS build sends today) and
      // must fail as a clean 422 inside this transaction, never escape it as
      // an uncaught throw that `aiHttp` would otherwise map to a retryable
      // 503 and a false server-fault report.
      if (confirmV2) {
        if (input.answers.allergenDeclarations === undefined)
          throw new AiCoachError(
            "VALIDATION_ERROR",
            "Save current allergy disclosures before confirming intake.",
            422
          );
        // The stored draft went through `allergenDeclarationsSchema` on
        // write (`ALLERGIES`, via `saveIntakeDraft`), which trims
        // `specificity` — comparing that trimmed value against the
        // confirm payload's raw, unvalidated form (this route's `answers`
        // is `z.record(z.string(), z.unknown())`) means a harmless
        // trailing/leading space makes CONFIRM_INTAKE permanently 422.
        // Parse the incoming value the same way before hashing so both
        // sides of the comparison are normalized identically.
        const incomingDeclarations = allergenDeclarationsSchema.safeParse(input.answers.allergenDeclarations);
        if (!incomingDeclarations.success)
          throw new AiCoachError(
            "VALIDATION_ERROR",
            "Save current allergy disclosures before confirming intake.",
            422
          );
        const draftDeclarations = savedDraft.success
          ? (extractAllergenDeclarations(savedDraft.data) ?? EMPTY_ALLERGEN_DECLARATIONS)
          : EMPTY_ALLERGEN_DECLARATIONS;
        if (
          !savedDraft.success ||
          contentHash(canonicalDeclarations(incomingDeclarations.data)) !==
            contentHash(canonicalDeclarations(draftDeclarations))
        )
          throw new AiCoachError(
            "VALIDATION_ERROR",
            "Save current allergy disclosures before confirming intake.",
            422
          );
      } else {
        const v1Allergies = (input.answers as { allergies?: unknown }).allergies;
        if (v1Allergies === undefined)
          throw new AiCoachError(
            "VALIDATION_ERROR",
            "Save current allergy disclosures before confirming intake.",
            422
          );
        if (
          !savedDraft.success ||
          contentHash(v1Allergies) !== contentHash(savedDraft.data.allergies ?? [])
        )
          throw new AiCoachError(
            "VALIDATION_ERROR",
            "Save current allergy disclosures before confirming intake.",
            422
          );
      }
      if (!(await hasRecordedSafetyDisclosure(tx, clientId)))
        throw new AiCoachError("VALIDATION_ERROR", SAFETY_DISCLOSURE_REQUIRED_MESSAGE, 422);
      const saved = await confirmIntake(clientId, input.answers, tx);
      if (!saved.success)
        throw new AiCoachError("VALIDATION_ERROR", "Complete the intake before confirming.", 422);
      await invalidateAiProposals(tx, clientId);
      result = { saved: true, profileRevision: saved.profileRevision };
    }
    if (input.operation === "ENROLL") {
      if (await tx.coachClient.count({ where: { clientId } }))
        throw new AiCoachError(
          "REVISION_CONFLICT",
          "Leave your current coaching relationship before enrolling."
        );
      if (profile.isSynthetic) {
        requireFixtureRuntime();
        if (!isAiCoachEnrollmentEnabled())
          throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "Enrollment is paused.", 503);
      } else {
        if (!liveRelease)
          throw new AiCoachError(
            "LIVE_RELEASE_EVIDENCE_REQUIRED",
            "Current governed launch evidence is required.",
            503
          );
        const discovery = liveRelease.runtimeConfiguration.discovery;
        const expectedConsentDigest = contentHash(discovery);
        if (
          input.consentConfigurationId !== discovery.configurationId ||
          input.consentConfigurationVersion !== discovery.version ||
          input.privacyNoticeVersion !== discovery.privacyNoticeVersion ||
          input.consentTextDigest !== expectedConsentDigest
        )
          throw new AiCoachError(
            "REVISION_CONFLICT",
            "The approved consent changed. Review it again before choosing AI Coach."
          );
      }
      if ((context?.revision ?? 0) !== input.expectedContextRevision || context?.mode === "HUMAN")
        throw new AiCoachError(
          "REVISION_CONFLICT",
          "Complete the current provider transition before enrolling."
        );
      if (!intakeAnswersSchema.safeParse(profile.confirmedIntake).success)
        throw new AiCoachError("VALIDATION_ERROR", "Confirm your intake before enrolling.", 422);
      try {
        new Intl.DateTimeFormat("en", { timeZone: input.reviewTimezone });
      } catch {
        throw new AiCoachError("VALIDATION_ERROR", "Choose a valid review timezone.", 422);
      }
      if (profile.reviewTimezone && profile.reviewTimezone !== input.reviewTimezone)
        throw new AiCoachError(
          "REVISION_CONFLICT",
          "Your established review timezone cannot be changed during the pilot."
        );
      await tx.aiCoachProfile.update({
        where: { clientId },
        data: {
          consentedAt: profile.consentedAt ?? new Date(),
          reviewTimezone: input.reviewTimezone,
          consentReleaseId: liveRelease?.releaseId ?? null,
          consentConfigurationDigest: liveRelease?.runtimeConfigurationDigest ?? null,
          consentConfigurationId: input.consentConfigurationId ?? null,
          consentConfigurationVersion: input.consentConfigurationVersion ?? null,
          consentPrivacyNoticeVersion: input.privacyNoticeVersion ?? null,
          consentTextDigest: input.consentTextDigest ?? null,
        },
      });
      if (context?.mode !== "AI") {
        const updatedContext = await tx.clientCoachingContext.upsert({
          where: { clientId },
          create: { clientId, mode: "AI", revision: 1 },
          update: { mode: "AI", activeCoachClientId: null, revision: { increment: 1 } },
        });
        if (liveRelease) {
          await tx.aiCoachProviderTransitionReceipt.create({
            data: {
              clientId,
              fromMode: context?.mode ?? "NONE",
              fromContextRevision: context?.revision ?? 0,
              toMode: "AI",
              toContextRevision: updatedContext.revision,
              releaseId: liveRelease.releaseId,
              runtimeConfigurationDigest: liveRelease.runtimeConfigurationDigest,
              discoveryConfigurationId: liveRelease.runtimeConfiguration.discovery.configurationId,
              discoveryConfigurationVersion: liveRelease.runtimeConfiguration.discovery.version,
              privacyNoticeVersion: liveRelease.runtimeConfiguration.discovery.privacyNoticeVersion,
              consentTextDigest: input.consentTextDigest!,
            },
          });
        }
      }
    }
    if (input.operation === "PAUSE") {
      if (context?.revision !== input.expectedContextRevision || context.mode !== "AI")
        throw new AiCoachError("REVISION_CONFLICT", "Your coaching provider changed.");
      await tx.clientCoachingContext.update({
        where: { clientId },
        data: { mode: "NONE", revision: { increment: 1 } },
      });
      await invalidateAiProposals(tx, clientId);
    }
    await tx.aiOperationReceipt.create({ data: { ...receiptKey, inputDigest, result } });
    return result;
  });
}
