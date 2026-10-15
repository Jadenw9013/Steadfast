import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import {
  evaluateCurrentClientNutritionSafety,
  resolveNutritionSafetyPolicy,
  type NutritionSafetyEvaluationInput,
} from "@/lib/ai-coach/nutrition-safety";
import {
  publishArtifactVersion,
  registerArtifactVersion,
  revokeArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";

vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");
const getCurrentDbUserMock = vi.mocked(getCurrentDbUser);

suite("T-1003 — PostgreSQL-backed synthetic nutrition safety gate", () => {
  afterAll(() => db.$disconnect());

  async function account(isSynthetic = true) {
    const id = randomUUID();
    const user = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true },
    });
    await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic } });
    getCurrentDbUserMock.mockResolvedValue(user);
    return user;
  }

  async function publishedArtifacts(label: string) {
    const set = buildSyntheticArtifactSet(`${label}-${randomUUID()}`);
    const effectiveAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 3_600_000);
    for (const artifact of [
      set.foodCatalog,
      set.exerciseCatalog,
      set.evidenceRegistry,
      set.escalationTemplates,
    ]) {
      await registerArtifactVersion(artifact);
      await publishArtifactVersion({
        id: artifact.id,
        effectiveAt,
        expiresAt,
        engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      });
    }
    await registerArtifactVersion(set.policyBundle);
    await publishArtifactVersion({
      id: set.policyBundle.id,
      effectiveAt,
      expiresAt,
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });
    return set;
  }

  function request(policyArtifactKey: string) {
    return {
      policyArtifactKey,
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    };
  }

  function clearInput(
    set: Awaited<ReturnType<typeof publishedArtifacts>>
  ): NutritionSafetyEvaluationInput {
    const policy = resolveNutritionSafetyPolicy(set.policyBundle.content);
    if (policy.resolutionStatus !== "RESOLVED") throw new Error("fixture safety policy changed");
    return {
      screening: {
        instrumentId: policy.screening.instrumentId,
        result: "CLEAR",
        provenance: "SYNTHETIC_SERVER_FIXTURE",
      },
      contraindications: {
        AGE_ELIGIBILITY: "CLEAR",
        PREGNANCY_POSTPARTUM: "CLEAR",
        EATING_DISORDER_HISTORY_OR_CONCERN: "CLEAR",
        TYPE_1_DIABETES: "CLEAR",
        CARDIAC_CONDITION: "CLEAR",
      },
      proposal: {
        proposedDailyEnergyKcal: policy.nutritionLimits.minimumDailyEnergyKcal + 500,
        currentWeightKg: 70,
        projectedWeeklyWeightChangeKg: -1,
        provenance: "SYNTHETIC_SERVER_FIXTURE",
      },
    };
  }

  it("persists a digest-bound PASS for the authenticated synthetic account only", async () => {
    const user = await account();
    const set = await publishedArtifacts("pass");
    const result = await evaluateCurrentClientNutritionSafety(
      request(set.policyKey),
      clearInput(set)
    );
    expect(result).toMatchObject({ outcome: "PASS", reasonCodes: [] });
    const row = await db.aiNutritionSafetyDecision.findUniqueOrThrow({
      where: { id: result.decisionId },
    });
    expect(row).toMatchObject({
      clientId: user.id,
      policyArtifactId: set.policyBundle.id,
      outcome: "PASS",
    });
    expect(row.policyArtifactDigest).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      db.aiNutritionSafetyDecision.update({
        where: { id: row.id },
        data: { reasonCodes: ["MODEL_REPLACEMENT"] },
      })
    ).rejects.toThrow("append-only");
  });

  it("persists deterministic PAUSE_REFER and HOLD outcomes", async () => {
    const user = await account();
    const set = await publishedArtifacts("outcomes");
    const flagged = clearInput(set);
    flagged.screening.result = "FLAGGED";
    await expect(
      evaluateCurrentClientNutritionSafety(request(set.policyKey), flagged)
    ).resolves.toMatchObject({ outcome: "PAUSE_REFER" });

    const policy = resolveNutritionSafetyPolicy(set.policyBundle.content);
    if (policy.resolutionStatus !== "RESOLVED") throw new Error("fixture safety policy changed");
    const belowFloor = clearInput(set);
    belowFloor.proposal!.proposedDailyEnergyKcal =
      policy.nutritionLimits.minimumDailyEnergyKcal - 1;
    await expect(
      evaluateCurrentClientNutritionSafety(request(set.policyKey), belowFloor)
    ).resolves.toMatchObject({
      outcome: "HOLD",
      reasonCodes: expect.arrayContaining([policy.nutritionLimits.minimumDailyEnergyReasonCode]),
    });
    expect(
      await db.aiNutritionSafetyDecision.groupBy({
        by: ["outcome"],
        where: { clientId: user.id },
        _count: { _all: true },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: "PAUSE_REFER" }),
        expect.objectContaining({ outcome: "HOLD" }),
      ])
    );
  });

  it("derives a consecutive deficit from persisted accepted plan history", async () => {
    const user = await account();
    const set = await publishedArtifacts("consecutive");
    const intake = {
      goal: "BODY_COMPOSITION" as const,
      experienceLevel: "NEW" as const,
      trainingDaysPerWeek: 2,
      equipmentAccess: ["NONE"],
      allergies: [],
      dietaryRestrictions: [],
      foodBudgetLevel: "LOW" as const,
      trackingPreference: "NUMBERS_VISIBLE" as const,
      unitsPreference: "METRIC" as const,
      heightCm: 170,
      weightKg: 70,
    };
    const initial = buildInitialFixturePlan(intake, "t1003-initial", "MEALS").payload;
    const reduced = structuredClone(initial);
    reduced.nutrition!.targets.energyKcal -= 100;
    const first = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "SUPERSEDED",
        changeClass: "INITIAL",
        acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
        payload: initial,
        payloadHash: contentHash(initial),
        policyVersion: initial.policyVersion,
        catalogVersions: initial.catalogVersions,
        contextRevision: 0,
        profileRevision: 0,
        observationRevision: 0,
        safetyRevision: 0,
      },
    });
    const second = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 2,
        baseVersionId: first.id,
        status: "ACCEPTED",
        changeClass: "ROUTINE",
        acceptedAt: new Date("2026-02-01T00:00:00.000Z"),
        payload: reduced,
        payloadHash: contentHash(reduced),
        policyVersion: reduced.policyVersion,
        catalogVersions: reduced.catalogVersions,
        contextRevision: 0,
        profileRevision: 0,
        observationRevision: 0,
        safetyRevision: 0,
      },
    });
    await db.aiCoachProfile.update({
      where: { clientId: user.id },
      data: { activePlanVersionId: second.id },
    });
    const input = clearInput(set);
    input.proposal!.proposedDailyEnergyKcal = reduced.nutrition!.targets.energyKcal - 100;
    const policy = resolveNutritionSafetyPolicy(set.policyBundle.content);
    if (policy.resolutionStatus !== "RESOLVED") throw new Error("fixture safety policy changed");
    await expect(
      evaluateCurrentClientNutritionSafety(request(set.policyKey), input)
    ).resolves.toMatchObject({
      outcome: "HOLD",
      reasonCodes: expect.arrayContaining([policy.nutritionLimits.noConsecutiveDeficitReasonCode]),
    });
  });

  it("never lets a real account select synthetic artifacts", async () => {
    const realAccount = await account(false);
    const set = await publishedArtifacts("real-account");
    await expect(
      evaluateCurrentClientNutritionSafety(request(set.policyKey), clearInput(set))
    ).rejects.toMatchObject({ code: "SYNTHETIC_ARTIFACT_FORBIDDEN" });
    expect(await db.aiNutritionSafetyDecision.count({ where: { clientId: realAccount.id } })).toBe(
      0
    );
  });

  it("fails closed if the reviewed policy is revoked before evaluation", async () => {
    const user = await account();
    const set = await publishedArtifacts("revoked");
    await revokeArtifactVersion(set.policyBundle.id, "Synthetic T-1003 revocation test");
    await expect(
      evaluateCurrentClientNutritionSafety(request(set.policyKey), clearInput(set))
    ).rejects.toMatchObject({ code: "ARTIFACT_REVOKED" });
    expect(await db.aiNutritionSafetyDecision.count({ where: { clientId: user.id } })).toBe(0);
  });
});
