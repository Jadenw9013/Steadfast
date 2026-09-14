import { getClientProvider, isClientProviderCurrent } from "@/lib/queries/client-provider";
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
    const provider = await getClientProvider(user.id);
    if (provider.resolutionRequired || provider.origin === "AI") return NextResponse.json({ error: provider.resolutionRequired ? "Your coaching provider needs resolution." : "Update Steadfast to use the AI Coach workspace." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    if (provider.origin === "NONE") return NextResponse.json({ mealPlan: null }, { headers: { "Cache-Control": "private, no-store" } });
    // ── Most recent published plan — explicit select (no select *) ────────
    const plan = await db.mealPlan.findFirst({
      where: { clientId: user.id, status: "PUBLISHED", publishedAt: { gte: provider.relationshipStartedAt! } },
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

    if (!await isClientProviderCurrent(user.id, provider)) return NextResponse.json({ error: "Your provider changed. Refresh to continue." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });

    if (!plan) {
      return NextResponse.json({ mealPlan: null });
    }

    // ── MacroTarget for the same weekOf as the plan ───────────────────────
    const macro = await getMacroTarget(user.id, plan.weekOf);

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
        planMode: plan.planMode,
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
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[GET /api/client/meal-plan/current]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
