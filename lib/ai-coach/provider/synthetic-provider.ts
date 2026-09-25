import type {
  ConstrainedModelProvider,
  ConstrainedProviderEnvelope,
  ModelProvider,
  ModelStageResult,
} from "./adapter";

/**
 * A05 — SYNTHETIC FIXTURE provider. Performs no network I/O and returns a
 * deterministic, conservative HOLD result immediately. This exists only
 * to exercise the executor's claim/checkpoint/complete control flow
 * end-to-end; it must never be treated as, or replaced ad hoc with,
 * anything that produces a real recommendation. A real provider requires
 * gate G05's deployment/model verification.
 */
export class SyntheticFixtureProvider implements ModelProvider {
  async runStage(): Promise<ModelStageResult> {
    return {
      outcome: "success",
      isFinal: true,
      stageOutput: { note: "SYNTHETIC_FIXTURE — no live model call was made" },
      tokensUsed: 0,
      reviewAction: "HOLD",
    };
  }
}

/**
 * T-1007 synthetic constrained provider. It echoes only server-allowlisted
 * references, has no tools or network integration, and never emits prose,
 * numbers, safety labels, authority decisions, or activation instructions.
 */
export class SyntheticConstrainedProvider implements ConstrainedModelProvider {
  async invoke(input: ConstrainedProviderEnvelope, context: { signal: AbortSignal }) {
    if (context.signal.aborted) throw new Error("Synthetic provider call aborted");
    return {
      output: {
        schemaVersion: 1,
        preferenceIds: input.allowed.preferenceIds.slice(0, 1),
        concern: { disposition: "NONE", clarificationId: null },
        rankedOptionIds: input.allowed.optionIds,
        explanation: {
          templateId: input.allowed.explanationTemplateIds[0],
          reasonCodes: input.allowed.reasonCodes,
          numericFieldIds: input.allowed.numericFieldIds,
          limitationIds: input.allowed.limitationIds,
        },
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
