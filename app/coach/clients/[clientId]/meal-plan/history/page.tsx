import Link from "next/link";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { db } from "@/lib/db";
import { listMealPlanHistory, mealPlanHistoryQuerySchema } from "@/lib/meal-plans/history";
import { MealPlanHistoryList } from "@/components/coach/meal-plan/history/meal-plan-history-list";

/**
 * T-801 — coach-facing meal plan version history for a client.
 * A page never 400s: an invalid/unparseable query string falls back to the
 * schema's own defaults (limit 50, offset 0) rather than erroring.
 */
export default async function MealPlanHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientId } = await params;
  await verifyCoachAccessToClient(clientId);

  const rawQuery = await searchParams;
  const parsedQuery = mealPlanHistoryQuerySchema.safeParse(rawQuery);
  const { limit, offset } = parsedQuery.success
    ? parsedQuery.data
    : mealPlanHistoryQuerySchema.parse({});

  const client = await db.user.findUniqueOrThrow({ where: { id: clientId } });
  const page = await listMealPlanHistory({ clientId, limit, offset });

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/coach/clients/${clientId}`}
          className="text-sm text-zinc-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
        >
          &larr; Back to profile
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white">
          {client.firstName} {client.lastName}
        </h1>
        <p className="text-sm text-zinc-400">Meal plan version history</p>
      </div>

      <MealPlanHistoryList clientId={clientId} page={page} />
    </div>
  );
}
