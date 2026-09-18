import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getMacroTarget } from "@/lib/queries/macro-targets";
import { parsePlanExtras } from "@/types/meal-plan-extras";
import { resolveDisplayPlanMode } from "@/lib/meal-plans/display-mode";

export async function GET() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // ── Most recent published plan — explicit select (no select *) ────────
    const plan = await db.mealPlan.findFirst({
      where: { clientId: user.id, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      select: {
        id: true,
        weekOf: true,
        status: true,
        planMode: true,
        publishedAt: true,
        planExtras: true,
        supportContent: true,
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            mealName: true,
            foodName: true,
            quantity: true,
            unit: true,
            servingDescription: true,
            calories: true,
            protein: true,
            carbs: true,
            fats: true,
          },
        },
        macroTargets: {
          orderBy: { sortOrder: "asc" },
          select: { id: true, mealName: true, calories: true, protein: true, carbs: true, fats: true },
        },
      },
    });

    if (!plan) {
      return NextResponse.json({ mealPlan: null });
    }

    // ── MacroTarget for the same weekOf as the plan ───────────────────────
    const macro = await getMacroTarget(user.id, plan.weekOf);

    // ── T-800 defensive render rule: never expose a mislabeled MACROS plan
    // (zero targets, has items) as MACROS — the client would see a blank
    // "no macro targets" card while the foods sit unrendered. ────────────
    const displayPlanMode = resolveDisplayPlanMode(plan.planMode, {
      items: plan.items.length,
      macroTargets: plan.macroTargets.length,
    });
    if (displayPlanMode !== plan.planMode) {
      console.warn("[meal-plan] mislabeled MACROS plan rendered as MEAL_PLAN", {
        mealPlanId: plan.id,
        items: plan.items.length,
        macroTargets: plan.macroTargets.length,
      });
    }

    // ── planExtras: safe parse from Json field ────────────────────────────
    const extras = parsePlanExtras(plan.planExtras);

    const planExtrasOut = extras
      ? {
          rules: null,
          cardio: null,
          hydration: null,
          supplements: null,
          // Pass through dayOverrides so iOS can run resolveForDay() client-side
          dayOverrides: extras.dayOverrides ?? null,
        }
      : null;

    return NextResponse.json({
      mealPlan: {
        id: plan.id,
        weekOf: plan.weekOf.toISOString(),
        status: plan.status,
        planMode: displayPlanMode,
        publishedAt: plan.publishedAt?.toISOString() ?? null,
        planExtras: planExtrasOut,
        planNotes: plan.supportContent,
        supportContent: plan.supportContent,
        items: plan.items.map((item) => ({
          id: item.id,
          mealName: item.mealName,
          foodName: item.foodName,
          quantity: item.quantity,
          unit: item.unit || null,
          servingDescription: item.servingDescription || null,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fats: item.fats,
        })),
        macroTargets: plan.macroTargets.map((t) => ({
          id: t.id,
          mealName: t.mealName,
          calories: t.calories,
          protein: t.protein,
          carbs: t.carbs,
          fats: t.fats,
        })),
        macroTarget: macro
          ? {
              calories: macro.calories,
              protein: macro.protein,
              carbs: macro.carbs,
              fats: macro.fats,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("[GET /api/client/meal-plan/current]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
