import { z } from "zod";
export const observationStatusSchema = z.enum(["NOT_REPORTED", "REPORTED_COMPLETE", "REPORTED_PARTIAL", "REPORTED_NOT_DONE", "NOT_SCHEDULED"]);
export const observationSchema = z.object({
  schemaVersion: z.literal(1), completeness: observationStatusSchema,
  followingDays: z.number().int().min(0).max(7).nullable(),
  weight: z.object({ value: z.number().positive().max(900), unit: z.enum(["KG", "LB"]), comparableConditions: z.boolean() }).strict().nullable(),
  energy: z.enum(["LOW", "OK", "HIGH", "NOT_REPORTED"]),
  recovery: z.enum(["GOOD", "MIXED", "POOR", "NOT_REPORTED"]),
  hunger: z.enum(["MANAGEABLE", "HIGH", "NOT_REPORTED"]),
  barrier: z.enum(["NONE", "TIME", "FOOD_ACCESS", "OTHER", "NOT_REPORTED"]),
  safetyChanged: z.enum(["YES", "NO", "UNSURE"]),
  notes: z.string().max(1000).optional(),
}).strict();
export const observationDraftSchema = observationSchema.partial();
export type AiObservation = z.infer<typeof observationSchema>;
export const observationCommandSchema = z.object({ requestKey: z.string().uuid(), clientEventId: z.string().uuid(), expectedRevision: z.number().int().nonnegative(), occurredAt: z.string().datetime({ offset: true }), submit: z.boolean(), payload: z.unknown() }).strict();
