import { getMyOnboardingForm } from "@/app/actions/onboarding-forms";
import { OnboardingEditor } from "@/components/coach/onboarding/onboarding-editor";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Client Intake Questionnaire | Steadfast",
};

export default async function CoachOnboardingPage() {
    const form = await getMyOnboardingForm();

    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-8">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Intake Questionnaire
                </h1>
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    Define the custom onboarding questions that new clients must answer before accessing their dashboard.
                </p>
            </div>

            <OnboardingEditor initialData={form} />
        </div>
    );
}
