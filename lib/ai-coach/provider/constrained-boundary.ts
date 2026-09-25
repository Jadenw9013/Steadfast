import { randomUUID } from "node:crypto";
import type { Prisma } from "@/app/generated/prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  evaluateCurrentClientAutonomyGate,
  serverAutonomyGateInputSchema,
  type AutonomyOutcome,
} from "../autonomy/gate";
import {
  ArtifactLoadError,
  getReviewedExerciseItem,
  getReviewedFoodItem,
  loadReviewedArtifactSet,
  reviewedCatalogDisplayNames,
  type ArtifactLoadRequest,
  type ReviewedArtifactSet,
} from "../artifacts/repository";
import { escalationTemplatesContentSchema } from "../artifacts/schema";
import { contentHash } from "../canonical-json";
import { observationDigest } from "../evidence";
import { observationSchema } from "../observation-contract";
import { sourceRefSchema } from "../plan-contract";
import { validatedManagedPayload } from "../validated-plan";
import { formatNumericDisplayValue } from "../numeric-display";
import {
  callConstrainedProvider,
  constrainedProviderEnvelopeSchema,
  type ConstrainedModelProvider,
  type ConstrainedProviderCallResult,
  type ConstrainedProviderEnvelope,
  type ConstrainedProviderExecutionPolicy,
  type ConstrainedProviderMeasurement,
  type ConstrainedProviderOutput,
} from "./adapter";
import {
  PROSE_CONTRACT_VERSION,
  validateExplanationProse,
  type ProseDisplayName,
  type ProseInputs,
  type ProseRejectionCode,
  type ProseValidation,
} from "./explanation-prose";

/** T-2006 — character budgets are the boundary's own constants, never sent
 * by the caller. `explanationInputs.maxCharacters` (envelope, sent to the
 * model) mirrors `EXPLANATION_MAX_CHARACTERS`; the model is never told the
 * clarification budget separately (`PROSE_SYSTEM_RULES` states it as text).
 */
const EXPLANATION_MAX_CHARACTERS = 400;
const EXPLANATION_MIN_CHARACTERS = 40;
const CLARIFICATION_MAX_CHARACTERS = 200;
const CLARIFICATION_MIN_CHARACTERS = 20;

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const eligibleOptionSchema = z
  .object({ kind: z.enum(["FOOD", "EXERCISE"]), id: identifierSchema })
  .strict();

export const constrainedProviderBoundaryInputSchema = z
  .object({
    languageSourceRefs: z.array(sourceRefSchema.refine((ref) => ref.kind === "CHECK_IN")).max(5),
    eligibleOptions: z.array(eligibleOptionSchema).max(100),
    gateInput: serverAutonomyGateInputSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    const languageIds = input.languageSourceRefs.map((item) => item.id);
    if (new Set(languageIds).size !== languageIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["languageSourceRefs"],
        message: "Current-client language source IDs must be unique.",
      });
    }
    const optionIds = input.eligibleOptions.map((item) => `${item.kind}:${item.id}`);
    if (new Set(optionIds).size !== optionIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["eligibleOptions"],
        message: "Eligible catalog option IDs must be unique.",
      });
    }
  });

export type ConstrainedProviderBoundaryInput = z.infer<
  typeof constrainedProviderBoundaryInputSchema
>;

const PREFERENCE_IDS = ["SYNTHETIC_PREFERENCE_SIMPLE", "SYNTHETIC_PREFERENCE_BUDGET"] as const;
const CLARIFICATION_IDS = ["SYNTHETIC_CLARIFY_PREFERENCE"] as const;
const LIMITATIONS = [
  {
    id: "SYNTHETIC_TEST_ONLY",
    text: "Synthetic fixture output only. It is not approved for client use.",
  },
] as const;

export type ConstrainedProviderBoundaryRuntime = {
  promptContractVersion: ConstrainedProviderEnvelope["promptContractVersion"];
  languageProvenance: ConstrainedProviderEnvelope["currentClientLanguage"][number]["provenance"];
  preferenceIds: readonly string[];
  clarificationIds: readonly string[];
  limitations: readonly { id: string; text: string }[];
  providerConfiguration: string;
  executionPolicy?: ConstrainedProviderExecutionPolicy;
};

const SYNTHETIC_BOUNDARY_RUNTIME: ConstrainedProviderBoundaryRuntime = {
  promptContractVersion: "t1007-synthetic-v1",
  languageProvenance: "SYNTHETIC_SERVER_FIXTURE",
  preferenceIds: PREFERENCE_IDS,
  clarificationIds: CLARIFICATION_IDS,
  limitations: LIMITATIONS,
  providerConfiguration: "SYNTHETIC_CONSTRAINED_PROVIDER_ONLY",
};

export type NumericField = {
  id: string;
  value: number;
  unit: "KCAL_PER_DAY" | "GRAMS_PER_DAY";
  displayLabel: string;
  displayValue: string;
};

const NUMERIC_FIELD_DISPLAY_LABELS: Record<string, string> = {
  NUTRITION_ENERGY_KCAL: "Energy",
  NUTRITION_PROTEIN_G: "Protein",
  NUTRITION_CARBS_G: "Carbohydrates",
  NUTRITION_FAT_G: "Fat",
};

/**
 * T-2030 review r1 MINOR 5 — re-exported from the dependency-free
 * `lib/ai-coach/numeric-display.ts` so this remains the only place a
 * validated number becomes a string for a model to read, and
 * `plan-display.tsx` (client-reachable) can use the identical formatter
 * without importing this (server-only, `db`-importing) module.
 */
export { formatNumericDisplayValue };

export type ReviewedNextAction = {
  templateId: string;
  locale: string;
  nextStepText: string;
  nonMonitoringStatement: string;
};

type GateResult = Awaited<ReturnType<typeof evaluateCurrentClientAutonomyGate>>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function artifactBindingsMatch(rawRefs: unknown, artifacts: ReviewedArtifactSet): boolean {
  const parsed = z
    .array(z.object({ id: z.string(), kind: z.string(), digest: z.string() }).passthrough())
    .safeParse(rawRefs);
  if (!parsed.success) return false;
  const expected = [
    artifacts.policy,
    artifacts.foodCatalog,
    artifacts.exerciseCatalog,
    artifacts.evidenceRegistry,
    artifacts.escalationTemplates,
  ];
  if (parsed.data.length !== expected.length) return false;
  return expected.every((artifact) =>
    parsed.data.some(
      (ref) =>
        ref.id === artifact.id &&
        ref.kind === artifact.kind &&
        ref.digest === artifact.contentDigest
    )
  );
}

function reviewedNextAction(
  artifacts: ReviewedArtifactSet,
  templateId: string
): ReviewedNextAction {
  const registry = escalationTemplatesContentSchema.parse(artifacts.escalationTemplates.content);
  const template = registry.templates.find((item) => item.id === templateId);
  if (!template) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "The deterministic gate selected an unavailable next-action template."
    );
  }
  return {
    templateId: template.id,
    locale: template.locale,
    nextStepText: template.nextStepText,
    nonMonitoringStatement: template.nonMonitoringStatement,
  };
}

function validateEligibleOptions(
  artifacts: ReviewedArtifactSet,
  options: readonly z.infer<typeof eligibleOptionSchema>[]
): ProseDisplayName[] {
  return options.map((option) => {
    const item =
      option.kind === "FOOD"
        ? getReviewedFoodItem(artifacts.foodCatalog, option.id)
        : getReviewedExerciseItem(artifacts.exerciseCatalog, option.id);
    return { optionId: optionReference(option), name: item.name };
  });
}

function optionReference(option: z.infer<typeof eligibleOptionSchema>) {
  return `${option.kind}:${option.id}`;
}

async function loadCurrentClientLanguage(
  clientId: string,
  refs: readonly z.infer<typeof sourceRefSchema>[],
  provenance: ConstrainedProviderEnvelope["currentClientLanguage"][number]["provenance"]
) {
  const rows = await db.aiCheckInObservation.findMany({
    where: {
      clientId,
      id: { in: refs.map((ref) => ref.id) },
      submitted: true,
      deletedAt: null,
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return refs.map((ref) => {
    const row = byId.get(ref.id);
    if (!row || row.revision !== ref.revision || observationDigest(row) !== ref.digest) {
      throw new ArtifactLoadError(
        "ARTIFACT_INCOMPATIBLE",
        "A current-client language source is unavailable or stale."
      );
    }
    const payload = observationSchema.safeParse(row.payload);
    const text = payload.success ? payload.data.notes?.trim() : null;
    if (!text) {
      throw new ArtifactLoadError(
        "ARTIFACT_INCOMPATIBLE",
        "A current-client language source has no validated text."
      );
    }
    return {
      id: row.id,
      text,
      provenance,
    };
  });
}

function candidateNumericFields(payload: NonNullable<ReturnType<typeof validatedManagedPayload>>) {
  const fields: NumericField[] = [];
  if (payload.nutrition) {
    const entries: readonly [string, number, NumericField["unit"]][] = [
      ["NUTRITION_ENERGY_KCAL", payload.nutrition.targets.energyKcal, "KCAL_PER_DAY"],
      ["NUTRITION_PROTEIN_G", payload.nutrition.targets.proteinG, "GRAMS_PER_DAY"],
      ["NUTRITION_CARBS_G", payload.nutrition.targets.carbsG, "GRAMS_PER_DAY"],
      ["NUTRITION_FAT_G", payload.nutrition.targets.fatG, "GRAMS_PER_DAY"],
    ];
    for (const [id, value, unit] of entries) {
      fields.push({
        id,
        value,
        unit,
        displayLabel: NUMERIC_FIELD_DISPLAY_LABELS[id],
        displayValue: formatNumericDisplayValue(value),
      });
    }
  }
  return fields;
}

async function loadGateAudit(result: GateResult) {
  return db.aiAutonomyGateDecision.findUniqueOrThrow({
    where: { id: result.decisionId },
    select: {
      id: true,
      clientId: true,
      evaluationKey: true,
      artifactRefs: true,
      candidatePayloadHash: true,
      approvedPlanVersionId: true,
    },
  });
}

async function loadCandidateNumericFields(
  clientId: string,
  candidateId: string,
  expectedHash: string | null
) {
  const candidate = await db.aiPlanVersion.findFirst({
    where: { id: candidateId, clientId },
  });
  if (!candidate || candidate.payloadHash !== expectedHash) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "The deterministic candidate changed before provider interpretation."
    );
  }
  const payload = validatedManagedPayload(candidate);
  if (!payload) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "The deterministic candidate is no longer valid."
    );
  }
  return candidateNumericFields(payload);
}

function buildEnvelope(
  input: ConstrainedProviderBoundaryInput,
  gate: GateResult,
  numericFields: readonly NumericField[],
  currentClientLanguage: ConstrainedProviderEnvelope["currentClientLanguage"],
  runtime: ConstrainedProviderBoundaryRuntime,
  explanationInputs: ConstrainedProviderEnvelope["explanationInputs"] = null
): ConstrainedProviderEnvelope {
  return constrainedProviderEnvelopeSchema.parse({
    schemaVersion: 1,
    operationId: randomUUID(),
    promptContractVersion: runtime.promptContractVersion,
    task: "INTERPRET_RANK_EXPLAIN",
    currentClientLanguage,
    allowed: {
      optionIds: input.eligibleOptions.map(optionReference),
      preferenceIds: runtime.preferenceIds,
      clarificationIds: runtime.clarificationIds,
      explanationTemplateIds: [gate.nextActionTemplateId],
      reasonCodes: gate.orderedReasonCodes,
      numericFieldIds: numericFields.map((field) => field.id),
      limitationIds: [
        ...runtime.limitations.map((limitation) => limitation.id),
        "REVIEWED_NON_MONITORING_STATEMENT",
      ],
    },
    explanationInputs,
    capabilities: {
      tools: [],
      browsing: false,
      rag: false,
      liveResearch: false,
      crossClientMemory: false,
    },
  });
}

function minimizedInputSnapshot(
  envelope: ConstrainedProviderEnvelope,
  gateInputDigest: string,
  languageSourceRefs: readonly z.infer<typeof sourceRefSchema>[]
) {
  return {
    schemaVersion: 1,
    operationId: envelope.operationId,
    promptContractVersion: envelope.promptContractVersion,
    task: envelope.task,
    gateInputDigest,
    languageSourceRefs,
    currentClientLanguage: envelope.currentClientLanguage.map((item) => ({
      id: item.id,
      digest: contentHash(item.text),
      provenance: item.provenance,
    })),
    allowed: envelope.allowed,
    capabilities: envelope.capabilities,
  };
}

/** T-2006 — audited alongside `validatedOutput`, never the rejected text itself. */
type ProseValidationOutcome = "ACCEPTED" | "REJECTED" | "ABSENT";
type ProseValidationSummary = {
  outcome: ProseValidationOutcome;
  reasonCodes: ProseRejectionCode[];
  characters: number;
};
type ExplanationValidationAudit = {
  schemaVersion: 1;
  contractVersion: string;
  explanation: ProseValidationSummary;
  clarification: ProseValidationSummary;
};

async function persistAudit(input: {
  clientId: string;
  boundaryOutcome: "VALIDATED" | "SKIPPED_GATE" | "FAIL_CLOSED" | "CAUTION";
  resultOutcome: AutonomyOutcome;
  failureCode: string | null;
  attempts: number;
  preGateDecisionId: string;
  finalGateDecisionId: string | null;
  envelope: ConstrainedProviderEnvelope;
  gateInputDigest: string;
  output: ConstrainedProviderOutput | null;
  measurement: ConstrainedProviderMeasurement | null;
  languageSourceRefs: readonly z.infer<typeof sourceRefSchema>[];
  providerConfiguration: string;
  explanationValidation?: ExplanationValidationAudit | null;
}) {
  const inputSnapshot = minimizedInputSnapshot(
    input.envelope,
    input.gateInputDigest,
    input.languageSourceRefs
  );
  return db.aiProviderBoundaryAudit.create({
    data: {
      clientId: input.clientId,
      operationId: input.envelope.operationId,
      promptContractVersion: input.envelope.promptContractVersion,
      providerConfiguration: input.providerConfiguration,
      boundaryOutcome: input.boundaryOutcome,
      resultOutcome: input.resultOutcome,
      failureCode: input.failureCode,
      attempts: input.attempts,
      preGateDecisionId: input.preGateDecisionId,
      finalGateDecisionId: input.finalGateDecisionId,
      inputSnapshot: json(inputSnapshot),
      inputDigest: contentHash(inputSnapshot),
      validatedOutput: input.output ? json(input.output) : undefined,
      outputDigest: input.output ? contentHash(input.output) : null,
      usage: input.measurement ? json(input.measurement) : undefined,
      explanationValidation: input.explanationValidation
        ? json(input.explanationValidation)
        : undefined,
    },
  });
}

/** Exported for the golden `stateDigest` regression test
 * (`tests/unit/ai-coach-golden-state-digest.test.ts`) — review r1 MINOR 1
 * requires the pinned pre-change hex to be asserted against the real,
 * exported function, not a hand-copied reimplementation. */
export function validatedExplanation(
  output: ConstrainedProviderOutput,
  nextAction: ReviewedNextAction,
  numericFields: readonly NumericField[],
  runtime: ConstrainedProviderBoundaryRuntime,
  explanationValidation: ProseValidation
) {
  const requestedNumericFields = new Set(output.explanation.numericFieldIds);
  return {
    templateId: nextAction.templateId,
    locale: nextAction.locale,
    reasonCodes: output.explanation.reasonCodes,
    nextStepText: nextAction.nextStepText,
    // Deliberately the narrow {id, value, unit} shape this has always been —
    // never the widened NumericField used for the envelope/validator. This
    // object sits inside `providerSelection`, which is hashed into
    // `AiAutomaticPlanApproval.stateDigest`; widening it here would change
    // the digest for every existing row, not just the ones with prose.
    numericFields: numericFields
      .filter((field) => requestedNumericFields.has(field.id))
      .map(({ id, value, unit }) => ({ id, value, unit })),
    limitations: [
      ...runtime.limitations,
      {
        id: "REVIEWED_NON_MONITORING_STATEMENT",
        text: nextAction.nonMonitoringStatement,
      },
    ],
    // T-2006 — omitted entirely (never `text: undefined`) when there is no
    // validated prose. `canonicalJson` throws on `undefined`, and an extra
    // key on every existing row would change `stateDigest` for approvals
    // that predate this ticket. See the golden `stateDigest` regression.
    ...(explanationValidation.accepted ? { text: explanationValidation.text } : {}),
  };
}

/**
 * R10 — structural retention, separate from the pure validator's own R9
 * lexical outcome check. Even lexically clean prose is dropped when the
 * final boundary outcome does not structurally permit it (e.g. an
 * explanation on a HOLD that never mentions a "change" word but is still
 * not an approval).
 */
function applyStructuralRetention(
  validation: ProseValidation,
  structurallyEligible: boolean
): ProseValidation {
  if (structurallyEligible) return validation;
  if (!validation.accepted) {
    return validation.reasonCodes.includes("PROSE_OUTCOME_MISMATCH")
      ? validation
      : { accepted: false, reasonCodes: [...validation.reasonCodes, "PROSE_OUTCOME_MISMATCH"] };
  }
  return { accepted: false, reasonCodes: ["PROSE_OUTCOME_MISMATCH"] };
}

/** Audit-row summary only: reason codes and a length, never the text itself. */
function summarizeProseValidation(
  raw: string | null | undefined,
  validation: ProseValidation
): ProseValidationSummary {
  if (raw === null || raw === undefined) {
    return { outcome: "ABSENT", reasonCodes: [], characters: 0 };
  }
  if (validation.accepted) {
    return { outcome: "ACCEPTED", reasonCodes: [], characters: validation.characters };
  }
  return { outcome: "REJECTED", reasonCodes: validation.reasonCodes, characters: 0 };
}

async function failClosedAfterApprovedGate(input: {
  clientId: string;
  gate: GateResult;
  envelope: ConstrainedProviderEnvelope;
  gateInputDigest: string;
  nextAction: ReviewedNextAction;
  failureCode: string;
  attempts: number;
  measurement?: ConstrainedProviderMeasurement;
  languageSourceRefs?: readonly z.infer<typeof sourceRefSchema>[];
  runtime: ConstrainedProviderBoundaryRuntime;
}) {
  const audit = await persistAudit({
    clientId: input.clientId,
    boundaryOutcome: "FAIL_CLOSED",
    resultOutcome: "HOLD",
    failureCode: input.failureCode,
    attempts: input.attempts,
    preGateDecisionId: input.gate.decisionId,
    finalGateDecisionId: null,
    envelope: input.envelope,
    gateInputDigest: input.gateInputDigest,
    output: null,
    measurement: input.measurement ?? null,
    languageSourceRefs: input.languageSourceRefs ?? [],
    providerConfiguration: input.runtime.providerConfiguration,
  });
  return {
    auditId: audit.id,
    outcome: "HOLD" as const,
    orderedReasonCodes: [input.failureCode],
    nextAction: input.nextAction,
    approvedCandidatePlanVersionId: null,
    providerSelection: null,
  };
}

/**
 * T-1007 authenticated structural boundary. T-1006 runs before the provider
 * receives any data and again after external I/O. Only an exact second
 * automatic approval can expose the pre-existing server-owned candidate.
 */
export async function runConstrainedProviderBoundary(
  artifactRequest: ArtifactLoadRequest,
  rawInput: unknown,
  provider: ConstrainedModelProvider,
  runtime: ConstrainedProviderBoundaryRuntime = SYNTHETIC_BOUNDARY_RUNTIME
) {
  const input = constrainedProviderBoundaryInputSchema.parse(rawInput);
  const gateInputDigest = contentHash(input.gateInput);
  const preGate = await evaluateCurrentClientAutonomyGate(artifactRequest, input.gateInput);
  const preGateAudit = await loadGateAudit(preGate);

  const artifacts = await loadReviewedArtifactSet(artifactRequest);
  if (!artifactBindingsMatch(preGateAudit.artifactRefs, artifacts)) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "Reviewed artifacts changed before constrained provider interpretation."
    );
  }
  const nextAction = reviewedNextAction(artifacts, preGate.nextActionTemplateId);

  if (preGate.outcome !== "APPROVE_AUTOMATICALLY") {
    const envelope = buildEnvelope(input, preGate, [], [], runtime);
    const audit = await persistAudit({
      clientId: preGateAudit.clientId,
      boundaryOutcome: "SKIPPED_GATE",
      resultOutcome: preGate.outcome,
      failureCode: "DETERMINISTIC_GATE_REJECTED",
      attempts: 0,
      preGateDecisionId: preGate.decisionId,
      finalGateDecisionId: null,
      envelope,
      gateInputDigest,
      output: null,
      measurement: null,
      languageSourceRefs: [],
      providerConfiguration: runtime.providerConfiguration,
    });
    return {
      auditId: audit.id,
      outcome: preGate.outcome,
      orderedReasonCodes: preGate.orderedReasonCodes,
      nextAction,
      approvedCandidatePlanVersionId: null,
      providerSelection: null,
    };
  }

  let currentClientLanguage: ConstrainedProviderEnvelope["currentClientLanguage"];
  let displayNames: ProseDisplayName[];
  try {
    displayNames = validateEligibleOptions(artifacts, input.eligibleOptions);
    currentClientLanguage = await loadCurrentClientLanguage(
      preGateAudit.clientId,
      input.languageSourceRefs,
      runtime.languageProvenance
    );
  } catch {
    const envelope = buildEnvelope(input, preGate, [], [], runtime);
    return failClosedAfterApprovedGate({
      clientId: preGateAudit.clientId,
      gate: preGate,
      envelope,
      gateInputDigest,
      nextAction,
      failureCode: "PROVIDER_SERVER_INPUT_INVALID",
      attempts: 0,
      runtime,
    });
  }
  const candidateId = preGate.approvedCandidatePlanVersionId;
  if (!candidateId || candidateId !== preGateAudit.approvedPlanVersionId) {
    throw new ArtifactLoadError(
      "ARTIFACT_INCOMPATIBLE",
      "T-1006 did not bind the approved candidate consistently."
    );
  }
  const numericFields = await loadCandidateNumericFields(
    preGateAudit.clientId,
    candidateId,
    preGateAudit.candidatePayloadHash
  );
  // Server-side only (never sent to the model): the denylist R7 checks a
  // mentioned food/exercise name against.
  const catalogVocabulary = reviewedCatalogDisplayNames(artifacts);
  const explanationInputs: ConstrainedProviderEnvelope["explanationInputs"] = {
    // The only outcome buildEnvelope is ever called with here is
    // APPROVE_AUTOMATICALLY — this branch is only reached after that check
    // above. The envelope type carries the other outcomes only so the pure
    // validator can be exercised against them directly (R9/R10).
    outcome: preGate.outcome,
    numericFields,
    displayNames,
    maxCharacters: EXPLANATION_MAX_CHARACTERS,
    language: "en",
  };
  const envelope = buildEnvelope(
    input,
    preGate,
    numericFields,
    currentClientLanguage,
    runtime,
    explanationInputs
  );
  const providerResult: ConstrainedProviderCallResult = await callConstrainedProvider(
    provider,
    envelope,
    runtime.executionPolicy
  );
  if (!providerResult.ok) {
    return failClosedAfterApprovedGate({
      clientId: preGateAudit.clientId,
      gate: preGate,
      envelope,
      gateInputDigest,
      nextAction,
      failureCode: providerResult.failureCode,
      attempts: providerResult.attempts,
      measurement: providerResult.measurement,
      languageSourceRefs: input.languageSourceRefs,
      runtime,
    });
  }

  const finalGate = await evaluateCurrentClientAutonomyGate(artifactRequest, input.gateInput);
  const finalGateAudit = await loadGateAudit(finalGate);
  if (finalGateAudit.clientId !== preGateAudit.clientId) {
    return failClosedAfterApprovedGate({
      clientId: preGateAudit.clientId,
      gate: preGate,
      envelope,
      gateInputDigest,
      nextAction,
      failureCode: "PROVIDER_TENANT_CONTEXT_CHANGED",
      attempts: providerResult.attempts,
      measurement: providerResult.measurement,
      languageSourceRefs: input.languageSourceRefs,
      runtime,
    });
  }
  if (
    finalGate.outcome === "APPROVE_AUTOMATICALLY" &&
    finalGateAudit.evaluationKey !== preGateAudit.evaluationKey
  ) {
    return failClosedAfterApprovedGate({
      clientId: preGateAudit.clientId,
      gate: preGate,
      envelope,
      gateInputDigest,
      nextAction,
      failureCode: "PROVIDER_GATE_BINDING_CHANGED",
      attempts: providerResult.attempts,
      measurement: providerResult.measurement,
      languageSourceRefs: input.languageSourceRefs,
      runtime,
    });
  }

  let outcome = finalGate.outcome;
  let orderedReasonCodes = finalGate.orderedReasonCodes;
  let approvedCandidatePlanVersionId = finalGate.approvedCandidatePlanVersionId;
  let boundaryOutcome: "VALIDATED" | "SKIPPED_GATE" | "FAIL_CLOSED" | "CAUTION" =
    finalGate.outcome === "APPROVE_AUTOMATICALLY" ? "VALIDATED" : "SKIPPED_GATE";
  let failureCode: string | null =
    finalGate.outcome === "APPROVE_AUTOMATICALLY" ? null : "DETERMINISTIC_GATE_REJECTED";

  if (finalGate.outcome === "APPROVE_AUTOMATICALLY") {
    if (providerResult.output.concern.disposition === "INCREASE_CAUTION") {
      outcome = "HOLD";
      orderedReasonCodes = ["PROVIDER_CAUTION_SIGNAL"];
      approvedCandidatePlanVersionId = null;
      boundaryOutcome = "CAUTION";
      failureCode = "PROVIDER_CAUTION_SIGNAL";
    } else if (providerResult.output.concern.disposition === "REQUEST_CLARIFICATION") {
      outcome = "FOCUSED_CLARIFICATION";
      orderedReasonCodes = ["PROVIDER_CLARIFICATION_REQUESTED"];
      approvedCandidatePlanVersionId = null;
      boundaryOutcome = "CAUTION";
      failureCode = "PROVIDER_CLARIFICATION_REQUESTED";
    }
  }

  // T-2006 — semantic prose validation runs after the output already
  // validated structurally and after the final outcome is known. A
  // rejection here only ever drops the text (R10); it can never move
  // `outcome`, `approvedCandidatePlanVersionId` or `boundaryOutcome`, which
  // are already fixed above. `structurallyEligible` is R10's retention
  // rule — separate from, and stricter than, the pure validator's own R9
  // lexical outcome check, because "no lexical violation" is not the same
  // as "this outcome may ever carry prose".
  const proseInputsBase: Omit<ProseInputs, "maxCharacters" | "minCharacters"> = {
    outcome,
    reasonCodes: orderedReasonCodes,
    numericFields,
    displayNames,
    catalogVocabulary,
    language: "en",
  };
  const explanationRawValidation = validateExplanationProse(
    {
      ...proseInputsBase,
      maxCharacters: EXPLANATION_MAX_CHARACTERS,
      minCharacters: EXPLANATION_MIN_CHARACTERS,
    },
    providerResult.output.explanationText
  );
  const clarificationRawValidation = validateExplanationProse(
    {
      ...proseInputsBase,
      maxCharacters: CLARIFICATION_MAX_CHARACTERS,
      minCharacters: CLARIFICATION_MIN_CHARACTERS,
    },
    providerResult.output.clarificationText
  );
  const explanationStructurallyEligible = outcome === "APPROVE_AUTOMATICALLY";
  const clarificationStructurallyEligible =
    outcome === "FOCUSED_CLARIFICATION" &&
    providerResult.output.concern.clarificationId !== null &&
    envelope.allowed.clarificationIds.includes(providerResult.output.concern.clarificationId);
  const explanationValidation = applyStructuralRetention(
    explanationRawValidation,
    explanationStructurallyEligible
  );
  const clarificationValidation = applyStructuralRetention(
    clarificationRawValidation,
    clarificationStructurallyEligible
  );
  const explanationValidationAudit: ExplanationValidationAudit = {
    schemaVersion: 1,
    contractVersion: PROSE_CONTRACT_VERSION,
    explanation: summarizeProseValidation(providerResult.output.explanationText, explanationValidation),
    clarification: summarizeProseValidation(
      providerResult.output.clarificationText,
      clarificationValidation
    ),
  };
  // Never persist a rejected string: sanitize before it reaches the audit
  // row. `providerResult.output` (the pre-sanitized value) is never passed
  // to `persistAudit` below.
  const sanitizedOutput: ConstrainedProviderOutput = {
    ...providerResult.output,
    explanationText: explanationValidation.accepted ? providerResult.output.explanationText : null,
    clarificationText: clarificationValidation.accepted
      ? providerResult.output.clarificationText
      : null,
  };

  const audit = await persistAudit({
    clientId: preGateAudit.clientId,
    boundaryOutcome,
    resultOutcome: outcome,
    failureCode,
    attempts: providerResult.attempts,
    preGateDecisionId: preGate.decisionId,
    finalGateDecisionId: finalGate.decisionId,
    envelope,
    gateInputDigest,
    output: sanitizedOutput,
    measurement: providerResult.measurement,
    languageSourceRefs: input.languageSourceRefs,
    providerConfiguration: runtime.providerConfiguration,
    explanationValidation: explanationValidationAudit,
  });
  return {
    auditId: audit.id,
    outcome,
    orderedReasonCodes,
    nextAction,
    approvedCandidatePlanVersionId,
    clarificationId:
      outcome === "FOCUSED_CLARIFICATION" ? providerResult.output.concern.clarificationId : null,
    providerSelection:
      outcome === "APPROVE_AUTOMATICALLY"
        ? {
            preferenceIds: providerResult.output.preferenceIds,
            rankedOptionIds: providerResult.output.rankedOptionIds,
            explanation: validatedExplanation(
              providerResult.output,
              nextAction,
              numericFields,
              runtime,
              explanationValidation
            ),
          }
        : null,
    clarification:
      clarificationValidation.accepted && providerResult.output.concern.clarificationId
        ? {
            text: clarificationValidation.text,
            clarificationId: providerResult.output.concern.clarificationId,
            kind: "MODEL_VALIDATED" as const,
          }
        : null,
  };
}
