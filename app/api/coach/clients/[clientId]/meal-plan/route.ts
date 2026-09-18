import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseWeekStartDate, getCurrentWeekMonday } from "@/lib/utils/date";
import { planExtrasSchema } from "@/types/meal-plan-extras";
import {
  mealMacroTargetSchema,
  planModeSchema,
  macroTargetTransactionOps,
  resolveDefaultPlanMode,
} from "@/lib/meal-plans/macro-targets";
import { resolveEditorPlanMode } from "@/lib/meal-plans/plan-mode";

type Params = { params: Promise<{ clientId: string }> };

const mealPlanItemSchema = z.object({
  mealName: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
  foodName: z.string().min(1).max(200),
  quantity: z.string().min(1).max(50),
  unit: z.string().min(1).max(20),
  servingDescription: z.string().max(200).optional(),
  calories: z.coerce.number().int().min(0).default(0),
  protein: z.coerce.number().int().min(0).default(0),
  carbs: z.coerce.number().int().min(0).default(0),
  fats: z.coerce.number().int().min(0).default(0),
});

async function verifyAssignment(coachId: string, clientId: string) {
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

    // Draft, published and the client's persistent default all in parallel —
    // the CoachClient.planMode read adds no latency. Mirrors
    // `getEffectiveMealPlanForReview` in lib/queries/meal-plans.ts so the two
    // coach-facing readers compose lib/meal-plans/plan-mode.ts the same way
    // (T-800 code-review r1 MAJOR-1).
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
          items: { orderBy: { sortOrder: "asc" }, select: itemSelect },
          macroTargets: { orderBy: { sortOrder: "asc" }, select: macroTargetSelect },
        },
      }),
      db.mealPlan.findFirst({
        where: { clientId, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          weekOf: true,
          version: true,
          status: true,
          planMode: true,
          planExtras: true,
          publishedAt: true,
          items: { orderBy: { sortOrder: "asc" }, select: itemSelect },
          macroTargets: { orderBy: { sortOrder: "asc" }, select: macroTargetSelect },
        },
      }),
      resolveDefaultPlanMode(user.id, clientId),
    ]);

    // Computed from the DRAFT for the requested week ONLY — never from
    // `published`, or a toggle on a published-only week would silently do
    // nothing again. See lib/meal-plans/plan-mode.ts. Server-resolved
    // `draft?.planMode ?? clientPlanMode` — never inferred from the
    // published row's content (round-2 adjudication, board/tickets/T-800.md
    // "## Decision").
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
      // T-800 MAJOR-1, additive. Always present and never null, including
      // when `mealPlan` is null. `mealPlan.planMode` above is unchanged and
      // still means "the planMode of the row in `mealPlan`"; `editorMode` is
      // what the coach's editor must render.
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
  copyFromPublished: z.boolean().default(false),
  items: z.array(mealPlanItemSchema).max(50).optional(),
  macroTargets: z.array(mealMacroTargetSchema).max(50).optional(),
  planMode: planModeSchema.optional(),
  planExtras: planExtrasSchema.optional(),
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

    const { weekOf: weekOfParam, copyFromPublished } = parsed.data;
    let weekOf: Date;
    try {
      weekOf = parseWeekStartDate(weekOfParam);
    } catch {
      return NextResponse.json({ error: "Invalid weekOf date" }, { status: 400 });
    }

    // Determine next version number
    const latestVersion = await db.mealPlan.findFirst({
      where: { clientId, weekOf },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    let itemsToCreate: z.infer<typeof mealPlanItemSchema>[] = [];
    let macroTargetsToCreate: z.infer<typeof mealMacroTargetSchema>[] = parsed.data.macroTargets ?? [];
    let extrasToStore = parsed.data.planExtras;
    let planMode = parsed.data.planMode;

    if (parsed.data.items || parsed.data.macroTargets) {
      itemsToCreate = parsed.data.items ?? [];
    } else if (copyFromPublished) {
      const publishedPlan = await db.mealPlan.findFirst({
        where: { clientId, status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        select: {
          planMode: true,
          planExtras: true,
          items: {
            orderBy: { sortOrder: "asc" },
            select: {
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
            },
          },
          macroTargets: {
            orderBy: { sortOrder: "asc" },
            select: { mealName: true, sortOrder: true, calories: true, protein: true, carbs: true, fats: true },
          },
        },
      });
      if (publishedPlan) {
        itemsToCreate = publishedPlan.items.map((item) => ({
          mealName: item.mealName,
          sortOrder: item.sortOrder,
          foodName: item.foodName,
          quantity: item.quantity,
          unit: item.unit,
          servingDescription: item.servingDescription ?? undefined,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fats: item.fats,
        }));
        macroTargetsToCreate = publishedPlan.macroTargets.map((t) => ({ ...t }));
        if (planMode === undefined) planMode = publishedPlan.planMode;
        if (!extrasToStore && publishedPlan.planExtras) {
          const validated = planExtrasSchema.safeParse(publishedPlan.planExtras);
          if (validated.success) extrasToStore = validated.data;
        }
      }
    }

    if (planMode === undefined) {
      planMode = await resolveDefaultPlanMode(user.id, clientId);
    }

    const plan = await db.mealPlan.create({
      data: {
        clientId,
        weekOf,
        version: nextVersion,
        status: "DRAFT",
        planMode,
        planExtras: extrasToStore ?? undefined,
        items: { create: itemsToCreate },
        macroTargets: { create: macroTargetsToCreate },
      },
      select: {
        id: true,
        weekOf: true,
        version: true,
        status: true,
        planMode: true,
      },
    });

    return NextResponse.json({ mealPlan: plan }, { status: 201 });
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

    await db.$transaction([
      ...(items !== undefined
        ? [
            db.mealPlanItem.deleteMany({ where: { mealPlanId } }),
            ...items.map((item, i) =>
              db.mealPlanItem.create({
                data: {
                  mealPlanId,
                  mealName: item.mealName,
                  sortOrder: i,
                  foodName: item.foodName,
                  quantity: item.quantity,
                  unit: item.unit,
                  servingDescription: item.servingDescription ?? null,
                  calories: item.calories,
                  protein: item.protein,
                  carbs: item.carbs,
                  fats: item.fats,
                },
              })
            ),
          ]
        : []),
      ...(macroTargets !== undefined ? macroTargetTransactionOps(mealPlanId, macroTargets) : []),
      ...(planExtras !== undefined
        ? [
            db.mealPlan.update({
              where: { id: mealPlanId },
              data: { planExtras: planExtras ?? undefined },
            }),
          ]
        : []),
    ]);

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
