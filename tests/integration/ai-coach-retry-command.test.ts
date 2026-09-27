import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requestAiRun, runSnapshotSchema } from "@/lib/ai-coach/run-command";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import {
  LEGACY_RUN_SNAPSHOT,
  legacyRunRowData,
} from "../fixtures/ai-coach-legacy-run-snapshot";
import { publishRuntimeFixtureArtifacts } from "../helpers/ai-live-launch";
import { retryManagedRun } from "@/lib/ai-coach/retry-command";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");
suite("owner-scoped terminal run retry", () => {
  beforeEach(() => { vi.stubEnv("AI_COACH_FIXTURE_MODE", "true"); vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true"); }); afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  async function fixture() { const id = randomUUID(); const client = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } }); await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } }); await db.aiCoachEntitlement.create({ data: { clientId: client.id } }); await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true, consentedAt: new Date(), reviewTimezone: "America/Los_Angeles", confirmedIntake: { goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 2, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC" } } }); const { runId } = await requestAiRun(client.id, { requestKey: randomUUID(), kind: "INITIAL", representation: "MACROS", expectedContextRevision: 0, expectedProfileRevision: 0 }); const run = await db.aiCoachRun.update({ where: { id: runId }, data: { status: "FAILED", attempts: 3 } }); return { client, run }; }
  it("collapses concurrent manual requests, preserving snapshots, windows and terminal history (T-2000: zero reviewer rows)", async () => { const { client, run } = await fixture(); expect(await db.aiCoachReviewerGrant.count({ where: { clientIds: { has: client.id } } })).toBe(0); await Promise.all([retryManagedRun(client.id, run.id, { requestKey: randomUUID() }), retryManagedRun(client.id, run.id, { requestKey: randomUUID() })]); const retries = await db.aiCoachRun.findMany({ where: { retryOfRunId: run.id } }); expect(retries).toHaveLength(1); expect(retries[0]).toMatchObject({ inputSnapshot: run.inputSnapshot, activationEndsAt: run.activationEndsAt, snapshotCutoffAt: run.snapshotCutoffAt, retryGeneration: 1 }); expect((await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("FAILED"); expect(await db.aiCoachReviewerGrant.count({ where: { clientIds: { has: client.id } } })).toBe(0); });
  /** T-2041 read path 2 (`retry-command.ts` re-parse -> `jsonValue` re-store).
   * A snapshot written before this ticket must round-trip byte-identically —
   * the `.optional()`/never-`.default()` rule is what makes that true — and a
   * snapshot carrying a frozen binding must keep it intact, so the retry of a
   * bound run is bound to the same artifacts. */
  it("T-2041: a legacy snapshot round-trips byte-identically through a retry", async () => {
    const id = randomUUID();
    const client = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    await db.aiCoachProfile.create({
      data: {
        clientId: client.id,
        isSynthetic: true,
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
        confirmedIntake: LEGACY_RUN_SNAPSHOT.intake,
      },
    });
    const original = await db.aiCoachRun.create({
      data: { ...legacyRunRowData(client.id, `t2041-retry-${randomUUID()}`), status: "FAILED", attempts: 3 },
    });
    const { runId } = (await retryManagedRun(client.id, original.id, {
      requestKey: randomUUID(),
    })) as { runId: string };
    const retry = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } });
    expect(contentHash(retry.inputSnapshot)).toBe(contentHash(original.inputSnapshot));
    expect(Object.hasOwn(retry.inputSnapshot as object, "runtimeBinding")).toBe(false);
  });

  it("T-2041: a retry of a bound run preserves its frozen runtimeBinding intact", async () => {
    await publishRuntimeFixtureArtifacts();
    const { client, run } = await fixture();
    const originalSnapshot = runSnapshotSchema.parse(run.inputSnapshot);
    expect(originalSnapshot.runtimeBinding).toBeDefined();
    const { runId } = (await retryManagedRun(client.id, run.id, {
      requestKey: randomUUID(),
    })) as { runId: string };
    const retry = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } });
    const retrySnapshot = runSnapshotSchema.parse(retry.inputSnapshot);
    expect(retrySnapshot.runtimeBinding).toEqual(originalSnapshot.runtimeBinding);
    expect(contentHash(retrySnapshot)).toBe(contentHash(originalSnapshot));
  });

  it.each(["foreign", "safety", "window", "budget"])("rejects %s retries", async kind => { const { client, run } = await fixture(); let owner = client.id; if (kind === "foreign") owner = (await fixture()).client.id; if (kind === "safety") await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { safetyRevision: { increment: 1 } } }); if (kind === "window") await db.aiCoachRun.update({ where: { id: run.id }, data: { activationEndsAt: new Date(Date.now() - 1) } }); if (kind === "budget") await db.aiCoachRun.update({ where: { id: run.id }, data: { retryGeneration: 2 } }); await expect(retryManagedRun(owner, run.id, { requestKey: randomUUID() })).rejects.toThrow(); expect(await db.aiCoachRun.count({ where: { retryOfRunId: run.id } })).toBe(0); });
});
