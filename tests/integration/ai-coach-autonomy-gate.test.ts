import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  evaluateAutonomyGate,
  evaluateCurrentClientAutonomyGate,
  serverAutonomyGateInputSchema,
  type AutonomyGateFacts,
  type ServerAutonomyGateInput,
} from "@/lib/ai-coach/autonomy/gate";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { exportAiData } from "@/lib/ai-coach/data-export";
import {
  evaluateCurrentClientNutritionSafety,
  resolveNutritionSafetyPolicy,
  type NutritionSafetyEvaluationInput,
} from "@/lib/ai-coach/nutrition-safety";
import { planPayloadSchema } from "@/lib/ai-coach/plan-contract";
import {
  publishArtifactVersion,
  registerArtifactVersion,
  revokeArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import { policyBundleContentSchema } from "@/lib/ai-coach/artifacts/schema";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";

vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));

function pureFixture() {
  const input: ServerAutonomyGateInput = {
    requestedScopeClasses: ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
    requestedDomains: ["NUTRITION"],
    requiredInputs: [{ id: "INPUT", status: "CONFIRMED" }],
    evidence: [{ ruleId: "EVIDENCE_RULE", status: "SUFFICIENT", sourceRefs: [] }],
    candidatePlanVersionId: "candidate",
  };
  const facts: AutonomyGateFacts = {
    authorityEligible: true,
    allowedScopeClasses: ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION"],
    explicitExclusions: [
      "DIAGNOSIS",
      "TREATMENT_OR_REHABILITATION",
      "CLINICAL_NUTRITION_OR_MEDICAL_NUTRITION_THERAPY",
      "MEDICATION_OR_SUPPLEMENT_PRESCRIBING",
      "CLINICIAN_INSTRUCTION_OVERRIDE",
    ],
    requiredInputIds: ["INPUT"],
    evidenceRuleIds: ["EVIDENCE_RULE"],
    permissions: { NUTRITION: "ALLOW", STRENGTH: "ALLOW", CARDIO: "ALLOW" },
    safetyDisposition: "CLEAR",
    // T-2033: additive field. `null` == legacy candidate, unchanged behavior.
    prescription: null,
    nutritionSafety: {
      id: "safety-decision",
      outcome: "PASS",
      reasonCodes: [],
      ruleIds: [],
      escalationTemplateIds: [],
      input: {
        screening: {
          instrumentId: "SYNTHETIC_SCREEN",
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
          proposedDailyEnergyKcal: 123,
          currentWeightKg: 70,
          projectedWeeklyWeightChangeKg: 0,
          provenance: "SYNTHETIC_SERVER_FIXTURE",
        },
      },
    },
    evidenceCurrent: true,
    candidateValid: true,
  };
  return { input, facts };
}

describe("T-1006 fixed-order autonomy contract", () => {
  it("returns only the four closed outcomes and never exposes a candidate after a failed gate", () => {
    const { input, facts } = pureFixture();
    expect(evaluateAutonomyGate(input, facts)).toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
      approvedCandidatePlanVersionId: "candidate",
    });

    const authority = evaluateAutonomyGate(input, { ...facts, authorityEligible: false });
    expect(authority).toMatchObject({
      outcome: "PAUSE_REFER",
      orderedReasonCodes: ["GATE_AUTHORITY_UNAVAILABLE"],
      approvedCandidatePlanVersionId: null,
    });

    const missing = structuredClone(input);
    missing.requiredInputs[0].status = "UNKNOWN";
    expect(evaluateAutonomyGate(missing, facts)).toMatchObject({
      outcome: "FOCUSED_CLARIFICATION",
      orderedReasonCodes: ["GATE_REQUIRED_INPUT_MISSING"],
      approvedCandidatePlanVersionId: null,
    });

    const insufficient = structuredClone(input);
    insufficient.evidence[0].status = "INSUFFICIENT";
    expect(evaluateAutonomyGate(insufficient, facts)).toMatchObject({
      outcome: "HOLD",
      orderedReasonCodes: ["GATE_EVIDENCE_INSUFFICIENT"],
      approvedCandidatePlanVersionId: null,
    });
  });

  it("routes every prohibited professional-scope class to PAUSE_REFER", () => {
    const { input, facts } = pureFixture();
    for (const requestedScope of facts.explicitExclusions) {
      expect(
        evaluateAutonomyGate(
          {
            ...input,
            requestedScopeClasses: [
              requestedScope as ServerAutonomyGateInput["requestedScopeClasses"][number],
            ],
          },
          facts
        )
      ).toMatchObject({ outcome: "PAUSE_REFER", orderedReasonCodes: ["GATE_OUT_OF_SCOPE"] });
    }
  });

  it("rejects client identity, synthetic flags, reviewer overrides, model outcomes and duplicate IDs", () => {
    const { input } = pureFixture();
    for (const injected of [
      { clientId: "forged-client" },
      { accountIsSynthetic: true },
      { reviewerOverride: "APPROVED" },
      { modelOutcome: "APPROVE_AUTOMATICALLY" },
    ]) {
      expect(() => serverAutonomyGateInputSchema.parse({ ...input, ...injected })).toThrow();
    }
    expect(() =>
      serverAutonomyGateInputSchema.parse({
        ...input,
        requiredInputs: [...input.requiredInputs, input.requiredInputs[0]],
      })
    ).toThrow("requiredInputs must be unique");
  });
});

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
const getCurrentDbUserMock = vi.mocked(getCurrentDbUser);

suite("T-1006 deterministic autonomy gate with real PostgreSQL constraints", () => {
  afterAll(() => db.$disconnect());

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
    return {
      policyArtifactKey,
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    };
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
    dailyEnergyKcal: number,
    reviewerStatus: "NOT_REQUIRED" | "APPROVED" = "NOT_REQUIRED"
  ) {
    const payload = planPayloadSchema.parse({
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: {
        prescriptionId: `synthetic-rx-${randomUUID()}`,
        method: "SYNTHETIC_CATALOG_MATCH",
        targets: {
          energyKcal: dailyEnergyKcal,
          proteinG: 1,
          carbsG: 1,
          fatG: 1,
        },
        tolerancePercent: 0,
        assumptions: ["Synthetic T-1006 fixture only."],
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
        reviewerStatus,
        sourceRefs: [],
        validationReport: {
          engine: "managed-v1",
          passed: true,
          inputHash: contentHash({ fixture: "t1006" }),
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

  async function eligibleFixture(label: string, reviewerStatus?: "NOT_REQUIRED" | "APPROVED") {
    const user = await account();
    const set = await publishedArtifacts(label);
    const safetyInput = clearSafetyInput(set);
    await evaluateCurrentClientNutritionSafety(artifactRequest(set.policyKey), safetyInput);
    const plan = await candidate(
      user.id,
      set,
      safetyInput.proposal!.proposedDailyEnergyKcal,
      reviewerStatus
    );
    return { user, set, safetyInput, plan, input: gateInput(set, plan.id) };
  }

  it("persists an immutable automatic approval bound to artifacts, revisions and candidate hash", async () => {
    const { user, set, plan, input } = await eligibleFixture("approved");
    const result = await evaluateCurrentClientAutonomyGate(artifactRequest(set.policyKey), input);
    expect(result).toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
      orderedReasonCodes: ["GATE_APPROVED"],
      approvedCandidatePlanVersionId: plan.id,
      nextActionTemplateId: "synthetic-pause-refer-template",
    });
    const row = await db.aiAutonomyGateDecision.findUniqueOrThrow({
      where: { id: result.decisionId },
    });
    expect(row).toMatchObject({
      clientId: user.id,
      approvedPlanVersionId: plan.id,
      candidatePayloadHash: plan.payloadHash,
      contextRevision: 0,
      profileRevision: 0,
      observationRevision: 0,
      safetyRevision: 0,
    });
    expect(row.artifactRefs).toHaveLength(5);
    await expect(
      db.aiAutonomyGateDecision.update({
        where: { id: row.id },
        data: { orderedReasonCodes: ["MODEL_REPLACEMENT"] },
      })
    ).rejects.toThrow("append-only");

    const exported = [];
    for await (const record of exportAiData(user.id)) exported.push(record);
    expect(exported).toContainEqual({
      dataset: "autonomyGateDecisions",
      record: expect.objectContaining({ id: row.id, clientId: user.id }),
    });
  });

  it("is deterministic for identical state and changes the binding when an input changes", async () => {
    const { set, input } = await eligibleFixture("deterministic");
    const first = await evaluateCurrentClientAutonomyGate(artifactRequest(set.policyKey), input);
    const replay = await evaluateCurrentClientAutonomyGate(artifactRequest(set.policyKey), input);
    expect(replay).toMatchObject({
      evaluationKey: first.evaluationKey,
      outcome: first.outcome,
      orderedReasonCodes: first.orderedReasonCodes,
    });

    const changed = structuredClone(input);
    changed.requiredInputs[0].status = "UNKNOWN";
    const clarified = await evaluateCurrentClientAutonomyGate(
      artifactRequest(set.policyKey),
      changed
    );
    expect(clarified).toMatchObject({
      outcome: "FOCUSED_CLARIFICATION",
      approvedCandidatePlanVersionId: null,
    });
    expect(clarified.evaluationKey).not.toBe(first.evaluationKey);
  });

  it("does not let reviewer approval bypass a newer deterministic T-1003 HOLD", async () => {
    const { user, set, safetyInput, plan, input } = await eligibleFixture(
      "reviewer-bypass",
      "APPROVED"
    );
    const policy = resolveNutritionSafetyPolicy(set.policyBundle.content);
    safetyInput.proposal!.proposedDailyEnergyKcal =
      policy.nutritionLimits.minimumDailyEnergyKcal - 1;
    await evaluateCurrentClientNutritionSafety(artifactRequest(set.policyKey), safetyInput);

    const result = await evaluateCurrentClientAutonomyGate(artifactRequest(set.policyKey), input);
    expect(result).toMatchObject({
      outcome: "HOLD",
      approvedCandidatePlanVersionId: null,
      orderedReasonCodes: expect.arrayContaining(["GATE_NUTRITION_SAFETY_HOLD"]),
    });
    expect(plan.reviewerStatus).toBe("APPROVED");
    expect(
      await db.aiAutonomyGateDecision.count({
        where: { clientId: user.id, approvedPlanVersionId: { not: null } },
      })
    ).toBe(0);
  });

  it("cannot approve when persisted provider authority is unavailable", async () => {
    const { user, set, input } = await eligibleFixture("authority");
    await db.aiCoachEntitlement.update({
      where: { clientId: user.id },
      data: { revokedAt: new Date() },
    });

    const result = await evaluateCurrentClientAutonomyGate(artifactRequest(set.policyKey), input);
    expect(result).toMatchObject({
      outcome: "PAUSE_REFER",
      orderedReasonCodes: ["GATE_AUTHORITY_UNAVAILABLE"],
      approvedCandidatePlanVersionId: null,
    });
  });

  it("rejects a candidate whose energy differs from the T-1003 checked proposal", async () => {
    const user = await account();
    const set = await publishedArtifacts("energy-mismatch");
    const safetyInput = clearSafetyInput(set);
    await evaluateCurrentClientNutritionSafety(artifactRequest(set.policyKey), safetyInput);
    const plan = await candidate(user.id, set, safetyInput.proposal!.proposedDailyEnergyKcal + 1);
    const result = await evaluateCurrentClientAutonomyGate(
      artifactRequest(set.policyKey),
      gateInput(set, plan.id)
    );
    expect(result).toMatchObject({
      outcome: "HOLD",
      orderedReasonCodes: ["GATE_CANDIDATE_INVALID"],
      approvedCandidatePlanVersionId: null,
    });
  });

  it("does not expose or approve another client's candidate", async () => {
    const { set, input } = await eligibleFixture("owner");
    const other = await account();
    const otherSafety = clearSafetyInput(set);
    await evaluateCurrentClientNutritionSafety(artifactRequest(set.policyKey), otherSafety);
    const result = await evaluateCurrentClientAutonomyGate(artifactRequest(set.policyKey), input);
    expect(result).toMatchObject({
      outcome: "HOLD",
      orderedReasonCodes: ["GATE_CANDIDATE_INVALID"],
      approvedCandidatePlanVersionId: null,
    });
    expect(
      await db.aiAutonomyGateDecision.findUniqueOrThrow({ where: { id: result.decisionId } })
    ).toMatchObject({ clientId: other.id, evaluatedPlanVersionId: input.candidatePlanVersionId });
  });

  it("fails closed when the selected policy is revoked", async () => {
    const { user, set, input } = await eligibleFixture("revoked");
    await revokeArtifactVersion(set.policyBundle.id, "Synthetic T-1006 revocation test");
    await expect(
      evaluateCurrentClientAutonomyGate(artifactRequest(set.policyKey), input)
    ).rejects.toMatchObject({ code: "ARTIFACT_REVOKED" });
    expect(await db.aiAutonomyGateDecision.count({ where: { clientId: user.id } })).toBe(0);
  });
});
