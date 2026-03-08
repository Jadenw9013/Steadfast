"use server";

import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { revalidatePath } from "next/cache";
import {
    UpsertOnboardingFormInput,
    upsertOnboardingFormSchema
} from "@/lib/validations/onboarding-form";

export async function getMyOnboardingForm() {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    return db.onboardingForm.findUnique({
        where: { coachId: user.id }
    });
}

export async function upsertMyOnboardingForm(input: UpsertOnboardingFormInput) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const validated = upsertOnboardingFormSchema.parse(input);

    // Prisma JSON casting for TypeScript compatibility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const questionsJson = validated.questions as any;

    const form = await db.onboardingForm.upsert({
        where: { coachId: user.id },
        update: {
            questions: questionsJson,
            isActive: validated.isActive,
        },
        create: {
            coachId: user.id,
            questions: questionsJson,
            isActive: validated.isActive,
        }
    });

    revalidatePath("/coach/onboarding");
    return form;
}
