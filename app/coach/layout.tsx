import { redirect } from "next/navigation";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { NavBar } from "@/components/ui/nav-bar";
import { MobileBottomNav } from "@/components/ui/mobile-bottom-nav";

export default async function CoachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentDbUser();

  if (user.activeRole !== "COACH") {
    redirect("/client");
  }

  return (
    <div className="min-h-screen bg-black">
      <NavBar
        role="coach"
        canSwitchRole={user.isCoach && user.isClient}
      />
      <main id="main-content" className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-8 sm:pb-8 sm:pt-8">{children}</main>
      <MobileBottomNav role="coach" />
    </div>
  );
}
