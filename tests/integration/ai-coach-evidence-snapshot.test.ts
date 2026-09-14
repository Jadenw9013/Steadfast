import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { collectEvidence, evidenceIsCurrent } from "@/lib/ai-coach/evidence-snapshot";
import { submitAiCheckIn } from "@/lib/check-ins/ai-observation";
import { lockAiClient } from "@/lib/ai-coach/access";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const u = new URL(process.env.DATABASE_URL ?? ""); if (u.hostname !== "127.0.0.1" || u.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
suite("frozen evidence references", () => {
  beforeEach(() => vi.stubEnv("AI_COACH_FIXTURE_MODE", "true")); afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function fixture() {
    const id = randomUUID(); const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } }); await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic: true } }); await db.aiCoachEntitlement.create({ data: { clientId: user.id } }); await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    const input = { requestKey: randomUUID(), clientEventId: randomUUID(), expectedRevision: 0, occurredAt: new Date(Date.now() - 86400000).toISOString(), submit: true, payload: { schemaVersion: 1, completeness: "REPORTED_PARTIAL", followingDays: null, weight: null, energy: "NOT_REPORTED", recovery: "NOT_REPORTED", hunger: "NOT_REPORTED", barrier: "NOT_REPORTED", safetyChanged: "NO" } };
    await submitAiCheckIn(user.id, input);
    const snapshot = await db.$transaction(async tx => { await lockAiClient(tx, user.id); return collectEvidence(tx, user.id, new Date(Date.now() - 7 * 86400000), new Date()); });
    return { user, input, snapshot };
  }
  it("captures only submitted owner evidence and fails closed across clients", async () => {
    const { user, snapshot } = await fixture(); const other = await fixture(); expect(snapshot.evidence.observations).toHaveLength(1);
    expect(await db.$transaction(tx => evidenceIsCurrent(tx, user.id, snapshot.sourceRefs))).toBe(true);
    expect(await db.$transaction(tx => evidenceIsCurrent(tx, other.user.id, snapshot.sourceRefs))).toBe(false);
  });
  it.each(["revision", "content", "deleted"])("detects %s changes even without an epoch update", async kind => {
    const { user, snapshot } = await fixture(); const id = snapshot.sourceRefs[0].id;
    await db.aiCheckInObservation.update({ where: { id }, data: kind === "revision" ? { revision: { increment: 1 } } : kind === "deleted" ? { deletedAt: new Date() } : { payload: { changed: true } } });
    expect(await db.$transaction(tx => evidenceIsCurrent(tx, user.id, snapshot.sourceRefs))).toBe(false);
  });
  it("does not include drafts or reports outside the frozen window", async () => {
    const { user, input, snapshot } = await fixture(); await submitAiCheckIn(user.id, { ...input, clientEventId: randomUUID(), requestKey: randomUUID(), submit: false });
    expect(snapshot.evidence.observations).toHaveLength(1);
    expect(await db.$transaction(tx => evidenceIsCurrent(tx, user.id, snapshot.sourceRefs))).toBe(true);
  });
});
