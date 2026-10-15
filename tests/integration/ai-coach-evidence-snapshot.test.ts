import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { collectEvidence, evidenceIsCurrent } from "@/lib/ai-coach/evidence-snapshot";
import { sortedUniqueSourceRefs } from "@/lib/ai-coach/autonomy/gate";
import { submitAiCheckIn } from "@/lib/check-ins/ai-observation";
import { lockAiClient } from "@/lib/ai-coach/access";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");
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
  /**
   * S-29 reader #2: `gate.ts`'s `evidenceCurrent` check used to pass
   * `input.evidence.flatMap((item) => item.sourceRefs)` straight to
   * `evidenceIsCurrent`, and finalization attaches the *same* `sourceRefs`
   * array to every evidence entry, so since T-2007 made `evidenceRuleIds`
   * length 2 that flatMap is the candidate's refs duplicated once per rule.
   * `evidenceIsCurrent` guards its input at `z.array(sourceRefSchema)
   * .max(2180)` and returns `false` on a parse failure — this pins the exact
   * mechanism: one real ref, duplicated past the 2180 cap, fails the guard
   * un-deduped and passes once `sortedUniqueSourceRefs` collapses it back
   * to one.
   */
  it("S-29: the 2180 max-refs guard fails a duplicated-past-cap array and passes once deduped", async () => {
    const { user, snapshot } = await fixture();
    const ref = snapshot.sourceRefs[0];
    expect(await evidenceIsCurrent(db, user.id, Array(2182).fill(ref))).toBe(false);
    expect(
      await evidenceIsCurrent(db, user.id, sortedUniqueSourceRefs([Array(2182).fill(ref)]))
    ).toBe(true);
  });
});
