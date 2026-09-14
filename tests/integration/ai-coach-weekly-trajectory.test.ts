import { assignFixtureReviewer } from "../helpers/ai-reviewer";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { submitAiCheckIn } from "@/lib/check-ins/ai-observation";
import { requestAiRun } from "@/lib/ai-coach/run-command";
import { reviewWindow } from "@/lib/ai-coach/review-window";
import { claimQueuedRun } from "@/lib/ai-coach/runs";
import { processClaimedRun } from "@/lib/ai-coach/executor";
import { SyntheticFixtureProvider } from "@/lib/ai-coach/provider/synthetic-provider";
import { reviewAiPlan } from "@/lib/ai-coach/reviewer";
import { approvalStateHash } from "@/lib/ai-coach/validated-plan";
import { acceptPlanVersionAtomic } from "@/lib/ai-coach/plan-acceptance";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const u = new URL(process.env.DATABASE_URL ?? ""); if (u.hostname !== "127.0.0.1" || u.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
suite("weekly review through real evidence, worker, reviewer and acceptance", () => {
  beforeEach(() => { vi.stubEnv("AI_COACH_FIXTURE_MODE", "true"); vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true"); vi.stubEnv("FEATURE_AI_COACH_PUBLICATION", "true"); }); afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function fixture() {
    const id = randomUUID(); const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await assignFixtureReviewer(user.id); const zone = "America/Los_Angeles";
    const intake = { goal: "BODY_COMPOSITION", experienceLevel: "NEW", trainingDaysPerWeek: 2, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC", heightCm: 170, weightKg: 70 };
    const { payload } = buildInitialFixturePlan(intake, "initial-rx", "MEALS");
    const base = await db.aiPlanVersion.create({ data: { clientId: user.id, version: 1, status: "ACCEPTED", changeClass: "INITIAL", acceptedAt: new Date(Date.now() - 60 * 86400000), payload, payloadHash: contentHash(payload), policyVersion: payload.policyVersion, catalogVersions: payload.catalogVersions, contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 0, sourceRefs: [], validationReport: { engine: "managed-v1", passed: true, inputHash: "a".repeat(64) } } });
    await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic: true, confirmedIntake: intake, consentedAt: new Date(), reviewTimezone: zone, activePlanVersionId: base.id } }); await db.aiCoachEntitlement.create({ data: { clientId: user.id } }); await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    const window = reviewWindow(new Date(), zone);
    for (const weeks of [1, 2, 3]) await submitAiCheckIn(user.id, { requestKey: randomUUID(), clientEventId: randomUUID(), expectedRevision: 0, occurredAt: new Date(window.activationStartsAt.getTime() - weeks * 7 * 86400000 + 2 * 86400000).toISOString(), submit: true, payload: { schemaVersion: 1, completeness: "REPORTED_COMPLETE", followingDays: 6, weight: { value: 70, unit: "KG", comparableConditions: true }, energy: "OK", recovery: "GOOD", hunger: "MANAGEABLE", barrier: "NONE", safetyChanged: "NO" } });
    const { runId } = await requestAiRun(user.id, { requestKey: randomUUID(), kind: "WEEKLY_REVIEW", representation: "MEALS", expectedContextRevision: 0, expectedProfileRevision: 0 });
    const claim = await claimQueuedRun(runId); if (!claim.claimed) throw new Error("claim failed");
    expect(await processClaimedRun(claim, new SyntheticFixtureProvider())).toBe("completed");
    const run = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } }); expect(run.resultReviewAction).toBe("ADJUST");
    const candidate = await db.aiPlanVersion.findUniqueOrThrow({ where: { id: run.resultPlanVersionId! } });
    const reviewerId = randomUUID(); const reviewer = await db.user.create({ data: { clerkId: reviewerId, email: `${reviewerId}@example.test` } }); await db.aiCoachReviewerGrant.create({ data: { userId: reviewer.id, clientIds: [user.id], domains: ["NUTRITION", "STRENGTH", "CARDIO"], qualificationNote: "SYNTHETIC" } });
    const acceptance = { requestKey: randomUUID(), expectedBaseVersionId: base.id, expectedContextRevision: 0, expectedProfileRevision: 0, expectedObservationRevision: 0, expectedSafetyRevision: 0 };
    return { user, base, run, candidate, reviewer, acceptance };
  }
  it("publishes only after review, accepts once and retains a permanent weekly slot", async () => {
    const { user, base, candidate, reviewer, acceptance } = await fixture();
    expect((await getAiWorkspace(user.id)).proposals[0].payload).toBeNull();
    await reviewAiPlan(reviewer.id, candidate.id, { requestKey: randomUUID(), expectedStateHash: approvalStateHash(candidate), approved: true, rationale: "Verified synthetic trajectory" });
    expect((await getAiWorkspace(user.id)).proposals[0].status).toBe("READY");
    const results = await Promise.all([acceptPlanVersionAtomic(user.id, candidate.id, acceptance), acceptPlanVersionAtomic(user.id, candidate.id, { ...acceptance, requestKey: randomUUID() })]);
    expect(results.every(r => r.success)).toBe(true); expect(await db.aiAdjustmentSlot.count({ where: { clientId: user.id } })).toBe(1);
    expect((await getAiWorkspace(user.id)).activePlan!.id).toBe(candidate.id);
    expect((await db.aiPlanVersion.findUniqueOrThrow({ where: { id: base.id } })).status).toBe("SUPERSEDED");
  });
  it("rejects a source correction after approval even when revision epochs are unchanged", async () => {
    const { user, candidate, reviewer, acceptance } = await fixture(); await reviewAiPlan(reviewer.id, candidate.id, { requestKey: randomUUID(), expectedStateHash: approvalStateHash(candidate), approved: true, rationale: "fixture" });
    const row = await db.aiCheckInObservation.findFirstOrThrow({ where: { clientId: user.id } }); await db.aiCheckInObservation.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    expect((await getAiWorkspace(user.id)).proposals[0].status).toBe("STALE"); expect(await acceptPlanVersionAtomic(user.id, candidate.id, acceptance)).toMatchObject({ success: false, code: "REVISION_CONFLICT" });
  });
  it("rejects relabeling a weekly candidate to bypass deterministic proof", async () => {
    const { user, candidate, acceptance } = await fixture(); await db.aiPlanVersion.update({ where: { id: candidate.id }, data: { changeClass: "PROTECTIVE", reviewerStatus: "NOT_REQUIRED" } });
    expect(await acceptPlanVersionAtomic(user.id, candidate.id, acceptance)).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
  });
});
