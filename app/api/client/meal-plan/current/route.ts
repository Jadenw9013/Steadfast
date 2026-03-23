import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { getMacroTarget } from "@/lib/queries/macro-targets";
import { parsePlanExtras } from "@/types/meal-plan-extras";

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
        planExtras: true,
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            mealName: true,
            foodName: true,
            quantity: true,
            unit: true,
            calories: true,
            protein: true,
            carbs: true,
            fats: true,
          },
        },
      },
    });

    if (!plan) {
      return NextResponse.json({ mealPlan: null });
    }

    // ── MacroTarget for the same weekOf as the plan ───────────────────────
    const macro = await getMacroTarget(user.id, plan.weekOf);

    // ── planExtras: safe parse from Json field ────────────────────────────
    const extras = parsePlanExtras(plan.planExtras);

    const planExtrasOut = extras
      ? {
          rules: extras.rules?.map((r) => r.text) ?? null,
          cardio:
            extras.rules
              ?.filter((r) => r.category.toLowerCase() === "cardio")
              .map((r) => r.text)
              .join("; ") || null,
          hydration:
            extras.rules
              ?.filter((r) => r.category.toLowerCase() === "hydration")
              .map((r) => r.text)
              .join("; ") || null,
          supplements:
            extras.supplements
              ?.map(
                (s) =>
                  `${s.name}${s.dosage ? ` (${s.dosage})` : ""} — ${s.timing}`
              )
              .join("; ") || null,
        }
      : null;

    return NextResponse.json({
      mealPlan: {
        id: plan.id,
        weekOf: plan.weekOf.toISOString(),
        status: plan.status,
        planExtras: planExtrasOut,
        items: plan.items.map((item) => ({
          id: item.id,
          mealName: item.mealName,
          foodName: item.foodName,
          quantity: parseFloat(item.quantity) || 0,
          unit: item.unit || null,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fats: item.fats,
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
