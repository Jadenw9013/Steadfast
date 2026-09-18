import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { verifyAssignment } from "@/app/api/coach/clients/[clientId]/meal-plan/route";
import { listMealPlanHistory, mealPlanHistoryQuerySchema } from "@/lib/meal-plans/history";

type Params = { params: Promise<{ clientId: string }> };

// ── GET — coach-facing meal plan version history (T-801) ─────────────────────
//
// Thin wrapper. All logic lives in lib/meal-plans/history.ts, shared with the
// two sibling routes and the restore Server Action (standing rule 1).

export async function GET(req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { clientId } = await params;

    if (!(await verifyAssignment(user.id, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const parsed = mealPlanHistoryQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const page = await listMealPlanHistory({
      clientId,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    return NextResponse.json({
      items: page.items.map((item) => ({
        id: item.id,
        weekOf: item.weekOf.toISOString(),
        version: item.version,
        status: item.status,
        publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
        planMode: item.planMode,
        itemCount: item.itemCount,
        macroTargetCount: item.macroTargetCount,
        hasPlanNotes: item.hasPlanNotes,
        weekHasDraft: item.weekHasDraft,
      })),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      currentPublishedMealPlanId: page.currentPublishedMealPlanId,
    });
  } catch (err) {
    console.error("[GET /api/coach/clients/[clientId]/meal-plan/history]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
