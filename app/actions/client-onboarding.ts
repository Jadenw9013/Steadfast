"use server";

import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { submitOnboardingResponseSchema, SubmitOnboardingResponseInput } from "@/lib/validations/onboarding-form";

export async function submitOnboardingResponse(input: SubmitOnboardingResponseInput) {
    const user = await getCurrentDbUser();
    if (!user.isClient) throw new Error("Unauthorized");

    const validated = submitOnboardingResponseSchema.parse(input);

    // Verify the form exists and the client is assigned to this coach
    const form = await db.onboardingForm.findUnique({
        where: { id: validated.formId }
    });

    if (!form) throw new Error("Form not found");

    const coachClient = await db.coachClient.findUnique({
        where: {
            coachId_clientId: { coachId: form.coachId, clientId: user.id }
        }
    });

    if (!coachClient) throw new Error("Not assigned to this coach");

    // TypeScript compatibility for Prisma Json
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const answersJson = validated.answers as any;

    await db.onboardingResponse.create({
        data: {
            clientId: user.id,
            coachId: form.coachId,
            formId: form.id,
            answers: answersJson,
        }
    });

    redirect("/client/dashboard");
}
