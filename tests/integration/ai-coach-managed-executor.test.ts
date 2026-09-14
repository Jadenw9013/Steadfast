import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requestAiRun } from "@/lib/ai-coach/run-command";
import { claimQueuedRun } from "@/lib/ai-coach/runs";
import { processClaimedRun } from "@/lib/ai-coach/executor";
import { SyntheticFixtureProvider } from "@/lib/ai-coach/provider/synthetic-provider";
import { approvalStateHash } from "@/lib/ai-coach/validated-plan";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { acceptPlanVersionAtomic } from "@/lib/ai-coach/plan-acceptance";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const url = new URL(process.env.DATABASE_URL ?? ""); if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
suite("managed execution and permitted reads", () => {
  beforeEach(() => { vi.stubEnv("AI_COACH_FIXTURE_MODE", "true"); vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true"); vi.stubEnv("FEATURE_AI_COACH_PUBLICATION", "true"); });
  afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function fixture() {
    const id = randomUUID(); const client = await db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isClient: true } });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true, consentedAt: new Date(), reviewTimezone: "America/Los_Angeles", confirmedIntake: { goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC", heightCm: 170, weightKg: 70 } } });
    const { runId } = await requestAiRun(client.id, { requestKey: randomUUID(), kind: "INITIAL", representation: "MACROS", expectedContextRevision: 0, expectedProfileRevision: 0 });
    const claim = await claimQueuedRun(runId); if (!claim.claimed) throw new Error("Fixture claim failed");
    return { client, claim };
  }
  it("saves exactly one pending candidate, without creating a human plan or exposing instructions", async () => {
    const { client, claim } = await fixture();
    expect(await processClaimedRun(claim, new SyntheticFixtureProvider())).toBe("completed");
    const view = await getAiWorkspace(client.id);
    expect(view.activePlan).toBeNull();
    expect(view.proposals).toHaveLength(1); expect(view.proposals[0]).toMatchObject({ status: "PENDING_REVIEW", payload: null });
    expect(await db.mealPlan.count({ where: { clientId: client.id } })).toBe(0);
    expect(await db.coachClient.count({ where: { clientId: client.id } })).toBe(0);
    expect(await processClaimedRun(claim, new SyntheticFixtureProvider())).toBe("failed");
    expect(await db.aiPlanVersion.count({ where: { clientId: client.id } })).toBe(1);
  });
  it.each(["safety", "authority", "lease"])("rejects late provider output after %s changes", async reason => {
    const { client, claim } = await fixture();
    const provider = { async runStage() {
      if (reason === "safety") await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { safetyRevision: { increment: 1 }, strengthPermission: "PAUSED" } });
      if (reason === "authority") await db.clientCoachingContext.update({ where: { clientId: client.id }, data: { mode: "HUMAN", revision: { increment: 1 } } });
      if (reason === "lease") await db.aiCoachRun.update({ where: { id: claim.run.id }, data: { fencingToken: { increment: 1 } } });
      return new SyntheticFixtureProvider().runStage();
    } };
    expect(await processClaimedRun(claim, provider)).toBe("failed");
    expect(await db.aiPlanVersion.count({ where: { clientId: client.id } })).toBe(0);
  });
  it("requires exact reviewed content for both proposal visibility and acceptance", async () => {
    const { client, claim } = await fixture(); await processClaimedRun(claim, new SyntheticFixtureProvider());
    const candidate = await db.aiPlanVersion.findFirstOrThrow({ where: { clientId: client.id } });
    const input = { requestKey: randomUUID(), expectedBaseVersionId: null, expectedContextRevision: 0, expectedProfileRevision: 0, expectedObservationRevision: 0, expectedSafetyRevision: 0 };
    expect(await acceptPlanVersionAtomic(client.id, candidate.id, input)).toMatchObject({ success: false, code: "REVIEWER_APPROVAL_REQUIRED" });
    const reviewerId = randomUUID(); const reviewer = await db.user.create({ data: { clerkId: reviewerId, email: `${reviewerId}@example.test` } });
    const grant = await db.aiCoachReviewerGrant.create({ data: { userId: reviewer.id, qualificationNote: "SYNTHETIC TEST REVIEWER", clientIds: [client.id], domains: ["NUTRITION", "STRENGTH", "CARDIO"] } });
    await db.aiPlanReviewerApproval.create({ data: { planVersionId: candidate.id, reviewerGrantId: grant.id, approvedHash: candidate.payloadHash, stateHash: approvalStateHash(candidate), approved: true, rationale: "fixture" } });
    await db.aiPlanVersion.update({ where: { id: candidate.id }, data: { reviewerStatus: "APPROVED" } });
    expect((await getAiWorkspace(client.id)).proposals[0].status).toBe("READY");
    expect(await acceptPlanVersionAtomic(client.id, candidate.id, input)).toMatchObject({ success: true });
    await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { nutritionPermission: "PAUSED", strengthPermission: "PAUSED" } });
    const view = await getAiWorkspace(client.id);
    expect(view.activePlan?.payload.nutrition).toBeNull(); expect(view.activePlan?.payload.strength).toEqual([]); expect(view.activePlan?.payload.cardio).toHaveLength(1);
  });
});
