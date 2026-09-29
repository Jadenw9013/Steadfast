import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { submitSafetyDisclosure } from "@/lib/ai-coach/safety";
import { requestAiRun } from "@/lib/ai-coach/run-command";
import { drainRunNow } from "@/lib/ai-coach/executor";

vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
lockGlobalAiCoachState("exclusive");

const intake = {
  goal: "GENERAL_FITNESS" as const,
  experienceLevel: "NEW" as const,
  trainingDaysPerWeek: 2,
  equipmentAccess: ["NONE" as const],
  dietaryRestrictions: [],
  allergies: [],
  foodBudgetLevel: "LOW" as const,
  trackingPreference: "NUMBERS_VISIBLE" as const,
  unitsPreference: "METRIC" as const,
  heightCm: 170,
  weightKg: 70,
};
const clearSafety = {
  chestPainDuringExercise: "NO" as const,
  dizzinessOrFainting: "NO" as const,
  heartCondition: "NO" as const,
  pregnantOrPostpartum: "NO" as const,
  recentInjuryOrSurgery: "NO" as const,
  ageEligibilityConcern: "NO" as const,
  eatingDisorderHistoryOrConcern: "NO" as const,
  type1Diabetes: "NO" as const,
};

/**
 * LEAD LATENCY PROBE, 2026-09-29. Not a gate — it exists to answer "how long
 * does generating a plan actually take?" with a measured number instead of an
 * estimate, and to record what a *non*-synthetic account does instead.
 *
 * Delete it, or promote it to a real assertion, once S-26/S-27 are worked.
 */
suite("lead probe — how long a plan actually takes", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  async function ensureRuntimeArtifacts() {
    const set = buildSyntheticArtifactSet("t1008-runtime");
    const effectiveAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 86_400_000);
    for (const draft of [
      set.foodCatalog,
      set.exerciseCatalog,
      set.evidenceRegistry,
      set.escalationTemplates,
      set.policyBundle,
    ]) {
      const existing = await db.aiCoachArtifactVersion.findUnique({ where: { id: draft.id } });
      if (!existing) await registerArtifactVersion(draft);
      const current = await db.aiCoachArtifactVersion.findUniqueOrThrow({
        where: { id: draft.id },
      });
      if (current.state === "DRAFT") {
        await publishArtifactVersion({
          id: draft.id,
          effectiveAt,
          expiresAt,
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
        });
      }
    }
  }

  async function makeClient(isSynthetic: boolean) {
    await ensureRuntimeArtifacts();
    const id = randomUUID();
    const user = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true },
    });
    await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: user.id } });
    await db.aiCoachProfile.create({
      data: {
        clientId: user.id,
        isSynthetic,
        confirmedIntake: intake,
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
      },
    });
    await submitSafetyDisclosure(user.id, clearSafety);
    return user;
  }

  async function timeOneRun(isSynthetic: boolean) {
    process.env.FEATURE_AI_COACH_GENERATION = "true";
    const user = await makeClient(isSynthetic);
    const context = await db.clientCoachingContext.findUniqueOrThrow({
      where: { clientId: user.id },
    });
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
    const t0 = Date.now();
    const created = (await requestAiRun(user.id, {
      kind: "INITIAL",
      representation: "MEALS",
      requestKey: randomUUID(),
      expectedContextRevision: context.revision,
      expectedProfileRevision: profile.profileRevision,
    })) as { runId?: string };
    const enqueuedMs = Date.now() - t0;
    const runId = created.runId!;
    const t1 = Date.now();
    const outcome = await drainRunNow(runId);
    const drainMs = Date.now() - t1;
    const run = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } });
    const plans = await db.aiPlanVersion.count({ where: { clientId: user.id } });
    return {
      enqueuedMs,
      drainMs,
      totalMs: enqueuedMs + drainMs,
      outcome,
      status: run.status,
      attempts: run.attempts,
      lastError: run.lastError,
      plans,
    };
  }

  it("a synthetic account gets a completed plan in one kick, in milliseconds", async () => {
    const r = await timeOneRun(true);
    console.log("SYNTHETIC  ", JSON.stringify(r));
    expect(r.outcome).toBe("completed");
    expect(r.status).toBe("COMPLETED");
    expect(r.attempts).toBe(1);
    expect(r.plans).toBe(1);
    // There is no model call on this path: `SyntheticFixtureProvider` returns
    // without touching the network, and `processManagedRun` is a single pass
    // that never requeues. Anything approaching a second here means work has
    // moved onto this path that did not used to be on it.
    expect(r.totalMs).toBeLessThan(5_000);
  });

  it("a real account cannot reach composition at all, and says which gate stopped it", async () => {
    // Two gates stand in front of a non-synthetic account and they fail at
    // different moments, which matters for what the client sees:
    //   - no ACTIVE governed live release -> LIVE_ACTIVATION_MISSING, thrown
    //     out of `requestAiRun`, so no run row is ever created and the UI
    //     shows an error immediately;
    //   - an active release but `isSynthetic: false` -> LIVE_COMPOSITION_
    //     UNAVAILABLE inside `processManagedRun`, which `failRunAttempt`
    //     turns into RETRY_WAIT. Nothing locally re-drives RETRY_WAIT (S-27),
    //     so that one presents as a spinner that never resolves (S-26).
    // This database has no active release, so the first gate is the one under
    // test here. The second is what a developer with an activated local
    // release hits.
    await expect(timeOneRun(false)).rejects.toMatchObject({
      code: "LIVE_ACTIVATION_MISSING",
    });
  });
});
