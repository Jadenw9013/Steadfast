import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getIntakeFormTemplate } from "@/lib/queries/intake-form";
import { IntakeFormSectionPanel } from "@/components/coach/intake/intake-form-section";
import { Metadata } from "next";

export const metadata: Metadata = { title: "Intake Form | Steadfast" };

export default async function IntakeFormPage() {
  const user = await getCurrentDbUser();
  if (!user.isCoach) return <p className="p-8 text-zinc-400">Unauthorized</p>;

  const intakeFormTemplate = await getIntakeFormTemplate(user.id);
  const intakeFormSections = intakeFormTemplate
    ? (intakeFormTemplate.sections as unknown as import("@/lib/intake-form-defaults").IntakeFormSection[])
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/coach/templates/onboarding"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          &larr; Onboarding
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Intake Form</h1>
        <p className="mt-1.5 text-sm text-zinc-500">Customize the form used during client intake sessions.</p>
      </section>

      <section className="animate-fade-in" style={{ animationDelay: "80ms" }}>
        <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4 dark:border-white/[0.06] dark:bg-[#0a1224]">
          <IntakeFormSectionPanel initialSections={intakeFormSections} />
        </div>
      </section>
    </div>
  );
}
