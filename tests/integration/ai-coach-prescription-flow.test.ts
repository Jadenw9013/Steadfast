import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import {
  evaluateCurrentClientNutritionSafety,
  resolveNutritionSafetyPolicy,
  type NutritionSafetyEvaluationInput,
} from "@/lib/ai-coach/nutrition-safety";
import {
  evaluateCurrentClientAutonomyGate,
  type ServerAutonomyGateInput,
} from "@/lib/ai-coach/autonomy/gate";
import {
  escalationTemplatesContentSchema,
  policyBundleContentSchema,
} from "@/lib/ai-coach/artifacts/schema";
import { confirmIntake } from "@/lib/ai-coach/intake";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { planPayloadSchema, type PlanPayload } from "@/lib/ai-coach/plan-contract";
import { finalizeCurrentClientPlan } from "@/lib/ai-coach/finalization";
import { acceptPlanVersionAtomic, type AcceptPlanVersionInput } from "@/lib/ai-coach/plan-acceptance";
import { requestAiRun } from "@/lib/ai-coach/run-command";
import { claimQueuedRun } from "@/lib/ai-coach/runs";
import { processClaimedRun } from "@/lib/ai-coach/executor";
import { SyntheticFixtureProvider } from "@/lib/ai-coach/provider/synthetic-provider";
import { submitSafetyDisclosure } from "@/lib/ai-coach/safety";

vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");
const authMock = vi.mocked(getCurrentDbUser);

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

/** A well-formed, `intakeAnswersSchema`-valid v2 confirmed intake, shaped
 * like what `confirmIntake()` actually persists (see
 * tests/helpers/ai-intake-v2.ts). */
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

/** The same client, expressed in the *write* schema `confirmIntake` accepts
 * (`intakeV2ConfirmSchema`, `.strict()`): it derives `allergies`/
 * `dietaryRestrictions` and stamps `capturedAt` itself, so those three are
 * not supplied here. Every CONFIRMED status carries its jointly-required
 * fields (`weightNeutralAccepted` with the goal, `sessionLengthBand` with the
 * training context). */
function v2ConfirmAnswers(overrides: Record<string, unknown> = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    intakeVersion: 2,
    experienceLevel: "NEW",
    trainingDaysPerWeek: 3,
    equipmentAccess: ["NONE"],
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
    cookingAccessStatus: "UNKNOWN",
    dislikes: [],
    cuisinePreferences: [],
    allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
    weightNeutralAccepted: false,
    sessionLengthBand: "MIN_30_45",
    goal: "BODY_COMPOSITION",
    foodBudgetLevel: "MODERATE",
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

suite("T-2033 — prescription-first composer, end to end (PostgreSQL-backed)", () => {
  beforeEach(() => {
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
    vi.stubEnv("FEATURE_AI_COACH_PUBLICATION", "true");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => db.$disconnect());

  /** Same "t1008-runtime" namespace `ai-coach-end-to-end-governance.test.ts`
   * / `ai-coach-managed-executor.test.ts` use — the FIXTURE-mode runtime
   * binding's `syntheticRuntimeArtifactRequest()` always resolves to this
   * exact policy key (`ACTIVE_POLICY_VERSION`, "policy-fixture-v1"), and
   * that variant of `buildSyntheticArtifactSet` is the one carrying the 75
   * prescription parameters plus the reviewed real-food catalog items
   * (chicken/rice/broccoli). Idempotent: registers/publishes once per test
   * database, like the existing suites.
   */
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
      const current = await db.aiCoachArtifactVersion.findUniqueOrThrow({ where: { id: artifact.id } });
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

  async function v2ClientFixture(intakeOverrides: Record<string, unknown> = {}) {
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
        isSynthetic: true,
        confirmedIntake: v2Intake(intakeOverrides),
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
      },
    });
    await submitSafetyDisclosure(user.id, clearSafety);
    authMock.mockResolvedValue(user);
    return user;
  }

  async function runToCompletion(userId: string, representation: "MACROS" | "MEALS" = "MACROS") {
    const { runId } = await requestAiRun(userId, {
      requestKey: randomUUID(),
      kind: "INITIAL",
      representation,
      expectedContextRevision: 0,
      expectedProfileRevision: 0,
    });
    const claim = await claimQueuedRun(runId);
    if (!claim.claimed) throw new Error("fixture claim failed");
    const outcome = await processClaimedRun(claim, new SyntheticFixtureProvider());
    expect(outcome).toBe("completed");
    const run = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } });
    if (!run.resultPlanVersionId) throw new Error("run completed with no plan version");
    return db.aiPlanVersion.findUniqueOrThrow({ where: { id: run.resultPlanVersionId } });
  }

  it("end-to-end: v2 intake -> generate -> finalize -> accept produces a REVIEWED_PRESCRIPTION_V1 candidate whose energy target and non-null projected rate reach the safety decision and the gate", async () => {
    const user = await v2ClientFixture();
    const candidate = await runToCompletion(user.id, "MACROS");
    const payload = planPayloadSchema.parse(candidate.payload);
    expect(payload.nutrition?.method).toBe("REVIEWED_PRESCRIPTION_V1");
    expect(payload.prescriptionOutcome).toMatchObject({ status: "PRESCRIBED" });
    expect(payload.nutrition?.targets.energyKcal).toBeGreaterThan(0);

    const result = await finalizeCurrentClientPlan(candidate.id);
    expect(result).toMatchObject({ outcome: "APPROVE_AUTOMATICALLY" });

    const decision = await db.aiNutritionSafetyDecision.findFirstOrThrow({
      where: { clientId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const decisionInput = decision.inputSnapshot as unknown as NutritionSafetyEvaluationInput;
    // gate.ts:428-432's energyMatchesSafety link — the value the gate/safety
    // layer verified against is the exact number on the accepted payload.
    expect(decisionInput.proposal?.proposedDailyEnergyKcal).toBe(payload.nutrition?.targets.energyKcal);
    // T-2000's hard-coded `null` is now the engine's real, non-null number —
    // for LOSE/GRADUAL at this body it is strictly negative (a real deficit,
    // not the old neutral fixture zero).
    expect(decisionInput.proposal?.projectedWeeklyWeightChangeKg).not.toBeNull();
    expect(decisionInput.proposal!.projectedWeeklyWeightChangeKg).toBeLessThan(0);

    const acceptInput: AcceptPlanVersionInput = {
      requestKey: randomUUID(),
      expectedBaseVersionId: null,
      expectedContextRevision: candidate.contextRevision,
      expectedProfileRevision: candidate.profileRevision,
      expectedObservationRevision: candidate.observationRevision,
      expectedSafetyRevision: candidate.safetyRevision,
    };
    await expect(acceptPlanVersionAtomic(user.id, candidate.id, acceptInput)).resolves.toMatchObject({
      success: true,
      activeVersionId: candidate.id,
    });
  });

  it("nutrition required but unavailable: LOSE intake with a DECLINED population category produces nutrition:null, prescriptionOutcome.required:true, and the gate FOCUSED_CLARIFICATIONs (never APPROVE_AUTOMATICALLY)", async () => {
    const user = await v2ClientFixture({ energyMethodPopulationCategoryStatus: "DECLINED" });
    const candidate = await runToCompletion(user.id, "MACROS");
    const payload = planPayloadSchema.parse(candidate.payload);
    expect(payload.nutrition).toBeNull();
    expect(payload.prescriptionOutcome).toMatchObject({ status: "UNAVAILABLE", nutritionRequired: true });
    expect(payload.prescriptionOutcome?.reasonCodes).toContain("PRESCRIPTION_INPUT_MISSING");

    const result = await finalizeCurrentClientPlan(candidate.id);
    expect(result.outcome).toBe("FOCUSED_CLARIFICATION");
    expect(result).not.toMatchObject({ outcome: "APPROVE_AUTOMATICALLY" });
    if ("reasonCodes" in result) {
      expect(result.reasonCodes).toEqual(
        expect.arrayContaining(["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", "PRESCRIPTION_INPUT_MISSING"])
      );
    }
  });

  // -------------------------------------------------------------------------
  // Review r1 MAJOR 1 / MINOR 7 — finalization replays the engine against the
  // *live* intake at *today's* date. Neither an intake edit nor a weigh-in
  // ageing is a change to the reviewed policy, and Amendment 1 §A1.5 exists so
  // an ordinary unrelated change does not 422 an outstanding proposal.
  // -------------------------------------------------------------------------

  it("MAJOR 1: a re-confirmed intake (new weigh-in) between generate and finalize is a graceful HOLD naming the inputs, never the 422 'no longer matches the reviewed policy'", async () => {
    const user = await v2ClientFixture();
    const candidate = await runToCompletion(user.id, "MACROS");
    const payload = planPayloadSchema.parse(candidate.payload);
    expect(payload.nutrition?.method).toBe("REVIEWED_PRESCRIPTION_V1");

    // Exactly the review's scenario: the client re-confirms intake with a new
    // weigh-in while the proposal is on screen. `confirmIntake` overwrites
    // `confirmedIntake` and bumps `profileRevision`; it does not supersede the
    // outstanding PROPOSED row.
    const confirmed = await confirmIntake(user.id, v2ConfirmAnswers({ weightKg: 88 }));
    expect(confirmed).toMatchObject({ success: true });
    const reloaded = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
    expect(reloaded.profileRevision).not.toBe(candidate.profileRevision);
    expect((reloaded.confirmedIntake as { weightKg: number }).weightKg).toBe(88);

    const result = await finalizeCurrentClientPlan(candidate.id);
    expect(result.outcome).toBe("HOLD");
    expect("reasonCodes" in result ? result.reasonCodes : []).toEqual([
      "PRESCRIPTION_CANDIDATE_INPUTS_CHANGED",
    ]);
  });

  it("MINOR 7: a weight measurement that ages past MAX_AGE_DAYS between generate and finalize reports the aged input, not PRESCRIPTION_PARAMETER_SET_CHANGED", async () => {
    const user = await v2ClientFixture();
    const candidate = await runToCompletion(user.id, "MACROS");

    // The clock moving forward past ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS
    // and the measurement date moving equally far back are the same input to
    // the engine (`daysBetween(weightMeasuredOn, evaluatedOn)`), and the
    // date-shift form leaves the artifact effective window alone. Written
    // without a `profileRevision` bump on purpose: this is the equal-revision
    // case, where the *only* thing that changed is elapsed time.
    await db.aiCoachProfile.update({
      where: { clientId: user.id },
      data: { confirmedIntake: v2Intake({ weightMeasuredOn: "2020-01-01" }) },
    });
    const unchanged = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
    expect(unchanged.profileRevision).toBe(candidate.profileRevision);

    const result = await finalizeCurrentClientPlan(candidate.id);
    expect(result.outcome).toBe("HOLD");
    const reasonCodes = "reasonCodes" in result ? result.reasonCodes : [];
    expect(reasonCodes).toEqual([
      "PRESCRIPTION_CANDIDATE_INPUTS_NOT_REPRODUCIBLE",
      "PRESCRIPTION_WEIGHT_MEASUREMENT_STALE",
    ]);
    expect(reasonCodes).not.toContain("PRESCRIPTION_PARAMETER_SET_CHANGED");
  });

  it("MAJOR 2: a reason code no reviewed escalation template declares still resolves a template — the gate writes a HOLD decision row instead of throwing ARTIFACT_INCOMPATIBLE (503, no row)", async () => {
    const user = await v2ClientFixture();
    const set = await ensureRuntimeArtifacts();
    const request = { policyArtifactKey: set.policyKey, engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION };
    // A code this bundle has no obligation to declare: a future
    // PrescriptionReasonCode, or a row written by a newer deploy. The
    // synthetic ESCALATION_TEMPLATES artifact declares the 15 codes that
    // exist today and nothing else.
    const unknownReasonCode = "PRESCRIPTION_FUTURE_CODE_NOT_IN_BUNDLE";
    const escalation = escalationTemplatesContentSchema.parse(set.escalationTemplates.content);
    expect(escalation.templates.flatMap((template) => template.reasonCodes)).not.toContain(
      unknownReasonCode
    );

    const payload = planPayloadSchema.parse({
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: null,
      meals: null,
      strength: [],
      cardio: [],
      policyVersion: set.policyBundle.artifactKey,
      catalogVersions: { food: set.foodCatalog.artifactKey, exercise: set.exerciseCatalog.artifactKey },
      prescriptionOutcome: {
        status: "UNAVAILABLE",
        reasonCodes: [unknownReasonCode],
        nutritionRequired: true,
        parameterSetDigest: null,
      },
    });
    const plan = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "PROPOSED",
        changeClass: "INITIAL",
        payload,
        payloadHash: contentHash(payload),
        contextRevision: 0,
        profileRevision: 0,
        observationRevision: 0,
        safetyRevision: 0,
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        reviewerStatus: "NOT_REQUIRED",
        sourceRefs: [],
        validationReport: { engine: "managed-v1", passed: true, inputHash: contentHash({ fixture: "t2033-unknown-code" }) },
      },
    });
    const policyContent = policyBundleContentSchema.parse(set.policyBundle.content);
    const gateInput: ServerAutonomyGateInput = {
      requestedScopeClasses: ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
      requestedDomains: ["NUTRITION"],
      requiredInputs: policyContent.requiredInputIds.map((id) => ({ id, status: "CONFIRMED" })),
      evidence: policyContent.evidenceRuleIds.map((ruleId) => ({ ruleId, status: "SUFFICIENT", sourceRefs: [] })),
      candidatePlanVersionId: plan.id,
    };
    const result = await evaluateCurrentClientAutonomyGate(request, gateInput);
    // outcomeFor's documented unknown-code-is-a-HOLD, all the way through to a
    // persisted decision row with a reviewed next-action template.
    expect(result.outcome).toBe("HOLD");
    expect(result.orderedReasonCodes).toEqual(
      expect.arrayContaining(["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", unknownReasonCode])
    );
    const row = await db.aiAutonomyGateDecision.findFirstOrThrow({
      where: { clientId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(row.outcome).toBe("HOLD");
    expect(row.nextActionTemplateId).toBeTruthy();
  });

  // MAJOR 2(b) — `loadLiveArtifactSetForLaunchValidation` now asserts that a
  // packet's reviewed escalation templates declare
  // GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE and all 14 PrescriptionReasonCodes
  // (artifacts/repository.ts). It is deliberately NOT covered by a test here:
  // reaching that assertion requires a *non-synthetic* packet, and
  // `parseArtifactDraftInput` (artifacts/schema.ts) only accepts one whose
  // reviewMetadata carries `jurisdictionReview.legalReviewStatus: "APPROVED"`.
  // Fabricating an approved legal review over synthetic content is exactly
  // what the G01-G09 gates forbid, so the assertion is left to the first real
  // live packet (which is a human gate) rather than proven with invented
  // reviewer metadata. Every synthetic path is unaffected: the validator
  // rejects synthetic artifacts (SYNTHETIC_ARTIFACT_FORBIDDEN) before it.

  it("regression, historical rows: a pre-existing SYNTHETIC_CATALOG_MATCH candidate with no prescriptionOutcome still parses, finalizes and reaches APPROVE_AUTOMATICALLY exactly as before", async () => {
    const user = await v2ClientFixture();
    // A v1-shaped intake also satisfies buildInitialFixturePlan; simulate a
    // row written before this ticket by deleting the additive field
    // composeLegacySyntheticPlan now always sets.
    const legacyPayload = buildInitialFixturePlan(
      {
        goal: "GENERAL_FITNESS",
        experienceLevel: "NEW",
        trainingDaysPerWeek: 3,
        equipmentAccess: ["NONE"],
        dietaryRestrictions: [],
        allergies: [],
        foodBudgetLevel: "LOW",
        trackingPreference: "NUMBERS_VISIBLE",
        unitsPreference: "METRIC",
        heightCm: 170,
        weightKg: 70,
      },
      "historical-rx",
      "MEALS"
    ).payload as unknown as Record<string, unknown>;
    delete legacyPayload.prescriptionOutcome;
    const payload = legacyPayload as unknown as PlanPayload;
    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId: user.id } });
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
    const candidate = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        payload,
        payloadHash: contentHash(payload),
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        changeClass: "INITIAL",
        reviewerStatus: "PENDING",
        validationReport: { engine: "managed-v1", passed: true, inputHash: "a".repeat(64) },
        sourceRefs: [],
      },
    });
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
  });

  it("a second consecutive calorie reduction on REVIEWED_PRESCRIPTION_V1 history -> HOLD noConsecutiveDeficitReasonCode, proving readNutritionHistory parses the widened method enum", async () => {
    const user = await v2ClientFixture();
    const set = await ensureRuntimeArtifacts();
    const request = { policyArtifactKey: set.policyKey, engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION };

    function prescribedPayload(energyKcal: number): PlanPayload {
      return planPayloadSchema.parse({
        schemaVersion: 1,
        contentKind: "SYNTHETIC_FIXTURE",
        nutrition: {
          prescriptionId: `rx-${randomUUID()}`,
          method: "REVIEWED_PRESCRIPTION_V1",
          targets: { energyKcal, proteinG: 80, carbsG: 200, fatG: 50 },
          tolerancePercent: 10,
          assumptions: ["Synthetic T-2033 fixture only."],
        },
        meals: null,
        strength: [],
        cardio: [],
        policyVersion: set.policyBundle.artifactKey,
        catalogVersions: { food: set.foodCatalog.artifactKey, exercise: set.exerciseCatalog.artifactKey },
        prescriptionOutcome: {
          status: "PRESCRIBED",
          reasonCodes: [],
          nutritionRequired: true,
          parameterSetDigest: "0".repeat(64),
        },
      });
    }

    const first = prescribedPayload(2500);
    const firstRow = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "SUPERSEDED",
        changeClass: "INITIAL",
        acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
        payload: first,
        payloadHash: contentHash(first),
        policyVersion: first.policyVersion,
        catalogVersions: first.catalogVersions,
        contextRevision: 0,
        profileRevision: 0,
        observationRevision: 0,
        safetyRevision: 0,
      },
    });
    const second = prescribedPayload(2300);
    await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 2,
        baseVersionId: firstRow.id,
        status: "ACCEPTED",
        changeClass: "ROUTINE",
        acceptedAt: new Date("2026-02-01T00:00:00.000Z"),
        payload: second,
        payloadHash: contentHash(second),
        policyVersion: second.policyVersion,
        catalogVersions: second.catalogVersions,
        contextRevision: 0,
        profileRevision: 0,
        observationRevision: 0,
        safetyRevision: 0,
      },
    });
    const policy = resolveNutritionSafetyPolicy(set.policyBundle.content);
    const input: NutritionSafetyEvaluationInput = {
      screening: { instrumentId: policy.screening.instrumentId, result: "CLEAR", provenance: "SYNTHETIC_SERVER_FIXTURE" },
      contraindications: {
        AGE_ELIGIBILITY: "CLEAR",
        PREGNANCY_POSTPARTUM: "CLEAR",
        EATING_DISORDER_HISTORY_OR_CONCERN: "CLEAR",
        TYPE_1_DIABETES: "CLEAR",
        CARDIAC_CONDITION: "CLEAR",
      },
      proposal: {
        proposedDailyEnergyKcal: 2100,
        currentWeightKg: 80,
        projectedWeeklyWeightChangeKg: -0.5,
        provenance: "SYNTHETIC_SERVER_FIXTURE",
      },
    };
    await expect(evaluateCurrentClientNutritionSafety(request, input)).resolves.toMatchObject({
      outcome: "HOLD",
      reasonCodes: expect.arrayContaining([policy.nutritionLimits.noConsecutiveDeficitReasonCode]),
    });
  });

  it("floor breach: a hand-built REVIEWED_PRESCRIPTION_V1 candidate below SYNTHETIC_MINIMUM_DAILY_ENERGY -> evaluateNutritionSafety HOLD (minimumDailyEnergyReasonCode) AND the gate GATE_NUTRITION_SAFETY_HOLD — the engine itself never produces this value (it clamps; see ai-coach-prescription.test.ts's floor vectors), so both layers are proven independently here", async () => {
    const user = await v2ClientFixture();
    const set = await ensureRuntimeArtifacts();
    const request = { policyArtifactKey: set.policyKey, engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION };
    const policy = resolveNutritionSafetyPolicy(set.policyBundle.content);
    const belowFloor = policy.nutritionLimits.minimumDailyEnergyKcal - 1;

    const input: NutritionSafetyEvaluationInput = {
      screening: { instrumentId: policy.screening.instrumentId, result: "CLEAR", provenance: "SYNTHETIC_SERVER_FIXTURE" },
      contraindications: {
        AGE_ELIGIBILITY: "CLEAR",
        PREGNANCY_POSTPARTUM: "CLEAR",
        EATING_DISORDER_HISTORY_OR_CONCERN: "CLEAR",
        TYPE_1_DIABETES: "CLEAR",
        CARDIAC_CONDITION: "CLEAR",
      },
      proposal: {
        proposedDailyEnergyKcal: belowFloor,
        currentWeightKg: 80,
        projectedWeeklyWeightChangeKg: -2,
        provenance: "SYNTHETIC_SERVER_FIXTURE",
      },
    };
    // Layer 1: evaluateNutritionSafety / evaluateCurrentClientNutritionSafety.
    await expect(evaluateCurrentClientNutritionSafety(request, input)).resolves.toMatchObject({
      outcome: "HOLD",
      reasonCodes: expect.arrayContaining([policy.nutritionLimits.minimumDailyEnergyReasonCode]),
    });

    // Layer 2: the gate, via a hand-built REVIEWED_PRESCRIPTION_V1 candidate
    // carrying the same below-floor number (never producible by the real
    // engine, which clamps to the floor — this simulates "what if a bad
    // number reached storage some other way").
    const payload = planPayloadSchema.parse({
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: {
        prescriptionId: `rx-${randomUUID()}`,
        method: "REVIEWED_PRESCRIPTION_V1",
        targets: { energyKcal: belowFloor, proteinG: 80, carbsG: 200, fatG: 50 },
        tolerancePercent: 10,
        assumptions: ["Synthetic T-2033 fixture only."],
      },
      meals: null,
      strength: [],
      cardio: [],
      policyVersion: set.policyBundle.artifactKey,
      catalogVersions: { food: set.foodCatalog.artifactKey, exercise: set.exerciseCatalog.artifactKey },
      prescriptionOutcome: {
        status: "PRESCRIBED",
        reasonCodes: [],
        nutritionRequired: true,
        parameterSetDigest: "0".repeat(64),
      },
    });
    const plan = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "PROPOSED",
        changeClass: "INITIAL",
        payload,
        payloadHash: contentHash(payload),
        contextRevision: 0,
        profileRevision: 0,
        observationRevision: 0,
        safetyRevision: 0,
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        reviewerStatus: "NOT_REQUIRED",
        sourceRefs: [],
        validationReport: { engine: "managed-v1", passed: true, inputHash: contentHash({ fixture: "t2033-floor" }) },
      },
    });
    const policyContent = policyBundleContentSchema.parse(set.policyBundle.content);
    const gateInput: ServerAutonomyGateInput = {
      requestedScopeClasses: ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
      requestedDomains: ["NUTRITION"],
      requiredInputs: policyContent.requiredInputIds.map((id) => ({ id, status: "CONFIRMED" })),
      evidence: policyContent.evidenceRuleIds.map((ruleId) => ({ ruleId, status: "SUFFICIENT", sourceRefs: [] })),
      candidatePlanVersionId: plan.id,
    };
    const result = await evaluateCurrentClientAutonomyGate(request, gateInput);
    expect(result.outcome).toBe("HOLD");
    expect(result.orderedReasonCodes).toContain("GATE_NUTRITION_SAFETY_HOLD");
  });
});
