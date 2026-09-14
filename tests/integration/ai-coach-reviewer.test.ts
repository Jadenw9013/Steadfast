import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getReviewerQueue, reviewAiPlan } from "@/lib/ai-coach/reviewer";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { approvalStateHash } from "@/lib/ai-coach/validated-plan";
import { jsonValue } from "@/lib/ai-coach/access";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const u = new URL(process.env.DATABASE_URL ?? ""); if (u.hostname !== "127.0.0.1" || u.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
suite("reviewer capability and exact-state decisions", () => {
  beforeEach(() => vi.stubEnv("AI_COACH_FIXTURE_MODE", "true")); afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function user() { const id = randomUUID(); return db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: true } }); }
  async function fixture() {
    const client = await user(); const reviewer = await user();
    await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    const { payload } = buildInitialFixturePlan({ goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC", heightCm: 170, weightKg: 70 }, "fixture-rx", "MACROS");
    const plan = await db.aiPlanVersion.create({ data: { clientId: client.id, version: 1, payload: jsonValue(payload), payloadHash: contentHash(payload), changeClass: "INITIAL", contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 0, policyVersion: payload.policyVersion, catalogVersions: payload.catalogVersions, sourceRefs: [], validationReport: { engine: "managed-v1", passed: true, inputHash: contentHash({ fixture: true }) }, reviewerStatus: "PENDING" } });
    const grant = await db.aiCoachReviewerGrant.create({ data: { userId: reviewer.id, qualificationNote: "SYNTHETIC TEST QUALIFICATIONS", clientIds: [client.id], domains: ["NUTRITION", "STRENGTH", "CARDIO"] } });
    return { client, reviewer, plan, grant };
  }
  const input = (state: string) => ({ requestKey: randomUUID(), expectedStateHash: state, approved: true, rationale: "Synthetic fixture checked." });
  it("ordinary coaches cannot see the queue or approve plans", async () => {
    const { plan } = await fixture(); const ordinary = await user();
    await expect(getReviewerQueue(ordinary.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reviewAiPlan(ordinary.id, plan.id, input(approvalStateHash(plan)))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["wrongCase", "wrongDomain", "revoked", "inactive"])("denies %s grants", async reason => {
    const { reviewer, grant, plan } = await fixture();
    if (reason === "wrongCase") await db.aiCoachReviewerGrant.update({ where: { id: grant.id }, data: { clientIds: [] } });
    if (reason === "wrongDomain") await db.aiCoachReviewerGrant.update({ where: { id: grant.id }, data: { domains: ["STRENGTH"] } });
    if (reason === "revoked") await db.aiCoachReviewerGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    if (reason === "inactive") await db.user.update({ where: { id: reviewer.id }, data: { isDeactivated: true } });
    await expect(reviewAiPlan(reviewer.id, plan.id, input(approvalStateHash(plan)))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("approves the exact assigned state idempotently and unlocks participant visibility", async () => {
    const { client, reviewer, plan } = await fixture(); const decision = input(approvalStateHash(plan));
    const queue = await getReviewerQueue(reviewer.id); expect(queue.candidates.map(p => p.id)).toEqual([plan.id]);
    expect((await getAiWorkspace(client.id)).proposals[0].payload).toBeNull();
    await reviewAiPlan(reviewer.id, plan.id, decision); await reviewAiPlan(reviewer.id, plan.id, decision);
    expect((await getAiWorkspace(client.id)).proposals[0].status).toBe("READY");
    await db.aiPlanVersion.update({ where: { id: plan.id }, data: { sourceRefs: [{ unexpected: "changed" }] } });
    expect((await getAiWorkspace(client.id)).proposals[0].payload).toBeNull();
  });
  it("rejects changed state hashes and conflicting decisions", async () => {
    const { reviewer, plan } = await fixture(); const decision = input(approvalStateHash(plan));
    await expect(reviewAiPlan(reviewer.id, plan.id, { ...decision, expectedStateHash: "0".repeat(64) })).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
    await reviewAiPlan(reviewer.id, plan.id, decision);
    await expect(reviewAiPlan(reviewer.id, plan.id, { ...decision, approved: false })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
});
