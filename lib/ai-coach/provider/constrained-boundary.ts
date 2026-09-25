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
  type ArtifactLoadRequest,
  type ReviewedArtifactSet,
} from "../artifacts/repository";
import { escalationTemplatesContentSchema } from "../artifacts/schema";
import { contentHash } from "../canonical-json";
import { observationDigest } from "../evidence";
import { observationSchema } from "../observation-contract";
import { sourceRefSchema } from "../plan-contract";
import { validatedManagedPayload } from "../validated-plan";
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

type NumericField = { id: string; value: number; unit: string };
type ReviewedNextAction = {
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
) {
  for (const option of options) {
    if (option.kind === "FOOD") getReviewedFoodItem(artifacts.foodCatalog, option.id);
    else getReviewedExerciseItem(artifacts.exerciseCatalog, option.id);
  }
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
    fields.push(
      {
        id: "NUTRITION_ENERGY_KCAL",
        value: payload.nutrition.targets.energyKcal,
        unit: "KCAL_PER_DAY",
      },
      {
        id: "NUTRITION_PROTEIN_G",
        value: payload.nutrition.targets.proteinG,
        unit: "GRAMS_PER_DAY",
      },
      {
        id: "NUTRITION_CARBS_G",
        value: payload.nutrition.targets.carbsG,
        unit: "GRAMS_PER_DAY",
      },
      {
        id: "NUTRITION_FAT_G",
        value: payload.nutrition.targets.fatG,
        unit: "GRAMS_PER_DAY",
      }
    );
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
  runtime: ConstrainedProviderBoundaryRuntime
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
    },
  });
}

function validatedExplanation(
  output: ConstrainedProviderOutput,
  nextAction: ReviewedNextAction,
  numericFields: readonly NumericField[],
  runtime: ConstrainedProviderBoundaryRuntime
) {
  const requestedNumericFields = new Set(output.explanation.numericFieldIds);
  return {
    templateId: nextAction.templateId,
    locale: nextAction.locale,
    reasonCodes: output.explanation.reasonCodes,
    nextStepText: nextAction.nextStepText,
    numericFields: numericFields.filter((field) => requestedNumericFields.has(field.id)),
    limitations: [
      ...runtime.limitations,
      {
        id: "REVIEWED_NON_MONITORING_STATEMENT",
        text: nextAction.nonMonitoringStatement,
      },
    ],
  };
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
  try {
    validateEligibleOptions(artifacts, input.eligibleOptions);
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
  const envelope = buildEnvelope(input, preGate, numericFields, currentClientLanguage, runtime);
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
    output: providerResult.output,
    measurement: providerResult.measurement,
    languageSourceRefs: input.languageSourceRefs,
    providerConfiguration: runtime.providerConfiguration,
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
              runtime
            ),
          }
        : null,
  };
}
