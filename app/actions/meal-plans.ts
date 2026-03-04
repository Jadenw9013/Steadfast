"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { parseWeekStartDate } from "@/lib/utils/date";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { revalidatePath } from "next/cache";
import { notifyMealPlanUpdated } from "@/lib/sms/notify";
import { getCurrentDbUser } from "@/lib/auth/roles";

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
});

export async function createDraftMealPlan(input: unknown) {
  const parsed = createDraftSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const { clientId, weekStartDate, copyFromPublished } = parsed.data;
  await verifyCoachAccessToClient(clientId);

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
  if (parsed.data.items) {
    itemsToCreate = parsed.data.items;
  } else if (copyFromPublished) {
    const published = await db.mealPlan.findFirst({
      where: { clientId, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      include: { items: { orderBy: { sortOrder: "asc" } } },
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
    }
  }

  const plan = await db.mealPlan.create({
    data: {
      clientId,
      weekOf,
      version: nextVersion,
      status: "DRAFT",
      items: { create: itemsToCreate },
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });

  revalidatePath("/coach", "layout");
  return { mealPlanId: plan.id };
}

const saveDraftSchema = z.object({
  mealPlanId: z.string().min(1),
  items: z.array(mealPlanItemSchema).max(50),
});

export async function saveDraftMealPlan(input: unknown) {
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { mealPlanId, items } = parsed.data;

  const plan = await db.mealPlan.findUnique({
    where: { id: mealPlanId },
    select: { clientId: true, status: true },
  });
  if (!plan) throw new Error("Meal plan not found");
  if (plan.status !== "DRAFT") throw new Error("Can only edit drafts");

  await verifyCoachAccessToClient(plan.clientId);

  // Replace all items
  await db.$transaction([
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

  const plan = await db.mealPlan.findUnique({
    where: { id: parsed.data.mealPlanId },
    select: { clientId: true, status: true },
  });
  if (!plan) throw new Error("Meal plan not found");
  if (plan.status !== "DRAFT") throw new Error("Can only publish drafts");

  await verifyCoachAccessToClient(plan.clientId);

  await db.mealPlan.update({
    where: { id: parsed.data.mealPlanId },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });

  revalidatePath("/coach", "layout");
  revalidatePath("/client", "layout");

  if (parsed.data.notifyClient) {
    try {
      const user = await getCurrentDbUser();
      await notifyMealPlanUpdated(plan.clientId, user.firstName);
    } catch (error) {
      console.error("[mealplans] Failed to send update notification:", error);
    }
  }

  return { success: true };
}
