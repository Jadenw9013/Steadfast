import type { AiCoachRun, AiReviewAction } from "@/app/generated/prisma/client";

/**
 * A05 — provider adapter boundary.
 *
 * The executor (executor.ts) calls exactly one `ModelProvider` per stage,
 * outside any database transaction (docs/ai-coach's standing rule: no
 * external network I/O inside `db.$transaction`). This interface is the
 * only seam a real model integration would occupy; nothing in this repo
 * implements it against a live API — gate G05 (deployment/model
 * configuration: verified scheduler timing, model support/benchmark,
 * token/spend caps, measured retry/latency) blocks that. `runExecutorSweep`
 * defaults to `SyntheticFixtureProvider` (synthetic-provider.ts), which
 * never performs network I/O.
 */

export interface ModelStageInput {
  run: AiCoachRun;
}

/**
 * `isFinal: false` means the executor should checkpoint this output and
 * requeue for a subsequent stage; `true` means the run is complete and
 * carries its terminal result. `tokensUsed` feeds spend-limits.ts.
 */
export type ModelStageResult =
  | { outcome: "success"; isFinal: false; stageOutput: Record<string, unknown>; tokensUsed: number }
  | { outcome: "success"; isFinal: true; stageOutput: Record<string, unknown>; tokensUsed: number; reviewAction: AiReviewAction; resultPlanVersionId?: string }
  | { outcome: "error"; message: string };

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

/** Races a provider call against the fixed A05 timeout default. */
export async function callProviderWithTimeout(provider: ModelProvider, input: ModelStageInput): Promise<ModelStageResult> {
  return Promise.race([
    provider.runStage(input),
    new Promise<never>((_, reject) => setTimeout(() => reject(new ProviderTimeoutError()), PROVIDER_TIMEOUT_MS)),
  ]);
}
