import { getClientProvider, rendersAiWorkspace } from "@/lib/queries/client-provider";
import { redirect } from "next/navigation";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getPendingClientQuestionnaire } from "@/lib/onboarding/questionnaire";
import { NavBar } from "@/components/ui/nav-bar";
import { MobileBottomNav } from "@/components/ui/mobile-bottom-nav";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentDbUser({ allowInactive: true });

  if (user.activeRole !== "CLIENT") {
    redirect("/coach/dashboard");
  }
  if (user.isDeactivated) {
    redirect("/account-deletion-pending");
  }

  const provider = await getClientProvider(user.id);
  const aiCoaching = rendersAiWorkspace(provider);

  const questionnaire = await getPendingClientQuestionnaire(user.id, provider);
  if (questionnaire) redirect("/onboarding");

  return (
    <div className="sf-app-shell min-h-[100dvh]">
      <NavBar
        role="client"
        canSwitchRole={user.isCoach && user.isClient}
        hasCoach={!!provider.activeCoachClientId} aiCoaching={aiCoaching}
      />
      <main id="main-content" className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-8 sm:pb-8 sm:pt-8">{children}</main>
      <MobileBottomNav role="client" hasCoach={!!provider.activeCoachClientId} aiCoaching={aiCoaching} />
    </div>
  );
}
