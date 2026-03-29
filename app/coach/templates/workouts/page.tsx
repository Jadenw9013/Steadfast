import Link from "next/link";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCoachTemplates } from "@/lib/queries/training-templates";
import { CreateTemplateButton } from "@/components/coach/training/create-template-button";

export default async function CoachWorkoutTemplatesPage() {
  const user = await getCurrentDbUser();
  const templates = await getCoachTemplates(user.id);

  return (
    <div className="space-y-8">
      <section className="animate-fade-in">
        <Link
          href="/coach/templates"
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
          aria-label="Back to templates"
        >
          &larr; Templates
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
              className="rounded-xl border border-white/[0.12] px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
            >
              Import
            </Link>
            <CreateTemplateButton />
          </div>
        </div>
      </section>

      <section className="animate-fade-in" style={{ animationDelay: "80ms" }}>
        {templates.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.02] px-8 py-16 text-center">
            <p className="text-sm font-semibold">No templates yet</p>
            <p className="text-sm text-zinc-400">
              Create a reusable training template or import one from a file or pasted text.
            </p>
            <div className="flex flex-col items-center gap-2 sm:flex-row">
              <CreateTemplateButton variant="inline" />
              <Link
                href="/coach/templates/import"
                className="rounded-xl border border-white/[0.12] px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
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
                  className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-4 transition-colors hover:border-white/[0.14] hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
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
                    <span className="text-zinc-300" aria-hidden="true">
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
