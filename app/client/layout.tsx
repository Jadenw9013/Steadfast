import { redirect } from "next/navigation";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { NavBar } from "@/components/ui/nav-bar";
import { MobileBottomNav } from "@/components/ui/mobile-bottom-nav";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentDbUser();

  if (user.activeRole !== "CLIENT") {
    redirect("/coach/dashboard");
  }

  // Enforce Onboarding Questionnaire completion before allowing dashboard access
  const coachClient = await db.coachClient.findFirst({
    where: { clientId: user.id },
  });

  if (coachClient) {
    const activeForm = await db.onboardingForm.findFirst({
      where: { coachId: coachClient.coachId, isActive: true },
    });

    if (activeForm) {
      const response = await db.onboardingResponse.findUnique({
        where: { clientId: user.id },
      });

      if (!response) {
        redirect("/onboarding");
      }
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b]">
      <NavBar
        role="client"
        canSwitchRole={user.isCoach && user.isClient}
      />
      <main id="main-content" className="mx-auto max-w-5xl px-5 pb-24 pt-8 sm:px-8 sm:pb-8">{children}</main>
      <MobileBottomNav role="client" />
    </div>
  );
}
