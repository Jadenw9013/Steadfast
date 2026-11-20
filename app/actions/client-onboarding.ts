"use server";

import { getCurrentDbUser } from "@/lib/auth/roles";
import { revalidatePath } from "next/cache";
import { SubmitOnboardingResponseInput } from "@/lib/validations/onboarding-form";
import { saveClientQuestionnaire } from "@/lib/onboarding/questionnaire";

export async function submitOnboardingResponse(input: SubmitOnboardingResponseInput) {
    const user = await getCurrentDbUser();
    if (!user.isClient) throw new Error("Unauthorized");

    const result = await saveClientQuestionnaire(user.id, input);
    if (result.success) revalidatePath("/client", "layout");
    return result;
}
