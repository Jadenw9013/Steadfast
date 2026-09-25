import type { AiRunKind } from "@/app/generated/prisma/client";
import { z } from "zod";
import { MAX_TOKENS_PER_STAGE_CALL } from "./spend-limits";

/**
 * A05 legacy synthetic execution probe plus the T-1007 constrained provider
 * boundary.
 *
 * The executor (executor.ts) calls exactly one `ModelProvider` per stage,
 * outside any database transaction (docs/ai-coach's standing rule: no
 * external network I/O inside `db.$transaction`). The legacy `ModelProvider`
 * receives only a fixed synthetic probe and can return only a fixed HOLD; a
 * future provider integration must use `ConstrainedModelProvider`. Nothing in
 * this repo implements either interface against a live API — gate G05 (deployment/model
 * configuration: verified scheduler timing, model support/benchmark,
 * token/spend caps, measured retry/latency) blocks that. `runExecutorSweep`
 * defaults to `SyntheticFixtureProvider` (synthetic-provider.ts), which
 * never performs network I/O.
 */

export const modelStageInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    synthetic: z.literal(true),
    task: z.literal("LEGACY_EXECUTION_PROBE"),
    runKind: z.enum(["INITIAL", "WEEKLY_REVIEW", "REPRESENTATION"]),
  })
  .strict();
export type ModelStageInput = z.infer<typeof modelStageInputSchema>;

/**
 * `isFinal: false` means the executor should checkpoint this output and
 * requeue for a subsequent stage; `true` means the run is complete and
 * carries its terminal result. `tokensUsed` feeds spend-limits.ts.
 */
export const modelStageResultSchema = z.union([
  z
    .object({
      outcome: z.literal("success"),
      isFinal: z.literal(false),
      stageOutput: z.object({ checkpoint: z.literal("SYNTHETIC_STAGE_COMPLETE") }).strict(),
      tokensUsed: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("success"),
      isFinal: z.literal(true),
      stageOutput: z
        .object({ note: z.literal("SYNTHETIC_FIXTURE — no live model call was made") })
        .strict(),
      tokensUsed: z.number().int().nonnegative(),
      reviewAction: z.literal("HOLD"),
    })
    .strict(),
  z.object({ outcome: z.literal("error"), message: z.string().min(1).max(500) }).strict(),
]);
export type ModelStageResult = z.infer<typeof modelStageResultSchema>;

export interface ModelProvider {
  runStage(input: ModelStageInput): Promise<ModelStageResult>;
}

export const PROVIDER_TIMEOUT_MS = 45_000; // docs/ai-coach/08 A05 engineering default

export class ProviderTimeoutError extends Error {
  constructor() {
    super("Model provider stage timed out");
    this.name = "ProviderTimeoutError";
  }
}

export function legacySyntheticStageInput(runKind: AiRunKind): ModelStageInput {
  return modelStageInputSchema.parse({
    schemaVersion: 1,
    synthetic: true,
    task: "LEGACY_EXECUTION_PROBE",
    runKind,
  });
}

/** Races a provider call against the fixed A05 timeout default. */
export async function callProviderWithTimeout(
  provider: ModelProvider,
  input: ModelStageInput
): Promise<ModelStageResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.runStage(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProviderTimeoutError()), PROVIDER_TIMEOUT_MS);
      }),
    ]);
    return modelStageResultSchema.parse(result);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const uniqueIds = (values: readonly string[]) => new Set(values).size === values.length;

const directIdentifierPatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /https?:\/\/\S+/i,
  /\+[1-9]\d{6,14}/,
  /\b(?:client|tenant|user)[_-]?id\s*[:=]/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  /\b(?:sk|pk|whsec)_[A-Za-z0-9_]+/,
] as const;

function containsDirectIdentifier(value: string) {
  return directIdentifierPatterns.some((pattern) => pattern.test(value));
}

/**
 * T-1007 provider input. This is deliberately not a prompt or a run record:
 * it contains no tenant identity, plan payload, policy body, target value,
 * source document, tool declaration, or cross-client memory key.
 */
export const constrainedProviderEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: z.string().uuid(),
    promptContractVersion: z.enum(["t1007-synthetic-v1", "t1007-live-v1"]),
    task: z.literal("INTERPRET_RANK_EXPLAIN"),
    currentClientLanguage: z
      .array(
        z
          .object({
            id: identifierSchema,
            text: z
              .string()
              .min(1)
              .max(1_000)
              .refine(
                (value) => !containsDirectIdentifier(value),
                "Current-client language must not contain a direct identifier."
              ),
            provenance: z.enum(["SYNTHETIC_SERVER_FIXTURE", "CURRENT_CLIENT_VALIDATED"]),
          })
          .strict()
      )
      .max(5),
    allowed: z
      .object({
        optionIds: z.array(identifierSchema).max(100),
        preferenceIds: z.array(identifierSchema).max(20),
        clarificationIds: z.array(identifierSchema).max(10),
        explanationTemplateIds: z.array(identifierSchema).min(1).max(10),
        reasonCodes: z.array(identifierSchema).min(1).max(20),
        numericFieldIds: z.array(identifierSchema).max(20),
        limitationIds: z.array(identifierSchema).min(1).max(20),
      })
      .strict(),
    capabilities: z
      .object({
        tools: z.tuple([]),
        browsing: z.literal(false),
        rag: z.literal(false),
        liveResearch: z.literal(false),
        crossClientMemory: z.literal(false),
      })
      .strict(),
    /**
     * T-2006 — the validated numeric fields (with their server-rendered
     * display tokens) and plan display names the model may mention in
     * `explanationText`/`clarificationText`. Deliberately a top-level key,
     * not nested inside `allowed`: the `superRefine` below iterates
     * `Object.entries(input.allowed)` and calls `uniqueIds` on each value,
     * which requires every `allowed.*` member to be a flat string array.
     * Carries no tenant identity, policy body, artifact or capability.
     * `catalogVocabulary` is never included here — it stays server-side
     * only (see `constrained-boundary.ts`).
     */
    explanationInputs: z
      .object({
        outcome: z.enum(["APPROVE_AUTOMATICALLY", "HOLD", "FOCUSED_CLARIFICATION", "PAUSE_REFER"]),
        numericFields: z
          .array(
            z
              .object({
                id: identifierSchema,
                value: z.number().finite(),
                unit: z.enum(["KCAL_PER_DAY", "GRAMS_PER_DAY"]),
                displayLabel: z.string().min(1).max(60),
                displayValue: z
                  .string()
                  .min(1)
                  .max(32)
                  .regex(/^[0-9]+(\.[0-9])?$/),
              })
              .strict()
          )
          .max(20),
        displayNames: z
          .array(
            z
              .object({
                optionId: identifierSchema,
                name: z.string().min(1).max(240),
              })
              .strict()
          )
          .max(100),
        maxCharacters: z.number().int().min(80).max(400),
        language: z.literal("en"),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    for (const [field, values] of Object.entries(input.allowed)) {
      if (!uniqueIds(values)) {
        ctx.addIssue({
          code: "custom",
          path: ["allowed", field],
          message: `${field} must contain unique server-owned IDs.`,
        });
      }
    }
    if (!uniqueIds(input.currentClientLanguage.map((item) => item.id))) {
      ctx.addIssue({
        code: "custom",
        path: ["currentClientLanguage"],
        message: "Current-client language IDs must be unique.",
      });
    }
    if (input.explanationInputs) {
      const numericFieldIds = new Set(input.allowed.numericFieldIds);
      const optionIds = new Set(input.allowed.optionIds);
      for (const field of input.explanationInputs.numericFields) {
        if (!numericFieldIds.has(field.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["explanationInputs", "numericFields"],
            message: "explanationInputs numeric field IDs must be allowed numeric field IDs.",
          });
        }
      }
      for (const entry of input.explanationInputs.displayNames) {
        if (!optionIds.has(entry.optionId)) {
          ctx.addIssue({
            code: "custom",
            path: ["explanationInputs", "displayNames"],
            message: "explanationInputs display name option IDs must be allowed option IDs.",
          });
        }
      }
      if (!uniqueIds(input.explanationInputs.numericFields.map((field) => field.id))) {
        ctx.addIssue({
          code: "custom",
          path: ["explanationInputs", "numericFields"],
          message: "explanationInputs numeric field IDs must be unique.",
        });
      }
      if (!uniqueIds(input.explanationInputs.displayNames.map((entry) => entry.optionId))) {
        ctx.addIssue({
          code: "custom",
          path: ["explanationInputs", "displayNames"],
          message: "explanationInputs display name option IDs must be unique.",
        });
      }
    }
  });

export type ConstrainedProviderEnvelope = z.infer<typeof constrainedProviderEnvelopeSchema>;

/**
 * The refinement-free base exists only because a JSON-Schema translation (T-996's
 * `zodOutputFormat`) cannot carry `superRefine`. `constrainedProviderOutputSchema`
 * below stays the authority — `validateConstrainedProviderOutput` re-validates
 * every provider response against the refined schema server-side.
 */
export const constrainedProviderOutputObjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    preferenceIds: z.array(identifierSchema).max(20),
    concern: z
      .object({
        disposition: z.enum(["NONE", "INCREASE_CAUTION", "REQUEST_CLARIFICATION"]),
        clarificationId: identifierSchema.nullable(),
      })
      .strict(),
    rankedOptionIds: z.array(identifierSchema).max(100),
    explanation: z
      .object({
        templateId: identifierSchema,
        reasonCodes: z.array(identifierSchema).min(1).max(20),
        numericFieldIds: z.array(identifierSchema).max(20),
        limitationIds: z.array(identifierSchema).min(1).max(20),
      })
      .strict(),
    /**
     * T-2006 seam. `.nullable().optional()`, not `.nullable()` alone:
     * `SyntheticConstrainedProvider` returns neither key and must keep
     * doing so, or a required key would fail-parse every synthetic
     * finalization. 600/400 are the hard structural ceilings; the
     * effective budget is `explanationInputs.maxCharacters`, enforced
     * semantically by `validateExplanationProse` — this schema never
     * learns about prose content, only shape.
     */
    explanationText: z.string().min(1).max(600).nullable().optional(),
    clarificationText: z.string().min(1).max(400).nullable().optional(),
  })
  .strict();

export const constrainedProviderOutputSchema = constrainedProviderOutputObjectSchema.superRefine(
  (output, ctx) => {
    for (const [field, values] of [
      ["preferenceIds", output.preferenceIds],
      ["rankedOptionIds", output.rankedOptionIds],
      ["explanation.reasonCodes", output.explanation.reasonCodes],
      ["explanation.numericFieldIds", output.explanation.numericFieldIds],
      ["explanation.limitationIds", output.explanation.limitationIds],
    ] as const) {
      if (!uniqueIds(values)) {
        ctx.addIssue({
          code: "custom",
          path: field.split("."),
          message: `${field} must be unique.`,
        });
      }
    }
    if (
      (output.concern.disposition === "REQUEST_CLARIFICATION") !==
      (output.concern.clarificationId !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["concern", "clarificationId"],
        message: "Only a clarification disposition may select one allowed clarification.",
      });
    }
    if (
      output.clarificationText != null &&
      output.concern.disposition !== "REQUEST_CLARIFICATION"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["clarificationText"],
        message: "clarificationText may be set only when concern.disposition is REQUEST_CLARIFICATION.",
      });
    }
  }
);

export type ConstrainedProviderOutput = z.infer<typeof constrainedProviderOutputSchema>;

export const constrainedTransportResponseSchema = z
  .object({
    output: z.unknown(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        spendMinorUnits: z.number().int().nonnegative().default(0),
      })
      .strict(),
  })
  .strict();

export interface ConstrainedModelProvider {
  invoke(input: ConstrainedProviderEnvelope, context: { signal: AbortSignal }): Promise<unknown>;
}

export type ConstrainedProviderFailureCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_OUTPUT_INVALID"
  | "PROVIDER_TOKEN_LIMIT";

export type ConstrainedProviderAttemptMeasurement = {
  attempt: number;
  latencyMs: number;
  outcome: "SUCCESS" | "FAILURE";
  failureCode: ConstrainedProviderFailureCode | null;
  inputTokens: number;
  outputTokens: number;
  spendMinorUnits: number;
  retryDelayMs: number;
};

/**
 * Numeric operational evidence only. This object deliberately excludes
 * prompts, client/tenant identifiers, provider output and raw error details.
 */
export type ConstrainedProviderMeasurement = {
  schemaVersion: 1;
  operationId: string;
  promptContractVersion: ConstrainedProviderEnvelope["promptContractVersion"];
  attempts: number;
  totalLatencyMs: number;
  totalRetryDelayMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalSpendMinorUnits: number;
  attemptMeasurements: ConstrainedProviderAttemptMeasurement[];
};

export type ConstrainedProviderMeasurementHooks = {
  nowMs?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  onAttempt?: (measurement: ConstrainedProviderAttemptMeasurement) => void | Promise<void>;
  onComplete?: (measurement: ConstrainedProviderMeasurement) => void | Promise<void>;
};

export type ConstrainedProviderCallResult =
  | {
      ok: true;
      attempts: number;
      output: ConstrainedProviderOutput;
      usage: { inputTokens: number; outputTokens: number };
      measurement: ConstrainedProviderMeasurement;
    }
  | {
      ok: false;
      attempts: number;
      failureCode: ConstrainedProviderFailureCode;
      measurement: ConstrainedProviderMeasurement;
    };

export const CONSTRAINED_PROVIDER_EXECUTION_POLICY = Object.freeze({
  timeoutMs: PROVIDER_TIMEOUT_MS,
  maxAttempts: 3,
  retryDelaysMs: [60_000, 300_000] as const,
  maxInputTokens: MAX_TOKENS_PER_STAGE_CALL,
  maxOutputTokens: MAX_TOKENS_PER_STAGE_CALL,
});

export type ConstrainedProviderExecutionPolicy = {
  timeoutMs: number;
  maxAttempts: number;
  retryDelaysMs: readonly number[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
};

function boundedDuration(startedAt: number, finishedAt: number) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return 0;
  return Math.max(0, Math.round(finishedAt - startedAt));
}

function measurementFor(
  envelope: ConstrainedProviderEnvelope,
  attempts: readonly ConstrainedProviderAttemptMeasurement[]
): ConstrainedProviderMeasurement {
  const inputTokens = attempts.reduce((total, attempt) => total + attempt.inputTokens, 0);
  const outputTokens = attempts.reduce((total, attempt) => total + attempt.outputTokens, 0);
  const totalSpendMinorUnits = attempts.reduce(
    (total, attempt) => total + attempt.spendMinorUnits,
    0
  );
  return {
    schemaVersion: 1,
    operationId: envelope.operationId,
    promptContractVersion: envelope.promptContractVersion,
    attempts: attempts.length,
    totalLatencyMs: attempts.reduce((total, attempt) => total + attempt.latencyMs, 0),
    totalRetryDelayMs: attempts.reduce((total, attempt) => total + attempt.retryDelayMs, 0),
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    totalSpendMinorUnits,
    attemptMeasurements: [...attempts],
  };
}

async function observe<T>(observer: ((value: T) => void | Promise<void>) | undefined, value: T) {
  try {
    await observer?.(value);
  } catch {
    // Monitoring must never change the safety decision or expose observer errors.
  }
}

function withinAllowed(values: readonly string[], allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return values.every((value) => allowedSet.has(value));
}

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maxLength;
}

/**
 * T-2030 review r1 MAJOR 1. `explanationText`/`clarificationText` are the
 * only two output fields whose validity is judged *semantically*
 * (`validateExplanationProse`, `constrained-boundary.ts`), never
 * structurally — T-2006 design choice 1: a plan the deterministic gate
 * approved cannot be withheld because the model chose a bad adjective. But
 * `z.string().min(1).max(600)` and the clarification/disposition
 * cross-field `superRefine` rule below are structural, so without this
 * step a bare `explanationText: ""` (the natural "nothing to say" value),
 * an over-ceiling string, or a stray `clarificationText` on a non-
 * REQUEST_CLARIFICATION disposition would fail
 * `constrainedProviderOutputSchema.safeParse` entirely —
 * `PROVIDER_OUTPUT_INVALID` — which fail-closes an otherwise gate-approved
 * plan to HOLD. This coerces exactly those two fields to `null` *before*
 * structural parsing whenever they violate their own bounds or the
 * cross-field rule, so the rest of the output (`preferenceIds`,
 * `rankedOptionIds`, `concern`, `explanation.*` — all still hard structural
 * requirements) is judged on its own merits, and the coerced-to-null
 * field reads downstream exactly as "the model supplied no prose" —
 * `validateExplanationProse` records `PROSE_EMPTY`, the template renders,
 * the approval survives. This is the one place `validateConstrainedProviderOutput`
 * now "learns about prose", updating T-2006's original "otherwise
 * unchanged" statement for this function.
 */
function sanitizeProseFieldsBeforeStructuralValidation(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const source = raw as Record<string, unknown>;
  const sanitized: Record<string, unknown> = { ...source };

  if (
    "explanationText" in sanitized &&
    sanitized.explanationText !== null &&
    sanitized.explanationText !== undefined &&
    !isBoundedNonEmptyString(sanitized.explanationText, 600)
  ) {
    sanitized.explanationText = null;
  }

  if (
    "clarificationText" in sanitized &&
    sanitized.clarificationText !== null &&
    sanitized.clarificationText !== undefined
  ) {
    const concern =
      typeof source.concern === "object" && source.concern !== null
        ? (source.concern as Record<string, unknown>)
        : null;
    const disposition = concern?.disposition;
    if (
      !isBoundedNonEmptyString(sanitized.clarificationText, 400) ||
      disposition !== "REQUEST_CLARIFICATION"
    ) {
      sanitized.clarificationText = null;
    }
  }

  return sanitized;
}

export function validateConstrainedProviderOutput(
  envelope: ConstrainedProviderEnvelope,
  raw: unknown
): ConstrainedProviderOutput | null {
  const parsed = constrainedProviderOutputSchema.safeParse(
    sanitizeProseFieldsBeforeStructuralValidation(raw)
  );
  if (!parsed.success) return null;
  const output = parsed.data;
  if (
    !withinAllowed(output.preferenceIds, envelope.allowed.preferenceIds) ||
    !withinAllowed(output.rankedOptionIds, envelope.allowed.optionIds) ||
    !envelope.allowed.explanationTemplateIds.includes(output.explanation.templateId) ||
    !withinAllowed(output.explanation.reasonCodes, envelope.allowed.reasonCodes) ||
    !withinAllowed(output.explanation.numericFieldIds, envelope.allowed.numericFieldIds) ||
    !withinAllowed(output.explanation.limitationIds, envelope.allowed.limitationIds) ||
    output.explanation.reasonCodes.length !== envelope.allowed.reasonCodes.length ||
    output.explanation.limitationIds.length !== envelope.allowed.limitationIds.length ||
    (output.concern.clarificationId !== null &&
      !envelope.allowed.clarificationIds.includes(output.concern.clarificationId))
  ) {
    return null;
  }
  return output;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function invokeOnce(
  provider: ConstrainedModelProvider,
  envelope: ConstrainedProviderEnvelope,
  timeoutMs: number
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.invoke(envelope, { signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Bounded retry/timeout wrapper. Only transport failures and timeouts retry.
 * Invalid or over-budget output fails immediately and raw errors are never
 * returned to callers or persisted by this layer.
 */
export async function callConstrainedProvider(
  provider: ConstrainedModelProvider,
  rawEnvelope: unknown,
  policy: ConstrainedProviderExecutionPolicy = CONSTRAINED_PROVIDER_EXECUTION_POLICY,
  hooks: ConstrainedProviderMeasurementHooks = {}
): Promise<ConstrainedProviderCallResult> {
  const envelope = constrainedProviderEnvelopeSchema.parse(rawEnvelope);
  const executionPolicy = z
    .object({
      timeoutMs: z.number().int().positive().max(PROVIDER_TIMEOUT_MS),
      maxAttempts: z.number().int().min(1).max(3),
      retryDelaysMs: z.array(z.number().int().nonnegative()).max(2),
      maxInputTokens: z.number().int().positive().max(MAX_TOKENS_PER_STAGE_CALL),
      maxOutputTokens: z.number().int().positive().max(MAX_TOKENS_PER_STAGE_CALL),
    })
    .strict()
    .parse({ ...CONSTRAINED_PROVIDER_EXECUTION_POLICY, ...policy });
  const nowMs = hooks.nowMs ?? Date.now;
  const sleep = hooks.sleep ?? wait;
  const measurements: ConstrainedProviderAttemptMeasurement[] = [];

  const finish = async (
    result:
      | {
          ok: true;
          attempts: number;
          output: ConstrainedProviderOutput;
          usage: { inputTokens: number; outputTokens: number };
        }
      | { ok: false; attempts: number; failureCode: ConstrainedProviderFailureCode }
  ): Promise<ConstrainedProviderCallResult> => {
    const measurement = measurementFor(envelope, measurements);
    await observe(hooks.onComplete, measurement);
    return { ...result, measurement };
  };

  for (let attempt = 1; attempt <= executionPolicy.maxAttempts; attempt += 1) {
    const startedAt = nowMs();
    try {
      const rawResponse = await invokeOnce(provider, envelope, executionPolicy.timeoutMs);
      const latencyMs = boundedDuration(startedAt, nowMs());
      const response = constrainedTransportResponseSchema.safeParse(rawResponse);
      if (!response.success) {
        const measurement = {
          attempt,
          latencyMs,
          outcome: "FAILURE" as const,
          failureCode: "PROVIDER_RESPONSE_INVALID" as const,
          inputTokens: 0,
          outputTokens: 0,
          spendMinorUnits: 0,
          retryDelayMs: 0,
        };
        measurements.push(measurement);
        await observe(hooks.onAttempt, measurement);
        return finish({
          ok: false,
          attempts: attempt,
          failureCode: "PROVIDER_RESPONSE_INVALID",
        });
      }
      if (
        response.data.usage.inputTokens > executionPolicy.maxInputTokens ||
        response.data.usage.outputTokens > executionPolicy.maxOutputTokens ||
        response.data.usage.inputTokens + response.data.usage.outputTokens >
          MAX_TOKENS_PER_STAGE_CALL
      ) {
        const measurement = {
          attempt,
          latencyMs,
          outcome: "FAILURE" as const,
          failureCode: "PROVIDER_TOKEN_LIMIT" as const,
          ...response.data.usage,
          retryDelayMs: 0,
        };
        measurements.push(measurement);
        await observe(hooks.onAttempt, measurement);
        return finish({ ok: false, attempts: attempt, failureCode: "PROVIDER_TOKEN_LIMIT" });
      }
      const output = validateConstrainedProviderOutput(envelope, response.data.output);
      if (!output) {
        const measurement = {
          attempt,
          latencyMs,
          outcome: "FAILURE" as const,
          failureCode: "PROVIDER_OUTPUT_INVALID" as const,
          ...response.data.usage,
          retryDelayMs: 0,
        };
        measurements.push(measurement);
        await observe(hooks.onAttempt, measurement);
        return finish({ ok: false, attempts: attempt, failureCode: "PROVIDER_OUTPUT_INVALID" });
      }
      const measurement = {
        attempt,
        latencyMs,
        outcome: "SUCCESS" as const,
        failureCode: null,
        ...response.data.usage,
        retryDelayMs: 0,
      };
      measurements.push(measurement);
      await observe(hooks.onAttempt, measurement);
      return finish({ ok: true, attempts: attempt, output, usage: response.data.usage });
    } catch (error) {
      const failureCode: ConstrainedProviderFailureCode =
        error instanceof ProviderTimeoutError ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR";
      const retryDelayMs =
        attempt === executionPolicy.maxAttempts
          ? 0
          : (executionPolicy.retryDelaysMs[attempt - 1] ?? 0);
      const measurement = {
        attempt,
        latencyMs: boundedDuration(startedAt, nowMs()),
        outcome: "FAILURE" as const,
        failureCode,
        inputTokens: 0,
        outputTokens: 0,
        spendMinorUnits: 0,
        retryDelayMs,
      };
      measurements.push(measurement);
      await observe(hooks.onAttempt, measurement);
      if (attempt === executionPolicy.maxAttempts) {
        return finish({ ok: false, attempts: attempt, failureCode });
      }
      await sleep(retryDelayMs);
    }
  }
  return finish({
    ok: false,
    attempts: executionPolicy.maxAttempts,
    failureCode: "PROVIDER_ERROR",
  });
}
