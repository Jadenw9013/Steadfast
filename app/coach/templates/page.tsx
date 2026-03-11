import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCoachTemplates } from "@/lib/queries/training-templates";
import { CreateTemplateButton } from "@/components/coach/training/create-template-button";

export default async function CoachTemplatesPage() {
  const user = await getCurrentDbUser();
  const templates = await getCoachTemplates(user.id);

  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/coach/dashboard"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:text-zinc-300"
          aria-label="Back to dashboard"
        >
          &larr; Dashboard
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Training Templates
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500">
              Reusable programs you can assign to any client
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/coach/templates/import"
              className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Import
            </Link>
            <CreateTemplateButton />
          </div>
        </div>
      </section>

      <section className="animate-fade-in" style={{ animationDelay: "80ms" }}>
        {templates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white px-8 py-16 text-center dark:border-zinc-700 dark:bg-[#0a1224]">
            <p className="text-sm font-semibold">No templates yet</p>
            <p className="text-sm text-zinc-400">
              Create a reusable training template or import one from a file or pasted text.
            </p>
            <div className="flex flex-col items-center gap-2 sm:flex-row">
              <CreateTemplateButton variant="inline" />
              <Link
                href="/coach/templates/import"
                className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Import from file or text
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/coach/templates/${t.id}`}
                  className="flex items-center justify-between rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-white/[0.06] dark:bg-[#0a1224] dark:hover:bg-zinc-900/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{t.name}</p>
                    {t.description && (
                      <p className="mt-0.5 truncate text-xs text-zinc-500">{t.description}</p>
                    )}
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-3">
                    <span className="text-xs text-zinc-400">
                      {t._count.days} {t._count.days === 1 ? "day" : "days"}
                    </span>
                    <span className="text-zinc-300 dark:text-zinc-600" aria-hidden="true">
                      &rsaquo;
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
