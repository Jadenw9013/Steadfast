import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { Metadata } from "next";
import { ClientOnboardingForm } from "@/components/client/onboarding/onboarding-form";
import { NavBar } from "@/components/ui/nav-bar";

export const metadata: Metadata = {
    title: "Client Onboarding | Steadfast",
};

export default async function OnboardingPage() {
    const user = await getCurrentDbUser();
    if (!user.isClient) redirect("/");

    const coachClient = await db.coachClient.findFirst({
        where: { clientId: user.id },
        include: { coach: true }
    });

    if (!coachClient) redirect("/client/dashboard");

    const form = await db.onboardingForm.findFirst({
        where: { coachId: coachClient.coachId, isActive: true }
    });

    if (!form) redirect("/client/dashboard");

    const response = await db.onboardingResponse.findUnique({
        where: { clientId: user.id }
    });

    if (response) redirect("/client/dashboard");

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b]">
            <NavBar role="client" canSwitchRole={user.isCoach && user.isClient} />
            <main className="mx-auto max-w-2xl px-5 py-12 sm:px-8">
                <div className="mb-8">
                    <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                        Welcome to Steadfast
                    </h1>
                    <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                        {coachClient.coach.firstName} has requested you complete this onboarding questionnaire before starting.
                    </p>
                </div>

                <ClientOnboardingForm form={form} />
            </main>
        </div>
    );
}
