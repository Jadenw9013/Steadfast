import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { db } from "@/lib/db";
import { getMealPlanVersionDetail, hasDraftForWeek, isRestorableStatus } from "@/lib/meal-plans/history";
import { sourceNotRestorableMessage } from "@/lib/meal-plans/history-messages";
import { MealPlanVersionPreview } from "@/components/coach/meal-plan/history/meal-plan-version-preview";
import { RestoreVersionButton } from "@/components/coach/meal-plan/history/restore-version-button";
import { ExportPdfButton } from "@/components/ui/export-pdf-button";

/**
 * T-801 — read-only preview of a single past meal plan version, with Restore.
 * Ownership is checked twice: `verifyCoachAccessToClient` proves the coach may
 * act on THIS client, `detail.clientId !== clientId` proves the plan belongs
 * to that client (T-801 spec, Risk 4 — dropping the second check is an IDOR).
 */
export default async function MealPlanVersionDetailPage({
  params,
}: {
  params: Promise<{ clientId: string; mealPlanId: string }>;
}) {
  const { clientId, mealPlanId } = await params;
  await verifyCoachAccessToClient(clientId);

  const detail = await getMealPlanVersionDetail(mealPlanId);
  if (!detail || detail.clientId !== clientId) notFound();

  const [client, weekHasDraft] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: clientId } }),
    hasDraftForWeek(clientId, detail.weekOf),
  ]);

  const isRestorable = isRestorableStatus(detail.status);
  const weekLabel = detail.weekOf.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  // T-801 review, finding 5 — any status is previewable (including DRAFT), so
  // the subtitle must name the real status rather than a two-way ternary that
  // calls everything non-SUPERSEDED "Published".
  const statusLabel =
    detail.status === "PUBLISHED" ? "Published" : detail.status === "SUPERSEDED" ? "Superseded" : "Draft";

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/coach/clients/${clientId}/meal-plan/history`}
          className="text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
        >
          &larr; Back to history
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">
            {client.firstName} {client.lastName} &mdash; Week of {weekLabel}
          </h1>
          <span className="text-sm text-zinc-500">v{detail.version}</span>
        </div>
        <p className="text-sm text-zinc-400">
          {statusLabel} version, read-only.
          {!isRestorable && <span className="ml-1 text-amber-400">{sourceNotRestorableMessage()}</span>}
        </p>
      </div>

      <MealPlanVersionPreview detail={detail} />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <RestoreVersionButton
          clientId={clientId}
          sourceMealPlanId={detail.id}
          version={detail.version}
          weekLabel={weekLabel}
          weekHasDraft={weekHasDraft}
          isRestorable={isRestorable}
        />
        <ExportPdfButton resourceId={detail.id} type="meal-plan" variant="small" />
      </div>
    </div>
  );
}
