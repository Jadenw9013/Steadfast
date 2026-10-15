"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { parseWeekStartDate, formatDateUTC } from "@/lib/utils/date";
import { verifyCoachAccessToClient } from "@/lib/queries/check-ins";
import { revalidatePath } from "next/cache";
import { notifyMealPlanUpdated } from "@/lib/sms/notify";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { planExtrasSchema } from "@/types/meal-plan-extras";
import { mealMacroTargetSchema, planModeSchema } from "@/lib/meal-plans/macro-targets";
import {
  mealPlanItemSchema,
  supportContentInputSchema,
  resolveStartBlank,
  createMealPlanDraft,
  getMealPlanSaveTarget,
  saveMealPlanDraftContent,
} from "@/lib/meal-plans/drafts";
import {
  emptyPlanMessage,
  getMealPlanPublishTarget,
  publishMealPlanTarget,
} from "@/lib/meal-plans/publish";
import {
  createDraftFromMealPlanVersion,
  draftExistsMessage,
  getMealPlanVersionDetail,
  sourceNotRestorableMessage,
} from "@/lib/meal-plans/history";

const createDraftSchema = z.object({
  clientId: z.string().min(1),
  weekStartDate: z.string().min(1),
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

export async function createDraftMealPlan(input: unknown) {
  const parsed = createDraftSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const { clientId, weekStartDate } = parsed.data;
  const coach = await verifyCoachAccessToClient(clientId);

  const weekOf = parseWeekStartDate(weekStartDate);

  // All draft-creation logic (copy-forward, planMode resolution, versioning)
  // lives in lib/meal-plans/drafts.ts so this action and the iOS-facing REST
  // route can't diverge again — T-101.
  const { mealPlanId } = await createMealPlanDraft({
    clientId,
    coachId: coach.id,
    weekOf,
    startBlank: resolveStartBlank(parsed.data),
    planMode: parsed.data.planMode,
    items: parsed.data.items,
    macroTargets: parsed.data.macroTargets,
    planExtras: parsed.data.planExtras,
    supportContent: parsed.data.supportContent,
  });

  revalidatePath("/coach", "layout");
  return { mealPlanId };
}

const saveDraftSchema = z.object({
  mealPlanId: z.string().min(1),
  items: z.array(mealPlanItemSchema).max(50).optional(),
  macroTargets: z.array(mealMacroTargetSchema).max(50).optional(),
  planExtras: planExtrasSchema.optional().nullable(),
  supportContent: supportContentInputSchema,
  /** Alias for `supportContent` — the name iOS sends. Declared here too so the
   *  action and the REST route validate identically. */
  planNotes: supportContentInputSchema,
});

export async function saveDraftMealPlan(input: unknown) {
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { mealPlanId, items, macroTargets, planExtras } = parsed.data;
  const supportContent =
    parsed.data.supportContent !== undefined ? parsed.data.supportContent : parsed.data.planNotes;

  const target = await getMealPlanSaveTarget(mealPlanId);
  if (!target) throw new Error("Meal plan not found");

  await verifyCoachAccessToClient(target.clientId);

  // CB04 fork-on-published lives entirely in lib/meal-plans/drafts.ts.
  const result = await saveMealPlanDraftContent(target, {
    items,
    macroTargets,
    planExtras,
    supportContent,
  });

  revalidatePath("/coach", "layout");
  return result.forkedNewDraftId
    ? { success: true as const, forkedNewDraftId: result.forkedNewDraftId }
    : { success: true as const };
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

  // CB04 — publishing lives entirely in lib/meal-plans/publish.ts so this
  // action and the iOS-facing REST route can't diverge again.
  const result = await publishMealPlanTarget(target);
  if (!result.ok) {
    if (result.code === "NOT_DRAFT") throw new Error("Can only publish drafts");
    // T-102b — the wording lives in lib/meal-plans/publish.ts so this action,
    // the REST publish route and the import route all say the same thing.
    if (result.code === "EMPTY_PLAN") throw new Error(emptyPlanMessage(result.planMode));
    throw new Error("This plan was already published or changed by someone else — refresh and try again.");
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

  return { success: true };
}

const restoreVersionSchema = z.object({
  clientId: z.string().min(1),
  sourceMealPlanId: z.string().min(1),
  weekStartDate: z.string().min(1).optional(),
  replaceExistingDraft: z.boolean().optional(),
});

/**
 * T-801 — restores a past PUBLISHED/SUPERSEDED meal plan version into a new
 * DRAFT for the coach to review and publish. Never mutates or un-publishes
 * history — all restore logic lives in lib/meal-plans/history.ts, shared with
 * the REST route `POST /api/coach/clients/[clientId]/meal-plan/restore`.
 */
export async function restoreMealPlanVersion(input: unknown): Promise<
  | { success: true; draftMealPlanId: string; weekStartDate: string; replacedDraftIds: string[] }
  | { error: string; code: "SOURCE_NOT_RESTORABLE" }
  | { error: string; code: "DRAFT_EXISTS"; existingDraftId: string }
> {
  const parsed = restoreVersionSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const { clientId, sourceMealPlanId, weekStartDate, replaceExistingDraft } = parsed.data;
  const coach = await verifyCoachAccessToClient(clientId);

  const source = await getMealPlanVersionDetail(sourceMealPlanId);
  if (!source) throw new Error("Meal plan not found");
  // Never leaks another client's existence — same "not found" whether the id
  // is unknown or simply belongs to someone else.
  if (source.clientId !== clientId) throw new Error("Meal plan not found");

  const result = await createDraftFromMealPlanVersion({
    source,
    coachId: coach.id,
    weekOf: weekStartDate ? parseWeekStartDate(weekStartDate) : undefined,
    replaceExistingDraft,
  });

  if (!result.ok) {
    if (result.code === "SOURCE_NOT_RESTORABLE") {
      return { error: sourceNotRestorableMessage(), code: "SOURCE_NOT_RESTORABLE" };
    }
    return { error: draftExistsMessage(), code: "DRAFT_EXISTS", existingDraftId: result.existingDraftId };
  }

  revalidatePath("/coach", "layout");
  return {
    success: true,
    draftMealPlanId: result.draftMealPlanId,
    weekStartDate: formatDateUTC(result.weekOf),
    replacedDraftIds: result.replacedDraftIds,
  };
}
