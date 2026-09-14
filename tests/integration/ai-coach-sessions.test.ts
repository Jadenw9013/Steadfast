import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { submitAiSession } from "@/lib/workouts/ai-session";
import { getAiSessions } from "@/lib/queries/ai-sessions";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { contentHash } from "@/lib/ai-coach/canonical-json";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const u = new URL(process.env.DATABASE_URL ?? ""); if (u.hostname !== "127.0.0.1" || u.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
suite("typed AI activity evidence", () => {
  beforeEach(() => vi.stubEnv("AI_COACH_FIXTURE_MODE", "true")); afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function fixture() {
    const id = randomUUID(); const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic: true } }); await db.aiCoachEntitlement.create({ data: { clientId: user.id } }); await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    const { payload } = buildInitialFixturePlan({ goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC" }, randomUUID(), "MACROS");
    const plan = await db.aiPlanVersion.create({ data: { clientId: user.id, version: 1, status: "ACCEPTED", acceptedAt: new Date(), payload, payloadHash: contentHash(payload), policyVersion: payload.policyVersion, catalogVersions: payload.catalogVersions, contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 0 } });
    const input = { requestKey: randomUUID(), clientEventId: randomUUID(), sessionInstanceId: randomUUID(), expectedRevision: 0, planVersionId: plan.id, prescriptionSessionId: payload.strength[0].sessionId, exerciseId: payload.strength[0].exercises[0].exerciseId, occurredAt: new Date().toISOString(), modality: "STRENGTH", setIndex: 0, resultStatus: "REPORTED_COMPLETE", reps: 8, loadValue: 0, loadUnit: null, loadKind: "BODYWEIGHT", durationMinutes: null, effortRating: 5, painReported: false };
    return { user, plan, payload, input };
  }
  it("keeps bodyweight zero, units, and repeated workout instances distinct", async () => {
    const { user, input } = await fixture(); await submitAiSession(user.id, input);
    await submitAiSession(user.id, { ...input, requestKey: randomUUID(), clientEventId: randomUUID(), sessionInstanceId: randomUUID(), loadKind: "ASSISTED", loadValue: 20, loadUnit: "LB" });
    const records = await getAiSessions(user.id); expect(records).toHaveLength(2);
    expect(records.find(r => r.loadKind === "BODYWEIGHT")).toMatchObject({ loadValue: 0, loadUnit: null, revision: 1 });
  });
  it("deduplicates retries, rejects duplicate sets and stale corrections", async () => {
    const { user, input } = await fixture(); await Promise.all([submitAiSession(user.id, input), submitAiSession(user.id, { ...input, requestKey: randomUUID() })]);
    expect(await getAiSessions(user.id)).toHaveLength(1);
    await expect(submitAiSession(user.id, { ...input, requestKey: randomUUID(), clientEventId: randomUUID() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await submitAiSession(user.id, { ...input, requestKey: randomUUID(), expectedRevision: 1, reps: 7 });
    await expect(submitAiSession(user.id, { ...input, requestKey: randomUUID(), expectedRevision: 1, reps: 6 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("records cardio without fabricated repetitions or load and rejects mixed fields", async () => {
    const { user, input, payload } = await fixture(); const cardio = { ...input, modality: "CARDIO", prescriptionSessionId: payload.cardio[0].sessionId, exerciseId: payload.cardio[0].exerciseId, reps: null, loadValue: null, loadKind: null, durationMinutes: 12 };
    await submitAiSession(user.id, cardio); expect((await getAiSessions(user.id))[0]).toMatchObject({ modality: "CARDIO", durationMinutes: 12, reps: null, loadKind: null });
    await expect(submitAiSession(user.id, { ...cardio, requestKey: randomUUID(), reps: 2 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("enforces plan ownership, prescribed activity, and explicit missing data", async () => {
    const { user, input } = await fixture(); const other = await fixture();
    await expect(submitAiSession(other.user.id, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(submitAiSession(user.id, { ...input, exerciseId: "invented" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await submitAiSession(user.id, { ...input, resultStatus: "REPORTED_NOT_DONE", reps: null, loadKind: null, loadValue: null });
    expect((await getAiSessions(user.id))[0]).toMatchObject({ resultStatus: "REPORTED_NOT_DONE", reps: null });
  });
  it("preserves a pain restriction despite invalid workout data", async () => {
    const { user, input } = await fixture(); await expect(submitAiSession(user.id, { ...input, painReported: true, reps: -1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await db.aiCoachProfile.findUnique({ where: { clientId: user.id } })).toMatchObject({ strengthPermission: "PAUSED", safetyRevision: 1 });
    expect(await getAiSessions(user.id)).toHaveLength(0);
  });
});
