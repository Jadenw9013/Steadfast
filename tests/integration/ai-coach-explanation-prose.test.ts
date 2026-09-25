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
import { policyBundleContentSchema } from "@/lib/ai-coach/artifacts/schema";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { finalizeCurrentClientPlan } from "@/lib/ai-coach/finalization";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import {
  evaluateCurrentClientNutritionSafety,
  resolveNutritionSafetyPolicy,
  type NutritionSafetyEvaluationInput,
} from "@/lib/ai-coach/nutrition-safety";
import { submitSafetyDisclosure } from "@/lib/ai-coach/safety";
import { planPayloadSchema } from "@/lib/ai-coach/plan-contract";
import {
  runConstrainedProviderBoundary,
} from "@/lib/ai-coach/provider/constrained-boundary";
import { SyntheticConstrainedProvider } from "@/lib/ai-coach/provider/synthetic-provider";
import type {
  ConstrainedModelProvider,
  ConstrainedProviderEnvelope,
} from "@/lib/ai-coach/provider/adapter";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { exportAiData } from "@/lib/ai-coach/data-export";
import type { ServerAutonomyGateInput } from "@/lib/ai-coach/autonomy/gate";

vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
const authMock = vi.mocked(getCurrentDbUser);

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

suite("T-2030 bounded explanation prose — golden digest, accept/reject, projection, export", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.AI_COACH_FIXTURE_MODE = "true";
    await db.aiCoachOperationalControl.deleteMany();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.aiCoachOperationalControl.deleteMany();
  });
  afterAll(() => db.$disconnect());

  async function ensureRuntimeArtifacts() {
    // "t1008-runtime" is the magic namespace `buildSyntheticArtifactSet`
    // resolves to `RUNTIME_POLICY_KEY` ("policy-fixture-v1",
    // finalization.ts) — the only namespace `finalizeCurrentClientPlan`'s
    // synthetic artifact request can find, matching the pattern in
    // ai-coach-end-to-end-governance.test.ts's `ensureRuntimeArtifacts`.
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
  }

  async function clientFixture() {
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
        confirmedIntake: intake,
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
      },
    });
    await submitSafetyDisclosure(user.id, clearSafety);
    authMock.mockResolvedValue(user);
    const context = await db.clientCoachingContext.findUniqueOrThrow({
      where: { clientId: user.id },
    });
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
    const { payload } = buildInitialFixturePlan(intake, "synthetic-rx", "MEALS");
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
    return { user, candidate };
  }

  /** A second, independent PROPOSED candidate for an existing fixture user
   * (its own `finalizeCurrentClientPlan` call, its own audit/approval row),
   * used to exercise two different provider behaviors for the same client
   * in one test. */
  async function additionalCandidateFor(user: { id: string }, version = 2) {
    const context = await db.clientCoachingContext.findUniqueOrThrow({
      where: { clientId: user.id },
    });
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
    const { payload } = buildInitialFixturePlan(intake, `synthetic-rx-${randomUUID()}`, "MEALS");
    return db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version,
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
        validationReport: { engine: "managed-v1", passed: true, inputHash: "b".repeat(64) },
        sourceRefs: [],
      },
    });
  }

  /** Every stub below echoes the same server-allowlisted IDs
   * SyntheticConstrainedProvider does; only `explanationText`/
   * `clarificationText`/`concern` differ per case. */
  function baseSyntheticOutput(envelope: ConstrainedProviderEnvelope) {
    return {
      schemaVersion: 1 as const,
      preferenceIds: envelope.allowed.preferenceIds.slice(0, 1),
      concern: { disposition: "NONE" as const, clarificationId: null },
      rankedOptionIds: envelope.allowed.optionIds,
      explanation: {
        templateId: envelope.allowed.explanationTemplateIds[0],
        reasonCodes: envelope.allowed.reasonCodes,
        numericFieldIds: envelope.allowed.numericFieldIds,
        limitationIds: envelope.allowed.limitationIds,
      },
    };
  }

  it("golden stateDigest: no `text` key on the no-prose synthetic path, and the digest is byte-stable", async () => {
    const { user, candidate } = await clientFixture();
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    const approval = await db.aiAutomaticPlanApproval.findUniqueOrThrow({
      where: { planVersionId: candidate.id },
    });
    expect(approval.clientId).toBe(user.id);
    const providerSelection = approval.providerSelection as {
      explanation: Record<string, unknown>;
    };
    expect("text" in providerSelection.explanation).toBe(false);
    // The row's own stored state must re-hash to its own stateDigest — this
    // is what plan-acceptance.ts's contentHash(approvalState) check re-does
    // on every acceptance, so a row written today (no prose, same shape a
    // pre-T-2030 row always had) still passes it. The pinned-digest proof
    // against commit 783baad's `validatedExplanation()` (review r1 MINOR 1)
    // lives in tests/unit/ai-coach-golden-state-digest.test.ts, which
    // compares the real exported function against a pinned hex captured
    // from the pre-change commit, reproducibly, in the repo.
    const reconstructed = {
      clientId: approval.clientId,
      planVersionId: approval.planVersionId,
      gateDecisionId: approval.gateDecisionId,
      providerBoundaryAuditId: approval.providerBoundaryAuditId,
      evaluationKey: approval.evaluationKey,
      candidatePayloadHash: approval.candidatePayloadHash,
      artifactRequest: approval.artifactRequest,
      artifactRefs: approval.artifactRefs,
      sourceRefs: approval.sourceRefs,
      gateInput: approval.gateInput,
      providerSelection: approval.providerSelection,
    };
    expect(contentHash(reconstructed)).toBe(approval.stateDigest);
  });

  it("a pre-existing (pre-T-2030-shaped) approval row still passes the stateDigest check and still accepts", async () => {
    // Simulates a row written before this change: `providerSelection`'s
    // `explanation` object has no `text` key at all, matching every
    // existing production row today.
    const { user, candidate } = await clientFixture();
    const gate = await db.aiAutonomyGateDecision.create({
      data: {
        clientId: user.id,
        evaluationKey: "9".repeat(64),
        outcome: "APPROVE_AUTOMATICALLY",
        orderedReasonCodes: ["SYNTHETIC_PRE_EXISTING"],
        ruleIds: [],
        nextActionTemplateId: "synthetic-pre-existing-template",
        artifactRefs: [],
        sourceRefs: [],
        inputSnapshot: { synthetic: true },
        inputDigest: "8".repeat(64),
        validationReport: { schemaVersion: 1, checks: [] },
        contextRevision: candidate.contextRevision,
        profileRevision: candidate.profileRevision,
        observationRevision: candidate.observationRevision,
        safetyRevision: candidate.safetyRevision,
        evaluatedPlanVersionId: candidate.id,
        approvedPlanVersionId: candidate.id,
        candidatePayloadHash: candidate.payloadHash,
      },
    });
    const audit = await db.aiProviderBoundaryAudit.create({
      data: {
        clientId: user.id,
        operationId: randomUUID(),
        promptContractVersion: "t1007-synthetic-v1",
        providerConfiguration: "SYNTHETIC_CONSTRAINED_PROVIDER_ONLY",
        boundaryOutcome: "VALIDATED",
        resultOutcome: "APPROVE_AUTOMATICALLY",
        attempts: 1,
        preGateDecisionId: gate.id,
        finalGateDecisionId: gate.id,
        inputSnapshot: { synthetic: true },
        inputDigest: "7".repeat(64),
        // explanationValidation intentionally omitted — pre-T-2030 rows
        // read this column as `null`.
      },
    });
    const preExistingState = {
      clientId: user.id,
      planVersionId: candidate.id,
      gateDecisionId: gate.id,
      providerBoundaryAuditId: audit.id,
      evaluationKey: gate.evaluationKey,
      candidatePayloadHash: candidate.payloadHash,
      artifactRequest: { policyArtifactKey: "policy-fixture-v1", engineVersion: "v1" },
      artifactRefs: [],
      sourceRefs: [],
      gateInput: { synthetic: true },
      providerSelection: {
        preferenceIds: [],
        rankedOptionIds: [],
        explanation: {
          templateId: "synthetic-pre-existing-template",
          locale: "en-US",
          reasonCodes: [],
          nextStepText: "Pre-existing fixture.",
          numericFields: [],
          limitations: [],
          // no `text` key — the pre-T-2030 shape.
        },
      },
    };
    const approval = await db.aiAutomaticPlanApproval.create({
      data: {
        ...preExistingState,
        artifactRequest: preExistingState.artifactRequest,
        stateDigest: contentHash(preExistingState),
      },
    });
    const reread = await db.aiAutomaticPlanApproval.findUniqueOrThrow({
      where: { id: approval.id },
    });
    const reconstructed = {
      clientId: reread.clientId,
      planVersionId: reread.planVersionId,
      gateDecisionId: reread.gateDecisionId,
      providerBoundaryAuditId: reread.providerBoundaryAuditId,
      evaluationKey: reread.evaluationKey,
      candidatePayloadHash: reread.candidatePayloadHash,
      artifactRequest: reread.artifactRequest,
      artifactRefs: reread.artifactRefs,
      sourceRefs: reread.sourceRefs,
      gateInput: reread.gateInput,
      providerSelection: reread.providerSelection,
    };
    expect(contentHash(reconstructed)).toBe(reread.stateDigest);
  });

  it("accepted path: valid prose is persisted, audited as ACCEPTED, and projected by getAiWorkspace", async () => {
    const { user, candidate } = await clientFixture();
    vi.spyOn(SyntheticConstrainedProvider.prototype, "invoke").mockImplementation(
      async (envelope: ConstrainedProviderEnvelope) => {
        const energy = envelope.explanationInputs?.numericFields.find(
          (field) => field.id === "NUTRITION_ENERGY_KCAL"
        );
        const explanationText = energy
          ? `Your energy target is ${energy.displayValue} kcal per day to support your training goals right now.`
          : null;
        return {
          output: { ...baseSyntheticOutput(envelope), explanationText },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
    );
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    const approval = await db.aiAutomaticPlanApproval.findUniqueOrThrow({
      where: { planVersionId: candidate.id },
    });
    const providerSelection = approval.providerSelection as {
      explanation: { text?: string };
    };
    expect(providerSelection.explanation.text).toMatch(/kcal per day/);

    const audit = await db.aiProviderBoundaryAudit.findUniqueOrThrow({
      where: { id: approval.providerBoundaryAuditId },
    });
    const explanationValidation = audit.explanationValidation as {
      explanation: { outcome: string; reasonCodes: string[] };
    };
    expect(explanationValidation.explanation.outcome).toBe("ACCEPTED");
    const validatedOutput = audit.validatedOutput as { explanationText: string };
    expect(validatedOutput.explanationText).toBe(providerSelection.explanation.text);

    const workspace = await getAiWorkspace(user.id);
    const proposal = workspace.proposals.find((entry) => entry.id === candidate.id);
    expect(proposal?.authorization.explanation?.text).toBe(providerSelection.explanation.text);
    expect(proposal?.authorization.explanation?.kind).toBe("MODEL_VALIDATED");
  });

  it("rejected path: a fabricated number never reaches any column, but the plan still approves", async () => {
    const { user, candidate } = await clientFixture();
    const sentinel = "SENTINEL-REJECTED-TEXT-MUST-NOT-PERSIST";
    vi.spyOn(SyntheticConstrainedProvider.prototype, "invoke").mockImplementation(
      async (envelope: ConstrainedProviderEnvelope) => {
        const energy = envelope.explanationInputs?.numericFields.find(
          (field) => field.id === "NUTRITION_ENERGY_KCAL"
        );
        const fabricated = energy ? Number(energy.displayValue) + 1 : 99_999;
        return {
          output: {
            ...baseSyntheticOutput(envelope),
            explanationText: `${sentinel}: your daily energy target has been set at ${fabricated} kcal today.`,
          },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
    );
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    const approval = await db.aiAutomaticPlanApproval.findUniqueOrThrow({
      where: { planVersionId: candidate.id },
    });
    const providerSelection = approval.providerSelection as {
      explanation: Record<string, unknown>;
    };
    expect("text" in providerSelection.explanation).toBe(false);

    const audit = await db.aiProviderBoundaryAudit.findUniqueOrThrow({
      where: { id: approval.providerBoundaryAuditId },
    });
    const explanationValidation = audit.explanationValidation as {
      explanation: { outcome: string; reasonCodes: string[] };
    };
    expect(explanationValidation.explanation.outcome).toBe("REJECTED");
    expect(explanationValidation.explanation.reasonCodes).toContain("PROSE_NUMBER_NOT_VALIDATED");

    const workspace = await getAiWorkspace(user.id);
    const proposal = workspace.proposals.find((entry) => entry.id === candidate.id);
    expect(proposal?.authorization.explanation).toBeNull();

    const rawPlan = await db.aiPlanVersion.findUniqueOrThrow({ where: { id: candidate.id } });
    for (const row of [approval, audit, rawPlan]) {
      expect(JSON.stringify(row)).not.toContain(sentinel);
    }
  });

  it("review r1 MAJOR 1: a structurally malformed prose field never fail-closes a gate-approved plan — three shapes, one test each survives to APPROVE_AUTOMATICALLY with explanation: null", async () => {
    const { user, candidate: emptyStringCandidate } = await clientFixture();
    const overCeilingCandidate = await additionalCandidateFor(user, 2);
    const strayClarificationCandidate = await additionalCandidateFor(user, 3);

    let call = 0;
    vi.spyOn(SyntheticConstrainedProvider.prototype, "invoke").mockImplementation(
      async (envelope: ConstrainedProviderEnvelope) => {
        call += 1;
        if (call === 1) {
          // Shape 1: explanationText: "" — the natural "nothing to say"
          // value once the key is in the schema. Pre-fix this failed
          // `z.string().min(1)` and fail-closed the whole output.
          return {
            output: { ...baseSyntheticOutput(envelope), explanationText: "" },
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        if (call === 2) {
          // Shape 2: a 601-character explanationText — one character over
          // the hard structural ceiling.
          return {
            output: { ...baseSyntheticOutput(envelope), explanationText: "x".repeat(601) },
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        // Shape 3: a stray clarificationText on a NONE disposition (no
        // clarification was requested).
        return {
          output: {
            ...baseSyntheticOutput(envelope),
            clarificationText: "Synthetic stray clarification text.",
          },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
    );

    await expect(finalizeCurrentClientPlan(emptyStringCandidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    await expect(finalizeCurrentClientPlan(overCeilingCandidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    await expect(finalizeCurrentClientPlan(strayClarificationCandidate.id)).resolves.toMatchObject(
      { outcome: "APPROVE_AUTOMATICALLY" }
    );

    const workspace = await getAiWorkspace(user.id);
    for (const candidateId of [
      emptyStringCandidate.id,
      overCeilingCandidate.id,
      strayClarificationCandidate.id,
    ]) {
      const approval = await db.aiAutomaticPlanApproval.findUniqueOrThrow({
        where: { planVersionId: candidateId },
      });
      expect(
        "text" in
          (approval.providerSelection as { explanation: Record<string, unknown> }).explanation
      ).toBe(false);
      const proposal = workspace.proposals.find((entry) => entry.id === candidateId);
      expect(proposal?.authorization.outcome).toBe("APPROVE_AUTOMATICALLY");
      expect(proposal?.authorization.explanation).toBeNull();
    }
  });

  it("not-approved projection: getAiWorkspace returns explanation: null whenever automaticApproved is false, even with a providerSelection carrying text", async () => {
    const { user, candidate } = await clientFixture();
    vi.spyOn(SyntheticConstrainedProvider.prototype, "invoke").mockImplementation(
      async (envelope: ConstrainedProviderEnvelope) => {
        const energy = envelope.explanationInputs?.numericFields.find(
          (field) => field.id === "NUTRITION_ENERGY_KCAL"
        );
        return {
          output: {
            ...baseSyntheticOutput(envelope),
            explanationText: energy
              ? `Your energy target is ${energy.displayValue} kcal per day to support your training goals right now.`
              : null,
          },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
    );
    await finalizeCurrentClientPlan(candidate.id);
    // Break exactly one `automaticApproved` AND-condition
    // (`automatic.candidatePayloadHash === candidate.payloadHash`) without
    // touching the approval row at all — `AiAutomaticPlanApproval` is
    // append-only (DB trigger), so the mismatch is introduced on the
    // candidate side instead, which is still a plain mutable PROPOSED row.
    await db.aiPlanVersion.update({
      where: { id: candidate.id },
      data: { payloadHash: "0".repeat(64) },
    });
    const approval = await db.aiAutomaticPlanApproval.findUniqueOrThrow({
      where: { planVersionId: candidate.id },
    });
    expect((approval.providerSelection as { explanation: { text?: string } }).explanation.text).toBeTruthy();

    const workspace = await getAiWorkspace(user.id);
    const proposal = workspace.proposals.find((entry) => entry.id === candidate.id);
    expect(proposal?.authorization.explanation).toBeNull();
  });

  it("export: accepted prose appears in automaticPlanApprovals; no rejected text appears anywhere in the stream", async () => {
    // review r1 MINOR 2 — the title claims both an accepted-text positive
    // and a rejected-text negative; the test now actually produces one of
    // each (two candidates for the same client) so both halves are real
    // assertions, not just the positive half.
    const { user, candidate } = await clientFixture();
    const rejectedCandidate = await additionalCandidateFor(user);
    const sentinel = "SENTINEL-EXPORT-REJECTED-TEXT-MUST-NOT-APPEAR";
    let calls = 0;
    vi.spyOn(SyntheticConstrainedProvider.prototype, "invoke").mockImplementation(
      async (envelope: ConstrainedProviderEnvelope) => {
        calls += 1;
        const energy = envelope.explanationInputs?.numericFields.find(
          (field) => field.id === "NUTRITION_ENERGY_KCAL"
        );
        if (calls === 1) {
          // First finalize call (the accepted candidate): valid prose.
          return {
            output: {
              ...baseSyntheticOutput(envelope),
              explanationText: energy
                ? `Your energy target is ${energy.displayValue} kcal per day to support your training goals right now.`
                : null,
            },
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        }
        // Second finalize call (the rejected candidate): a fabricated
        // number carrying the sentinel, which must never survive.
        const fabricated = energy ? Number(energy.displayValue) + 1 : 99_999;
        return {
          output: {
            ...baseSyntheticOutput(envelope),
            explanationText: `${sentinel}: your daily energy target has been set at ${fabricated} kcal today.`,
          },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
    );
    await finalizeCurrentClientPlan(candidate.id);
    await finalizeCurrentClientPlan(rejectedCandidate.id);
    const approval = await db.aiAutomaticPlanApproval.findUniqueOrThrow({
      where: { planVersionId: candidate.id },
    });
    const rejectedApproval = await db.aiAutomaticPlanApproval.findUniqueOrThrow({
      where: { planVersionId: rejectedCandidate.id },
    });
    const text = (approval.providerSelection as { explanation: { text: string } }).explanation.text;
    expect(
      "text" in (rejectedApproval.providerSelection as { explanation: Record<string, unknown> }).explanation
    ).toBe(false);

    const exported: { dataset: string; record: unknown }[] = [];
    for await (const record of exportAiData(user.id)) exported.push(record);
    expect(exported).toContainEqual({
      dataset: "automaticPlanApprovals",
      record: expect.objectContaining({ id: approval.id }),
    });
    expect(exported).toContainEqual({
      dataset: "automaticPlanApprovals",
      record: expect.objectContaining({ id: rejectedApproval.id }),
    });
    const serializedExport = JSON.stringify(exported);
    expect(serializedExport).toContain(text);
    expect(serializedExport).not.toContain(sentinel);
  });
});

suite("T-2030 R10 structural retention (direct boundary calls)", () => {
  afterAll(() => db.$disconnect());
  const getCurrentDbUserMock = vi.mocked(getCurrentDbUser);

  async function account() {
    const id = randomUUID();
    const user = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true },
    });
    await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic: true } });
    await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: user.id } });
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

  function artifactRequest(policyArtifactKey: string) {
    return { policyArtifactKey, engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION };
  }

  function clearSafetyInput(
    set: Awaited<ReturnType<typeof publishedArtifacts>>
  ): NutritionSafetyEvaluationInput {
    const policy = resolveNutritionSafetyPolicy(set.policyBundle.content);
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

  async function candidate(
    userId: string,
    set: Awaited<ReturnType<typeof publishedArtifacts>>,
    dailyEnergyKcal: number
  ) {
    const payload = planPayloadSchema.parse({
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: {
        prescriptionId: `synthetic-rx-${randomUUID()}`,
        method: "SYNTHETIC_CATALOG_MATCH",
        targets: { energyKcal: dailyEnergyKcal, proteinG: 100, carbsG: 100, fatG: 50 },
        tolerancePercent: 0,
        assumptions: ["Synthetic T-2030 fixture only."],
      },
      meals: null,
      strength: [],
      cardio: [],
      policyVersion: set.policyBundle.artifactKey,
      catalogVersions: {
        food: set.foodCatalog.artifactKey,
        exercise: set.exerciseCatalog.artifactKey,
      },
    });
    return db.aiPlanVersion.create({
      data: {
        clientId: userId,
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
        reviewerStatus: "APPROVED",
        sourceRefs: [],
        validationReport: {
          engine: "managed-v1",
          passed: true,
          inputHash: contentHash({ fixture: "t2030" }),
        },
      },
    });
  }

  function gateInput(
    set: Awaited<ReturnType<typeof publishedArtifacts>>,
    candidatePlanVersionId: string
  ): ServerAutonomyGateInput {
    const policy = policyBundleContentSchema.parse(set.policyBundle.content);
    return {
      requestedScopeClasses: ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
      requestedDomains: ["NUTRITION"],
      requiredInputs: policy.requiredInputIds.map((id) => ({ id, status: "CONFIRMED" })),
      evidence: policy.evidenceRuleIds.map((ruleId) => ({
        ruleId,
        status: "SUFFICIENT",
        sourceRefs: [],
      })),
      candidatePlanVersionId,
    };
  }

  async function eligibleFixture(label: string) {
    const user = await account();
    const set = await publishedArtifacts(label);
    const safetyInput = clearSafetyInput(set);
    await evaluateCurrentClientNutritionSafety(artifactRequest(set.policyKey), safetyInput);
    const plan = await candidate(user.id, set, safetyInput.proposal!.proposedDailyEnergyKcal);
    return {
      user,
      set,
      plan,
      input: {
        languageSourceRefs: [],
        eligibleOptions: [
          { kind: "FOOD" as const, id: "synthetic-food-item" },
          { kind: "EXERCISE" as const, id: "synthetic-exercise-item" },
        ],
        gateInput: gateInput(set, plan.id),
      },
    };
  }

  it("INCREASE_CAUTION with otherwise-valid prose: outcome HOLD, explanation null, PROSE_OUTCOME_MISMATCH", async () => {
    const { set, input } = await eligibleFixture("r10-hold");
    const provider: ConstrainedModelProvider = {
      async invoke(envelope) {
        const energy = envelope.explanationInputs?.numericFields.find(
          (field) => field.id === "NUTRITION_ENERGY_KCAL"
        );
        return {
          output: {
            schemaVersion: 1,
            preferenceIds: envelope.allowed.preferenceIds.slice(0, 1),
            concern: { disposition: "INCREASE_CAUTION", clarificationId: null },
            rankedOptionIds: envelope.allowed.optionIds,
            explanation: {
              templateId: envelope.allowed.explanationTemplateIds[0],
              reasonCodes: envelope.allowed.reasonCodes,
              numericFieldIds: envelope.allowed.numericFieldIds,
              limitationIds: envelope.allowed.limitationIds,
            },
            explanationText: energy
              ? `Your energy target is ${energy.displayValue} kcal per day to support your training goals right now.`
              : null,
          },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };
    const result = await runConstrainedProviderBoundary(
      artifactRequest(set.policyKey),
      input,
      provider
    );
    expect(result.outcome).toBe("HOLD");
    expect(result.providerSelection).toBeNull();
    const audit = await db.aiProviderBoundaryAudit.findUniqueOrThrow({
      where: { id: result.auditId },
    });
    const explanationValidation = audit.explanationValidation as {
      explanation: { outcome: string; reasonCodes: string[] };
    };
    expect(explanationValidation.explanation.outcome).toBe("REJECTED");
    expect(explanationValidation.explanation.reasonCodes).toContain("PROSE_OUTCOME_MISMATCH");
  });

  it("REQUEST_CLARIFICATION with valid clarification prose: outcome FOCUSED_CLARIFICATION, clarification.text present, explanation null", async () => {
    const { set, input } = await eligibleFixture("r10-clarify");
    const provider: ConstrainedModelProvider = {
      async invoke(envelope) {
        return {
          output: {
            schemaVersion: 1,
            preferenceIds: envelope.allowed.preferenceIds.slice(0, 1),
            concern: {
              disposition: "REQUEST_CLARIFICATION",
              clarificationId: envelope.allowed.clarificationIds[0],
            },
            rankedOptionIds: envelope.allowed.optionIds,
            explanation: {
              templateId: envelope.allowed.explanationTemplateIds[0],
              reasonCodes: envelope.allowed.reasonCodes,
              numericFieldIds: envelope.allowed.numericFieldIds,
              limitationIds: envelope.allowed.limitationIds,
            },
            clarificationText:
              "Please confirm whether you prefer chicken breast or brown rice as your main protein choice.",
          },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };
    const result = await runConstrainedProviderBoundary(
      artifactRequest(set.policyKey),
      input,
      provider
    );
    expect(result.outcome).toBe("FOCUSED_CLARIFICATION");
    expect(result.providerSelection).toBeNull();
    // review r1 MINOR 2 — this used to read the expected value off the
    // actual value (`envelopeClarificationId(result)`), which always
    // passes regardless of what the boundary actually chose. Assert the
    // real runtime constant (`SYNTHETIC_BOUNDARY_RUNTIME.clarificationIds`,
    // `constrained-boundary.ts`), which is also independently the only
    // member of `envelope.allowed.clarificationIds` in this fixture.
    expect(result.clarification).toEqual({
      text: "Please confirm whether you prefer chicken breast or brown rice as your main protein choice.",
      clarificationId: "SYNTHETIC_CLARIFY_PREFERENCE",
      kind: "MODEL_VALIDATED",
    });
  });
});
