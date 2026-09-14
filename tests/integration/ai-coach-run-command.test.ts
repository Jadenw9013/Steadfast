import { assignFixtureReviewer } from "../helpers/ai-reviewer";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requestAiRun } from "@/lib/ai-coach/run-command";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const url = new URL(process.env.DATABASE_URL ?? ""); if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
suite("managed run request boundary", () => {
  beforeEach(() => { vi.stubEnv("AI_COACH_FIXTURE_MODE", "true"); vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true"); });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => db.$disconnect());
  async function fixture() {
    const id = randomUUID();
    const client = await db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isClient: true } });
    await assignFixtureReviewer(client.id);
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true, consentedAt: new Date(), reviewTimezone: "America/Los_Angeles", confirmedIntake: { goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC", heightCm: 170, weightKg: 70 } } });
    return client;
  }
  const command = () => ({ requestKey: randomUUID(), kind: "INITIAL", representation: "MACROS", expectedContextRevision: 0, expectedProfileRevision: 0 });
  it("requires current assigned reviewer scope and reserves bounded queue capacity", async () => {
    const client = await fixture();
    const grant = await db.aiCoachReviewerGrant.findFirstOrThrow({ where: { clientIds: { has: client.id } } });
    await db.aiCoachReviewerGrant.update({ where: { id: grant.id }, data: { domains: ["NUTRITION"] } });
    await expect(requestAiRun(client.id, command())).rejects.toMatchObject({ code: "REVIEWER_UNAVAILABLE" });
    await db.aiCoachReviewerGrant.update({ where: { id: grant.id }, data: { domains: ["NUTRITION", "STRENGTH", "CARDIO"] } });
    await db.aiPlanVersion.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ clientId: client.id, version: i + 1, payload: {}, payloadHash: "fixture", policyVersion: "policy-fixture-v1", catalogVersions: {}, contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 0, reviewerStatus: "PENDING" as const })) });
    await expect(requestAiRun(client.id, command())).rejects.toMatchObject({ code: "REVIEWER_CAPACITY" });
    expect(await db.aiCoachRun.count({ where: { clientId: client.id } })).toBe(0);
    await db.aiPlanVersion.updateMany({ where: { clientId: client.id }, data: { status: "INVALIDATED" } });
    expect(await requestAiRun(client.id, command())).toHaveProperty("runId");
  });
  it("deduplicates concurrent business inputs despite different client request keys", async () => {
    const client = await fixture();
    const [a, b] = await Promise.all([requestAiRun(client.id, command()), requestAiRun(client.id, command())]);
    expect(a.runId).toBe(b.runId);
    expect(await db.aiCoachRun.count({ where: { clientId: client.id } })).toBe(1);
    const run = await db.aiCoachRun.findUniqueOrThrow({ where: { id: a.runId } });
    expect(run.inputSnapshot).toMatchObject({ synthetic: true, baseVersionId: null, sourceRefs: [] });
    expect(run.activationEndsAt!.getTime()).toBeGreaterThan(run.activationStartsAt!.getTime());
  });
  it("replays exact requests, rejects changed payloads under one key", async () => {
    const client = await fixture(); const input = command();
    const first = await requestAiRun(client.id, input);
    expect(await requestAiRun(client.id, input)).toEqual(first);
    await expect(requestAiRun(client.id, { ...input, representation: "MEALS" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it.each(["isSynthetic", "generation", "fixtureMode", "production", "safety", "inactive", "revision"])("fails closed for %s", async reason => {
    const client = await fixture(); const input = command();
    if (reason === "isSynthetic") await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { isSynthetic: false } });
    if (reason === "generation") vi.stubEnv("FEATURE_AI_COACH_GENERATION", "false");
    if (reason === "fixtureMode") vi.stubEnv("AI_COACH_FIXTURE_MODE", "false");
    if (reason === "production") vi.stubEnv("NODE_ENV", "production");
    if (reason === "safety") await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { strengthPermission: "PAUSED" } });
    if (reason === "inactive") await db.user.update({ where: { id: client.id }, data: { isDeactivated: true } });
    if (reason === "revision") input.expectedContextRevision = 99;
    await expect(requestAiRun(client.id, input)).rejects.toThrow();
    expect(await db.aiCoachRun.count({ where: { clientId: client.id } })).toBe(0);
  });
  it("rejects caller-supplied authority or snapshot fields", async () => {
    const client = await fixture();
    await expect(requestAiRun(client.id, { ...command(), clientId: "someone-else" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("retains receipts only while their account exists", async () => {
    const id = randomUUID();
    const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await db.aiOperationReceipt.create({ data: { clientId: user.id, operation: "TEST", requestKey: id, inputDigest: "test", result: { private: "fixture" } } });
    await db.user.delete({ where: { id: user.id } });
    expect(await db.aiOperationReceipt.count({ where: { clientId: user.id } })).toBe(0);
  });
});
