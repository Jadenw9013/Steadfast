import type { ModelProvider, ModelStageResult } from "./adapter";

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
