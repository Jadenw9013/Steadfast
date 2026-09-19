import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseWeekStartDate, getCurrentWeekMonday } from "@/lib/utils/date";
import { planExtrasSchema } from "@/types/meal-plan-extras";
import { mealMacroTargetSchema, planModeSchema } from "@/lib/meal-plans/macro-targets";
import { resolveDefaultPlanMode, resolveEditorPlanMode } from "@/lib/meal-plans/plan-mode";
import {
  mealPlanItemSchema,
  supportContentInputSchema,
  resolveStartBlank,
  createMealPlanDraft,
  getMealPlanSaveTarget,
  saveMealPlanDraftContent,
} from "@/lib/meal-plans/drafts";

type Params = { params: Promise<{ clientId: string }> };

/** Exported so the three history routes (T-801) import this instead of
 *  writing a third and fourth copy of the same assignment check. */
export async function verifyAssignment(coachId: string, clientId: string) {
  return db.coachClient.findUnique({
    where: { coachId_clientId: { coachId, clientId } },
    select: { id: true },
  });
}

// ── GET — effective meal plan for a week ──────────────────────────────────────

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
    const weekOfParam = searchParams.get("weekOf");

    let weekOf: Date;
    if (weekOfParam) {
      try {
        weekOf = parseWeekStartDate(weekOfParam);
      } catch {
        return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
      }
    } else {
      // Default to most recent published plan
      const latest = await db.mealPlan.findFirst({
        where: { clientId, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        select: { weekOf: true },
      });
      weekOf = latest?.weekOf ?? new Date();
    }

    // Draft takes priority over published for the given week
    const itemSelect = {
      id: true,
      mealName: true,
      sortOrder: true,
      foodName: true,
      quantity: true,
      unit: true,
      servingDescription: true,
      calories: true,
      protein: true,
      carbs: true,
      fats: true,
    } as const;
    const macroTargetSelect = {
      id: true,
      mealName: true,
      sortOrder: true,
      calories: true,
      protein: true,
      carbs: true,
      fats: true,
    } as const;

    // All three reads in parallel — the CoachClient.planMode read adds no
    // latency. Mirrors `getEffectiveMealPlanForReview` in lib/queries/meal-plans.ts
    // so the two coach-facing readers compose lib/meal-plans/plan-mode.ts the
    // same way. The published read is scoped to the requested week, matching the
    // draft lookup. The previous unscoped lookup returned the globally-latest
    // published plan while reporting `source: "published"` and a `weekOf` from a
    // different week (T-101, audit note 2). The default-week branch above is
    // unaffected: it derives `weekOf` from the latest published plan, so this
    // returns that same row. Its own defect (preferring the latest published
    // week over the current week) is T-731.
    const [draft, published, clientPlanMode] = await Promise.all([
      db.mealPlan.findFirst({
        where: { clientId, weekOf, status: "DRAFT" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          weekOf: true,
          version: true,
          status: true,
          planMode: true,
          planExtras: true,
          supportContent: true,
          items: { orderBy: { sortOrder: "asc" }, select: itemSelect },
          macroTargets: { orderBy: { sortOrder: "asc" }, select: macroTargetSelect },
        },
      }),
      db.mealPlan.findFirst({
        where: { clientId, weekOf, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          weekOf: true,
          version: true,
          status: true,
          planMode: true,
          planExtras: true,
          supportContent: true,
          publishedAt: true,
          items: { orderBy: { sortOrder: "asc" }, select: itemSelect },
          macroTargets: { orderBy: { sortOrder: "asc" }, select: macroTargetSelect },
        },
      }),
      resolveDefaultPlanMode(user.id, clientId),
    ]);

    // Computed from the DRAFT for the requested week ONLY — never from
    // `published`, and never from `active` below, or a toggle on a
    // published-only week would silently do nothing again (T-102a).
    // See lib/meal-plans/plan-mode.ts.
    const editorMode = resolveEditorPlanMode(draft?.planMode ?? null, clientPlanMode);

    const active = draft ?? published;

    return NextResponse.json({
      mealPlan: active
        ? {
            id: active.id,
            weekOf: active.weekOf.toISOString(),
            version: active.version,
            status: active.status,
            planMode: active.planMode,
            planExtras: active.planExtras ?? null,
            // Same column under both names — `planNotes` is what iOS decodes,
            // `supportContent` is web's canonical name. Matches the precedent
            // in app/api/client/meal-plan/current/route.ts. Before T-101 an
            // iOS coach could not see plan notes a web coach wrote at all.
            planNotes: active.supportContent ?? null,
            supportContent: active.supportContent ?? null,
            items: active.items,
            macroTargets: active.macroTargets,
          }
        : null,
      source: draft ? "draft" : published ? "published" : "empty",
      draftId: draft?.id ?? null,
      publishedId: published?.id ?? null,
      // Server-computed "current week" — clients should prefer this over
      // any on-device date math when seeding a brand-new plan's weekOf.
      currentWeekOf: getCurrentWeekMonday().toISOString(),
      // T-102a, additive. Always present and never null, including when
      // `mealPlan` is null — that empty case is the whole point. `mealPlan
      // .planMode` above is unchanged and still means "the planMode of the row
      // in `mealPlan`"; `editorMode` is what the coach's editor must render.
      clientPlanMode,
      editorMode,
    });
  } catch (err) {
    console.error("[GET /api/coach/clients/[clientId]/meal-plan]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── POST — create new draft meal plan ─────────────────────────────────────────

const createDraftSchema = z.object({
  weekOf: z.string().min(1),
  /** Legacy. Only an explicit `false` is still meaningful (⇒ start blank);
   *  `true` and omitted both mean copy-forward. Prefer `startBlank`. */
  copyFromPublished: z.boolean().optional(),
  startBlank: z.boolean().optional(),
  items: z.array(mealPlanItemSchema).max(50).optional(),
  macroTargets: z.array(mealMacroTargetSchema).max(50).optional(),
  planMode: planModeSchema.optional(),
  planExtras: planExtrasSchema.optional(),
  supportContent: supportContentInputSchema,
});

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
    const parsed = createDraftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { weekOf: weekOfParam } = parsed.data;
    let weekOf: Date;
    try {
      weekOf = parseWeekStartDate(weekOfParam);
    } catch {
      return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
    }

    // All draft-creation logic (copy-forward, planMode resolution, versioning)
    // lives in lib/meal-plans/drafts.ts so this route and the web Server Action
    // can't diverge again — T-101.
    const { mealPlanId } = await createMealPlanDraft({
      clientId,
      coachId: user.id,
      weekOf,
      startBlank: resolveStartBlank(parsed.data),
      planMode: parsed.data.planMode,
      items: parsed.data.items,
      macroTargets: parsed.data.macroTargets,
      planExtras: parsed.data.planExtras,
      supportContent: parsed.data.supportContent,
    });

    const fullPlan = await db.mealPlan.findUniqueOrThrow({
      where: { id: mealPlanId },
      select: { id: true, weekOf: true, version: true, status: true, planMode: true },
    });

    return NextResponse.json({ mealPlan: fullPlan }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/coach/clients/[clientId]/meal-plan]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── PUT — save draft meal plan items ─────────────────────────────────────────

const saveDraftSchema = z.object({
  mealPlanId: z.string().min(1),
  items: z.array(mealPlanItemSchema).max(50).optional(),
  macroTargets: z.array(mealMacroTargetSchema).max(50).optional(),
  planExtras: planExtrasSchema.optional().nullable(),
  /** Canonical name, matches the web Server Action. */
  supportContent: supportContentInputSchema,
  /** Alias — the name iOS already sends. `supportContent` wins if both present. */
  planNotes: supportContentInputSchema,
});

export async function PUT(req: NextRequest, { params }: Params) {
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
    const parsed = saveDraftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    const { mealPlanId, items, macroTargets, planExtras } = parsed.data;
    const supportContent =
      parsed.data.supportContent !== undefined ? parsed.data.supportContent : parsed.data.planNotes;

    const target = await getMealPlanSaveTarget(mealPlanId);
    if (!target) {
      return NextResponse.json({ error: "Meal plan not found" }, { status: 404 });
    }
    if (target.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // CB04 fork-on-published lives entirely in lib/meal-plans/drafts.ts.
    const result = await saveMealPlanDraftContent(target, {
      items,
      macroTargets,
      planExtras,
      supportContent,
    });

    if (result.forkedNewDraftId) {
      return NextResponse.json({ success: true, forkedNewDraftId: result.forkedNewDraftId });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/coach/clients/[clientId]/meal-plan]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── DELETE — delete a draft meal plan ────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: Params) {
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
    const mealPlanId = searchParams.get("mealPlanId");
    if (!mealPlanId) {
      return NextResponse.json(
        { error: "mealPlanId query param is required" },
        { status: 400 }
      );
    }

    const plan = await db.mealPlan.findUnique({
      where: { id: mealPlanId },
      select: { clientId: true, status: true },
    });
    if (!plan) {
      return NextResponse.json({ error: "Meal plan not found" }, { status: 404 });
    }
    if (plan.clientId !== clientId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (plan.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Only draft plans can be deleted" },
        { status: 409 }
      );
    }

    await db.mealPlan.delete({ where: { id: mealPlanId } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[DELETE /api/coach/clients/[clientId]/meal-plan]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
