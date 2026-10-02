import { Prisma } from "@/app/generated/prisma/client";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { z } from "zod";
import { AiCoachError } from "./access";
import {
  ArtifactLoadError,
  getReviewedEvidenceRegistryContent,
  getReviewedPolicyBundleContent,
  loadReviewedArtifactSet,
} from "./artifacts/repository";
import { deriveEvidenceGateEntries } from "./autonomy/evidence-status";
import { contentHash } from "./canonical-json";
import { isV2Intake, intakeAnswersSchema } from "./intake";
import { evaluateCurrentClientNutritionSafety } from "./nutrition-safety";
import { assertAiCoachOperationEnabled } from "./operations";
import { buildPrescriptionInput, computePrescription } from "./prescription";
import { classifyPrescriptionReasonCodes } from "./prescription-reason-classes";
import { resolvePrescriptionParametersForArtifacts } from "./prescription-binding";
import { runSnapshotSchema } from "./run-command";
import {
  resolveAiCoachRuntimeBinding,
  runRuntimeConstrainedProviderBoundary,
  runtimeArtifactRefs,
} from "./runtime-binding";
import { sourceRefSchema } from "./plan-contract";
import { safetyDisclosureSchema, type TriState } from "./safety";
import { validatedManagedPayload } from "./validated-plan";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function status(value: TriState | undefined): "CLEAR" | "EXCLUDED" | "UNKNOWN" {
  if (value === "NO") return "CLEAR";
  if (value === "YES") return "EXCLUDED";
  return "UNKNOWN";
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * T-1008 synthetic-only finalization. The caller supplies only the owned plan
 * identifier. Identity, safety answers, policy, evidence, revisions, catalog
 * candidates and provider implementation are all selected by the server.
 */
export async function finalizeCurrentClientPlan(planVersionId: string) {
  await assertAiCoachOperationEnabled("FINALIZATION");
  await assertAiCoachOperationEnabled("PROVIDER");
  const user = await getCurrentDbUser();
  const candidate = await db.aiPlanVersion.findFirst({
    where: { id: planVersionId, clientId: user.id, status: "PROPOSED" },
  });
  if (!candidate) throw new AiCoachError("NOT_FOUND", "Plan proposal not found.", 404);
  const payload = validatedManagedPayload(candidate);
  if (!payload) {
    throw new AiCoachError(
      "VALIDATION_ERROR",
      "This proposal cannot be verified against the current reviewed content.",
      422
    );
  }
  const [profile, disclosure] = await Promise.all([
    db.aiCoachProfile.findUnique({ where: { clientId: user.id } }),
    db.aiSafetyDisclosureEvent.findFirst({
      where: { clientId: user.id },
      orderBy: [{ reportedAt: "desc" }, { id: "desc" }],
    }),
  ]);
  if (!profile) {
    throw new AiCoachError("FORBIDDEN", "An AI Coach profile is required.", 403);
  }
  // T-2000: FIXTURE for a synthetic profile, LIVE (exact artifact references
  // from the sole ACTIVE release) for a real one. Fails closed to
  // TEMPORARILY_UNAVAILABLE when neither branch is currently usable.
  const binding = await resolveAiCoachRuntimeBinding(null, profile);
  const request = binding.artifactRequest;
  if (candidate.policyVersion !== request.policyArtifactKey) {
    throw new AiCoachError(
      "VALIDATION_ERROR",
      "The proposal is not bound to the current reviewed policy.",
      422
    );
  }
  const answers = safetyDisclosureSchema.safeParse(disclosure?.structuredAnswers);
  const allAnswered =
    answers.success &&
    [
      answers.data.ageEligibilityConcern,
      answers.data.eatingDisorderHistoryOrConcern,
      answers.data.type1Diabetes,
    ].every(Boolean);
  const screeningValues = answers.success ? Object.values(answers.data) : [];
  const screeningResult =
    !answers.success || !allAnswered
      ? "UNKNOWN"
      : screeningValues.includes("YES")
        ? "FLAGGED"
        : screeningValues.includes("UNSURE")
          ? "UNKNOWN"
          : "CLEAR";
  // Artifacts/policy load before the safety call: the screening instrument ID
  // and provenance below come from the loaded reviewed bundle and account
  // classification, never from a constant (T-2000 risk #3).
  let artifacts;
  try {
    artifacts = await loadReviewedArtifactSet(request);
  } catch (err) {
    // T-2000 parity finding P5: the artifact set can change between binding
    // resolution and this load (e.g. revoked); ArtifactLoadError extends the
    // plain Error base, so leaving it unwrapped would escape as an
    // unreadable message plus a spurious reportServerError anomaly.
    if (err instanceof ArtifactLoadError) {
      throw new AiCoachError(
        "TEMPORARILY_UNAVAILABLE",
        "AI coaching is not available for live use yet.",
        503
      );
    }
    throw err;
  }
  // T-2041 — the run's frozen binding is the authority, and this is the
  // explicit fail-closed for "the release rotated or an artifact was revoked
  // between request and finalize". `artifacts` above is today's set for this
  // account; `frozen` is the exact set the run that produced this candidate
  // was prepared against. A candidate with no run, or a run whose snapshot
  // predates T-2041, carries no frozen binding and skips the check entirely —
  // unchanged behaviour. The implicit fail-closed (the load above refusing a
  // revoked artifact) stays as the second layer.
  //
  // This is deliberately a rotation of *reviewed content*, which is the same
  // class as the existing `candidate.policyVersion` 422 a few lines above,
  // not a change in the client's own inputs — T-2033's replay keeps routing
  // those to a HOLD, and nothing here touches that path.
  const producingRun = await db.aiCoachRun.findFirst({
    where: { clientId: user.id, resultPlanVersionId: candidate.id, status: "COMPLETED" },
    // Mandatory (release-safety §3): `findFirst` over a set that can hold a
    // retry's duplicate must be ordered.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { inputSnapshot: true },
  });
  const storedSnapshot = producingRun
    ? runSnapshotSchema.safeParse(producingRun.inputSnapshot)
    : null;
  const frozen = storedSnapshot?.success ? storedSnapshot.data.runtimeBinding : undefined;
  if (frozen && contentHash(frozen.artifactRefs) !== contentHash(runtimeArtifactRefs(artifacts))) {
    throw new AiCoachError(
      "VALIDATION_ERROR",
      "The proposal was prepared against different reviewed content.",
      422
    );
  }
  const policy = getReviewedPolicyBundleContent(artifacts.policy);
  const provenance = binding.mode === "LIVE" ? "SERVER_VALIDATED_CLIENT_STATE" : "SYNTHETIC_SERVER_FIXTURE";
  const currentWeightKg =
    typeof (profile.confirmedIntake as { weightKg?: unknown } | null)?.weightKg === "number"
      ? (profile.confirmedIntake as { weightKg: number }).weightKg
      : null;

  let projectedWeeklyWeightChangeKg: number | null = null;
  if (payload.nutrition) {
    if (payload.nutrition.method === "SYNTHETIC_CATALOG_MATCH") {
      // LIVE: no invented clinical projection. FIXTURE: neutral synthetic
      // fixture value; not a live estimate or client-facing claim. Kept
      // exactly as before this ticket — this literal `0`/`null` only
      // applies to the legacy synthetic-catalog-match payload (T-2003
      // Amendment 1 §A1.5's "supersedes the 422 sentence" note).
      projectedWeeklyWeightChangeKg = binding.mode === "LIVE" ? null : 0;
    } else {
      // REVIEWED_PRESCRIPTION_V1 (T-2033 file item 5 / T-2003 Amendment 1
      // §A1.5): recomputed by replaying the engine against the stored
      // intake and the currently loaded bundle — never trusted from the
      // persisted number — then asserted against the stored
      // `targetEnergyKcal` and `parameterSetDigest`.
      //
      // Review r1 MAJOR 1 / MINOR 7: the replay reads the *live*
      // `confirmedIntake` at *today's* date, so it can differ from the
      // candidate's own generation input for two reasons that are not a
      // policy change at all — the client re-confirmed intake (a new
      // weigh-in), or a weight measurement simply aged past
      // `ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS` while the proposal
      // sat on screen. Neither means "the reviewed policy moved", and
      // Amendment 1 §A1.5 exists so an ordinary unrelated change does not
      // 422 an outstanding proposal. Each case therefore reports its own
      // reason code, and only a genuine target mismatch *at an equal
      // profileRevision* — i.e. the same inputs producing a different
      // number — is a hard 422.
      const holdWith = (reasonCodes: string[], nextAction: string) => ({
        outcome: "HOLD" as const,
        reasonCodes,
        nextAction,
        clarificationId: null,
      });
      const staleCandidateResult = holdWith(
        ["PRESCRIPTION_PARAMETER_SET_CHANGED"],
        "This proposal is stale against the current reviewed policy. Request a new plan."
      );
      if (candidate.profileRevision !== profile.profileRevision) {
        // The client's own inputs changed after this proposal was prepared
        // (`confirmIntake` bumps `profileRevision`), so the candidate is
        // stale against them and there is nothing to compare. This is the
        // graceful HOLD the gate's own `revisionsMatch` check
        // (`autonomy/gate.ts`, `GATE_CANDIDATE_INVALID`) would reach anyway.
        return holdWith(
          ["PRESCRIPTION_CANDIDATE_INPUTS_CHANGED"],
          "Your answers changed after this proposal was prepared. Request a new plan to use your latest answers."
        );
      }
      const evaluatedOn = new Date().toISOString().slice(0, 10);
      const built = buildPrescriptionInput(profile.confirmedIntake, evaluatedOn);
      const parametersResolution = built.ok
        ? resolvePrescriptionParametersForArtifacts(artifacts)
        : null;
      if (parametersResolution && !parametersResolution.ok) {
        // The currently loaded reviewed bundle can no longer supply the
        // engine's parameter set: the policy really did move.
        return staleCandidateResult;
      }
      const recomputed =
        built.ok && parametersResolution?.ok
          ? computePrescription(parametersResolution.parameters, built.input)
          : null;
      const replayReasonCodes = !built.ok
        ? built.reasonCodes
        : recomputed?.status === "UNAVAILABLE"
          ? recomputed.reasonCodes
          : [];
      if (!recomputed || recomputed.status === "UNAVAILABLE") {
        // The engine can no longer reproduce *any* comparable target, so
        // there is no `targetEnergyKcal` to compare against "no longer
        // matches" — always a HOLD, never a hard 422. Which HOLD depends on
        // *why*: a `POLICY_NOT_READY` class code means the reviewed content
        // this needs is unavailable; anything else means the client's own
        // inputs no longer satisfy the engine (MINOR 7's aged weigh-in is
        // `PRESCRIPTION_WEIGHT_MEASUREMENT_STALE`, a `CLIENT_FIXABLE` code),
        // which is not a parameter-set change and must not say it is.
        if (classifyPrescriptionReasonCodes(replayReasonCodes) === "POLICY_NOT_READY") {
          return staleCandidateResult;
        }
        return holdWith(
          ["PRESCRIPTION_CANDIDATE_INPUTS_NOT_REPRODUCIBLE", ...replayReasonCodes],
          "This proposal can no longer be reproduced from your current answers. Request a new plan."
        );
      }
      if (recomputed.prescription.targetEnergyKcal !== payload.nutrition.targets.energyKcal) {
        throw new AiCoachError(
          "VALIDATION_ERROR",
          "The proposal no longer matches the reviewed policy.",
          422
        );
      }
      if (recomputed.prescription.parameterSetDigest !== payload.prescriptionOutcome?.parameterSetDigest) {
        // Amendment 1 §A1.5: a digest-only mismatch (e.g. a reviewed
        // explanation-copy edit or a T-1003 floor change), with an equal
        // `targetEnergyKcal`, is a stale candidate, not a 422 — a copy edit
        // must not 422 every outstanding proposal in the system.
        return staleCandidateResult;
      }
      projectedWeeklyWeightChangeKg = recomputed.prescription.projectedWeeklyWeightChangeKg;
    }
  }

  await evaluateCurrentClientNutritionSafety(request, {
    screening: {
      instrumentId: policy.safetyControls.screening.instrumentId,
      result: screeningResult,
      provenance,
    },
    contraindications: {
      AGE_ELIGIBILITY: status(answers.success ? answers.data.ageEligibilityConcern : undefined),
      PREGNANCY_POSTPARTUM: status(answers.success ? answers.data.pregnantOrPostpartum : undefined),
      EATING_DISORDER_HISTORY_OR_CONCERN: status(
        answers.success ? answers.data.eatingDisorderHistoryOrConcern : undefined
      ),
      TYPE_1_DIABETES: status(answers.success ? answers.data.type1Diabetes : undefined),
      CARDIAC_CONDITION: status(answers.success ? answers.data.heartCondition : undefined),
    },
    proposal: payload.nutrition
      ? {
          proposedDailyEnergyKcal: payload.nutrition.targets.energyKcal,
          currentWeightKg,
          projectedWeeklyWeightChangeKg,
          provenance,
        }
      : null,
  });
  const sourceRefs = z.array(sourceRefSchema).parse(candidate.sourceRefs ?? []);
  // T-2000 review finding 1: the server can only verify these specific input
  // ids today. Any other id a reviewed bundle declares (real inputs land in
  // T-2003) maps to UNKNOWN, never a caller-asserted CONFIRMED, so the gate
  // fails closed to FOCUSED_CLARIFICATION instead of trusting an
  // unrecognized required input. The synthetic fixture bundle never declares
  // any id outside this set, so FIXTURE behavior is unchanged.
  const CONTRAINDICATION_REQUIRED_INPUT_IDS = new Set([
    "AGE_ELIGIBILITY",
    "PREGNANCY_POSTPARTUM",
    "EATING_DISORDER_HISTORY_OR_CONCERN",
    "TYPE_1_DIABETES",
    "CARDIAC_CONDITION",
  ]);
  const contraindicationStatusById: Record<string, "CLEAR" | "EXCLUDED" | "UNKNOWN"> = {
    AGE_ELIGIBILITY: status(answers.success ? answers.data.ageEligibilityConcern : undefined),
    PREGNANCY_POSTPARTUM: status(answers.success ? answers.data.pregnantOrPostpartum : undefined),
    EATING_DISORDER_HISTORY_OR_CONCERN: status(
      answers.success ? answers.data.eatingDisorderHistoryOrConcern : undefined
    ),
    TYPE_1_DIABETES: status(answers.success ? answers.data.type1Diabetes : undefined),
    CARDIAC_CONDITION: status(answers.success ? answers.data.heartCondition : undefined),
  };
  // T-2033 file item 5: `SYNTHETIC_REQUIRED_INPUT`'s status is now answered
  // from the intake v2 field statuses instead of a blunt "some confirmedIntake
  // exists" check — a v2-shaped `confirmedIntake` blob must actually satisfy
  // `intakeAnswersSchema` to count as confirmed, not merely be truthy. v1
  // confirmedIntake keeps the original existence check byte-for-byte (v1
  // rows have no field-status concept to check against). Every other id
  // this mapping does not recognise stays `UNKNOWN`, never `CONFIRMED`
  // (fail closed) — unchanged below.
  const confirmedIntakeConfirmed = isV2Intake(profile.confirmedIntake)
    ? intakeAnswersSchema.safeParse(profile.confirmedIntake).success
    : Boolean(profile.confirmedIntake);
  const requiredInputs = policy.requiredInputIds.map((id) => {
    if (id === "SYNTHETIC_REQUIRED_INPUT")
      return { id, status: confirmedIntakeConfirmed ? ("CONFIRMED" as const) : ("UNKNOWN" as const) };
    if (id === "SYNTHETIC_SCREEN_RESULT")
      return {
        id,
        status: screeningResult === "CLEAR" ? ("CONFIRMED" as const) : ("UNKNOWN" as const),
      };
    if (CONTRAINDICATION_REQUIRED_INPUT_IDS.has(id))
      return {
        id,
        status:
          contraindicationStatusById[id] === "CLEAR" ? ("CONFIRMED" as const) : ("UNKNOWN" as const),
      };
    return { id, status: "UNKNOWN" as const };
  });
  const requestedDomains = distinct(
    [
      payload.nutrition ? "NUTRITION" : null,
      payload.strength.length ? "STRENGTH" : null,
      payload.cardio.length ? "CARDIO" : null,
    ].filter((value): value is "NUTRITION" | "STRENGTH" | "CARDIO" => value !== null)
  );
  const gateInput = {
    requestedScopeClasses: distinct([
      ...(payload.nutrition ? ["GENERAL_BEHAVIOR_NUTRITION_EDUCATION" as const] : []),
      ...(payload.strength.length || payload.cardio.length
        ? ["GENERAL_FITNESS_PROGRAMMING" as const]
        : []),
    ]),
    requestedDomains,
    requiredInputs,
    // S-29 — derived provenance, not a caller-asserted guess: a policy
    // evidence rule is SUFFICIENT iff the reviewed, digest-verified
    // EVIDENCE_REGISTRY loaded for this account (`artifacts`, above) carries
    // a claim that lists it, UNKNOWN otherwise. T-2007 added
    // `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` to `evidenceRuleIds`, and the
    // real signed bundle declares neither of the ids a now-removed hardcoded
    // ternary recognised, so every real candidate used to finalize into
    // UNKNOWN -> GATE_EVIDENCE_MISSING -> FOCUSED_CLARIFICATION. This calls
    // the same shared predicate the gate's `assertEvidenceRulesHaveClaims`
    // precondition uses (`autonomy/gate.ts`), so the two can never again
    // disagree about what "substantiated" means, and it fails closed: a rule
    // with no covering claim still comes back UNKNOWN here, never SUFFICIENT.
    evidence: deriveEvidenceGateEntries({
      evidenceRuleIds: policy.evidenceRuleIds,
      claims: getReviewedEvidenceRegistryContent(artifacts.evidenceRegistry).claims,
      sourceRefs,
    }),
    candidatePlanVersionId: candidate.id,
  };
  const eligibleOptions = distinct([
    ...(payload.meals?.days.flatMap((day) =>
      day.meals.flatMap((meal) => meal.ingredients.map((item) => `FOOD:${item.foodId}`))
    ) ?? []),
    ...payload.strength.flatMap((session) =>
      session.exercises.map((item) => `EXERCISE:${item.exerciseId}`)
    ),
    ...payload.cardio.map((item) => `EXERCISE:${item.exerciseId}`),
  ]).map((reference) => {
    const [kind, id] = reference.split(":", 2);
    return { kind: kind as "FOOD" | "EXERCISE", id };
  });
  const result = await runRuntimeConstrainedProviderBoundary(binding, {
    languageSourceRefs: sourceRefs.filter((ref) => ref.kind === "CHECK_IN").slice(0, 5),
    eligibleOptions,
    gateInput,
  });
  if (result.outcome !== "APPROVE_AUTOMATICALLY" || !result.providerSelection) {
    return {
      outcome: result.outcome,
      reasonCodes: result.orderedReasonCodes,
      nextAction: result.nextAction,
      clarificationId: result.clarificationId ?? null,
    };
  }
  const audit = await db.aiProviderBoundaryAudit.findFirst({
    where: { id: result.auditId, clientId: user.id },
  });
  if (!audit?.finalGateDecisionId || audit.resultOutcome !== "APPROVE_AUTOMATICALLY") {
    throw new AiCoachError("TEMPORARILY_UNAVAILABLE", "Finalization could not be verified.", 503);
  }
  const gate = await db.aiAutonomyGateDecision.findFirst({
    where: { id: audit.finalGateDecisionId, clientId: user.id },
  });
  if (
    !gate ||
    gate.outcome !== "APPROVE_AUTOMATICALLY" ||
    gate.approvedPlanVersionId !== candidate.id ||
    gate.candidatePayloadHash !== candidate.payloadHash
  ) {
    throw new AiCoachError(
      "TEMPORARILY_UNAVAILABLE",
      "The deterministic gate did not authorize this proposal.",
      503
    );
  }
  const state = {
    clientId: user.id,
    planVersionId: candidate.id,
    gateDecisionId: gate.id,
    providerBoundaryAuditId: audit.id,
    evaluationKey: gate.evaluationKey,
    candidatePayloadHash: candidate.payloadHash,
    artifactRequest: request,
    artifactRefs: gate.artifactRefs,
    sourceRefs: gate.sourceRefs,
    gateInput,
    providerSelection: result.providerSelection,
  };
  const existing = await db.aiAutomaticPlanApproval.findUnique({
    where: { planVersionId: candidate.id },
  });
  const stateDigest = contentHash(state);
  if (existing) {
    // T-2030 review r1 MINOR 6 — `state.providerSelection` now potentially
    // contains model-authored explanation text (`constrained-boundary.ts`'s
    // `validatedExplanation`). A live (non-synthetic) provider is not
    // pinned to return byte-identical prose on a retried/duplicated call
    // for the same candidate, so once a live packet is ACTIVE, a
    // re-finalize of the same `planVersionId` will very likely hit this
    // `REVISION_CONFLICT` even though nothing about the *deterministic*
    // approval changed — this pre-existing class of false conflict
    // (ranked option order can already vary) goes from rare to expected.
    // Not reachable today (no ACTIVE live packet exists; this synthetic
    // path always calls the same deterministic `SyntheticConstrainedProvider`
    // twice-identically). Tracked for the live-provider rollout alongside
    // T-997, not fixed here — deciding whether prose belongs inside the
    // digest at all is a design call for that ticket, not this one.
    if (existing.stateDigest !== stateDigest) {
      throw new AiCoachError(
        "REVISION_CONFLICT",
        "The proposal was finalized against different state.",
        409
      );
    }
    return {
      outcome: result.outcome,
      approvalId: existing.id,
      reasonCodes: result.orderedReasonCodes,
    };
  }
  const approval = await db.aiAutomaticPlanApproval.create({
    data: {
      ...state,
      artifactRequest: json(request),
      artifactRefs: json(gate.artifactRefs),
      sourceRefs: json(gate.sourceRefs),
      gateInput: json(gateInput),
      providerSelection: json(result.providerSelection),
      stateDigest,
    },
  });
  return {
    outcome: result.outcome,
    approvalId: approval.id,
    reasonCodes: result.orderedReasonCodes,
  };
}
