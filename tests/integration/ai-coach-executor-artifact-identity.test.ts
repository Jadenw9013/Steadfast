import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";
import * as artifactRepository from "@/lib/ai-coach/artifacts/repository";
import {
  ArtifactLoadError,
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import { FOOD_CATALOG_VERSION } from "@/lib/ai-coach/catalog/food-catalog";
import { EXERCISE_CATALOG_VERSION } from "@/lib/ai-coach/catalog/exercise-catalog";
import { claimQueuedRun } from "@/lib/ai-coach/runs";
import { processClaimedRun } from "@/lib/ai-coach/executor";
import { SyntheticFixtureProvider } from "@/lib/ai-coach/provider/synthetic-provider";
import { RUNTIME_ARTIFACTS_UNPUBLISHED } from "@/lib/ai-coach/error";

vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");
const authMock = vi.mocked(getCurrentDbUser);

/**
 * S-28 — regression coverage for the defect: `composeManagedInitialPlan`'s
 * fallback artifact load (`managed-executor.ts`, no `frozenArtifacts`, i.e.
 * the T-2041 unbound-snapshot degrade) used to resolve identity from
 * `getCurrentDbUser()` — the ambient Clerk session — instead of the run's
 * own server-derived `claim.run.clientId`. Every existing managed-executor
 * test drains inside a mocked session for *the run's own client*, which is
 * exactly why this never showed up: nobody drained with no session, or with
 * a session for a different account.
 *
 * Both tests below build an **unbound** v2-intake run snapshot directly
 * (bypassing `requestAiRun`), matching the shape
 * `../fixtures/ai-coach-legacy-run-snapshot.ts` uses for the v1 case, so the
 * executor is forced onto the fallback path under test.
 */
suite("S-28 — managed executor artifact identity (unbound-snapshot fallback)", () => {
  beforeEach(() => {
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
    vi.stubEnv("FEATURE_AI_COACH_PUBLICATION", "true");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => db.$disconnect());

  /** Same "t1008-runtime" namespace the other managed-executor-adjacent
   * suites use. Registers/publishes once per test database. */
  async function ensureRuntimeArtifacts() {
    const set = buildSyntheticArtifactSet("t1008-runtime");
    const effectiveAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 86_400_000);
    for (const artifact of [
      set.foodCatalog,
      set.exerciseCatalog,
      set.evidenceRegistry,
      set.escalationTemplates,
      set.policyBundle,
    ]) {
      const existing = await db.aiCoachArtifactVersion.findUnique({ where: { id: artifact.id } });
      if (!existing) await registerArtifactVersion(artifact);
      const current = await db.aiCoachArtifactVersion.findUniqueOrThrow({
        where: { id: artifact.id },
      });
      if (current.state === "DRAFT") {
        await publishArtifactVersion({
          id: artifact.id,
          effectiveAt,
          expiresAt,
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
        });
      }
    }
    return set;
  }

  /** A well-formed, `intakeAnswersSchema`-valid v2 confirmed intake — the
   * minimum shape that makes `isV2Intake` true and reaches the artifact
   * load inside `composeManagedInitialPlan`. */
  function v2Intake(overrides: Record<string, unknown> = {}) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      intakeVersion: 2,
      goal: "BODY_COMPOSITION",
      experienceLevel: "NEW",
      trainingDaysPerWeek: 3,
      equipmentAccess: ["NONE"],
      dietaryRestrictions: [],
      allergies: [],
      foodBudgetLevel: "MODERATE",
      trackingPreference: "NUMBERS_VISIBLE",
      unitsPreference: "METRIC",
      capturedAt: `${today}T00:00:00.000Z`,
      ageYears: 30,
      ageStatus: "CONFIRMED",
      energyMethodPopulationCategory: "MALE_ADULT",
      energyMethodPopulationCategoryStatus: "CONFIRMED",
      physicalActivityCategory: "ACTIVE",
      physicalActivityCategoryStatus: "CONFIRMED",
      bodyMeasurementStatus: "CONFIRMED",
      heightCm: 180,
      weightKg: 80,
      weightMeasuredOn: today,
      bodyWeightIntent: "LOSE",
      goalPaceClass: "GRADUAL",
      goalStatus: "CONFIRMED",
      resistanceTrainingContext: "NONE",
      trainingContextStatus: "CONFIRMED",
      dietaryPattern: {
        pattern: "OMNIVORE",
        reason: "PREFERENCE",
        status: "CONFIRMED",
        otherLabel: null,
        mandatory: false,
      },
      ...overrides,
    };
  }

  /**
   * Builds an `AiCoachRun` row exactly as a pre-T-2041 (or T-2041
   * ARTIFACT_MISSING-degraded) `requestAiRun` would have written it for a v2
   * intake: no `runtimeBinding` key, the four top-level fixture constants
   * inline — the shape `runSnapshotSchema`'s `superRefine` requires when
   * unbound. This is what forces `composeManagedInitialPlan` onto its
   * fallback (`frozenArtifacts === null`).
   */
  function unboundV2RunRowData(clientId: string, businessKey: string) {
    const now = new Date();
    const inputSnapshot = {
      schemaVersion: 1,
      synthetic: true,
      intake: v2Intake(),
      policyVersion: ACTIVE_POLICY_VERSION,
      catalogVersions: { food: FOOD_CATALOG_VERSION, exercise: EXERCISE_CATALOG_VERSION },
      modelConfiguration: "synthetic-template-v1",
      baseVersionId: null,
      basePayload: null,
      representation: "MACROS",
      reviewWindowKey: "2026-W40",
      reviewTimezone: "America/Los_Angeles",
      lastSafetyResolutionAt: null,
      sourceRefs: [],
      evidence: { observations: [], sessions: [] },
      history: [],
      substitution: null,
    };
    return {
      clientId,
      kind: "INITIAL" as const,
      businessKey,
      contextRevision: 0,
      profileRevision: 0,
      observationRevision: 0,
      safetyRevision: 0,
      inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
      snapshotCutoffAt: now,
      activationStartsAt: new Date(now.getTime() - 3_600_000),
      activationEndsAt: new Date(now.getTime() + 7 * 86_400_000),
      lookbackStart: new Date(now.getTime() - 7 * 86_400_000),
      lookbackEnd: now,
    };
  }

  async function makeSyntheticClient() {
    const id = randomUUID();
    const user = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true },
    });
    await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: user.id } });
    await db.aiCoachProfile.create({
      data: {
        clientId: user.id,
        isSynthetic: true,
        confirmedIntake: v2Intake() as object,
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
      },
    });
    return user;
  }

  it("drains an unbound run with no session present and reports RUNTIME_ARTIFACTS_UNPUBLISHED, not a generic failure", async () => {
    // "This environment has never published a usable artifact set" (S-26/
    // S-27) is global, write-once database state that every other AI Coach
    // integration file also idempotently publishes under the same
    // "t1008-runtime" key — by the time this file's tests run in a shared
    // suite, that state is no longer reliably absent. The fault under test
    // is the identity resolution, not the publish state, so the ARTIFACT_
    // MISSING outcome is produced deterministically via a spy on the one
    // function the fix now calls, rather than by racing database setup
    // order. No session is mocked: `getCurrentDbUser()` throws a plain,
    // non-`AiCoachError` `Error("Not authenticated")` — the cron sweep's
    // exact context. Before the fix this escaped the `ArtifactLoadError`
    // branch entirely and the run failed with the generic
    // `MANAGED_RUN_FAILED` (measured and reported separately).
    authMock.mockRejectedValue(new Error("Not authenticated"));
    const spy = vi
      .spyOn(artifactRepository, "resolveArtifactSetForClient")
      .mockRejectedValue(new ArtifactLoadError("ARTIFACT_MISSING", "No published policy bundle exists."));
    const client = await makeSyntheticClient();
    const run = await db.aiCoachRun.create({
      data: unboundV2RunRowData(client.id, `s28-no-session-${randomUUID()}`),
    });
    const claim = await claimQueuedRun(run.id);
    if (!claim.claimed) throw new Error("fixture claim failed");

    const outcome = await processClaimedRun(claim, new SyntheticFixtureProvider());
    expect(outcome).toBe("failed");
    // The spy must actually have been consulted with this run's own client,
    // never a session-derived one (there is no session at all here).
    expect(spy).toHaveBeenCalledWith(expect.anything(), client.id, expect.anything());
    const updated = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(updated.lastError).toBe(RUNTIME_ARTIFACTS_UNPUBLISHED);
    expect(updated.lastError).not.toBe("MANAGED_RUN_FAILED");
    // No plan is ever written for an artifact-load fault.
    expect(await db.aiPlanVersion.count({ where: { clientId: client.id } })).toBe(0);
    spy.mockRestore();
  });

  it("drains client A's unbound run while a session for an ineligible client B is active, and resolves A's binding — not B's", async () => {
    // Published artifacts this time: A's run can actually complete if (and
    // only if) the fallback resolves identity from `claim.run.clientId`
    // (A), not from the session. B is a real, persisted account but not an
    // eligible client at all (`isClient: false`) — exactly the shape
    // `withReviewedArtifactSetForCurrentClient` rejects with
    // `ACCOUNT_NOT_ELIGIBLE` if it is ever consulted. Before the fix, B's
    // session being active at drain time was enough to fail A's run on B's
    // eligibility, a fault that has nothing to do with A.
    await ensureRuntimeArtifacts();
    const clientA = await makeSyntheticClient();
    const bId = randomUUID();
    const clientB = await db.user.create({
      data: { clerkId: bId, email: `${bId}@example.test`, isClient: false },
    });
    authMock.mockResolvedValue(clientB);

    const run = await db.aiCoachRun.create({
      data: unboundV2RunRowData(clientA.id, `s28-cross-client-${randomUUID()}`),
    });
    const claim = await claimQueuedRun(run.id);
    if (!claim.claimed) throw new Error("fixture claim failed");
    expect(claim.run.clientId).toBe(clientA.id);

    const outcome = await processClaimedRun(claim, new SyntheticFixtureProvider());
    expect(outcome).toBe("completed");
    const updated = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(updated.status).toBe("COMPLETED");
    expect(updated.lastError).toBeNull();
    // The plan that was written belongs to A, the run's own client — never B.
    expect(await db.aiPlanVersion.count({ where: { clientId: clientA.id } })).toBe(1);
    expect(await db.aiPlanVersion.count({ where: { clientId: clientB.id } })).toBe(0);
  });
});
