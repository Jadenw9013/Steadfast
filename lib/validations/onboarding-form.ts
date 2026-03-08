import { z } from "zod";

/**
 * Question types supported by the Coach Onboarding intake forms.
 *
 * - shortText: single-line text input
 * - longText: multi-line textarea
 * - number: numeric input
 * - boolean: yes/no toggle
 * - multipleChoice: radio or select with predefined options
 */
export const onboardingQuestionTypes = [
    "shortText",
    "longText",
    "number",
    "boolean",
    "multipleChoice",
] as const;

export type OnboardingQuestionType = (typeof onboardingQuestionTypes)[number];

export const onboardingQuestionSchema = z
    .object({
        id: z.string().min(1).max(50),
        type: z.enum(onboardingQuestionTypes),
        label: z.string().min(1, "Question text is required").max(300),
        required: z.boolean().default(false),
        options: z.array(z.string().min(1).max(100)).optional(), // For multiple choice
    })
    .superRefine((q, ctx) => {
        if (q.type === "multipleChoice") {
            if (!q.options || q.options.length < 2) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Multiple choice questions require at least two options",
                    path: ["options"],
                });
            }
        }
    });

export type OnboardingQuestion = z.infer<typeof onboardingQuestionSchema>;

export const upsertOnboardingFormSchema = z.object({
    questions: z
        .array(onboardingQuestionSchema)
        .max(50, "Maximum 50 questions allowed"),
    isActive: z.boolean().default(true),
});

export type UpsertOnboardingFormInput = z.infer<typeof upsertOnboardingFormSchema>;

// Response validation
export const submitOnboardingResponseSchema = z.object({
    formId: z.string().min(1),
    answers: z.array(
        z.object({
            questionId: z.string().min(1),
            answer: z.string().or(z.number()).or(z.boolean()).or(z.array(z.string())),
        })
    ),
});

export type SubmitOnboardingResponseInput = z.infer<typeof submitOnboardingResponseSchema>;
