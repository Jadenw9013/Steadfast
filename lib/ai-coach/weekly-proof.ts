import type { Prisma, AiPlanVersion } from "@/app/generated/prisma/client";
import { runSnapshotSchema } from "./run-command";
import { buildWeeklyFixtureReview } from "./weekly-controller";
import { contentHash } from "./canonical-json";
import { validationReportSchema } from "./validated-plan";
/** Re-derive a weekly candidate at the acceptance/reviewer boundary. A status or
 * self-asserted changeClass cannot bypass the deterministic joint controller. */
export async function weeklyCandidateIsValid(tx: Prisma.TransactionClient, candidate: AiPlanVersion) {
  if (candidate.changeClass === "INITIAL" || candidate.changeClass === "TARGET_PRESERVING") return true;
  const report = validationReportSchema.safeParse(candidate.validationReport);
  const run = await tx.aiCoachRun.findFirst({ where: { clientId: candidate.clientId, resultPlanVersionId: candidate.id, kind: "WEEKLY_REVIEW", status: "COMPLETED" } });
  const snapshot = runSnapshotSchema.safeParse(run?.inputSnapshot);
  if (!report.success || !snapshot.success || contentHash(snapshot.data) !== report.data.inputHash || contentHash(snapshot.data.sourceRefs) !== contentHash(candidate.sourceRefs) || snapshot.data.baseVersionId !== candidate.baseVersionId || snapshot.data.reviewWindowKey !== candidate.reviewWindowKey) return false;
  const history = await tx.aiPlanVersion.findMany({ where: { clientId: candidate.clientId, acceptedAt: { not: null } }, orderBy: { acceptedAt: "asc" }, take: 501, select: { id: true, acceptedAt: true, changeClass: true, reviewWindowKey: true, payload: true } });
  if (contentHash(history.map(p => ({ ...p, acceptedAt: p.acceptedAt!.toISOString() }))) !== contentHash(snapshot.data.history)) return false;
  const replay = buildWeeklyFixtureReview(snapshot.data);
  return replay.payload !== null && replay.decision.changeClass === candidate.changeClass && contentHash(replay.payload) === candidate.payloadHash && contentHash(replay.decision) === contentHash(run!.resultDecision);
}
