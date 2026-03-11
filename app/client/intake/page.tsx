import { getCurrentDbUser } from "@/lib/auth/roles";
import { getMyIntake } from "@/lib/queries/client-intake";
import { redirect } from "next/navigation";
import { Metadata } from "next";
import { NavBar } from "@/components/ui/nav-bar";
import { IntakeStepper } from "@/components/client/intake/intake-stepper";

export const metadata: Metadata = {
  title: "Intake Questionnaire | Steadfast",
};

export default async function IntakePage() {
  const user = await getCurrentDbUser();
  if (!user.isClient) redirect("/");

  const intake = await getMyIntake(user.id);

  // No intake sent or already completed — go to dashboard
  if (!intake || intake.status === "COMPLETED") {
    redirect("/client");
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#020815]">
      <NavBar role="client" canSwitchRole={user.isCoach && user.isClient} />
      <main className="mx-auto max-w-lg px-5 pb-16 pt-10 sm:px-8">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Getting started
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Intake Questionnaire
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Help your coach understand your starting point. Takes about 2 minutes.
          </p>
        </div>

        <IntakeStepper />
      </main>
    </div>
  );
}
