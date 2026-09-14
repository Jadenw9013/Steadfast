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
