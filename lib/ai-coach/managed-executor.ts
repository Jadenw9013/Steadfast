import { db } from "@/lib/db";
import type { ClaimResult } from "./runs";
import { failRunAttempt } from "./runs";
import { runSnapshotSchema } from "./run-command";
import { buildInitialFixturePlan } from "./initial-plan";
import { contentHash } from "./canonical-json";
import { AiCoachError, jsonValue, lockAiClient } from "./access";
import { isAiCoachGenerationEnabled } from "@/lib/flags/ai-coach";
import { callProviderWithTimeout, type ModelProvider } from "./provider/adapter";
import { checkProviderRateLimit, isWithinTokenCeiling } from "./provider/spend-limits";
import { decisionSchema, planPayloadSchema } from "./plan-contract";

/** Commit candidate and run completion together, after the external provider stage.
 * Model output never supplies targets, catalog IDs, ownership or a plan pointer.
 */
export async function processManagedRun(claim: Extract<ClaimResult, { claimed: true }>, provider: ModelProvider): Promise<"completed" | "failed"> {
  try {
    const snapshot = runSnapshotSchema.parse(claim.run.inputSnapshot);
    if (claim.run.kind !== "INITIAL") throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "This run type is not available yet.");
    const generated = buildInitialFixturePlan(snapshot.intake, `rx-${claim.run.id}`, snapshot.representation);
    await db.$transaction(async tx => { await lockAiClient(tx, claim.run.clientId); });
    if (!isAiCoachGenerationEnabled()) throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "Generation paused.");
    if (!await checkProviderRateLimit(claim.run.clientId, claim.run.kind)) throw new AiCoachError("RATE_LIMITED", "Provider budget reached.");
    const stage = await callProviderWithTimeout(provider, { run: claim.run });
    if (stage.outcome !== "success" || !stage.isFinal || !isWithinTokenCeiling(stage.tokensUsed)) throw new AiCoachError("VALIDATION_ERROR", "Provider stage did not validate.");
    // The synthetic provider's wording is deliberately not published. Use the
    // bounded explanation template tied to the deterministic decision.
    const payload = planPayloadSchema.parse(generated.payload);
    const decision = decisionSchema.parse(generated.decision);
    const completed = await db.$transaction(async tx => {
      const { context, profile } = await lockAiClient(tx, claim.run.clientId);
      const run = await tx.aiCoachRun.findUnique({ where: { id: claim.run.id } });
      if (!run || run.status !== "RUNNING" || run.fencingToken !== claim.fencingToken || !run.leaseExpiresAt || run.leaseExpiresAt <= new Date()) return false;
      if (!isAiCoachGenerationEnabled() || context!.revision !== run.contextRevision || profile.profileRevision !== run.profileRevision || profile.observationRevision !== run.observationRevision || profile.safetyRevision !== run.safetyRevision || profile.activePlanVersionId !== snapshot.baseVersionId || [profile.nutritionPermission, profile.strengthPermission, profile.cardioPermission].some(p => p !== "ALLOW") || (run.activationEndsAt && run.activationEndsAt <= new Date())) {
        await tx.aiCoachRun.update({ where: { id: run.id }, data: { status: "CANCELED", leaseExpiresAt: null } });
        return false;
      }
      const latest = await tx.aiPlanVersion.findFirst({ where: { clientId: run.clientId }, orderBy: { version: "desc" }, select: { version: true } });
      const plan = await tx.aiPlanVersion.create({ data: {
        clientId: run.clientId, version: (latest?.version ?? 0) + 1, baseVersionId: snapshot.baseVersionId,
        payload: jsonValue(payload), payloadHash: contentHash(payload), policyVersion: snapshot.policyVersion, catalogVersions: snapshot.catalogVersions,
        contextRevision: run.contextRevision, profileRevision: run.profileRevision, observationRevision: run.observationRevision, safetyRevision: run.safetyRevision,
        activationStartsAt: run.activationStartsAt, activationEndsAt: run.activationEndsAt, reviewWindowKey: snapshot.reviewWindowKey,
        changeClass: "INITIAL", reviewerStatus: "PENDING", sourceRefs: jsonValue(snapshot.sourceRefs),
        validationReport: { engine: "managed-v1", passed: true, inputHash: contentHash(snapshot) },
      } });
      const result = await tx.aiCoachRun.updateMany({ where: { id: run.id, status: "RUNNING", fencingToken: claim.fencingToken, leaseExpiresAt: { gt: new Date() } }, data: { status: "COMPLETED", leaseExpiresAt: null, resultPlanVersionId: plan.id, resultReviewAction: decision.action, resultDecision: jsonValue(decision) } });
      if (result.count !== 1) throw new AiCoachError("REVISION_CONFLICT", "Worker lease changed.");
      return true;
    });
    return completed ? "completed" : "failed";
  } catch (error) {
    // Never persist provider stacks or health notes as a user-facing message.
    await failRunAttempt(claim.run.id, claim.fencingToken, error instanceof AiCoachError ? error.code : "MANAGED_RUN_FAILED");
    return "failed";
  }
}
