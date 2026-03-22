import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getIntakeFormTemplate } from "@/lib/queries/intake-form";
import { Metadata } from "next";

export const metadata: Metadata = { title: "Onboarding Templates | Steadfast" };

export default async function OnboardingHubPage() {
  const user = await getCurrentDbUser();
  if (!user.isCoach) return <p className="p-8 text-zinc-400">Unauthorized</p>;

  const [intakeForm, documents] = await Promise.all([
    getIntakeFormTemplate(user.id),
    db.coachDocument.findMany({
      where: { coachId: user.id, isActive: true },
      select: { title: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const intakeSections = intakeForm?.sections as unknown as { title: string; questions: unknown[] }[] | null;
  const sectionCount = intakeSections?.length ?? 0;
  const questionCount = intakeSections?.reduce((sum, s) => sum + (s.questions?.length ?? 0), 0) ?? 0;
  const sectionTitles = intakeSections?.map(s => s.title) ?? [];

  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/coach/templates"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          &larr; Templates
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Onboarding Templates</h1>
        <p className="mt-1.5 text-sm text-zinc-500">Manage the forms and documents sent to prospects during the intake process.</p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in" style={{ animationDelay: "80ms" }}>
        {/* Intake Form */}
        <div className="flex flex-col rounded-2xl border border-zinc-200/80 bg-white p-6 dark:border-white/[0.06] dark:bg-[#0a1224]">
          <h2 className="text-sm font-semibold">Intake Form</h2>
          <p className="mt-1 text-xs text-zinc-500">{sectionCount} {sectionCount === 1 ? "section" : "sections"}, {questionCount} {questionCount === 1 ? "question" : "questions"}</p>
          {sectionTitles.length > 0 && (
            <ul className="mt-3 space-y-1">
              {sectionTitles.slice(0, 4).map(t => (
                <li key={t} className="text-xs text-zinc-400 truncate">• {t}</li>
              ))}
              {sectionTitles.length > 4 && (
                <li className="text-xs text-zinc-500">+ {sectionTitles.length - 4} more</li>
              )}
            </ul>
          )}
          <Link
            href="/coach/templates/onboarding/intake"
            className="mt-auto pt-4 inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            Edit Form →
          </Link>
        </div>

        {/* Documents */}
        <div className="flex flex-col rounded-2xl border border-zinc-200/80 bg-white p-6 dark:border-white/[0.06] dark:bg-[#0a1224]">
          <h2 className="text-sm font-semibold">Documents</h2>
          <p className="mt-1 text-xs text-zinc-500">{documents.length} {documents.length === 1 ? "document" : "documents"}</p>
          {documents.length > 0 && (
            <ul className="mt-3 space-y-1">
              {documents.slice(0, 4).map(d => (
                <li key={d.title} className="text-xs text-zinc-400 truncate">• {d.title}</li>
              ))}
              {documents.length > 4 && (
                <li className="text-xs text-zinc-500">+ {documents.length - 4} more</li>
              )}
            </ul>
          )}
          <Link
            href="/coach/templates/onboarding/documents"
            className="mt-auto pt-4 inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            Manage Documents →
          </Link>
        </div>
      </section>
    </div>
  );
}
