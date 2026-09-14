import { db } from "@/lib/db";
import type { AiRunStatus, AiRunKind, AiReviewAction } from "@/app/generated/prisma/client";

/**
 * A05 — safe run-status read.
 *
 * docs/ai-coach/05's read contract: never return prompts, model traces,
 * other users' data, or internal approval commentary in a general DTO.
 * `checkpointData` and the raw `lastError` never leave this file.
 */

export interface RunStatusView {
  id: string;
  kind: AiRunKind;
  status: AiRunStatus;
  createdAt: Date;
  updatedAt: Date;
  resultReviewAction: AiReviewAction | null;
  failureMessage: string | null;
}

export type GetRunStatusResult = { success: true; run: RunStatusView } | { success: false; error: "NOT_FOUND" | "FORBIDDEN" };

export async function getRunStatusForClient(clientId: string, runId: string): Promise<GetRunStatusResult> {
  const run = await db.aiCoachRun.findUnique({ where: { id: runId } });
  if (!run) return { success: false, error: "NOT_FOUND" };
  if (run.clientId !== clientId) return { success: false, error: "FORBIDDEN" };

  return {
    success: true,
    run: {
      id: run.id,
      kind: run.kind,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      resultReviewAction: run.resultReviewAction,
      failureMessage: run.status === "FAILED" ? "This run could not be completed. Please try again or contact support." : null,
    },
  };
}
