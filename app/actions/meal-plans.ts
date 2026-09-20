"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { parseWeekStartDate } from "@/lib/utils/date";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { revalidatePath } from "next/cache";
import { notifyMealPlanUpdated } from "@/lib/sms/notify";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { planExtrasSchema } from "@/types/meal-plan-extras";
import { mergePlanExtras } from "@/lib/meal-plans/plan-extras-merge";
import {
  mealMacroTargetSchema,
  planModeSchema,
  macroTargetTransactionOps,
  resolveDefaultPlanMode,
} from "@/lib/meal-plans/macro-targets";
import {
  getMealPlanPublishTarget,
  publishMealPlanTarget,
} from "@/lib/meal-plans/publish";

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

const createDraftSchema = z.object({
  clientId: z.string().min(1),
  weekStartDate: z.string().min(1),
  copyFromPublished: z.boolean().default(false),
  items: z.array(mealPlanItemSchema).max(50).optional(),
  macroTargets: z.array(mealMacroTargetSchema).max(50).optional(),
  planMode: planModeSchema.optional(),
  planExtras: planExtrasSchema.optional(),
  supportContent: z.string().optional().nullable(),
});

export async function createDraftMealPlan(input: unknown) {
  const parsed = createDraftSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const { clientId, weekStartDate, copyFromPublished } = parsed.data;
  const coach = await verifyCoachAccessToClient(clientId);

  const weekOf = parseWeekStartDate(weekStartDate);

  // Determine next version number
  const latestVersion = await db.mealPlan.findFirst({
    where: { clientId, weekOf },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latestVersion?.version ?? 0) + 1;

  // Resolve items: explicit items > copy from published > empty
  let itemsToCreate: z.infer<typeof mealPlanItemSchema>[] = [];
  let macroTargetsToCreate: z.infer<typeof mealMacroTargetSchema>[] = parsed.data.macroTargets ?? [];
  let extrasToStore: z.infer<typeof planExtrasSchema> | undefined =
    parsed.data.planExtras;
  let supportContent = parsed.data.supportContent;
  let planMode = parsed.data.planMode;

  if (parsed.data.items || parsed.data.macroTargets) {
    itemsToCreate = parsed.data.items ?? [];
  } else if (copyFromPublished) {
    const published = await db.mealPlan.findFirst({
      where: { clientId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        macroTargets: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (published) {
      itemsToCreate = published.items.map((item) => ({
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
      macroTargetsToCreate = published.macroTargets.map((t) => ({
        mealName: t.mealName,
        sortOrder: t.sortOrder,
        calories: t.calories,
        protein: t.protein,
        carbs: t.carbs,
        fats: t.fats,
      }));
      if (planMode === undefined) planMode = published.planMode;
      // Also copy plan extras and support content from the published plan
      if (!extrasToStore && published.planExtras) {
        const validated = planExtrasSchema.safeParse(published.planExtras);
        if (validated.success) extrasToStore = validated.data;
      }
      if (supportContent === undefined && published.supportContent) {
        supportContent = published.supportContent;
      }
    }
  }

  if (planMode === undefined) {
    planMode = await resolveDefaultPlanMode(coach.id, clientId);
  }

  const plan = await db.mealPlan.create({
    data: {
      clientId,
      weekOf,
      version: nextVersion,
      status: "DRAFT",
      planMode,
      planExtras: extrasToStore ?? undefined,
      supportContent: supportContent ?? undefined,
      items: { create: itemsToCreate },
      macroTargets: { create: macroTargetsToCreate },
    },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      macroTargets: { orderBy: { sortOrder: "asc" } },
    },
  });

  revalidatePath("/coach", "layout");
  return { mealPlanId: plan.id };
}

const saveDraftSchema = z.object({
  mealPlanId: z.string().min(1),
  items: z.array(mealPlanItemSchema).max(50).optional(),
  macroTargets: z.array(mealMacroTargetSchema).max(50).optional(),
  planExtras: planExtrasSchema.optional().nullable(),
  supportContent: z.string().optional().nullable(),
});

export async function saveDraftMealPlan(input: unknown) {
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { mealPlanId, items, macroTargets, planExtras, supportContent } = parsed.data;

  const plan = await db.mealPlan.findUnique({
    where: { id: mealPlanId },
    select: { clientId: true, status: true, planExtras: true },
  });
  if (!plan) throw new Error("Meal plan not found");

  await verifyCoachAccessToClient(plan.clientId);

  // Replace all items/macroTargets (whichever was provided) + update extras
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
                servingDescription: item.servingDescription || null,
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
    // Update planExtras/supportContent if provided.
    // planExtras: T-841 — a defined, non-null value merges key-wise against
    // the RAW stored JSON (see lib/meal-plans/plan-extras-merge.ts) instead
    // of replacing the column wholesale. `null` is a documented no-op on
    // this branch (origin/main), matching supportContent's `null` no-op
    // below — do not "fix" this asymmetry here, see T-841 spec. Read-modify-
    // write race accepted: strictly narrower than the prior unconditional
    // replace; the atomic jsonb-concat form is deferred to T-873 pending
    // proof the column is actually `jsonb` (no migration created it).
    ...(planExtras !== undefined || supportContent !== undefined
      ? [
          db.mealPlan.update({
            where: { id: mealPlanId },
            data: {
              ...(planExtras != null && { planExtras: mergePlanExtras(plan.planExtras, planExtras) }),
              ...(supportContent !== undefined && { supportContent: supportContent ?? undefined }),
            },
          }),
        ]
      : []),
  ]);

  revalidatePath("/coach", "layout");
  return { success: true };
}

const publishSchema = z.object({
  mealPlanId: z.string().min(1),
  notifyClient: z.boolean().optional(),
});

export async function publishMealPlan(input: unknown) {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const target = await getMealPlanPublishTarget(parsed.data.mealPlanId);
  if (!target) throw new Error("Meal plan not found");

  await verifyCoachAccessToClient(target.clientId);

  const result = await publishMealPlanTarget(target);
  if (!result.ok) {
    if (result.code === "NOT_DRAFT") throw new Error("Can only publish drafts");
    if (result.code === "EMPTY_PLAN") throw new Error(result.message);
    return {
      success: false as const,
      message: "This plan was already published or changed by someone else. Refresh and try again.",
    };
  }

  revalidatePath("/coach", "layout");
  revalidatePath("/client", "layout");

  if (parsed.data.notifyClient) {
    try {
      const user = await getCurrentDbUser();
      await notifyMealPlanUpdated(target.clientId, user.firstName);

      // Background email to client
      const client = await db.user.findUnique({ where: { id: target.clientId }, select: { email: true, firstName: true, emailMealPlanUpdates: true } });
      if (client?.email && client.emailMealPlanUpdates) {
        const { sendEmail } = await import("@/lib/email/sendEmail");
        const { mealPlanUpdatedEmail } = await import("@/lib/email/templates");
        const email = mealPlanUpdatedEmail(client.firstName || "there", user.firstName || "your coach");
        sendEmail({ to: client.email, ...email }).catch(console.error);
      }
    } catch (error) {
      console.error("[mealplans] Failed to send update notification:", error);
    }
  }

  return { success: true as const };
}
