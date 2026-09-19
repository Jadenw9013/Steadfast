import { z } from "zod";

export const IntakeSchema = z.object({
  bodyweightLbs: z
    .number()
    .min(50, "Weight must be at least 50 lbs")
    .max(700, "Enter a valid weight"),
  heightInches: z
    .number()
    .min(24, "Height must be at least 24 inches")
    .max(108, "Enter a valid height"),
  ageYears: z
    .number()
    .int()
    .min(13, "Must be at least 13")
    .max(100, "Enter a valid age"),
  gender: z.string().min(1, "Select an option").max(50),
  primaryGoal: z.string().min(1, "Select an option").max(100),
  targetTimeline: z.string().max(100).optional().default(""),
  injuries: z.string().max(2000),
  dietaryRestrictions: z.string().max(500),
  dietaryPreferences: z.string().max(1000),
  currentDiet: z.string().max(2000),
  trainingExperience: z.string().min(1, "Select an option").max(100),
  trainingDaysPerWeek: z
    .number()
    .int()
    .min(1, "Must be at least 1 day")
    .max(7, "Maximum 7 days"),
  gymAccess: z.string().min(1, "Select an option").max(100),
});

export type IntakeData = z.infer<typeof IntakeSchema>;

/**
 * Validates the raw intake form data from a client submission.
 * It will parse the incoming payload using the IntakeSchema.
 * If the validation passes, the success property is true.
 * If it fails, the success property is false and issues are returned.
 *
 * @param data The unknown data object.
 * @returns The parsed schema result.
 */
export function validateIntakeForm(data: unknown) {
  return IntakeSchema.safeParse(data);
}
