import Link from "next/link";
import { CheckInForm } from "@/components/check-in/check-in-form";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getLatestCheckIn } from "@/lib/queries/check-ins";
import { getActiveTemplateForClient } from "@/lib/queries/check-in-templates";

type TemplateQuestion = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
};

export default async function ClientCheckInPage() {
  const user = await getCurrentDbUser();
  const [latest, template] = await Promise.all([
    getLatestCheckIn(user.id),
    getActiveTemplateForClient(user.id),
  ]);

  const templateQuestions = template
    ? (template.questions as TemplateQuestion[])
    : undefined;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/client"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label="Back to dashboard"
        >
          &larr;
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Weekly Check-In
          </h1>
          <p className="text-xs text-zinc-500">
            Log your progress for the week
          </p>
        </div>
      </div>
      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800/80 dark:bg-[#121215]">
        <CheckInForm
          previousWeight={
            latest?.weight
              ? {
                weight: latest.weight,
                date: latest.submittedAt.toISOString(),
              }
              : null
          }
          templateId={template?.id}
          templateQuestions={templateQuestions}
        />
      </div>
    </div>
  );
}
