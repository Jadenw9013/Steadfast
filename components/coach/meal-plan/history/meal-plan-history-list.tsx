import Link from "next/link";
import type { MealPlanHistoryPage } from "@/lib/meal-plans/history";

/**
 * T-801 — one row per PUBLISHED/SUPERSEDED meal plan version. Server
 * component: no interactivity here, restore lives on the preview page.
 * Counts are picked by `planMode`, never by which array is non-empty — since
 * T-101 a MACROS version routinely also carries the previous week's foods.
 */

function weekLabel(weekOf: Date): string {
  return weekOf.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusPill({ status, isActive }: { status: "PUBLISHED" | "SUPERSEDED"; isActive: boolean }) {
  if (isActive) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-0.5 text-xs font-semibold text-emerald-400">
        Active
      </span>
    );
  }
  if (status === "SUPERSEDED") {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-800 px-3 py-0.5 text-xs font-semibold text-zinc-400">
        Superseded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-blue-500/10 px-3 py-0.5 text-xs font-semibold text-blue-400">
      Published
    </span>
  );
}

export function MealPlanHistoryList({
  clientId,
  page,
}: {
  clientId: string;
  page: MealPlanHistoryPage;
}) {
  if (page.total === 0) {
    return (
      <div className="sf-glass-card p-12 text-center">
        <p className="text-zinc-400">No published meal plan history yet for this client.</p>
      </div>
    );
  }

  const hasPrev = page.offset > 0;
  const hasNext = page.offset + page.items.length < page.total;
  const prevOffset = Math.max(0, page.offset - page.limit);
  const nextOffset = page.offset + page.limit;
  // Carry `limit` through so a non-default page size survives paging
  // (T-801 review, finding 6 / parity gap 4) — offsets above are already
  // computed from `page.limit`, so dropping it from the link would silently
  // reset the page size back to the default on the next click.
  const pageQuery = (offset: number) => `?offset=${offset}&limit=${page.limit}`;

  return (
    <div className="space-y-3">
      {page.items.map((item) => {
        const countLabel =
          item.planMode === "MACROS"
            ? `${item.macroTargetCount} target${item.macroTargetCount === 1 ? "" : "s"}`
            : `${item.itemCount} food${item.itemCount === 1 ? "" : "s"}`;
        const isActive = item.id === page.currentPublishedMealPlanId;

        return (
          <Link
            key={item.id}
            href={`/coach/clients/${clientId}/meal-plan/history/${item.id}`}
            className="flex min-h-[48px] items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-white/[0.04] p-4 transition-colors hover:border-white/[0.14] hover:bg-white/[0.07]"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-white">Week of {weekLabel(item.weekOf)}</p>
                <span className="text-xs text-zinc-500">v{item.version}</span>
                <span className="inline-flex items-center rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  {item.planMode === "MACROS" ? "Macros" : "Foods"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-3 text-sm text-zinc-400">
                <span>{countLabel}</span>
                {item.publishedAt && (
                  <span>
                    Published{" "}
                    {item.publishedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
                {item.hasPlanNotes && <span>Has notes</span>}
                {item.weekHasDraft && <span className="text-amber-400">Draft in progress</span>}
              </div>
            </div>
            <StatusPill status={item.status} isActive={isActive} />
          </Link>
        );
      })}

      {(hasPrev || hasNext) && (
        <div className="flex items-center justify-between pt-2">
          {hasPrev ? (
            <Link
              href={pageQuery(prevOffset)}
              className="inline-flex min-h-[48px] items-center rounded-xl border border-zinc-700 px-5 text-sm font-semibold text-zinc-300 transition-all hover:border-zinc-500 hover:text-zinc-100"
            >
              &larr; Newer
            </Link>
          ) : (
            <span />
          )}
          {hasNext && (
            <Link
              href={pageQuery(nextOffset)}
              className="inline-flex min-h-[48px] items-center rounded-xl border border-zinc-700 px-5 text-sm font-semibold text-zinc-300 transition-all hover:border-zinc-500 hover:text-zinc-100"
            >
              Older &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
