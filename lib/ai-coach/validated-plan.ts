import { z } from "zod";
import { planPayloadSchema } from "./plan-contract";
import { contentHash } from "./canonical-json";
export const validationReportSchema = z.object({ engine: z.literal("managed-v1"), passed: z.literal(true), inputHash: z.string().length(64) }).strict();
export function validatedManagedPayload(candidate: { payload: unknown; payloadHash: string; validationReport: unknown }) {
  if (!validationReportSchema.safeParse(candidate.validationReport).success) return null;
  const parsed = planPayloadSchema.safeParse(candidate.payload);
  if (!parsed.success || contentHash(parsed.data) !== candidate.payloadHash) return null;
  return parsed.data;
}

export function approvalStateHash(candidate: {
  payloadHash: string; policyVersion: string; catalogVersions: unknown; sourceRefs: unknown;
  contextRevision: number; profileRevision: number; observationRevision: number; safetyRevision: number;
  baseVersionId: string | null; changeClass: string | null; reviewWindowKey: string | null;
}) {
  return contentHash({ payloadHash: candidate.payloadHash, policyVersion: candidate.policyVersion, catalogVersions: candidate.catalogVersions, sourceRefs: candidate.sourceRefs, contextRevision: candidate.contextRevision, profileRevision: candidate.profileRevision, observationRevision: candidate.observationRevision, safetyRevision: candidate.safetyRevision, baseVersionId: candidate.baseVersionId, changeClass: candidate.changeClass, reviewWindowKey: candidate.reviewWindowKey });
}
export function grantCoversPlan(grant: { clientIds: string[]; domains: string[]; revokedAt: Date | null; userId: string }, clientId: string, payload: unknown) {
  const plan = planPayloadSchema.safeParse(payload);
  if (!plan.success || grant.revokedAt || grant.userId === clientId || !grant.clientIds.includes(clientId)) return false;
  const touched = [plan.data.nutrition ? "NUTRITION" : null, plan.data.strength.length ? "STRENGTH" : null, plan.data.cardio.length ? "CARDIO" : null].filter((d): d is string => d !== null);
  return touched.every(domain => grant.domains.includes(domain));
}
