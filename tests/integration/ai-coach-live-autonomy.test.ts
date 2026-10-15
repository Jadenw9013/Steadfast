import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: table-wide AI Coach state; runs alone. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("exclusive");
const authMock = vi.mocked(getCurrentDbUser);

import type { ArtifactDraftInput } from "@/lib/ai-coach/artifacts/schema";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { finalizeCurrentClientPlan } from "@/lib/ai-coach/finalization";
import {
  acceptPlanVersionAtomic,
  type AcceptPlanVersionInput,
} from "@/lib/ai-coach/plan-acceptance";
import { planPayloadSchema } from "@/lib/ai-coach/plan-contract";
import { requestAiRun } from "@/lib/ai-coach/run-command";
import { retryManagedRun } from "@/lib/ai-coach/retry-command";
import { applyAiClientCommand } from "@/lib/ai-coach/client-commands";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { submitSafetyDisclosure } from "@/lib/ai-coach/safety";
import { claimQueuedRun } from "@/lib/ai-coach/runs";
import { processManagedRun } from "@/lib/ai-coach/managed-executor";
import { SyntheticFixtureProvider } from "@/lib/ai-coach/provider/synthetic-provider";
import {
  activateTestLiveRelease,
  artifactReferenceOf,
  buildLiveTrainingArtifacts,
  buildNonSyntheticLaunchTestArtifacts,
  createTestGovernanceActor,
  deactivateTestLiveRelease,
  ensureLiveTrainingExerciseCatalogPublished,
  stubApprovedLiveProviderTransport,
} from "../helpers/ai-live-launch";

// S-24: this v1 GENERAL_FITNESS intake reaches APPROVE_AUTOMATICALLY through the
// legacy synthetic composer (composeLegacySyntheticPlan), which stamps
// prescriptionOutcome.status: "PRESCRIBED" whenever height/weight are present --
// independent of bodyWeightIntent/nutritionRequiredForGoal (v1 intake has no
// bodyWeightIntent at all). Do not read this approval as evidence that the gate
// waives prescription availability for a MAINTAIN/NO_PREFERENCE goal: 9fb5513
// (S-15 finding 2) made autonomy/gate.ts's `!facts.prescription.available` check
// fire regardless of `required`, specifically so a MAINTAIN v2 client with an
// unavailable prescription still escalates instead of silently approving -- see
// ai-coach-prescription-flow.test.ts's MAINTAIN/DECLINED-population test. If a
// MAINTAIN client stops at FOCUSED_CLARIFICATION elsewhere, that is the fix
// working; do not widen the gate check to make it match this fixture.
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
  heightCm: 175,
  weightKg: 80,
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
 * T-2000 review finding 1: a policy bundle whose required-input and
 * evidence-rule ids are genuinely non-synthetic — NOT the "t1008-runtime"
 * synthetic set with `synthetic` flipped to `false`, which is what every
 * other fixture in this file (deliberately, per finding 7) reuses. This is
 * the fixture that proves the server fails closed on an id it cannot
 * verify, instead of the synthetic fixture happening to only ever declare
 * ids the code already recognizes.
 */
function buildLiveArtifactsWithRealBundleIds(namespace: string, exerciseLeaf: ArtifactDraftInput) {
  const base = buildNonSyntheticLaunchTestArtifacts(namespace);
  const policy = structuredClone(base.policy);
  const content = policy.content as unknown as {
    requiredInputIds: string[];
    evidenceRuleIds: string[];
    ruleIds: string[];
    safetyControls: { screening: { resultInputId: string } };
  };
  content.requiredInputIds = content.requiredInputIds.map((id) =>
    id === "SYNTHETIC_SCREEN_RESULT"
      ? "REAL_SCREEN_RESULT"
      : id === "SYNTHETIC_REQUIRED_INPUT"
        ? "REAL_MEDICAL_CLEARANCE"
        : id
  );
  content.safetyControls.screening.resultInputId = "REAL_SCREEN_RESULT";
  // Add, never rename, in `ruleIds`: the (untouched) evidence registry's own
  // claims still reference "SYNTHETIC_EVIDENCE_RULE" by name
  // (repository.ts's "Evidence claim references unknown policy rule ID"
  // cross-check), so removing it from `ruleIds` breaks artifact-set loading
  // entirely. Only `evidenceRuleIds` — what finalization.ts actually reads
  // for gate evidence — needs to point at the new, non-synthetic id.
  content.ruleIds = [...content.ruleIds, "REAL_EVIDENCE_RULE"];
  content.evidenceRuleIds = content.evidenceRuleIds.map((id) =>
    id === "SYNTHETIC_EVIDENCE_RULE" ? "REAL_EVIDENCE_RULE" : id
  );
  // gate.ts's assertEvidenceRulesHaveClaims requires every policy
  // evidenceRuleId to be supported by an actual evidence-registry claim.
  // Add "REAL_EVIDENCE_RULE" to whichever existing claim already carries
  // "SYNTHETIC_EVIDENCE_RULE", rather than removing it there too.
  const evidenceLeaf = base.leaves.find((leaf) => leaf.kind === "EVIDENCE_REGISTRY")!;
  const evidenceContent = structuredClone(evidenceLeaf.content) as unknown as {
    claims: { ruleIds: string[] }[];
  };
  for (const claim of evidenceContent.claims) {
    if (claim.ruleIds.includes("SYNTHETIC_EVIDENCE_RULE")) claim.ruleIds.push("REAL_EVIDENCE_RULE");
  }
  const customEvidence: ArtifactDraftInput = {
    ...structuredClone(evidenceLeaf),
    content: evidenceContent as unknown as ArtifactDraftInput["content"],
  };
  const leaves = base.leaves.map((leaf) =>
    leaf.kind === "EXERCISE_CATALOG"
      ? exerciseLeaf
      : leaf.kind === "EVIDENCE_REGISTRY"
        ? customEvidence
        : leaf
  );
  policy.dependencies = leaves.map(artifactReferenceOf);
  return { leaves, policy, references: [artifactReferenceOf(policy), ...policy.dependencies] };
}

/**
 * T-2000 review round 2 nit 2: `buildLiveArtifactsWithRealBundleIds` above
 * renames *both* required-input and evidence-rule ids, so its candidate
 * always short-circuits at the gate's earlier REQUIRED_INPUTS stage
 * (`gate.ts`'s fixed check order) and never actually exercises
 * `finalization.ts`'s evidence-status branch. This variant keeps every
 * required-input id known (so REQUIRED_INPUTS passes) and renames only the
 * evidence-rule id, so the gate reaches EVIDENCE_SUFFICIENCY and
 * `finalization.ts`'s evidence[] derivation is the one actually under test.
 *
 * S-29 — this builder also deliberately adds the renamed id to the same
 * claim that already covers SYNTHETIC_EVIDENCE_RULE, so the renamed id is
 * genuinely claim-covered, not merely renamed. Before S-29, `finalization.ts`
 * mapped any id other than the literal string "SYNTHETIC_EVIDENCE_RULE" to
 * UNKNOWN regardless of claim coverage, so the test built on this fixture
 * used to assert that wrong behaviour as correct. The fail-closed case this
 * shape used to stand in for — a rule with *no* covering claim — now has its
 * own, stronger coverage: `tests/integration/ai-coach-autonomy-gate.test.ts`
 * ("a bundle whose evidence rule has no covering claim still fails closed
 * with ARTIFACT_INCOMPATIBLE") at the publication-time precondition, and
 * `tests/unit/ai-coach-evidence-rule-coverage.test.ts` ("fails closed
 * (T-2000 review r1 BLOCKER 1)...") for the shared derivation itself. What
 * this builder now proves (below) is the positive contract: a real,
 * claim-covered evidence-rule id is genuinely substantiated and must reach
 * `APPROVE_AUTOMATICALLY` through the real finalize path, not stay `UNKNOWN`
 * merely for not being the one hardcoded fixture id.
 */
function buildLiveArtifactsWithRealEvidenceRuleOnly(
  namespace: string,
  exerciseLeaf: ArtifactDraftInput
) {
  const base = buildNonSyntheticLaunchTestArtifacts(namespace);
  const policy = structuredClone(base.policy);
  const content = policy.content as unknown as {
    evidenceRuleIds: string[];
    ruleIds: string[];
  };
  // Required-input ids and safetyControls.screening.resultInputId are left
  // exactly as the synthetic-fixture-derived base declares them — every one
  // is a known id, so the gate's REQUIRED_INPUTS stage passes cleanly.
  content.ruleIds = [...content.ruleIds, "REAL_EVIDENCE_RULE"];
  content.evidenceRuleIds = content.evidenceRuleIds.map((id) =>
    id === "SYNTHETIC_EVIDENCE_RULE" ? "REAL_EVIDENCE_RULE" : id
  );
  const evidenceLeaf = base.leaves.find((leaf) => leaf.kind === "EVIDENCE_REGISTRY")!;
  const evidenceContent = structuredClone(evidenceLeaf.content) as unknown as {
    claims: { ruleIds: string[] }[];
  };
  for (const claim of evidenceContent.claims) {
    if (claim.ruleIds.includes("SYNTHETIC_EVIDENCE_RULE")) claim.ruleIds.push("REAL_EVIDENCE_RULE");
  }
  const customEvidence: ArtifactDraftInput = {
    ...structuredClone(evidenceLeaf),
    content: evidenceContent as unknown as ArtifactDraftInput["content"],
  };
  const leaves = base.leaves.map((leaf) =>
    leaf.kind === "EXERCISE_CATALOG"
      ? exerciseLeaf
      : leaf.kind === "EVIDENCE_REGISTRY"
        ? customEvidence
        : leaf
  );
  policy.dependencies = leaves.map(artifactReferenceOf);
  return { leaves, policy, references: [artifactReferenceOf(policy), ...policy.dependencies] };
}

suite("T-2000 — bounded autonomy for a real (non-synthetic) client under a live release", () => {
  const sharedArtifacts = buildLiveTrainingArtifacts();
  let actorId: string;

  beforeAll(() => ensureLiveTrainingExerciseCatalogPublished(sharedArtifacts));

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
    vi.stubEnv("FEATURE_AI_COACH_ENROLLMENT", "true");
    vi.stubEnv("FEATURE_AI_COACH_PUBLICATION", "true");
    stubApprovedLiveProviderTransport();
    // Isolate from every other suite's leftover rows: acceptance criterion 1
    // requires proving this ticket's zero-reviewer path with a real assertion,
    // not one that happens to pass because nothing else in this shared local
    // test DB has ever seeded a reviewer grant.
    await db.aiPlanReviewerApproval.deleteMany();
    await db.aiCoachReviewerGrant.deleteMany();
    expect(await db.aiCoachReviewerGrant.count()).toBe(0);
    const actor = await createTestGovernanceActor(
      ["APPROVE_LIVE_LAUNCH", "ACTIVATE_LIVE_LAUNCH", "DEACTIVATE_LIVE_LAUNCH"],
      "T-2000-live-autonomy"
    );
    actorId = actor.id;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    // T-2014: read the invariant, ALWAYS tear the release down, then assert.
    // Asserting before the teardown meant a single failure left the sole ACTIVE
    // release in place, so every later test in this file died with a derived
    // LIVE_ACTIVATION_ALREADY_EXISTS and the one real cause was buried under
    // five consequences. The assertion itself is unchanged and still fails.
    const reviewerGrants = await db.aiCoachReviewerGrant.count();
    await deactivateTestLiveRelease(actorId);
    expect(reviewerGrants).toBe(0);
  });
  afterAll(() => db.$disconnect());

  async function activateSharedRelease() {
    return activateTestLiveRelease({
      namespace: "live-autonomy-shared",
      actorUserId: actorId,
      artifacts: sharedArtifacts,
      packetSuffix: `live-autonomy-${randomUUID()}`,
    });
  }

  /** A non-synthetic, entitled, consented client with an active live
   * release, its confirmed intake and a CLEAR safety disclosure. */
  async function liveClientFixture() {
    await activateSharedRelease();
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

  /** A training-only (nutrition: null, meals: null) managed candidate — the
   * only live happy path this ticket can prove without inventing a clinical
   * projected-rate input (see spec "training-only candidate" section). One
   * strength session on "goblet-squat", present in the live exercise-catalog
   * artifact and the code's static catalog module. */
  async function seedTrainingOnlyCandidate(
    user: { id: string },
    context: { revision: number },
    profile: {
      profileRevision: number;
      observationRevision: number;
      safetyRevision: number;
      activePlanVersionId: string | null;
    },
    overrides: Partial<{
      reviewerStatus: "PENDING" | "APPROVED" | "REJECTED" | "NOT_REQUIRED";
    }> = {}
  ) {
    const payload = planPayloadSchema.parse({
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
              exerciseId: "goblet-squat",
              catalogVersion: "exercise-fixture-v1",
              sets: 3,
              reps: 8,
              restSeconds: 90,
              effort: "RPE 7 — two reps in reserve",
            },
          ],
        },
      ],
      cardio: [],
      policyVersion: sharedArtifacts.policy.artifactKey,
      catalogVersions: {
        food: sharedArtifacts.leaves.find((leaf) => leaf.kind === "FOOD_CATALOG")!.artifactKey,
        exercise: sharedArtifacts.leaves.find((leaf) => leaf.kind === "EXERCISE_CATALOG")!
          .artifactKey,
      },
    });
    return db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "PROPOSED",
        changeClass: "INITIAL",
        payload,
        payloadHash: contentHash(payload),
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        baseVersionId: profile.activePlanVersionId,
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        reviewerStatus: overrides.reviewerStatus ?? "PENDING",
        sourceRefs: [],
        validationReport: { engine: "managed-v1", passed: true, inputHash: "b".repeat(64) },
      },
    });
  }

  function acceptInputFor(candidate: {
    baseVersionId: string | null;
    contextRevision: number;
    profileRevision: number;
    observationRevision: number;
    safetyRevision: number;
  }): AcceptPlanVersionInput {
    return {
      requestKey: randomUUID(),
      expectedBaseVersionId: candidate.baseVersionId,
      expectedContextRevision: candidate.contextRevision,
      expectedProfileRevision: candidate.profileRevision,
      expectedObservationRevision: candidate.observationRevision,
      expectedSafetyRevision: candidate.safetyRevision,
    };
  }

  it("T-2000 review finding 1 (BLOCKER): a real bundle's non-synthetic required-input/evidence-rule ids fail closed to FOCUSED_CLARIFICATION, never silently CONFIRMED/SUFFICIENT", async () => {
    const namespace = `live-autonomy-real-ids-${randomUUID()}`;
    const exerciseLeaf = sharedArtifacts.leaves.find((leaf) => leaf.kind === "EXERCISE_CATALOG")!;
    const customArtifacts = buildLiveArtifactsWithRealBundleIds(namespace, exerciseLeaf);
    await activateTestLiveRelease({
      namespace,
      actorUserId: actorId,
      artifacts: customArtifacts,
      packetSuffix: `live-autonomy-real-ids-${randomUUID()}`,
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

    const payload = planPayloadSchema.parse({
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
              exerciseId: "goblet-squat",
              catalogVersion: "exercise-fixture-v1",
              sets: 3,
              reps: 8,
              restSeconds: 90,
              effort: "RPE 7 — two reps in reserve",
            },
          ],
        },
      ],
      cardio: [],
      policyVersion: customArtifacts.policy.artifactKey,
      catalogVersions: {
        food: customArtifacts.leaves.find((leaf) => leaf.kind === "FOOD_CATALOG")!.artifactKey,
        exercise: customArtifacts.leaves.find((leaf) => leaf.kind === "EXERCISE_CATALOG")!
          .artifactKey,
      },
    });
    const candidate = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "PROPOSED",
        changeClass: "INITIAL",
        payload,
        payloadHash: contentHash(payload),
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        baseVersionId: profile.activePlanVersionId,
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        reviewerStatus: "PENDING",
        sourceRefs: [],
        validationReport: { engine: "managed-v1", passed: true, inputHash: "c".repeat(64) },
      },
    });

    const result = await finalizeCurrentClientPlan(candidate.id);
    expect(result.outcome).toBe("FOCUSED_CLARIFICATION");
    // T-2000 review round 2 nit 1: this bundle's unrecognized required-input
    // id (REAL_SCREEN_RESULT) is what actually produces FOCUSED_CLARIFICATION
    // here — assert the gate's own reason code, not just the outcome, so a
    // future regression that reaches FOCUSED_CLARIFICATION for an unrelated
    // reason (e.g. only the evidence branch firing) cannot pass silently.
    expect(result.reasonCodes).toContain("GATE_REQUIRED_INPUT_MISSING");
    expect(await db.aiAutomaticPlanApproval.count({ where: { planVersionId: candidate.id } })).toBe(
      0
    );
  });

  it("S-29 / T-2000 review round 2 nit 2: a real, claim-covered evidence-rule id reaches APPROVE_AUTOMATICALLY through the real finalize path", async () => {
    const namespace = `live-autonomy-real-evidence-${randomUUID()}`;
    const exerciseLeaf = sharedArtifacts.leaves.find((leaf) => leaf.kind === "EXERCISE_CATALOG")!;
    const customArtifacts = buildLiveArtifactsWithRealEvidenceRuleOnly(namespace, exerciseLeaf);
    await activateTestLiveRelease({
      namespace,
      actorUserId: actorId,
      artifacts: customArtifacts,
      packetSuffix: `live-autonomy-real-evidence-${randomUUID()}`,
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

    const payload = planPayloadSchema.parse({
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
              exerciseId: "goblet-squat",
              catalogVersion: "exercise-fixture-v1",
              sets: 3,
              reps: 8,
              restSeconds: 90,
              effort: "RPE 7 — two reps in reserve",
            },
          ],
        },
      ],
      cardio: [],
      policyVersion: customArtifacts.policy.artifactKey,
      catalogVersions: {
        food: customArtifacts.leaves.find((leaf) => leaf.kind === "FOOD_CATALOG")!.artifactKey,
        exercise: customArtifacts.leaves.find((leaf) => leaf.kind === "EXERCISE_CATALOG")!
          .artifactKey,
      },
    });
    const candidate = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "PROPOSED",
        changeClass: "INITIAL",
        payload,
        payloadHash: contentHash(payload),
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        baseVersionId: profile.activePlanVersionId,
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        reviewerStatus: "PENDING",
        sourceRefs: [],
        validationReport: { engine: "managed-v1", passed: true, inputHash: "d".repeat(64) },
      },
    });

    const result = await finalizeCurrentClientPlan(candidate.id);
    expect(result.outcome).toBe("APPROVE_AUTOMATICALLY");
    expect(await db.aiAutomaticPlanApproval.count({ where: { planVersionId: candidate.id } })).toBe(
      1
    );

    // As strong as this file's other happy-path proof ("zero-reviewer happy
    // path"): the decision row behind the approval is itself a clean
    // APPROVE_AUTOMATICALLY with no HOLD/clarification reason codes, so the
    // renamed, claim-covered evidence rule did not merely slip past a
    // different check.
    const gate = await db.aiAutonomyGateDecision.findFirst({
      where: { evaluatedPlanVersionId: candidate.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(gate).toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
      orderedReasonCodes: ["GATE_APPROVED"],
    });

    const workspace = await getAiWorkspace(user.id);
    const proposal = workspace.proposals.find((p) => p.id === candidate.id);
    expect(proposal).toMatchObject({ status: "READY" });
    expect(proposal?.payload).not.toBeNull();

    const accepted = await acceptPlanVersionAtomic(user.id, candidate.id, acceptInputFor(candidate));
    expect(accepted).toMatchObject({
      success: true,
      alreadyAccepted: false,
      activeVersionId: candidate.id,
    });
    expect(
      (await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } }))
        .activePlanVersionId
    ).toBe(candidate.id);
    expect(
      await db.aiPlanActivationAttempt.findFirst({ where: { planVersionId: candidate.id } })
    ).toMatchObject({ outcome: "ACCEPTED", reasonCode: "AUTOMATIC_GATE_APPROVED" });

    expect(await db.aiCoachReviewerGrant.count()).toBe(0);
    expect(await db.aiPlanReviewerApproval.count({ where: { planVersionId: candidate.id } })).toBe(
      0
    );
  });

  it("zero-reviewer happy path: finalizes and accepts a live training-only candidate with no AiCoachReviewerGrant anywhere", async () => {
    const { user, context, profile } = await liveClientFixture();
    const candidate = await seedTrainingOnlyCandidate(user, context, profile);

    const finalizeResult = await finalizeCurrentClientPlan(candidate.id);
    expect(finalizeResult).toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    expect(await db.aiAutomaticPlanApproval.count({ where: { planVersionId: candidate.id } })).toBe(
      1
    );

    const workspace = await getAiWorkspace(user.id);
    const proposal = workspace.proposals.find((p) => p.id === candidate.id);
    expect(proposal).toMatchObject({ status: "READY" });
    expect(proposal?.payload).not.toBeNull();

    const result = await acceptPlanVersionAtomic(user.id, candidate.id, acceptInputFor(candidate));
    expect(result).toMatchObject({
      success: true,
      alreadyAccepted: false,
      activeVersionId: candidate.id,
    });
    expect(
      (await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } }))
        .activePlanVersionId
    ).toBe(candidate.id);
    expect(
      await db.aiPlanActivationAttempt.findFirst({ where: { planVersionId: candidate.id } })
    ).toMatchObject({ outcome: "ACCEPTED", reasonCode: "AUTOMATIC_GATE_APPROVED" });

    expect(await db.aiCoachReviewerGrant.count()).toBe(0);
    expect(await db.aiPlanReviewerApproval.count({ where: { planVersionId: candidate.id } })).toBe(
      0
    );
  });

  it("T-2000 review finding 2: processManagedRun fails closed for a real client and writes no AiPlanVersion", async () => {
    const { user, context, profile } = await liveClientFixture();
    const { runId } = await requestAiRun(user.id, {
      requestKey: randomUUID(),
      kind: "INITIAL",
      representation: "MACROS",
      expectedContextRevision: context.revision,
      expectedProfileRevision: profile.profileRevision,
    });
    const claim = await claimQueuedRun(runId);
    if (!claim.claimed) throw new Error("Fixture claim failed");
    // Composition (buildInitialFixturePlan) stamps hard-coded fixture doses,
    // foods and contentKind: "SYNTHETIC_FIXTURE" — never correct for a real
    // account until T-2022/T-2039/T-2041. The provider argument is never
    // reached; the fence fires before any provider call.
    await expect(processManagedRun(claim, new SyntheticFixtureProvider())).resolves.toBe("failed");
    expect(await db.aiPlanVersion.count({ where: { clientId: user.id } })).toBe(0);
    const run = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.lastError).toBe("LIVE_COMPOSITION_UNAVAILABLE");
    expect(["RETRY_WAIT", "FAILED"]).toContain(run.status);
  });

  it("T-2000 review finding 8 / spec risk 1: a candidate stays READY after a failed acceptance attempt", async () => {
    const { user, context, profile } = await liveClientFixture();
    const candidate = await seedTrainingOnlyCandidate(user, context, profile);
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    expect(
      (await getAiWorkspace(user.id)).proposals.find((p) => p.id === candidate.id)
    ).toMatchObject({ status: "READY" });

    // A failed acceptance attempt still writes a fresh gate row (the managed
    // pre-transaction block always re-evaluates the gate before the
    // transaction's own STALE_PROPOSAL check runs) but must not hide an
    // otherwise still-valid candidate behind that attempt's new row —
    // visibility is keyed on evaluationKey, not gate id.
    const staleInput = { ...acceptInputFor(candidate), expectedBaseVersionId: "stale-base-id" };
    const failed = await acceptPlanVersionAtomic(user.id, candidate.id, staleInput);
    expect(failed.success).toBe(false);
    expect(
      (await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } }))
        .activePlanVersionId
    ).toBeNull();

    const after = await getAiWorkspace(user.id);
    expect(after.proposals.find((p) => p.id === candidate.id)).toMatchObject({ status: "READY" });
  });

  it("a reviewer APPROVED row on a candidate whose fresh gate is HOLD does not activate", async () => {
    const { user, context, profile } = await liveClientFixture();
    const candidate = await seedTrainingOnlyCandidate(user, context, profile);
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });

    const reviewerKey = randomUUID();
    const reviewer = await db.user.create({
      data: { clerkId: reviewerKey, email: `${reviewerKey}@example.test`, isCoach: true },
    });
    const grant = await db.aiCoachReviewerGrant.create({
      data: {
        userId: reviewer.id,
        clientIds: [user.id],
        domains: ["NUTRITION", "STRENGTH", "CARDIO"],
        qualificationNote: "T-2000 regression fixture — inert for a managed row.",
      },
    });
    await db.aiPlanReviewerApproval.create({
      data: {
        planVersionId: candidate.id,
        reviewerGrantId: grant.id,
        approvedHash: candidate.payloadHash,
        approved: true,
        rationale: "T-2000 regression: this must never authorize a managed candidate.",
      },
    });
    await db.aiPlanVersion.update({
      where: { id: candidate.id },
      data: { reviewerStatus: "APPROVED" },
    });

    // Force the fresh gate to HOLD_ONLY-driven PAUSE_REFER by restricting the
    // one domain this candidate touches.
    await db.aiCoachProfile.update({
      where: { clientId: user.id },
      data: { strengthPermission: "HOLD_ONLY" },
    });

    const result = await acceptPlanVersionAtomic(user.id, candidate.id, acceptInputFor(candidate));
    expect(result.success).toBe(false);
    expect(["SAFETY_RESTRICTED", "REVISION_CONFLICT"]).toContain(
      !result.success ? result.code : null
    );
    expect(
      (await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } }))
        .activePlanVersionId
    ).toBeNull();
    const workspace = await getAiWorkspace(user.id);
    expect(workspace.proposals.find((p) => p.id === candidate.id)?.payload).toBeNull();

    // Cleanup for this test's own reviewer-grant rows before the shared
    // afterEach re-asserts the global zero-grant invariant.
    await db.aiPlanReviewerApproval.deleteMany({ where: { planVersionId: candidate.id } });
    await db.aiCoachReviewerGrant.delete({ where: { id: grant.id } });
  });

  it.each(["HOLD", "FOCUSED_CLARIFICATION", "PAUSE_REFER"] as const)(
    "%s exposes status and reason codes but never a payload",
    async (outcome) => {
      const { user, context, profile } = await liveClientFixture();
      const candidate = await seedTrainingOnlyCandidate(user, context, profile);
      const evaluationKey = contentHash({ outcome, candidateId: candidate.id, salt: randomUUID() });
      await db.aiAutonomyGateDecision.create({
        data: {
          clientId: user.id,
          evaluationKey,
          outcome,
          orderedReasonCodes: [`SYNTHETIC_${outcome}_REASON`],
          ruleIds: ["SYNTHETIC_RULE"],
          nextActionTemplateId: "synthetic-pause-refer-template",
          artifactRefs: sharedArtifacts.references,
          sourceRefs: [],
          inputSnapshot: { synthetic: true },
          inputDigest: contentHash({ synthetic: true, salt: randomUUID() }),
          validationReport: { engine: "managed-v1", passed: true },
          contextRevision: context.revision,
          profileRevision: profile.profileRevision,
          observationRevision: profile.observationRevision,
          safetyRevision: profile.safetyRevision,
          evaluatedPlanVersionId: candidate.id,
          approvedPlanVersionId: null,
          candidatePayloadHash: candidate.payloadHash,
        },
      });

      const workspace = await getAiWorkspace(user.id);
      const proposal = workspace.proposals.find((p) => p.id === candidate.id);
      expect(proposal).toMatchObject({ status: outcome, payload: null });
      expect(proposal?.authorization.reasonCodes.length).toBeGreaterThan(0);
      expect(proposal?.authorization.nextActionTemplateId).not.toBeNull();
    }
  );

  it("T-2000 review finding 3: reasonCodes and nextActionTemplateId come from the same row as outcome (stale APPROVE audit, fresh HOLD gate)", async () => {
    const { user, context, profile } = await liveClientFixture();
    const candidate = await seedTrainingOnlyCandidate(user, context, profile);
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    // finalize already wrote a matching APPROVE_AUTOMATICALLY gate + a
    // VALIDATED provider audit (failureCode: null). Simulate an independent,
    // later HOLD re-evaluation for the same candidate with no new provider
    // audit — before the fix, reasonCodes/nextActionTemplateId would still
    // read from the stale APPROVE audit (empty reasonCodes, since
    // failureCode is null for an approval) even though status/outcome
    // already correctly switched to HOLD from the newer gate.
    await db.aiAutonomyGateDecision.create({
      data: {
        clientId: user.id,
        evaluationKey: contentHash({ candidateId: candidate.id, holdSalt: randomUUID() }),
        outcome: "HOLD",
        orderedReasonCodes: ["SYNTHETIC_HOLD_REASON"],
        ruleIds: ["SYNTHETIC_RULE"],
        nextActionTemplateId: "synthetic-pause-refer-template",
        artifactRefs: sharedArtifacts.references,
        sourceRefs: [],
        inputSnapshot: { synthetic: true },
        inputDigest: contentHash({ synthetic: true, salt: randomUUID() }),
        validationReport: { engine: "managed-v1", passed: true },
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        evaluatedPlanVersionId: candidate.id,
        approvedPlanVersionId: null,
        candidatePayloadHash: candidate.payloadHash,
      },
    });

    const workspace = await getAiWorkspace(user.id);
    const proposal = workspace.proposals.find((p) => p.id === candidate.id);
    expect(proposal).toMatchObject({ status: "HOLD", payload: null });
    expect(proposal?.authorization.reasonCodes).toEqual(["SYNTHETIC_HOLD_REASON"]);
    expect(proposal?.authorization.nextActionTemplateId).toBe("synthetic-pause-refer-template");
  });

  it("a stale approval (evaluationKey no longer matches) is not enough to stay READY", async () => {
    const { user, context, profile } = await liveClientFixture();
    const candidate = await seedTrainingOnlyCandidate(user, context, profile);
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    expect(
      (await getAiWorkspace(user.id)).proposals.find((p) => p.id === candidate.id)
    ).toMatchObject({ status: "READY" });

    // Changing safetyRevision changes every fresh evaluationKey computed from
    // current profile state, without touching the persisted approval.
    await db.aiCoachProfile.update({
      where: { clientId: user.id },
      data: { safetyRevision: { increment: 1 } },
    });

    const after = await getAiWorkspace(user.id);
    expect(after.proposals.find((p) => p.id === candidate.id)?.status).not.toBe("READY");
  });

  it("a real client with no live release fails closed at every boundary", async () => {
    const { user, context, profile } = await liveClientFixture();
    const candidate = await seedTrainingOnlyCandidate(user, context, profile);

    await deactivateTestLiveRelease(actorId);

    await expect(
      requestAiRun(user.id, {
        requestKey: randomUUID(),
        kind: "WEEKLY_REVIEW",
        representation: "MACROS",
        expectedContextRevision: context.revision,
        expectedProfileRevision: profile.profileRevision,
      })
    ).rejects.toThrow();
    expect(await db.aiCoachRun.count({ where: { clientId: user.id } })).toBe(0);

    await expect(
      retryManagedRun(user.id, "nonexistent-run-id", { requestKey: randomUUID() })
    ).rejects.toThrow();

    await expect(
      applyAiClientCommand(user.id, {
        requestKey: randomUUID(),
        expectedProfileRevision: profile.profileRevision,
        operation: "ENROLL",
        consent: true,
        expectedContextRevision: context.revision,
        reviewTimezone: "America/Los_Angeles",
      })
    ).rejects.toThrow();

    await expect(finalizeCurrentClientPlan(candidate.id)).rejects.toThrow();

    const result = await acceptPlanVersionAtomic(user.id, candidate.id, acceptInputFor(candidate));
    expect(result).toMatchObject({ success: false, code: "POLICY_UNAVAILABLE" });
    expect(
      await db.aiPlanActivationAttempt.findFirst({
        where: { planVersionId: candidate.id, reasonCode: "AUTOMATIC_GATE_UNAVAILABLE" },
      })
    ).not.toBeNull();

    // getAiWorkspace's own account lock (lockAiClient) already fails closed
    // for a real client with no active release, before this ticket's own
    // degrade-not-throw catch is ever reached — "either throws or degrades"
    // is the frozen contract; this is the "throws" half of it.
    await expect(getAiWorkspace(user.id)).rejects.toThrow();
  });
});
