import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { deleteAiEvidence } from "@/lib/ai-coach/delete-evidence";
import { submitAiCheckIn } from "@/lib/check-ins/ai-observation";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");
suite("owned evidence deletion", () => {
  beforeEach(() => vi.stubEnv("AI_COACH_FIXTURE_MODE", "true")); afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function fixture() { const id = randomUUID(); const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } }); await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic: true } }); await db.aiCoachEntitlement.create({ data: { clientId: user.id } }); await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } }); const input = { requestKey: randomUUID(), clientEventId: randomUUID(), expectedRevision: 0, occurredAt: new Date().toISOString(), submit: false, payload: { energy: "LOW" } }; await submitAiCheckIn(user.id, input); const row = await db.aiCheckInObservation.findFirstOrThrow({ where: { clientId: user.id } }); return { user, row, input }; }
  it("requires ownership and current revision, scrubs the report and prevents resurrection", async () => { const { user, row, input } = await fixture(); const other = await fixture(); const command = { requestKey: randomUUID(), kind: "CHECK_IN", id: row.id, expectedRevision: 1, confirmed: true }; await expect(deleteAiEvidence(other.user.id, command)).rejects.toMatchObject({ code: "NOT_FOUND" }); await expect(deleteAiEvidence(user.id, { ...command, expectedRevision: 0 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" }); await deleteAiEvidence(user.id, command); await deleteAiEvidence(user.id, command); expect((await db.aiCheckInObservation.findUniqueOrThrow({ where: { id: row.id } })).payload).toEqual({ deleted: true }); await expect(submitAiCheckIn(user.id, { ...input, requestKey: randomUUID(), expectedRevision: 2 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" }); });
  it("invalidates referenced proposals without clearing safety restrictions", async () => { const { user, row } = await fixture(); await db.aiCoachRun.create({ data: { clientId: user.id, kind: "WEEKLY_REVIEW", businessKey: randomUUID(), status: "COMPLETED", contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 0, inputSnapshot: { sourceRefs: [{ kind: "CHECK_IN", id: row.id }] } } }); await db.aiCoachProfile.update({ where: { clientId: user.id }, data: { nutritionPermission: "PAUSED" } }); await deleteAiEvidence(user.id, { requestKey: randomUUID(), kind: "CHECK_IN", id: row.id, expectedRevision: 1, confirmed: true }); expect(await db.aiCoachProfile.findUnique({ where: { clientId: user.id } })).toMatchObject({ observationRevision: 1, nutritionPermission: "PAUSED" }); });
});
