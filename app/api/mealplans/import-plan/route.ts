import { auth } from "@clerk/nextjs/server";
import { db, prismaErrorMessage } from "@/lib/db";
import {
  parsedMealPlanSchema,
  splitPortion,
  extractPlanExtras,
} from "@/lib/validations/meal-plan-import";
import { createMealPlanDraft, supportContentInputSchema } from "@/lib/meal-plans/drafts";
import { emptyPlanMessage, publishMealPlanTarget } from "@/lib/meal-plans/publish";
import { parsePlanExtras } from "@/types/meal-plan-extras";
import { getCurrentWeekMonday } from "@/lib/utils/date";
import { NextRequest, NextResponse } from "next/server";
import { ROUTE_FAILED } from "@/lib/observability/events";
import { reportServerError } from "@/lib/observability/report";

/**
 * OCR/LLM import of a coach-uploaded meal-plan document (T-730).
 *
 * This route holds ZERO meal-plan lifecycle logic. It is auth + validation +
 * document→items mapping, then two calls into the shared services:
 * `createMealPlanDraft` (lib/meal-plans/drafts.ts — version allocation,
 * planMode, planExtras, supportContent) and, when the coach asked to publish,
 * `publishMealPlanTarget` (lib/meal-plans/publish.ts — the CB04 supersede and
 * the race guard). It used to hand-roll both, which made it a third MealPlan
 * writer that could leave two PUBLISHED rows for one week.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const coach = await db.user.findUnique({ where: { clerkId: userId } });
    if (!coach?.isCoach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });
    if (coach.isDeactivated) return NextResponse.json({ error: "Account is pending deletion" }, { status: 403 });

    const body = await req.json();
    const { draftId, parsedJson: overrideJson, publish } = body as {
      draftId?: string;
      parsedJson?: unknown;
      publish?: boolean;
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
    const shouldPublish = !!publish;

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

    // Extract plan extras (metadata, day overrides, confidence)
    const planExtras = parsePlanExtras(extractPlanExtras(plan)) ?? undefined;
    // Plan notes. `MealPlanDraft.supportContent` is a dead column — the live
    // source is the parsed JSON (or the coach's edited override). The shared
    // schema normalizes "" / whitespace-only to undefined so an empty
    // "Guidance & Support" section is not written as an empty string.
    const supportContent = supportContentInputSchema.parse(plan.supportContent);

    // Always created as a DRAFT through the shared service, which owns version
    // allocation (with its P2002 retry), planMode and content. `startBlank`
    // because an import is a wholesale replacement — the uploaded document is
    // the plan, so last week's published foods must never be merged into it.
    // `planMode` is explicit: this document can only ever produce foods
    // (parsedMealPlanSchema has no macro targets), so falling through to the
    // client's CoachClient.planMode could publish an empty MACROS plan.
    const { mealPlanId } = await createMealPlanDraft({
      clientId,
      coachId: coach.id,
      weekOf,
      startBlank: true,
      planMode: "MEAL_PLAN",
      items,
      planExtras,
      supportContent,
    });

    if (shouldPublish) {
      // `status: "DRAFT"` is constructed, not re-read: createMealPlanDraft never
      // writes MealPlan.status, and the flip itself is gated in the database
      // (`updateMany where status: "DRAFT"`), so any staleness degrades to
      // RACE_LOST rather than a wrong publish.
      const result = await publishMealPlanTarget({ id: mealPlanId, clientId, weekOf, status: "DRAFT" });
      if (!result.ok) {
        // Return BEFORE the bookkeeping writes. Marking the upload IMPORTED on a
        // failed publish would trip the "Already imported" 400 on the coach's
        // retry and strand the import.
        //
        // T-102b — a document that parsed to zero items produces an empty
        // MEAL_PLAN plan. Without this branch the shared guard's EMPTY_PLAN
        // would be misreported as PLAN_NOT_DRAFT.
        if (result.code === "EMPTY_PLAN") {
          return NextResponse.json(
            { error: emptyPlanMessage(result.planMode), code: "PLAN_EMPTY" },
            { status: 409 }
          );
        }
        return NextResponse.json(
          result.code === "RACE_LOST"
            ? { error: "This plan was already published or changed by someone else", code: "PUBLISH_RACE_LOST" }
            : { error: "Can only publish drafts", code: "PLAN_NOT_DRAFT" },
          { status: 409 }
        );
      }
    }

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
      mealPlanId,
      clientId,
      weekStartDate: weekOf.toISOString().split("T")[0],
      published: shouldPublish,
    });
  } catch (error) {
    const { message, status } = prismaErrorMessage(error);
    if (status >= 500) {
      reportServerError(ROUTE_FAILED.evt, error, {
        route: "/api/mealplans/import-plan",
        method: "POST",
        statusCode: status,
        context: { handler: "POST meal-plan import" },
        allow: ROUTE_FAILED.allow,
      });
    }
    console.error("[import]", message);
    return NextResponse.json({ error: message }, { status });
  }
}
