import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { submitAiCheckIn } from "@/lib/check-ins/submit";
import { getAiObservations } from "@/lib/queries/ai-observations";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const u = new URL(process.env.DATABASE_URL ?? ""); if (u.hostname !== "127.0.0.1" || u.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
const payload = { schemaVersion: 1, completeness: "REPORTED_PARTIAL", followingDays: null, weight: null, energy: "NOT_REPORTED", recovery: "NOT_REPORTED", hunger: "NOT_REPORTED", barrier: "NOT_REPORTED", safetyChanged: "NO" };
suite("revisioned private AI check-ins", () => {
  beforeEach(() => vi.stubEnv("AI_COACH_FIXTURE_MODE", "true")); afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function fixture() { const id = randomUUID(); const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } }); await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic: true } }); await db.aiCoachEntitlement.create({ data: { clientId: user.id } }); await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } }); return user; }
  const command = () => ({ requestKey: randomUUID(), clientEventId: randomUUID(), expectedRevision: 0, occurredAt: new Date().toISOString(), submit: true, payload });
  it("persists missing and partial data without inventing weight, food intake or human access", async () => {
    const user = await fixture(); await submitAiCheckIn(user.id, command());
    expect((await getAiObservations(user.id))[0].payload).toMatchObject({ followingDays: null, weight: null, completeness: "REPORTED_PARTIAL" });
    expect(await db.checkIn.count({ where: { clientId: user.id } })).toBe(0); expect(await db.coachClient.count({ where: { clientId: user.id } })).toBe(0);
  });
  it("deduplicates simultaneous submissions and binds every request key", async () => {
    const user = await fixture(); const input = command(); const secondKey = randomUUID();
    await Promise.all([submitAiCheckIn(user.id, input), submitAiCheckIn(user.id, { ...input, requestKey: secondKey })]);
    expect(await db.aiCheckInObservation.count({ where: { clientId: user.id } })).toBe(1);
    expect(await db.aiOperationReceipt.count({ where: { clientId: user.id, operation: "AI_CHECK_IN" } })).toBe(2);
    await expect(submitAiCheckIn(user.id, { ...input, requestKey: secondKey, payload: { ...payload, followingDays: 3 } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("keeps a draft resumable and rejects stale corrections", async () => {
    const user = await fixture(); const input = { ...command(), submit: false, payload: { energy: "LOW" } };
    await submitAiCheckIn(user.id, input); expect((await getAiObservations(user.id))[0].submitted).toBe(false);
    await submitAiCheckIn(user.id, { ...input, requestKey: randomUUID(), expectedRevision: 1, submit: true, payload });
    await expect(submitAiCheckIn(user.id, { ...input, requestKey: randomUUID(), expectedRevision: 1, payload: { energy: "OK" } })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("invalidates referenced corrections but not ordinary later logs", async () => {
    const user = await fixture(); const input = command(); await submitAiCheckIn(user.id, input);
    const row = (await getAiObservations(user.id))[0];
    await db.aiCoachRun.create({ data: { clientId: user.id, kind: "WEEKLY_REVIEW", businessKey: randomUUID(), status: "COMPLETED", contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 0, inputSnapshot: { sourceRefs: [{ kind: "CHECK_IN", id: row.id }] }, lookbackStart: new Date(Date.now() - 14 * 86400000), lookbackEnd: new Date(Date.now() - 7 * 86400000), snapshotCutoffAt: new Date() } });
    await submitAiCheckIn(user.id, command());
    expect((await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } })).observationRevision).toBe(0);
    await submitAiCheckIn(user.id, { ...input, requestKey: randomUUID(), expectedRevision: 1, payload: { ...payload, followingDays: 2 } });
    expect((await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } })).observationRevision).toBe(1);
  });
  it("applies a concern despite an invalid unrelated field, with idempotent safety effects", async () => {
    const user = await fixture(); const input = { ...command(), payload: { ...payload, safetyChanged: "YES", weight: "invalid" } };
    await expect(submitAiCheckIn(user.id, input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(submitAiCheckIn(user.id, input)).rejects.toThrow();
    expect(await db.aiCoachProfile.findUnique({ where: { clientId: user.id } })).toMatchObject({ nutritionPermission: "PAUSED", strengthPermission: "PAUSED", safetyRevision: 1 });
    expect(await db.aiCheckInObservation.count({ where: { clientId: user.id } })).toBe(0);
  });
});
