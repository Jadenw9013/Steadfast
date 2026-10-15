import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: occupies the single ACTIVE live release and asserts table-wide on
// AiCoachReviewerGrant, so it runs alone. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("exclusive");
const authMock = vi.mocked(getCurrentDbUser);

import type { ArtifactDraftInput } from "@/lib/ai-coach/artifacts/schema";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { planPayloadSchema } from "@/lib/ai-coach/plan-contract";
import { validatedManagedPayload } from "@/lib/ai-coach/validated-plan";
import { policyBundleContentSchema } from "@/lib/ai-coach/artifacts/schema";
import {
  evaluateCurrentClientAutonomyGate,
  type ServerAutonomyGateInput,
} from "@/lib/ai-coach/autonomy/gate";
import {
  evaluateCurrentClientNutritionSafety,
  resolveNutritionSafetyPolicy,
} from "@/lib/ai-coach/nutrition-safety";
import { liveArtifactRequest } from "@/lib/ai-coach/runtime-binding";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { submitAiSession } from "@/lib/workouts/ai-session";
import { submitSafetyDisclosure } from "@/lib/ai-coach/safety";
import {
  activateTestLiveRelease,
  artifactReferenceOf,
  buildNonSyntheticLaunchTestArtifacts,
  createTestGovernanceActor,
  deactivateTestLiveRelease,
} from "../helpers/ai-live-launch";

const intake = {
  goal: "GENERAL_FITNESS" as const,
  experienceLevel: "NEW" as const,
  trainingDaysPerWeek: 3,
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
  heartCondition: "NO" as const,
  pregnantOrPostpartum: "NO" as const,
  recentInjuryOrSurgery: "NO" as const,
  ageEligibilityConcern: "NO" as const,
  eatingDisorderHistoryOrConcern: "NO" as const,
  type1Diabetes: "NO" as const,
};

const STRENGTH_ITEM_ID = "synthetic-exercise-item";
const CARDIO_ITEM_ID = "synthetic-exercise-item-cardio";

type ExerciseCatalogContent = {
  exercises: ({ id: string; name: string; modality: "STRENGTH" | "CARDIO" } & Record<
    string,
    unknown
  >)[];
};

/**
 * T-2040 — this suite's live artifact set.
 *
 * Unlike `ai-coach-live-autonomy.test.ts`, it deliberately does **not** reuse
 * the `t1008-runtime` alias, so its exercise catalog key is
 * `synthetic-exercise-<namespace>` — a key `lib/ai-coach/catalog/loader.ts`
 * does not serve. That is the whole point: this is the binding the in-code
 * loader cannot resolve, and the reviewed artifact is the authority for it.
 *
 * The catalog gains one extra exercise, cloned from the set's own
 * SYNTHETIC_TEST_ONLY strength item with only `id`, `name` and `modality`
 * changed, so the reviewed catalog can disagree with the slot a payload puts
 * an exercise in. Nothing here asserts a real source: every field is copied
 * from `buildSyntheticArtifactSet`'s synthetic fixture content, and it exists
 * only inside the disposable test database.
 */
function buildLiveCatalogArtifacts(namespace: string) {
  const base = buildNonSyntheticLaunchTestArtifacts(namespace);
  const exerciseLeaf = base.leaves.find((leaf) => leaf.kind === "EXERCISE_CATALOG")!;
  const content = structuredClone(exerciseLeaf.content) as unknown as ExerciseCatalogContent;
  const strengthItem = content.exercises.find((exercise) => exercise.id === STRENGTH_ITEM_ID)!;
  expect(strengthItem.modality).toBe("STRENGTH");
  content.exercises.push({
    ...structuredClone(strengthItem),
    id: CARDIO_ITEM_ID,
    name: "Synthetic test cardio exercise",
    modality: "CARDIO",
  });
  const customExercise: ArtifactDraftInput = {
    ...structuredClone(exerciseLeaf),
    content: content as unknown as ArtifactDraftInput["content"],
  };
  const leaves = base.leaves.map((leaf) =>
    leaf.kind === "EXERCISE_CATALOG" ? customExercise : leaf
  );
  const policy = structuredClone(base.policy);
  policy.dependencies = leaves.map(artifactReferenceOf);
  return { leaves, policy, references: [artifactReferenceOf(policy), ...policy.dependencies] };
}

suite("T-2040 — a plan bound to a catalog this build does not carry in code", () => {
  const artifacts = buildLiveCatalogArtifacts(`live-catalog-${randomUUID()}`);
  const exerciseKey = artifacts.leaves.find(
    (leaf) => leaf.kind === "EXERCISE_CATALOG"
  )!.artifactKey;
  const foodKey = artifacts.leaves.find((leaf) => leaf.kind === "FOOD_CATALOG")!.artifactKey;
  let actorId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
    vi.stubEnv("FEATURE_AI_COACH_ENROLLMENT", "true");
    vi.stubEnv("FEATURE_AI_COACH_PUBLICATION", "true");
    await db.aiPlanReviewerApproval.deleteMany();
    await db.aiCoachReviewerGrant.deleteMany();
    expect(await db.aiCoachReviewerGrant.count()).toBe(0);
    const actor = await createTestGovernanceActor(
      ["APPROVE_LIVE_LAUNCH", "ACTIVATE_LIVE_LAUNCH", "DEACTIVATE_LIVE_LAUNCH"],
      "T-2040-live-catalog"
    );
    actorId = actor.id;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    // Read the invariant, always tear the release down, then assert (T-2014).
    const reviewerGrants = await db.aiCoachReviewerGrant.count();
    await deactivateTestLiveRelease(actorId);
    expect(reviewerGrants).toBe(0);
  });

  afterAll(() => db.$disconnect());

  /** A non-synthetic, entitled, consented client under an ACTIVE live release
   * bound to the artifact set above. */
  async function liveClientFixture() {
    await activateTestLiveRelease({
      namespace: "live-catalog-binding",
      actorUserId: actorId,
      artifacts,
      packetSuffix: `live-catalog-${randomUUID()}`,
    });
    const id = randomUUID();
    const user = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true },
    });
    await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: user.id } });
    await db.aiCoachProfile.create({
      data: {
        clientId: user.id,
        isSynthetic: false,
        confirmedIntake: intake,
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
      },
    });
    await submitSafetyDisclosure(user.id, clearSafety);
    const context = await db.clientCoachingContext.findUniqueOrThrow({
      where: { clientId: user.id },
    });
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
    authMock.mockResolvedValue(user);
    return { user, context, profile };
  }

  function request() {
    return liveArtifactRequest("ai-coach-artifact-engine-v1", artifacts.references);
  }

  /** Training-only payload on the live catalog keys. Every clinical number is
   * seeded by this test, exactly as T-2000's `seedTrainingOnlyCandidate` does;
   * generation stamps nothing live until T-2041/T-2039. */
  function trainingOnlyPayload(
    overrides: {
      exerciseId?: string;
      exerciseCatalogVersion?: string;
      boundExerciseKey?: string;
    } = {}
  ) {
    return planPayloadSchema.parse({
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: null,
      meals: null,
      strength: [
        {
          sessionId: `session-${randomUUID()}`,
          templateId: `template-${randomUUID()}`,
          day: 1,
          exercises: [
            {
              exerciseId: overrides.exerciseId ?? STRENGTH_ITEM_ID,
              catalogVersion: overrides.exerciseCatalogVersion ?? exerciseKey,
              sets: 3,
              reps: 8,
              restSeconds: 90,
              effort: "RPE 7 — two reps in reserve",
            },
          ],
        },
      ],
      cardio: [],
      policyVersion: artifacts.policy.artifactKey,
      catalogVersions: {
        food: foodKey,
        exercise: overrides.boundExerciseKey ?? exerciseKey,
      },
    });
  }

  async function seedPlan(
    user: { id: string },
    context: { revision: number },
    profile: {
      profileRevision: number;
      observationRevision: number;
      safetyRevision: number;
      activePlanVersionId: string | null;
    },
    status: "PROPOSED" | "ACCEPTED",
    payload: ReturnType<typeof trainingOnlyPayload>
  ) {
    return db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: status === "ACCEPTED" ? 1 : 2,
        status,
        changeClass: "INITIAL",
        payload,
        payloadHash: contentHash(payload),
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        baseVersionId: null,
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        reviewerStatus: "NOT_REQUIRED",
        sourceRefs: [],
        acceptedAt: status === "ACCEPTED" ? new Date() : null,
        validationReport: { engine: "managed-v1", passed: true, inputHash: "b".repeat(64) },
      },
    });
  }

  function gateInput(candidatePlanVersionId: string): ServerAutonomyGateInput {
    const policy = policyBundleContentSchema.parse(artifacts.policy.content);
    return {
      requestedScopeClasses: ["GENERAL_FITNESS_PROGRAMMING"],
      requestedDomains: ["STRENGTH"],
      requiredInputs: policy.requiredInputIds.map((id) => ({ id, status: "CONFIRMED" as const })),
      evidence: policy.evidenceRuleIds.map((ruleId) => ({
        ruleId,
        status: "SUFFICIENT" as const,
        sourceRefs: [],
      })),
      candidatePlanVersionId,
    };
  }

  /** Records a PASS nutrition-safety decision, which the gate requires even for
   * a training-only candidate, and which is itself the `readNutritionHistory`
   * proof: that reader parses every accepted plan payload for this client and
   * turns a parse failure into UNVERIFIABLE -> a permanent HOLD. */
  async function recordNutritionSafety() {
    const policy = resolveNutritionSafetyPolicy(artifacts.policy.content);
    if (policy.resolutionStatus !== "RESOLVED") throw new Error("fixture safety policy changed");
    return evaluateCurrentClientNutritionSafety(request(), {
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
        projectedWeeklyWeightChangeKg: -0.5,
        provenance: "SYNTHETIC_SERVER_FIXTURE",
      },
    });
  }

  it("keeps the shared parser, the workspace and the session logger working (read paths 1-6)", async () => {
    const { user, context, profile } = await liveClientFixture();
    const payload = trainingOnlyPayload();
    const accepted = await seedPlan(user, context, profile, "ACCEPTED", payload);
    await db.aiCoachProfile.update({
      where: { clientId: user.id },
      data: { activePlanVersionId: accepted.id },
    });

    // 1. validated-plan.ts — the shared parser behind every read path below.
    const parsed = validatedManagedPayload(accepted);
    expect(parsed).not.toBeNull();
    expect(contentHash(parsed)).toBe(accepted.payloadHash);
    expect(parsed!.catalogVersions.exercise).toBe(exerciseKey);

    // 2 + 4. queries/ai-coach.ts activePayload and availableSubstitutions:
    // the client sees the plan degraded (no substitution offers), not blank.
    const workspace = await getAiWorkspace(user.id);
    expect(workspace.activePlan).not.toBeNull();
    expect(workspace.activePlan!.payload).not.toBeNull();
    expect(workspace.activePlan!.payload!.strength).toHaveLength(1);
    expect(workspace.substitutions).toEqual([]);

    // 5. workouts/ai-session.ts — the client can still log a set.
    const session = await submitAiSession(user.id, {
      requestKey: randomUUID(),
      expectedRevision: 0,
      planVersionId: accepted.id,
      prescriptionSessionId: payload.strength[0].sessionId,
      exerciseId: STRENGTH_ITEM_ID,
      sessionInstanceId: randomUUID(),
      clientEventId: randomUUID(),
      modality: "STRENGTH",
      setIndex: 1,
      resultStatus: "REPORTED_COMPLETE",
      reps: 8,
      loadValue: 0,
      loadUnit: null,
      loadKind: "BODYWEIGHT",
      durationMinutes: null,
      effortRating: 7,
      painReported: false,
      occurredAt: new Date().toISOString(),
    });
    expect(session).toMatchObject({ revision: 1 });
    expect(await db.aiWorkoutSession.count({ where: { clientId: user.id } })).toBe(1);

    // 6. nutrition-safety.ts readNutritionHistory — the accepted live-keyed
    // payload parses, so the history is verifiable and never HOLDs forever.
    const policy = resolveNutritionSafetyPolicy(artifacts.policy.content);
    if (policy.resolutionStatus !== "RESOLVED") throw new Error("fixture safety policy changed");
    const safety = await recordNutritionSafety();
    expect(safety.outcome).toBe("PASS");
    expect(safety.reasonCodes).not.toContain(policy.nutritionLimits.unverifiableHistoryReasonCode);
  });

  it("approves a live-keyed candidate automatically, with no reviewer grant (read path 7)", async () => {
    const { user, context, profile } = await liveClientFixture();
    await recordNutritionSafety();
    const candidate = await seedPlan(user, context, profile, "PROPOSED", trainingOnlyPayload());

    const result = await evaluateCurrentClientAutonomyGate(request(), gateInput(candidate.id));
    expect(result).toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
      orderedReasonCodes: ["GATE_APPROVED"],
      approvedCandidatePlanVersionId: candidate.id,
    });
    const row = await db.aiAutonomyGateDecision.findUniqueOrThrow({
      where: { id: result.decisionId },
    });
    expect(row).toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
      clientId: user.id,
      approvedPlanVersionId: candidate.id,
    });
  });

  it("fails closed on a mixed catalog set: the payload names a key the release does not bind", async () => {
    const { user, context, profile } = await liveClientFixture();
    await recordNutritionSafety();
    // `goblet-squat` on `exercise-fixture-v1` parses (that key IS served in
    // code), so this exercises `bindingsMatch`, not the parser.
    const candidate = await seedPlan(
      user,
      context,
      profile,
      "PROPOSED",
      trainingOnlyPayload({
        exerciseId: "goblet-squat",
        exerciseCatalogVersion: "exercise-fixture-v1",
        boundExerciseKey: "exercise-fixture-v1",
      })
    );

    const result = await evaluateCurrentClientAutonomyGate(request(), gateInput(candidate.id));
    expect(result.outcome).not.toBe("APPROVE_AUTOMATICALLY");
    expect(result.orderedReasonCodes).toContain("GATE_CANDIDATE_INVALID");
    expect(result.approvedCandidatePlanVersionId).toBeNull();
    expect(user.id).toBeTruthy();
  });

  it("fails closed when the reviewed catalog says the exercise is CARDIO and the plan puts it in a strength session", async () => {
    // The new guarantee. `planPayloadSchema` cannot check modality for this
    // key (it does not carry the catalog), so `catalogItemsValid` in
    // autonomy/gate.ts is the only thing standing between a cardio movement
    // and a strength prescription. Deleting either assertion there makes this
    // test APPROVE_AUTOMATICALLY.
    const { user, context, profile } = await liveClientFixture();
    await recordNutritionSafety();
    const payload = trainingOnlyPayload({ exerciseId: CARDIO_ITEM_ID });
    // It parses: the in-code loader does not serve this catalog key.
    expect(
      validatedManagedPayload({
        payload,
        payloadHash: contentHash(payload),
        validationReport: { engine: "managed-v1", passed: true, inputHash: "b".repeat(64) },
      })
    ).not.toBeNull();
    const candidate = await seedPlan(user, context, profile, "PROPOSED", payload);

    const result = await evaluateCurrentClientAutonomyGate(request(), gateInput(candidate.id));
    expect(result.outcome).not.toBe("APPROVE_AUTOMATICALLY");
    expect(result.orderedReasonCodes).toContain("GATE_CANDIDATE_INVALID");
    expect(result.approvedCandidatePlanVersionId).toBeNull();
  });
});
