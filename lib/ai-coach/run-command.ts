import { z } from "zod";
import { db } from "@/lib/db";
import { intakeAnswersSchema } from "./intake";
import { planPayloadSchema, sourceRefSchema } from "./plan-contract";
import { contentHash } from "./canonical-json";
import { reviewWindow } from "./review-window";
import { ACTIVE_POLICY_VERSION } from "./policy/policy-version";
import { FOOD_CATALOG_VERSION } from "./catalog/food-catalog";
import { EXERCISE_CATALOG_VERSION } from "./catalog/exercise-catalog";
import { isAiCoachGenerationEnabled } from "@/lib/flags/ai-coach";
import { AiCoachError, jsonValue, lockAiClient } from "./access";

export const runCommandSchema = z.object({
  requestKey: z.string().uuid(), kind: z.enum(["INITIAL", "WEEKLY_REVIEW", "REPRESENTATION"]),
  representation: z.enum(["MACROS", "MEALS"]), expectedContextRevision: z.number().int().nonnegative(),
  expectedProfileRevision: z.number().int().nonnegative(),
}).strict();
export const runSnapshotSchema = z.object({
  schemaVersion: z.literal(1), synthetic: z.literal(true), intake: intakeAnswersSchema,
  policyVersion: z.literal(ACTIVE_POLICY_VERSION),
  catalogVersions: z.object({ food: z.literal(FOOD_CATALOG_VERSION), exercise: z.literal(EXERCISE_CATALOG_VERSION) }).strict(),
  modelConfiguration: z.literal("synthetic-template-v1"), baseVersionId: z.string().nullable(),
  basePayload: planPayloadSchema.nullable(), representation: z.enum(["MACROS", "MEALS"]),
  reviewWindowKey: z.string(), reviewTimezone: z.string(),
  sourceRefs: z.array(sourceRefSchema).max(500),
}).strict();
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;

/** Owner and business identity are entirely server-derived; request keys cannot buy new runs. */
export async function requestAiRun(clientId: string, raw: unknown) {
  const parsed = runCommandSchema.safeParse(raw);
  if (!parsed.success) throw new AiCoachError("VALIDATION_ERROR", "Invalid plan request.", 422);
  const input = parsed.data;
  return db.$transaction(async tx => {
    const { context, profile } = await lockAiClient(tx, clientId);
    const digest = contentHash(input);
    const receipt = await tx.aiOperationReceipt.findUnique({ where: { clientId_operation_requestKey: { clientId, operation: "RUN", requestKey: input.requestKey } } });
    if (receipt) {
      if (receipt.inputDigest !== digest) throw new AiCoachError("REVISION_CONFLICT", "This request key was already used with different input.");
      return receipt.result as { runId: string };
    }
    if (!isAiCoachGenerationEnabled()) throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "Plan preparation is paused.", 503);
    if (context!.revision !== input.expectedContextRevision || profile.profileRevision !== input.expectedProfileRevision) throw new AiCoachError("REVISION_CONFLICT", "Your intake or coaching provider changed. Refresh to continue.");
    if (!profile.consentedAt || !profile.reviewTimezone) throw new AiCoachError("VALIDATION_ERROR", "Confirm intake and consent before requesting a plan.", 422);
    const intake = intakeAnswersSchema.safeParse(profile.confirmedIntake);
    if (!intake.success) throw new AiCoachError("VALIDATION_ERROR", "Complete and confirm your intake first.", 422);
    if ([profile.nutritionPermission, profile.strengthPermission, profile.cardioPermission].some(p => p !== "ALLOW")) throw new AiCoachError("SAFETY_RESTRICTED", "Resolve the current safety restriction before preparing a new plan.");
    const base = profile.activePlanVersionId ? await tx.aiPlanVersion.findFirst({ where: { id: profile.activePlanVersionId, clientId, acceptedAt: { not: null } } }) : null;
    const historyExists = await tx.aiPlanVersion.count({ where: { clientId, acceptedAt: { not: null } } });
    if ((input.kind === "INITIAL" && historyExists > 0) || (input.kind !== "INITIAL" && !base)) throw new AiCoachError("REVISION_CONFLICT", "The requested operation does not match your plan history.");
    const window = reviewWindow(new Date(), profile.reviewTimezone);
    const snapshot = runSnapshotSchema.parse({
      schemaVersion: 1, synthetic: true, intake: intake.data, policyVersion: ACTIVE_POLICY_VERSION,
      catalogVersions: { food: FOOD_CATALOG_VERSION, exercise: EXERCISE_CATALOG_VERSION }, modelConfiguration: "synthetic-template-v1",
      baseVersionId: base?.id ?? null, basePayload: base?.payload ?? null, representation: input.representation,
      reviewWindowKey: window.key, reviewTimezone: profile.reviewTimezone, sourceRefs: [],
    });
    const revisions = { contextRevision: context!.revision, profileRevision: profile.profileRevision, observationRevision: profile.observationRevision, safetyRevision: profile.safetyRevision };
    const businessKey = contentHash({ clientId, kind: input.kind, snapshot: jsonValue(snapshot), ...revisions });
    let run = await tx.aiCoachRun.findUnique({ where: { businessKey } });
    if (!run) {
      const recent = await tx.aiCoachRun.count({ where: { clientId, createdAt: { gte: new Date(Date.now() - 86400000) } } });
      if (recent >= 8) throw new AiCoachError("RATE_LIMITED", "The daily preparation limit has been reached. Try again later.", 429);
      run = await tx.aiCoachRun.create({ data: { clientId, kind: input.kind, businessKey, ...revisions, inputSnapshot: jsonValue(snapshot), snapshotCutoffAt: new Date(), activationStartsAt: window.activationStartsAt, activationEndsAt: window.activationEndsAt, lookbackStart: window.lookbackStart, lookbackEnd: window.lookbackEnd } });
    }
    const result = { runId: run.id };
    await tx.aiOperationReceipt.create({ data: { clientId, operation: "RUN", requestKey: input.requestKey, inputDigest: digest, result } });
    return result;
  });
}
