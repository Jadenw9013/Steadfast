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
import { buildPrescriptionInput, nutritionRequiredForGoal } from "../prescription";
import { classifyPrescriptionReasonCodes } from "../prescription-reason-classes";
import { unsubstantiatedEvidenceRuleIds } from "./evidence-status";
import {
  ArtifactLoadError,
  getReviewedEvidenceRegistryContent,
  getReviewedExerciseItem,
  getReviewedFoodItem,
  getReviewedPolicyBundleContent,
  type ArtifactLoadRequest,
  type LoadedArtifact,
  type ReviewedArtifactSet,
  withReviewedArtifactSetForCurrentClient,
} from "../artifacts/repository";
import { escalationTemplatesContentSchema, type PolicyBundleContent } from "../artifacts/schema";

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
  "GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE",
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
  /** T-2033 (T-2003 Amendment: gate.ts:415-427 lead ruling). `null` means a
   * legacy candidate (no `prescriptionOutcome` on the payload) and is read as
   * `{required:false, available:true}` so no historical candidate changes
   * meaning. Populated by the server entry point below from the candidate
   * payload's `prescriptionOutcome` plus `nutritionRequiredForGoal(intake)`. */
  prescription: { required: boolean; available: boolean; reasonCodes: string[] } | null;
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
 * T-2033 — frozen total map over `PrescriptionReasonCode` (T-2003 Contract
 * "Gate"). The three reason classes live in one place
 * (`prescription/reason-classes.ts`) because `initial-plan.ts` and
 * `finalization.ts` route off the same split (review r1 MINOR 5/7). An
 * unknown code (forward compatibility) is `POLICY_NOT_READY` -> `HOLD`.
 * Multiple codes resolve to the most protective outcome: `PAUSE_REFER` >
 * `HOLD` > `FOCUSED_CLARIFICATION`.
 */
function outcomeFor(
  reasonCodes: readonly string[]
): Exclude<AutonomyOutcome, "APPROVE_AUTOMATICALLY"> {
  const reasonClass = classifyPrescriptionReasonCodes(reasonCodes);
  if (reasonClass === "OUT_OF_SCOPE") return "PAUSE_REFER";
  if (reasonClass === "POLICY_NOT_READY") return "HOLD";
  return "FOCUSED_CLARIFICATION";
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

  // T-2033: placed before the nutritionSafety checks below (T-2003 Contract
  // "Gate"), so GATE_ORDER and the validationReport.checks shape are
  // unchanged — this still runs inside the TARGET_AND_LIMITS stage. Makes
  // APPROVE_AUTOMATICALLY unreachable whenever the engine explicitly says
  // the prescription is unavailable. `required` remains durable context for
  // old payload readers, but it must not suppress an OUT_OF_SCOPE or invalid-
  // input result: that was the hole that let MAINTAIN / NO_PREFERENCE (and an
  // otherwise incomplete goal) discard a clinical exclusion the engine had
  // already found. A genuinely legacy candidate has `prescription: null` and
  // retains the historical path below.
  if (facts.prescription && !facts.prescription.available) {
    return stoppedEvaluation(
      "TARGET_AND_LIMITS",
      outcomeFor(facts.prescription.reasonCodes),
      ["GATE_NUTRITION_PRESCRIPTION_UNAVAILABLE", ...facts.prescription.reasonCodes],
      []
    );
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

/**
 * T-2033 review r1 (MAJOR 2) — degrades instead of throwing.
 *
 * `orderedReasonCodes` can carry codes read off a persisted candidate payload
 * (`facts.prescription.reasonCodes`, typed as arbitrary strings in
 * `plan-contract.ts`), so a code a reviewed bundle has no obligation to
 * declare — a future `PrescriptionReasonCode`, or a row written by a newer
 * deploy and read by an older one — can reach here. Throwing on that aborts
 * the transaction *before* the `AiAutonomyGateDecision` row is written and
 * turns the client's request into a 503, which defeats `outcomeFor`'s
 * documented unknown-code-is-a-HOLD forward compatibility one call later.
 *
 * So: prefer a template covering the whole set; otherwise fall back to one
 * covering the leading `GATE_*` code, which the bundle must declare (the
 * live-launch validator in `artifacts/repository.ts` asserts that coverage at
 * publication). Only when even that is absent is the bundle genuinely
 * incompatible. The persisted decision row keeps the full
 * `orderedReasonCodes` alongside the resolved template id, so a degraded
 * resolution stays auditable.
 */
function resolveNextActionTemplateId(
  artifacts: ReviewedArtifactSet,
  policy: PolicyBundleContent,
  reasonCodes: readonly string[]
) {
  const content = escalationTemplatesContentSchema.parse(artifacts.escalationTemplates.content);
  const allowedIds = new Set(policy.escalationTemplateIds);
  const templateCovering = (codes: readonly string[]) =>
    content.templates.find(
      (candidate) =>
        allowedIds.has(candidate.id) &&
        codes.every((reason) => candidate.reasonCodes.includes(reason))
    );
  const template = templateCovering(reasonCodes);
  if (template) return template.id;
  const leadingGateReasonCode = reasonCodes.find((code) => code.startsWith("GATE_"));
  const degraded = leadingGateReasonCode ? templateCovering([leadingGateReasonCode]) : undefined;
  if (!degraded) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "No reviewed next-action template supports the deterministic gate outcome."
    );
  }
  return degraded.id;
}

/**
 * S-29 — refactored onto the shared predicate in `autonomy/evidence-status.ts`
 * so this precondition and finalization's `evidence[].status` derivation can
 * never again disagree about what "substantiated" means. Signature, message
 * and `ARTIFACT_INCOMPATIBLE` code are byte-identical to the S-17 version:
 * `tests/unit/ai-coach-evidence-rule-coverage.test.ts` and the S-17 fixture
 * comment both reference the message string.
 */
function assertEvidenceRulesHaveClaims(
  artifacts: ReviewedArtifactSet,
  policy: PolicyBundleContent
) {
  const evidence = getReviewedEvidenceRegistryContent(artifacts.evidenceRegistry);
  for (const ruleId of unsubstantiatedEvidenceRuleIds(policy.evidenceRuleIds, evidence.claims)) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      `No reviewed evidence claim supports policy evidence rule: ${ruleId}`
    );
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function sortedUniqueSourceRefs(groups: readonly (readonly SourceRef[])[]) {
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

/** T-2033 — server-derived, not trusted from the candidate payload: recomputed
 * from the account's *current* confirmed intake, the same way
 * `buildPrescriptionInput` would see it. `evaluatedOn` does not affect
 * `bodyWeightIntent`, so any valid calendar date string is fine here. */
function nutritionRequiredFromConfirmedIntake(confirmedIntake: unknown): boolean {
  const built = buildPrescriptionInput(confirmedIntake, "1970-01-01");
  return built.ok && nutritionRequiredForGoal(built.input);
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
    return { valid: false, payloadHash: null, sourceRefs: [] as SourceRef[], payload: null };
  }
  const candidate = await tx.aiPlanVersion.findFirst({
    where: { id: input.candidatePlanVersionId, clientId },
  });
  if (!candidate || candidate.status !== "PROPOSED") {
    return { valid: false, payloadHash: null, sourceRefs: [] as SourceRef[], payload: null };
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
    return {
      valid: false,
      payloadHash: candidate.payloadHash,
      sourceRefs: [] as SourceRef[],
      payload: null,
    };
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
    // T-2040 — modality authority lives here, on the reviewed artifact.
    // `planPayloadSchema` can only check modality for a catalog key this build
    // carries in code, so it no longer speaks for a live-bound plan; the
    // reviewed catalog does. A cardio movement sitting in `payload.strength`
    // (or the reverse) is a candidate defect, so it throws into the `catch`
    // below and lands on the existing `GATE_CANDIDATE_INVALID` — no new reason
    // code, no change to `validationReport.checks`.
    const assertModality = (exerciseId: string, required: "STRENGTH" | "CARDIO") => {
      const item = getReviewedExerciseItem(artifacts.exerciseCatalog, exerciseId);
      if (item.modality !== required) {
        throw new ArtifactLoadError(
          "ARTIFACT_INCOMPATIBLE",
          "The exercise modality does not match the session it is prescribed in."
        );
      }
    };
    for (const session of payload.strength) {
      for (const exercise of session.exercises) {
        assertModality(exercise.exerciseId, "STRENGTH");
      }
    }
    for (const session of payload.cardio) {
      assertModality(session.exerciseId, "CARDIO");
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
    payload,
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
            confirmedIntake: true,
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
      // S-29 — dedupe before the currency check. Finalization attaches the
      // *same* `sourceRefs` array to every evidence entry
      // (`finalization.ts`), so since T-2007 made `evidenceRuleIds` length 2,
      // `evidenceRefs` is the candidate's refs duplicated once per rule.
      // `evidenceIsCurrent` guards its input at `z.array(sourceRefSchema)
      // .max(2180)` and returns `false` on a parse failure
      // (`evidence-snapshot.ts`), and a candidate's refs can legitimately
      // reach 2180 (`collectEvidence` caps 180 observations + 2000
      // sessions), so an un-deduped candidate with more than 1090 refs would
      // silently fail this check (`GATE_EVIDENCE_STALE`) even though every
      // ref is current. Deduping is not a widening of the check: "are all of
      // these refs current" has the same answer for a multiset and its set;
      // the 2180 cap is an input-size guard, not part of the predicate.
      const evidenceCurrent = await evidenceIsCurrent(
        tx,
        clientId,
        sortedUniqueSourceRefs([evidenceRefs])
      );
      // T-2033: `null` when the candidate payload carries no
      // `prescriptionOutcome` (a legacy row, or one that failed to load at
      // all) — read as {required:false, available:true} so no historical
      // candidate changes meaning. `required` is recomputed from the
      // account's *current* confirmed intake rather than trusted from the
      // stored payload, matching this function's existing pattern of
      // server-derived, not candidate-supplied, facts.
      const prescription = candidate.payload?.prescriptionOutcome
        ? {
            required: nutritionRequiredFromConfirmedIntake(profile.confirmedIntake),
            available: candidate.payload.prescriptionOutcome.status === "PRESCRIBED",
            reasonCodes: candidate.payload.prescriptionOutcome.reasonCodes,
          }
        : null;
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
        prescription,
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
