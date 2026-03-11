import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import {
  parsedMealPlanSchema,
  splitPortion,
  extractPlanExtras,
} from "@/lib/validations/meal-plan-import";
import { getCurrentWeekMonday } from "@/lib/utils/date";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  console.log("[import-plan] POST hit");
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const coach = await db.user.findUnique({ where: { clerkId: userId } });
    if (!coach?.isCoach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });

    const body = await req.json();
    const { draftId, parsedJson: overrideJson } = body as {
      draftId?: string;
      parsedJson?: unknown;
    };

    if (!draftId) return NextResponse.json({ error: "Missing draftId" }, { status: 400 });

    // Get draft + upload
    const draft = await db.mealPlanDraft.findUnique({
      where: { id: draftId },
      include: { upload: true },
    });

    if (!draft || draft.upload.coachId !== coach.id) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.upload.status === "IMPORTED") {
      return NextResponse.json({ error: "Already imported" }, { status: 400 });
    }

    // Use override JSON (from user edits) or the stored parsed JSON
    const rawJson = overrideJson ?? draft.parsedJson;
    const validated = parsedMealPlanSchema.safeParse(rawJson);
    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid meal plan data", details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const plan = validated.data;
    const clientId = draft.upload.clientId;
    const weekOf = getCurrentWeekMonday();

    // Determine next version
    const latestVersion = await db.mealPlan.findFirst({
      where: { clientId, weekOf },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    // Convert parsed meals → MealPlanItem format
    let sortOrder = 0;
    const items = plan.meals.flatMap((meal) =>
      meal.items.map((item) => {
        const { quantity, unit } = splitPortion(item.portion);
        return {
          mealName: meal.name,
          sortOrder: sortOrder++,
          foodName: item.food,
          quantity,
          unit,
          servingDescription: item.portion, // Keep original portion as description
          calories: 0,
          protein: 0,
          carbs: 0,
          fats: 0,
        };
      })
    );

    // Extract plan extras (metadata, overrides, supplements, etc.)
    const planExtras = extractPlanExtras(plan);

    // Create meal plan as draft (coach can review/publish in normal editor)
    const mealPlan = await db.mealPlan.create({
      data: {
        clientId,
        weekOf,
        version: nextVersion,
        status: "DRAFT",
        planExtras: planExtras ? JSON.parse(JSON.stringify(planExtras)) : undefined,
        items: { create: items },
      },
    });

    // Update draft with final edits if override was provided
    if (overrideJson) {
      await db.mealPlanDraft.update({
        where: { id: draftId },
        data: { parsedJson: plan },
      });
    }

    // Mark upload as imported
    await db.mealPlanUpload.update({
      where: { id: draft.upload.id },
      data: { status: "IMPORTED" },
    });

    return NextResponse.json({
      status: "imported",
      mealPlanId: mealPlan.id,
      clientId,
      weekStartDate: weekOf.toISOString().split("T")[0],
    });
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    console.error("[import]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
