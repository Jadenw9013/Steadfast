import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { Metadata } from "next";

export const metadata: Metadata = { title: "Templates | Steadfast" };

export default async function TemplatesHubPage() {
  const user = await getCurrentDbUser();
  if (!user.isCoach) return <p className="p-8 text-zinc-400">Unauthorized</p>;

  // Load summary counts
  const profile = await db.coachProfile.findUnique({ where: { userId: user.id }, select: { id: true } });

  const [workoutCount, workoutTemplates, intakeForm, docCount] = await Promise.all([
    db.trainingTemplate.count({ where: { coachId: user.id } }),
    db.trainingTemplate.findMany({ where: { coachId: user.id }, select: { name: true }, take: 3, orderBy: { updatedAt: "desc" } }),
    db.intakeFormTemplate.findUnique({ where: { coachId: user.id }, select: { sections: true } }),
    profile ? db.coachDocument.count({ where: { coachId: user.id, isActive: true } }) : Promise.resolve(0),
  ]);

  const intakeSections = intakeForm?.sections as unknown as { title: string; questions: unknown[] }[] | null;
  const sectionCount = intakeSections?.length ?? 0;
  const questionCount = intakeSections?.reduce((sum, s) => sum + (s.questions?.length ?? 0), 0) ?? 0;

  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/coach/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          &larr; Dashboard
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Templates</h1>
        <p className="mt-1.5 text-sm text-zinc-500">Manage your reusable content and onboarding assets</p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in" style={{ animationDelay: "80ms" }}>
        {/* Workouts */}
        <Link
          href="/coach/templates/workouts"
          className="group flex flex-col rounded-2xl border border-zinc-200/80 bg-white p-6 transition-all hover:shadow-md hover:border-blue-500/20 dark:border-white/[0.06] dark:bg-[#0a1224] dark:hover:border-blue-500/20 dark:hover:shadow-blue-500/5"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/></svg>
          </div>
          <h2 className="text-sm font-semibold">Workout Templates</h2>
          <p className="mt-1 text-xs text-zinc-500">{workoutCount} {workoutCount === 1 ? "template" : "templates"}</p>
          {workoutTemplates.length > 0 && (
            <ul className="mt-3 space-y-1">
              {workoutTemplates.map(t => (
                <li key={t.name} className="text-xs text-zinc-400 truncate">• {t.name}</li>
              ))}
            </ul>
          )}
          <span className="mt-auto pt-4 text-xs font-semibold text-blue-400 group-hover:text-blue-300">Manage →</span>
        </Link>

        {/* Meal Plans — coming soon */}
        <div className="flex flex-col rounded-2xl border border-dashed border-zinc-300 bg-white/50 p-6 dark:border-zinc-700 dark:bg-[#0a1224]/50">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M13 21v-4"/><path d="M11 21v-4"/></svg>
          </div>
          <h2 className="text-sm font-semibold text-zinc-400">Meal Plan Templates</h2>
          <p className="mt-1 text-xs text-zinc-500">Coming soon</p>
          <span className="mt-auto pt-4 text-xs font-semibold text-zinc-600">Coming Soon</span>
        </div>

        {/* Onboarding */}
        <Link
          href="/coach/templates/onboarding"
          className="group flex flex-col rounded-2xl border border-zinc-200/80 bg-white p-6 transition-all hover:shadow-md hover:border-violet-500/20 dark:border-white/[0.06] dark:bg-[#0a1224] dark:hover:border-violet-500/20 dark:hover:shadow-violet-500/5"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>
          </div>
          <h2 className="text-sm font-semibold">Onboarding</h2>
          <div className="mt-2 space-y-1">
            <p className="text-xs text-zinc-500">Intake Form: {sectionCount} {sectionCount === 1 ? "section" : "sections"}, {questionCount} {questionCount === 1 ? "question" : "questions"}</p>
            <p className="text-xs text-zinc-500">Documents: {docCount} {docCount === 1 ? "document" : "documents"}</p>
          </div>
          <span className="mt-auto pt-4 text-xs font-semibold text-violet-400 group-hover:text-violet-300">Manage →</span>
        </Link>
      </section>
    </div>
  );
}
