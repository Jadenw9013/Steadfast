import { z } from "zod";
import type { AiWorkoutSession, Prisma } from "@/app/generated/prisma/client";
import { observationSchema } from "./observation-contract";
import { observationDigest } from "./evidence";
import { contentHash } from "./canonical-json";
import { sourceRefSchema, type SourceRef } from "./plan-contract";
import { AiCoachError } from "./access";
export const evidenceSnapshotSchema = z.object({
  observations: z.array(z.object({ id: z.string(), revision: z.number().int(), occurredAt: z.string().datetime(), payload: observationSchema }).strict()).max(180),
  sessions: z.array(z.object({ id: z.string(), revision: z.number().int(), occurredAt: z.string().datetime(), planVersionId: z.string(), sessionInstanceId: z.string(), prescriptionSessionId: z.string(), exerciseId: z.string(), modality: z.enum(["STRENGTH", "CARDIO"]), resultStatus: z.string(), reps: z.number().nullable(), loadValue: z.number().nullable(), loadUnit: z.string().nullable(), loadKind: z.string().nullable(), durationMinutes: z.number().nullable(), effortRating: z.number().nullable(), painReported: z.boolean(), setIndex: z.number().int() }).strict()).max(2000),
}).strict();
export type EvidenceSnapshot = z.infer<typeof evidenceSnapshotSchema>;
const sessionSelect = { id: true, revision: true, occurredAt: true, planVersionId: true, sessionInstanceId: true, prescriptionSessionId: true, exerciseId: true, modality: true, resultStatus: true, reps: true, loadValue: true, loadUnit: true, loadKind: true, durationMinutes: true, effortRating: true, painReported: true, setIndex: true, deletedAt: true } as const;
function sessionValue(row: Pick<AiWorkoutSession, keyof typeof sessionSelect>) {
  const data = { ...row, occurredAt: row.occurredAt.toISOString() };
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== "deletedAt"));
}
function sessionDigest(row: Pick<AiWorkoutSession, keyof typeof sessionSelect>) { return contentHash({ ...sessionValue(row), deletedAt: row.deletedAt?.toISOString() ?? null }); }
/** Caller holds the client User lock, shared by all evidence writers. */
export async function collectEvidence(tx: Prisma.TransactionClient, clientId: string, start: Date, end: Date) {
  const observations = await tx.aiCheckInObservation.findMany({ where: { clientId, submitted: true, deletedAt: null, occurredAt: { gte: start, lt: end } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 181 });
  const sessions = await tx.aiWorkoutSession.findMany({ where: { clientId, deletedAt: null, sessionInstanceId: { not: null }, occurredAt: { gte: start, lt: end } }, select: sessionSelect, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 2001 });
  if (observations.length > 180 || sessions.length > 2000) throw new AiCoachError("VALIDATION_ERROR", "This review contains too many records for a bounded snapshot.", 422);
  const evidence = evidenceSnapshotSchema.parse({ observations: observations.map(r => ({ id: r.id, revision: r.revision, occurredAt: r.occurredAt.toISOString(), payload: r.payload })), sessions: sessions.map(sessionValue) });
  const sourceRefs: SourceRef[] = [...observations.map(r => ({ kind: "CHECK_IN" as const, id: r.id, revision: r.revision, digest: observationDigest(r) })), ...sessions.map(r => ({ kind: "SESSION" as const, id: r.id, revision: r.revision, digest: sessionDigest(r) }))];
  return { evidence, sourceRefs };
}
export async function evidenceIsCurrent(tx: Prisma.TransactionClient, clientId: string, raw: unknown) {
  const refs = z.array(sourceRefSchema).max(2180).safeParse(raw);
  if (!refs.success) return false;
  const observations = await tx.aiCheckInObservation.findMany({ where: { clientId, id: { in: refs.data.filter(r => r.kind === "CHECK_IN").map(r => r.id) } } });
  const sessions = await tx.aiWorkoutSession.findMany({ where: { clientId, id: { in: refs.data.filter(r => r.kind === "SESSION").map(r => r.id) } }, select: sessionSelect });
  const byObservation = new Map(observations.map(r => [r.id, r]));
  const bySession = new Map(sessions.map(r => [r.id, r]));
  for (const ref of refs.data) {
    if (ref.kind === "CHECK_IN") {
      const row = byObservation.get(ref.id);
      if (!row || row.deletedAt || !row.submitted || row.revision !== ref.revision || observationDigest(row) !== ref.digest) return false;
    } else {
      const row = bySession.get(ref.id);
      if (!row || row.deletedAt || row.revision !== ref.revision || sessionDigest(row) !== ref.digest) return false;
    }
  }
  return true;
}
