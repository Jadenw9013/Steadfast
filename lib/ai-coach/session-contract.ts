import { z } from "zod";
import { observationStatusSchema } from "./observation-contract";
export const sessionCommandSchema = z.object({
  requestKey: z.string().uuid(), clientEventId: z.string().uuid(), sessionInstanceId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(), planVersionId: z.string().min(1).max(120),
  prescriptionSessionId: z.string().min(1).max(120), exerciseId: z.string().min(1).max(120),
  occurredAt: z.string().datetime({ offset: true }), modality: z.enum(["STRENGTH", "CARDIO"]),
  setIndex: z.number().int().min(0).max(100), resultStatus: observationStatusSchema,
  reps: z.number().int().min(0).max(1000).nullable(), loadValue: z.number().finite().min(0).max(2000).nullable(),
  loadUnit: z.enum(["KG", "LB"]).nullable(), loadKind: z.enum(["EXTERNAL", "BODYWEIGHT", "ASSISTED"]).nullable(),
  durationMinutes: z.number().positive().max(1440).nullable(), effortRating: z.number().int().min(1).max(10).nullable(), painReported: z.boolean(),
}).strict().superRefine((s, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (s.modality === "CARDIO") {
    if (s.reps !== null || s.loadValue !== null || s.loadKind !== null || s.loadUnit !== null || s.setIndex !== 0) invalid("Cardio cannot contain strength load or set data.");
    if (s.resultStatus === "REPORTED_COMPLETE" && s.durationMinutes === null) invalid("Completed cardio requires duration.");
  } else {
    if (s.durationMinutes !== null) invalid("Strength records cannot contain cardio duration.");
    if (s.loadKind === "BODYWEIGHT" && (s.loadValue !== 0 || s.loadUnit !== null)) invalid("Bodyweight uses zero external load and no unit.");
    if ((s.loadKind === "EXTERNAL" || s.loadKind === "ASSISTED") && (s.loadValue === null || s.loadUnit === null)) invalid("External or assisted load requires a value and unit.");
    if (s.loadKind === null && (s.loadValue !== null || s.loadUnit !== null)) invalid("Load values require a load type.");
    if (s.resultStatus === "REPORTED_COMPLETE" && (s.reps === null || s.loadKind === null)) invalid("Completed sets require repetitions and load type.");
  }
  if (["NOT_REPORTED", "REPORTED_NOT_DONE", "NOT_SCHEDULED"].includes(s.resultStatus) && (s.reps !== null || s.loadKind !== null || s.durationMinutes !== null)) invalid("Unperformed or unreported activity cannot contain completed work.");
});
