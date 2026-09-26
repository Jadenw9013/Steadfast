import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requestAiRun, runSnapshotSchema } from "@/lib/ai-coach/run-command";
import {
  activateTestLiveRelease,
  createTestGovernanceActor,
  deactivateTestLiveRelease,
} from "../helpers/ai-live-launch";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: table-wide AI Coach state; runs alone. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("exclusive");
suite("managed run request boundary", () => {
  beforeEach(() => {
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => db.$disconnect());
  async function fixture() {
    const id = randomUUID();
    const client = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true },
    });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    await db.aiCoachProfile.create({
      data: {
        clientId: client.id,
        isSynthetic: true,
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
        confirmedIntake: {
          goal: "GENERAL_FITNESS",
          experienceLevel: "NEW",
          trainingDaysPerWeek: 3,
          equipmentAccess: ["NONE"],
          allergies: [],
          dietaryRestrictions: [],
          foodBudgetLevel: "LOW",
          trackingPreference: "NUMBERS_VISIBLE",
          unitsPreference: "METRIC",
          heightCm: 170,
          weightKg: 70,
        },
      },
    });
    return client;
  }
  const command = () => ({
    requestKey: randomUUID(),
    kind: "INITIAL",
    representation: "MACROS",
    expectedContextRevision: 0,
    expectedProfileRevision: 0,
  });
  it("does not use reviewer grants or reviewer backlog as generation authority (T-2000: zero grants exist)", async () => {
    const client = await fixture();
    expect(await db.aiCoachReviewerGrant.count({ where: { clientIds: { has: client.id } } })).toBe(
      0
    );
    expect(await requestAiRun(client.id, command())).toHaveProperty("runId");
    expect(await db.aiCoachReviewerGrant.count({ where: { clientIds: { has: client.id } } })).toBe(
      0
    );
  });
  it("deduplicates concurrent business inputs despite different client request keys", async () => {
    const client = await fixture();
    const [a, b] = await Promise.all([
      requestAiRun(client.id, command()),
      requestAiRun(client.id, command()),
    ]);
    expect(a.runId).toBe(b.runId);
    expect(await db.aiCoachRun.count({ where: { clientId: client.id } })).toBe(1);
    const run = await db.aiCoachRun.findUniqueOrThrow({ where: { id: a.runId } });
    expect(run.inputSnapshot).toMatchObject({
      synthetic: true,
      baseVersionId: null,
      sourceRefs: [],
    });
    expect(run.activationEndsAt!.getTime()).toBeGreaterThan(run.activationStartsAt!.getTime());
  });
  it("replays exact requests, rejects changed payloads under one key", async () => {
    const client = await fixture();
    const input = command();
    const first = await requestAiRun(client.id, input);
    expect(await requestAiRun(client.id, input)).toEqual(first);
    await expect(
      requestAiRun(client.id, { ...input, representation: "MEALS" })
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it.each([
    "nonSyntheticWithoutLiveRelease",
    "generation",
    "fixtureMode",
    "production",
    "safety",
    "inactive",
    "revision",
  ])("fails closed for %s", async (reason) => {
    const client = await fixture();
    const input = command();
    if (reason === "nonSyntheticWithoutLiveRelease")
      // T-2000: this now fails closed for the right reason — no ACTIVE live
      // release — not because a non-synthetic profile is unconditionally
      // rejected. See "nonSyntheticWithLiveRelease" below for the success case.
      await db.aiCoachProfile.update({
        where: { clientId: client.id },
        data: { isSynthetic: false },
      });
    if (reason === "generation") vi.stubEnv("FEATURE_AI_COACH_GENERATION", "false");
    if (reason === "fixtureMode") vi.stubEnv("AI_COACH_FIXTURE_MODE", "false");
    if (reason === "production") vi.stubEnv("NODE_ENV", "production");
    if (reason === "safety")
      await db.aiCoachProfile.update({
        where: { clientId: client.id },
        data: { strengthPermission: "PAUSED" },
      });
    if (reason === "inactive")
      await db.user.update({ where: { id: client.id }, data: { isDeactivated: true } });
    if (reason === "revision") input.expectedContextRevision = 99;
    await expect(requestAiRun(client.id, input)).rejects.toThrow();
    expect(await db.aiCoachRun.count({ where: { clientId: client.id } })).toBe(0);
  });
  it("nonSyntheticWithLiveRelease: succeeds under an ACTIVE live release with zero reviewer grants", async () => {
    const client = await fixture();
    await db.aiCoachProfile.update({
      where: { clientId: client.id },
      data: { isSynthetic: false },
    });
    const actor = await createTestGovernanceActor(
      ["APPROVE_LIVE_LAUNCH", "ACTIVATE_LIVE_LAUNCH", "DEACTIVATE_LIVE_LAUNCH"],
      "T-2000-run-command-live-test"
    );
    await activateTestLiveRelease({
      namespace: `run-command-live-${randomUUID()}`,
      actorUserId: actor.id,
    });
    try {
      expect(
        await db.aiCoachReviewerGrant.count({ where: { clientIds: { has: client.id } } })
      ).toBe(0);
      const result = await requestAiRun(client.id, command());
      expect(result).toHaveProperty("runId");
      expect(await db.aiCoachRun.count({ where: { clientId: client.id } })).toBe(1);
      expect(
        await db.aiCoachReviewerGrant.count({ where: { clientIds: { has: client.id } } })
      ).toBe(0);
    } finally {
      await deactivateTestLiveRelease(actor.id);
    }
  });
  it("rejects caller-supplied authority or snapshot fields", async () => {
    const client = await fixture();
    await expect(
      requestAiRun(client.id, { ...command(), clientId: "someone-else" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("retains receipts only while their account exists", async () => {
    const id = randomUUID();
    const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await db.aiOperationReceipt.create({
      data: {
        clientId: user.id,
        operation: "TEST",
        requestKey: id,
        inputDigest: "test",
        result: { private: "fixture" },
      },
    });
    await db.user.delete({ where: { id: user.id } });
    expect(await db.aiOperationReceipt.count({ where: { clientId: user.id } })).toBe(0);
  });
  it("T-2024: a v1 confirmedIntake (no intakeVersion) still produces a stored inputSnapshot that runSnapshotSchema re-parses — the back-compat regression the intake v2 read schema must never break", async () => {
    const client = await fixture(); // this fixture's confirmedIntake is v1-shaped (no intakeVersion)
    const { runId } = await requestAiRun(client.id, command());
    const run = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } });
    const parsed = runSnapshotSchema.safeParse(run.inputSnapshot);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("unreachable");
    expect(parsed.data.intake).not.toHaveProperty("intakeVersion");
    expect(parsed.data.schemaVersion).toBe(1);
  });
});
