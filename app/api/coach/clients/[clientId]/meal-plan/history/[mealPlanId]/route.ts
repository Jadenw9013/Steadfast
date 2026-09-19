import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { verifyAssignment } from "@/app/api/coach/clients/[clientId]/meal-plan/route";
import { getMealPlanVersionDetail, hasDraftForWeek, isRestorableStatus } from "@/lib/meal-plans/history";

type Params = { params: Promise<{ clientId: string; mealPlanId: string }> };

// ── GET — a single meal plan version, read-only (T-801) ──────────────────────
//
// Thin wrapper over lib/meal-plans/history.ts. Any status is previewable
// (including DRAFT), but `isRestorable` only ever reports true for
// PUBLISHED/SUPERSEDED — the same predicate createDraftFromMealPlanVersion
// enforces server-side.

export async function GET(_req: NextRequest, { params }: Params) {
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
    const { clientId, mealPlanId } = await params;

    if (!(await verifyAssignment(user.id, clientId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const detail = await getMealPlanVersionDetail(mealPlanId);
    if (!detail) {
      return NextResponse.json({ error: "Meal plan not found" }, { status: 404 });
    }
    // IDOR guard: the coach's assignment proves they may act on THIS client,
    // not that this plan belongs to that client. Both checks are required —
    // see T-801 spec, Risk 4.
    if (detail.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const weekHasDraft = await hasDraftForWeek(clientId, detail.weekOf);
    const isRestorable = isRestorableStatus(detail.status);

    return NextResponse.json({
      mealPlan: {
        id: detail.id,
        weekOf: detail.weekOf.toISOString(),
        version: detail.version,
        status: detail.status,
        planMode: detail.planMode,
        publishedAt: detail.publishedAt ? detail.publishedAt.toISOString() : null,
        planNotes: detail.supportContent ?? null,
        supportContent: detail.supportContent ?? null,
        planExtras: detail.planExtras ?? null,
        items: detail.items,
        macroTargets: detail.macroTargets,
      },
      weekHasDraft,
      isRestorable,
    });
  } catch (err) {
    console.error("[GET /api/coach/clients/[clientId]/meal-plan/history/[mealPlanId]]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
