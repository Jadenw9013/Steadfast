import type { Prisma } from "@/app/generated/prisma/client";
import { z } from "zod";
import { contentHash } from "../canonical-json";
import { evidenceIsCurrent } from "../evidence-snapshot";
import {
  nutritionSafetyEvaluationInputSchema,
  type NutritionSafetyDecision,
} from "../nutrition-safety";
import { sourceRefSchema, type SourceRef } from "../plan-contract";
import { validatedManagedPayload } from "../validated-plan";
import {
  ArtifactLoadError,
  getReviewedExerciseItem,
  getReviewedFoodItem,
  getReviewedPolicyBundleContent,
  type ArtifactLoadRequest,
  type LoadedArtifact,
  type ReviewedArtifactSet,
  withReviewedArtifactSetForCurrentClient,
} from "../artifacts/repository";
import {
  escalationTemplatesContentSchema,
  evidenceRegistryContentSchema,
  type PolicyBundleContent,
} from "../artifacts/schema";

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const autonomyOutcomeSchema = z.enum([
  "APPROVE_AUTOMATICALLY",
  "HOLD",
  "FOCUSED_CLARIFICATION",
  "PAUSE_REFER",
]);

export const autonomyGateReasonCodeSchema = z.enum([
  "GATE_APPROVED",
  "GATE_AUTHORITY_UNAVAILABLE",
  "GATE_OUT_OF_SCOPE",
  "GATE_SAFETY_RESTRICTED",
  "GATE_REQUIRED_INPUT_INVALID",
  "GATE_REQUIRED_INPUT_MISSING",
  "GATE_NUTRITION_SAFETY_UNAVAILABLE",
  "GATE_NUTRITION_SAFETY_HOLD",
  "GATE_NUTRITION_SAFETY_PAUSE_REFER",
  "GATE_EVIDENCE_INVALID",
  "GATE_EVIDENCE_MISSING",
  "GATE_EVIDENCE_INSUFFICIENT",
  "GATE_EVIDENCE_STALE",
  "GATE_CANDIDATE_INVALID",
]);

const scopeClassSchema = z.enum([
  "GENERAL_FITNESS_PROGRAMMING",
  "GENERAL_BEHAVIOR_NUTRITION_EDUCATION",
  "DIAGNOSIS",
  "TREATMENT_OR_REHABILITATION",
  "CLINICAL_NUTRITION_OR_MEDICAL_NUTRITION_THERAPY",
  "MEDICATION_OR_SUPPLEMENT_PRESCRIBING",
  "CLINICIAN_INSTRUCTION_OVERRIDE",
]);

const domainSchema = z.enum(["NUTRITION", "STRENGTH", "CARDIO"]);

export const serverAutonomyGateInputSchema = z
  .object({
    requestedScopeClasses: z.array(scopeClassSchema).min(1).max(7),
    requestedDomains: z.array(domainSchema).min(1).max(3),
    requiredInputs: z
      .array(
        z
          .object({
            id: identifierSchema,
            status: z.enum(["CONFIRMED", "DECLINED", "UNKNOWN"]),
          })
          .strict()
      )
      .max(100),
    evidence: z
      .array(
        z
          .object({
            ruleId: identifierSchema,
            status: z.enum(["SUFFICIENT", "INSUFFICIENT", "UNKNOWN"]),
            sourceRefs: z.array(sourceRefSchema).max(2_180),
          })
          .strict()
      )
      .max(100),
    candidatePlanVersionId: identifierSchema.nullable(),
  })
  .strict()
  .superRefine((input, ctx) => {
    for (const [path, values] of [
      ["requestedScopeClasses", input.requestedScopeClasses],
      ["requestedDomains", input.requestedDomains],
      ["requiredInputs", input.requiredInputs.map((item) => item.id)],
      ["evidence", input.evidence.map((item) => item.ruleId)],
    ] as const) {
      if (new Set(values).size !== values.length) {
        ctx.addIssue({ code: "custom", path: [path], message: `${path} must be unique.` });
      }
    }
  });

export type ServerAutonomyGateInput = z.infer<typeof serverAutonomyGateInputSchema>;
export type AutonomyOutcome = z.infer<typeof autonomyOutcomeSchema>;
export type AutonomyGateReasonCode = z.infer<typeof autonomyGateReasonCodeSchema>;

const GATE_ORDER = [
  "AUTHORITY",
  "ARTIFACT_COMPATIBILITY",
  "SCOPE_AND_SAFETY",
  "REQUIRED_INPUTS",
  "TARGET_AND_LIMITS",
  "EVIDENCE_SUFFICIENCY",
  "CANDIDATE_VALIDATION",
] as const;

type GateCheckName = (typeof GATE_ORDER)[number];
type GateCheck = { check: GateCheckName; status: "PASS" | "FAIL" | "NOT_REACHED" };

type VerifiedNutritionSafety = Pick<
  NutritionSafetyDecision,
  "outcome" | "reasonCodes" | "ruleIds" | "escalationTemplateIds"
> & {
  id: string;
  input: z.infer<typeof nutritionSafetyEvaluationInputSchema>;
};

export type AutonomyGateFacts = {
  authorityEligible: boolean;
  allowedScopeClasses: readonly string[];
  explicitExclusions: readonly string[];
  requiredInputIds: readonly string[];
  evidenceRuleIds: readonly string[];
  permissions: Record<z.infer<typeof domainSchema>, "ALLOW" | "HOLD_ONLY" | "PAUSED">;
  safetyDisposition: "CLEAR" | "CLARIFY" | "RESTRICTED" | "REFER" | "URGENT";
  nutritionSafety: VerifiedNutritionSafety | null;
  evidenceCurrent: boolean;
  candidateValid: boolean;
};

export type AutonomyGateEvaluation = {
  outcome: AutonomyOutcome;
  orderedReasonCodes: string[];
  ruleIds: string[];
  checks: GateCheck[];
  approvedCandidatePlanVersionId: string | null;
};

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function stoppedEvaluation(
  failedCheck: GateCheckName,
  outcome: Exclude<AutonomyOutcome, "APPROVE_AUTOMATICALLY">,
  orderedReasonCodes: string[],
  ruleIds: string[] = []
): AutonomyGateEvaluation {
  const failedIndex = GATE_ORDER.indexOf(failedCheck);
  return {
    outcome,
    orderedReasonCodes: unique(orderedReasonCodes),
    ruleIds: unique(ruleIds),
    checks: GATE_ORDER.map((check, index) => ({
      check,
      status: index < failedIndex ? "PASS" : index === failedIndex ? "FAIL" : "NOT_REACHED",
    })),
    approvedCandidatePlanVersionId: null,
  };
}

/**
 * Pure fixed-order T-1006 decision. Facts are produced by the authenticated
 * server entry point below. There is no reviewer, model, flag, or caller-owned
 * outcome override in this contract.
 */
export function evaluateAutonomyGate(
  input: ServerAutonomyGateInput,
  facts: AutonomyGateFacts
): AutonomyGateEvaluation {
  if (!facts.authorityEligible) {
    return stoppedEvaluation("AUTHORITY", "PAUSE_REFER", ["GATE_AUTHORITY_UNAVAILABLE"]);
  }

  const allowedScopes = new Set(facts.allowedScopeClasses);
  const explicitExclusions = new Set(facts.explicitExclusions);
  if (
    input.requestedScopeClasses.some(
      (scope) => explicitExclusions.has(scope) || !allowedScopes.has(scope)
    )
  ) {
    return stoppedEvaluation("SCOPE_AND_SAFETY", "PAUSE_REFER", ["GATE_OUT_OF_SCOPE"]);
  }
  if (
    facts.safetyDisposition !== "CLEAR" ||
    input.requestedDomains.some((domain) => facts.permissions[domain] !== "ALLOW")
  ) {
    return stoppedEvaluation("SCOPE_AND_SAFETY", "PAUSE_REFER", ["GATE_SAFETY_RESTRICTED"]);
  }

  const requiredIds = new Set(facts.requiredInputIds);
  const providedInputIds = new Set(input.requiredInputs.map((item) => item.id));
  if ([...providedInputIds].some((id) => !requiredIds.has(id))) {
    return stoppedEvaluation("REQUIRED_INPUTS", "FOCUSED_CLARIFICATION", [
      "GATE_REQUIRED_INPUT_INVALID",
    ]);
  }
  if (
    [...requiredIds].some((id) => !providedInputIds.has(id)) ||
    input.requiredInputs.some((item) => item.status !== "CONFIRMED")
  ) {
    return stoppedEvaluation("REQUIRED_INPUTS", "FOCUSED_CLARIFICATION", [
      "GATE_REQUIRED_INPUT_MISSING",
    ]);
  }

  if (!facts.nutritionSafety) {
    return stoppedEvaluation("TARGET_AND_LIMITS", "PAUSE_REFER", [
      "GATE_NUTRITION_SAFETY_UNAVAILABLE",
    ]);
  }
  if (facts.nutritionSafety.outcome === "PAUSE_REFER") {
    return stoppedEvaluation(
      "TARGET_AND_LIMITS",
      "PAUSE_REFER",
      ["GATE_NUTRITION_SAFETY_PAUSE_REFER", ...facts.nutritionSafety.reasonCodes],
      facts.nutritionSafety.ruleIds
    );
  }
  if (facts.nutritionSafety.outcome === "HOLD") {
    return stoppedEvaluation(
      "TARGET_AND_LIMITS",
      "HOLD",
      ["GATE_NUTRITION_SAFETY_HOLD", ...facts.nutritionSafety.reasonCodes],
      facts.nutritionSafety.ruleIds
    );
  }

  const evidenceRuleIds = new Set(facts.evidenceRuleIds);
  const providedEvidenceIds = new Set(input.evidence.map((item) => item.ruleId));
  if ([...providedEvidenceIds].some((id) => !evidenceRuleIds.has(id))) {
    return stoppedEvaluation("EVIDENCE_SUFFICIENCY", "HOLD", ["GATE_EVIDENCE_INVALID"]);
  }
  if (
    [...evidenceRuleIds].some((id) => !providedEvidenceIds.has(id)) ||
    input.evidence.some((item) => item.status === "UNKNOWN")
  ) {
    return stoppedEvaluation("EVIDENCE_SUFFICIENCY", "FOCUSED_CLARIFICATION", [
      "GATE_EVIDENCE_MISSING",
    ]);
  }
  if (input.evidence.some((item) => item.status === "INSUFFICIENT")) {
    return stoppedEvaluation(
      "EVIDENCE_SUFFICIENCY",
      "HOLD",
      ["GATE_EVIDENCE_INSUFFICIENT"],
      [...facts.evidenceRuleIds]
    );
  }
  if (!facts.evidenceCurrent) {
    return stoppedEvaluation("EVIDENCE_SUFFICIENCY", "HOLD", ["GATE_EVIDENCE_STALE"]);
  }

  if (!facts.candidateValid || !input.candidatePlanVersionId) {
    return stoppedEvaluation("CANDIDATE_VALIDATION", "HOLD", ["GATE_CANDIDATE_INVALID"]);
  }

  return {
    outcome: "APPROVE_AUTOMATICALLY",
    orderedReasonCodes: ["GATE_APPROVED"],
    ruleIds: [],
    checks: GATE_ORDER.map((check) => ({ check, status: "PASS" })),
    approvedCandidatePlanVersionId: input.candidatePlanVersionId,
  };
}

function artifactReference(artifact: LoadedArtifact) {
  return {
    id: artifact.id,
    artifactKey: artifact.artifactKey,
    version: artifact.version,
    kind: artifact.kind,
    digest: artifact.contentDigest,
  };
}

function resolveNextActionTemplateId(
  artifacts: ReviewedArtifactSet,
  policy: PolicyBundleContent,
  reasonCodes: readonly string[]
) {
  const content = escalationTemplatesContentSchema.parse(artifacts.escalationTemplates.content);
  const allowedIds = new Set(policy.escalationTemplateIds);
  const template = content.templates.find(
    (candidate) =>
      allowedIds.has(candidate.id) &&
      reasonCodes.every((reason) => candidate.reasonCodes.includes(reason))
  );
  if (!template) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "No reviewed next-action template supports the deterministic gate outcome."
    );
  }
  return template.id;
}

function assertEvidenceRulesHaveClaims(
  artifacts: ReviewedArtifactSet,
  policy: PolicyBundleContent
) {
  const evidence = evidenceRegistryContentSchema.parse(artifacts.evidenceRegistry.content);
  for (const ruleId of policy.evidenceRuleIds) {
    if (!evidence.claims.some((claim) => claim.ruleIds.includes(ruleId))) {
      throw new ArtifactLoadError(
        "ARTIFACT_INCOMPATIBLE",
        `No reviewed evidence claim supports policy evidence rule: ${ruleId}`
      );
    }
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sortedUniqueSourceRefs(groups: readonly (readonly SourceRef[])[]) {
  const refs = new Map<string, SourceRef>();
  for (const ref of groups.flat())
    refs.set(`${ref.kind}:${ref.id}:${ref.revision}:${ref.digest}`, ref);
  return [...refs.values()].sort((a, b) =>
    `${a.kind}:${a.id}:${a.revision}`.localeCompare(`${b.kind}:${b.id}:${b.revision}`)
  );
}

async function loadVerifiedNutritionSafety(
  tx: Prisma.TransactionClient,
  clientId: string,
  policy: LoadedArtifact
): Promise<VerifiedNutritionSafety | null> {
  const row = await tx.aiNutritionSafetyDecision.findFirst({
    where: { clientId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (
    !row ||
    row.policyArtifactId !== policy.id ||
    row.policyArtifactVersion !== policy.version ||
    row.policyArtifactDigest !== policy.contentDigest
  ) {
    return null;
  }
  const input = nutritionSafetyEvaluationInputSchema.safeParse(row.inputSnapshot);
  if (!input.success || contentHash(input.data) !== row.inputDigest) return null;
  const expectedEvaluationKey = contentHash({
    clientId,
    policyArtifactId: policy.id,
    policyArtifactDigest: policy.contentDigest,
    inputDigest: row.inputDigest,
    sourcePlanVersionIds: row.sourcePlanVersionIds,
  });
  if (expectedEvaluationKey !== row.evaluationKey) return null;
  return {
    id: row.id,
    outcome: row.outcome,
    reasonCodes: row.reasonCodes,
    ruleIds: row.ruleIds,
    escalationTemplateIds: row.escalationTemplateIds,
    input: input.data,
  };
}

async function validateCandidate(
  tx: Prisma.TransactionClient,
  clientId: string,
  input: ServerAutonomyGateInput,
  artifacts: ReviewedArtifactSet,
  revisions: {
    context: number;
    profile: number;
    observation: number;
    safety: number;
  },
  nutritionSafety: VerifiedNutritionSafety | null
) {
  if (!input.candidatePlanVersionId) {
    return { valid: false, payloadHash: null, sourceRefs: [] as SourceRef[] };
  }
  const candidate = await tx.aiPlanVersion.findFirst({
    where: { id: input.candidatePlanVersionId, clientId },
  });
  if (!candidate || candidate.status !== "PROPOSED") {
    return { valid: false, payloadHash: null, sourceRefs: [] as SourceRef[] };
  }
  const payload = validatedManagedPayload(candidate);
  const sourceRefs = z
    .array(sourceRefSchema)
    .max(2_180)
    .safeParse(candidate.sourceRefs ?? []);
  const catalogVersions = z
    .object({ food: identifierSchema, exercise: identifierSchema })
    .strict()
    .safeParse(candidate.catalogVersions);
  if (!payload || !sourceRefs.success || !catalogVersions.success) {
    return { valid: false, payloadHash: candidate.payloadHash, sourceRefs: [] as SourceRef[] };
  }

  const touchedDomains = new Set<string>(
    [
      payload.nutrition ? "NUTRITION" : null,
      payload.strength.length > 0 ? "STRENGTH" : null,
      payload.cardio.length > 0 ? "CARDIO" : null,
    ].filter((value): value is string => value !== null)
  );
  const requestedDomains = new Set(input.requestedDomains);
  const domainsMatch =
    touchedDomains.size === requestedDomains.size &&
    [...touchedDomains].every((domain) =>
      requestedDomains.has(domain as z.infer<typeof domainSchema>)
    );
  const energyMatchesSafety =
    !touchedDomains.has("NUTRITION") ||
    (nutritionSafety?.input.proposal !== null &&
      payload.nutrition?.targets.energyKcal ===
        nutritionSafety?.input.proposal.proposedDailyEnergyKcal);
  const bindingsMatch =
    candidate.policyVersion === payload.policyVersion &&
    payload.policyVersion === artifacts.policy.artifactKey &&
    catalogVersions.data.food === payload.catalogVersions.food &&
    catalogVersions.data.exercise === payload.catalogVersions.exercise &&
    payload.catalogVersions.food === artifacts.foodCatalog.artifactKey &&
    payload.catalogVersions.exercise === artifacts.exerciseCatalog.artifactKey;
  const revisionsMatch =
    candidate.contextRevision === revisions.context &&
    candidate.profileRevision === revisions.profile &&
    candidate.observationRevision === revisions.observation &&
    candidate.safetyRevision === revisions.safety;
  const sourcesCurrent = await evidenceIsCurrent(tx, clientId, sourceRefs.data);
  let catalogItemsValid = true;
  try {
    for (const day of payload.meals?.days ?? []) {
      for (const meal of day.meals) {
        for (const ingredient of meal.ingredients) {
          getReviewedFoodItem(artifacts.foodCatalog, ingredient.foodId);
        }
      }
    }
    for (const session of payload.strength) {
      for (const exercise of session.exercises) {
        getReviewedExerciseItem(artifacts.exerciseCatalog, exercise.exerciseId);
      }
    }
    for (const session of payload.cardio) {
      getReviewedExerciseItem(artifacts.exerciseCatalog, session.exerciseId);
    }
  } catch {
    catalogItemsValid = false;
  }
  return {
    valid:
      domainsMatch &&
      energyMatchesSafety &&
      bindingsMatch &&
      revisionsMatch &&
      sourcesCurrent &&
      catalogItemsValid,
    payloadHash: candidate.payloadHash,
    sourceRefs: sourceRefs.data,
  };
}

/**
 * Authenticated, server-only T-1006 entry point. The input is assembled by
 * deterministic services from persisted state. No public route is added by
 * this ticket, and no client/model-provided identity or authorization field is
 * accepted.
 */
export async function evaluateCurrentClientAutonomyGate(
  artifactRequest: ArtifactLoadRequest,
  rawInput: unknown
) {
  const input = serverAutonomyGateInputSchema.parse(rawInput);
  return withReviewedArtifactSetForCurrentClient(
    artifactRequest,
    async ({ tx, clientId, artifacts }) => {
      const policy = getReviewedPolicyBundleContent(artifacts.policy);
      assertEvidenceRulesHaveClaims(artifacts, policy);

      const [context, profile, entitlement, nutritionSafety] = await Promise.all([
        tx.clientCoachingContext.findUnique({
          where: { clientId },
          select: { mode: true, resolutionRequired: true, revision: true },
        }),
        tx.aiCoachProfile.findUnique({
          where: { clientId },
          select: {
            profileRevision: true,
            observationRevision: true,
            safetyRevision: true,
            safetyDisposition: true,
            nutritionPermission: true,
            strengthPermission: true,
            cardioPermission: true,
          },
        }),
        tx.aiCoachEntitlement.findUnique({
          where: { clientId },
          select: { expiresAt: true, revokedAt: true },
        }),
        loadVerifiedNutritionSafety(tx, clientId, artifacts.policy),
      ]);
      if (!profile) {
        throw new ArtifactLoadError("ACCOUNT_NOT_ELIGIBLE", "The AI Coach profile is unavailable.");
      }
      const now = new Date();
      const authorityEligible = Boolean(
        context &&
        context.mode === "AI" &&
        !context.resolutionRequired &&
        entitlement &&
        !entitlement.revokedAt &&
        (!entitlement.expiresAt || entitlement.expiresAt > now)
      );
      const revisions = {
        context: context?.revision ?? -1,
        profile: profile.profileRevision,
        observation: profile.observationRevision,
        safety: profile.safetyRevision,
      };
      const candidate = await validateCandidate(
        tx,
        clientId,
        input,
        artifacts,
        revisions,
        nutritionSafety
      );
      const evidenceRefs = input.evidence.flatMap((item) => item.sourceRefs);
      const evidenceCurrent = await evidenceIsCurrent(tx, clientId, evidenceRefs);
      const evaluation = evaluateAutonomyGate(input, {
        authorityEligible,
        allowedScopeClasses: artifacts.policy.reviewMetadata.allowedScope,
        explicitExclusions: artifacts.policy.reviewMetadata.explicitExclusions,
        requiredInputIds: policy.requiredInputIds,
        evidenceRuleIds: policy.evidenceRuleIds,
        permissions: {
          NUTRITION: profile.nutritionPermission,
          STRENGTH: profile.strengthPermission,
          CARDIO: profile.cardioPermission,
        },
        safetyDisposition: profile.safetyDisposition,
        nutritionSafety,
        evidenceCurrent,
        candidateValid: candidate.valid,
      });
      const nextActionTemplateId = resolveNextActionTemplateId(
        artifacts,
        policy,
        evaluation.orderedReasonCodes
      );
      const artifactRefs = [
        artifactReference(artifacts.policy),
        artifactReference(artifacts.foodCatalog),
        artifactReference(artifacts.exerciseCatalog),
        artifactReference(artifacts.evidenceRegistry),
        artifactReference(artifacts.escalationTemplates),
      ];
      const sourceRefs = sortedUniqueSourceRefs([evidenceRefs, candidate.sourceRefs]);
      const inputSnapshot = {
        schemaVersion: 1,
        requestedScopeClasses: input.requestedScopeClasses,
        requestedDomains: input.requestedDomains,
        requiredInputs: input.requiredInputs,
        evidence: input.evidence,
        candidatePlanVersionId: input.candidatePlanVersionId,
        candidatePayloadHash: candidate.payloadHash,
        nutritionSafetyDecisionId: nutritionSafety?.id ?? null,
        revisions,
      };
      const inputDigest = contentHash(inputSnapshot);
      const evaluationKey = contentHash({ clientId, artifactRefs, inputDigest });
      const row = await tx.aiAutonomyGateDecision.create({
        data: {
          clientId,
          evaluationKey,
          outcome: evaluation.outcome,
          orderedReasonCodes: evaluation.orderedReasonCodes,
          ruleIds: evaluation.ruleIds,
          nextActionTemplateId,
          artifactRefs: json(artifactRefs),
          sourceRefs: json(sourceRefs),
          inputSnapshot: json(inputSnapshot),
          inputDigest,
          validationReport: json({ schemaVersion: 1, checks: evaluation.checks }),
          contextRevision: revisions.context,
          profileRevision: revisions.profile,
          observationRevision: revisions.observation,
          safetyRevision: revisions.safety,
          nutritionSafetyDecisionId: nutritionSafety?.id ?? null,
          evaluatedPlanVersionId: input.candidatePlanVersionId,
          approvedPlanVersionId: evaluation.approvedCandidatePlanVersionId,
          candidatePayloadHash: candidate.payloadHash,
        },
      });
      return {
        decisionId: row.id,
        evaluationKey,
        outcome: evaluation.outcome,
        orderedReasonCodes: evaluation.orderedReasonCodes,
        nextActionTemplateId,
        approvedCandidatePlanVersionId: evaluation.approvedCandidatePlanVersionId,
      };
    }
  );
}
