import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { parseWeekStartDate } from "@/lib/utils/date";
import { verifyAssignment } from "@/app/api/coach/clients/[clientId]/meal-plan/route";
import {
  createDraftFromMealPlanVersion,
  draftExistsMessage,
  getMealPlanVersionDetail,
  sourceNotRestorableMessage,
} from "@/lib/meal-plans/history";

type Params = { params: Promise<{ clientId: string }> };

const restoreSchema = z.object({
  sourceMealPlanId: z.string().min(1),
  weekOf: z.string().optional(),
  replaceExistingDraft: z.boolean().optional(),
});

// ── POST — restore a past meal plan version into a new DRAFT (T-801) ─────────
//
// Never mutates or un-publishes history. Auth ladder identical to the publish
// route: auth → isCoach → CoachClient assignment → parse body →
// parseWeekStartDate → read source → 404 → source.clientId !== clientId 403 →
// service. All business logic lives in lib/meal-plans/history.ts.

export async function POST(req: NextRequest, { params }: Params) {
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

    const body = await req.json();
    const parsed = restoreSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    let weekOf: Date | undefined;
    if (parsed.data.weekOf) {
      try {
        weekOf = parseWeekStartDate(parsed.data.weekOf);
      } catch {
        return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
      }
    }

    const source = await getMealPlanVersionDetail(parsed.data.sourceMealPlanId);
    if (!source) {
      return NextResponse.json({ error: "Meal plan not found" }, { status: 404 });
    }
    if (source.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await createDraftFromMealPlanVersion({
      source,
      coachId: user.id,
      weekOf,
      replaceExistingDraft: parsed.data.replaceExistingDraft,
    });

    if (!result.ok) {
      if (result.code === "SOURCE_NOT_RESTORABLE") {
        return NextResponse.json(
          { error: sourceNotRestorableMessage(), code: "SOURCE_NOT_RESTORABLE" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: draftExistsMessage(), code: "DRAFT_EXISTS", existingDraftId: result.existingDraftId },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      draftMealPlanId: result.draftMealPlanId,
      weekOf: result.weekOf.toISOString(),
      replacedDraftIds: result.replacedDraftIds,
    });
  } catch (err) {
    console.error("[POST /api/coach/clients/[clientId]/meal-plan/restore]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
