import { z } from "zod";
import { db } from "@/lib/db";
import type { MealPlanStatus, PlanMode, Prisma } from "@/app/generated/prisma/client";
import { planExtrasSchema, type PlanExtras } from "@/types/meal-plan-extras";
import {
  macroTargetTransactionOps,
  resolveDefaultPlanMode,
  type MealMacroTargetInput,
  type PlanModeInput,
} from "@/lib/meal-plans/macro-targets";
import { createMealPlanWithNextVersion } from "@/lib/meal-plans/version";

/**
 * Single source of truth for the meal-plan DRAFT lifecycle across both
 * transports: the web Server Actions (`app/actions/meal-plans.ts` —
 * `createDraftMealPlan`, `saveDraftMealPlan`) and the iOS-facing REST route
 * (`app/api/coach/clients/[clientId]/meal-plan/route.ts` — POST/PUT). Both are
 * auth + zod + call + shape-response wrappers with no business logic. This
 * module previously existed as two verbatim copies that had already drifted
 * (`supportContent` was handled in the action and absent from the route's PUT
 * schema; the route's fork hardcoded the published plan's `supportContent`
 * while the action honored the payload) — T-101.
 *
 * Three behavioral rules live here because they are what makes switching
 * between foods mode and macros mode reversible:
 *
 * 1. **Copy-forward is the default, not an opt-in.** Creating a draft starts
 *    from the most recent PUBLISHED plan with `weekOf <= requested weekOf`;
 *    explicit payload fields override only the parts they carry. `startBlank`
 *    is the ONLY way to get an empty draft (the legacy explicit
 *    `copyFromPublished: false` maps onto it — see `resolveStartBlank`).
 *    Omitting `copyFromPublished` now means copy-forward; it used to mean blank.
 *
 * 2. **`planMode` is resolved once, explicitly, and is never inferred from
 *    which array the caller sent.** Precedence is caller-supplied `planMode`,
 *    then `resolveDefaultPlanMode` (the `CoachClient.planMode` column). The
 *    carry-forward source's own `planMode` is deliberately NOT in that chain:
 *    both mode toggles write `CoachClient.planMode`, so that column is always
 *    at least as fresh as any published plan's mode, and preferring the copied
 *    plan would silently undo a toggle the coach just made.
 *
 * 3. **`items` and `macroTargets` coexist on every version.** The service never
 *    clears one because the other was sent. Readers pick by `planMode`, never
 *    by "which array is non-empty".
 *
 * Sibling module: `lib/meal-plans/publish.ts` owns the DRAFT → PUBLISHED
 * transition (CB04 supersede). There is deliberately no import between the two
 * — this module never writes `MealPlan.status` (every row it creates is
 * `DRAFT`) or `publishedAt`, and `publish.ts` never touches plan content.
 *
 * No network I/O inside any transaction here; `revalidatePath` stays in the
 * Server Action and never in this module.
 */

/** Moved here verbatim from the two entry points, which were identical. Both
 *  import it from here; neither redeclares it. */
export const mealPlanItemSchema = z.object({
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
export type MealPlanItemInput = z.infer<typeof mealPlanItemSchema>;

/** Plan notes column (`MealPlan.supportContent`). Frozen write semantics,
 *  identical on both surfaces and on create and save:
 *    omitted / undefined        → leave unchanged
 *    "" or whitespace-only      → leave unchanged  (normalized to undefined here)
 *    null                       → clear the column
 *    non-empty string           → set
 *
 *  Empty string must NOT clear: `EditableMealPlan.planNotes` on iOS is a
 *  non-optional Swift `String` defaulting to `""` and is sent on every save, so
 *  treating `""` as "clear" would let any iOS save wipe a web coach's notes.
 *  This also reproduces web's existing behavior exactly — the v2 editor sends
 *  `supportContent || undefined`, so web already cannot clear notes by emptying
 *  the textarea. Clearing from either UI is T-732.
 *
 *  No `.max()` — the action's schema never had one and existing rows may exceed
 *  any limit we would invent. */
export const supportContentInputSchema = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (typeof v === "string" && v.trim() === "" ? undefined : v));

/** The frozen `startBlank` resolution, shared so the action and the route can
 *  never disagree. `startBlank` wins when explicitly present; the legacy
 *  `copyFromPublished` only still means something when it is explicitly
 *  `false` ("start blank"). */
export function resolveStartBlank(input: {
  startBlank?: boolean;
  copyFromPublished?: boolean;
}): boolean {
  return input.startBlank ?? input.copyFromPublished === false;
}

// ── Create ───────────────────────────────────────────────────────────────────

export type CreateMealPlanDraftInput = {
  clientId: string;
  /** Already-authorized coach. Used only for resolveDefaultPlanMode. */
  coachId: string;
  /** Already parsed by parseWeekStartDate at the entry point. */
  weekOf: Date;
  /** The ONLY way to get an empty draft. Default false. */
  startBlank?: boolean;
  planMode?: PlanModeInput;
  items?: MealPlanItemInput[];
  macroTargets?: MealMacroTargetInput[];
  planExtras?: PlanExtras;
  supportContent?: string | null;
};

export type CreateMealPlanDraftResult = {
  mealPlanId: string;
  planMode: PlanModeInput;
  /** id of the published plan content was carried forward from, or null. */
  copiedFromMealPlanId: string | null;
};

/** Content of the PUBLISHED plan a new draft carries forward from. `planExtras`
 *  is already validated (undefined when the stored JSON does not parse). */
export type CarryForwardSource = {
  id: string;
  /** Deliberately NOT used when resolving a new draft's planMode — see rule 2
   *  in the file header. Selected only so callers/tests can inspect it. */
  planMode: PlanMode;
  planExtras: PlanExtras | undefined;
  supportContent: string | null;
  items: MealPlanItemInput[];
  macroTargets: MealMacroTargetInput[];
};

const carryForwardItemSelect = {
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

const carryForwardMacroTargetSelect = {
  mealName: true,
  sortOrder: true,
  calories: true,
  protein: true,
  carbs: true,
  fats: true,
} as const;

/**
 * The carry-forward source for `weekOf`: the most recent PUBLISHED plan at or
 * before that week. Never returns a later week's plan — the previous unscoped
 * lookup (`{ clientId, status: "PUBLISHED" }` ordered by `publishedAt desc`)
 * meant creating a draft for a past week copied from a later week's plan.
 * The three-key `orderBy` keeps the pick deterministic when two plans share a
 * `weekOf`, which is possible for historical rows predating the partial unique
 * index. Exported for tests.
 */
export async function findCarryForwardSource(
  clientId: string,
  weekOf: Date
): Promise<CarryForwardSource | null> {
  const source = await db.mealPlan.findFirst({
    where: { clientId, status: "PUBLISHED", weekOf: { lte: weekOf } },
    orderBy: [{ weekOf: "desc" }, { publishedAt: "desc" }, { version: "desc" }],
    select: {
      id: true,
      planMode: true,
      planExtras: true,
      supportContent: true,
      items: { orderBy: { sortOrder: "asc" }, select: carryForwardItemSelect },
      macroTargets: { orderBy: { sortOrder: "asc" }, select: carryForwardMacroTargetSelect },
    },
  });
  if (!source) return null;

  const parsedExtras = source.planExtras ? planExtrasSchema.safeParse(source.planExtras) : null;

  return {
    id: source.id,
    planMode: source.planMode,
    planExtras: parsedExtras?.success ? parsedExtras.data : undefined,
    supportContent: source.supportContent,
    items: source.items.map((item) => ({
      ...item,
      // `null` in the column, `undefined` in the schema's shape.
      servingDescription: item.servingDescription ?? undefined,
    })),
    macroTargets: source.macroTargets.map((t) => ({ ...t })),
  };
}

/**
 * Creates a new DRAFT meal plan for a week, carrying forward the latest
 * published plan's full content unless `startBlank` was set. Callers MUST have
 * authorized coach access to `input.clientId` first.
 */
export async function createMealPlanDraft(
  input: CreateMealPlanDraftInput
): Promise<CreateMealPlanDraftResult> {
  const source = input.startBlank
    ? null
    : await findCarryForwardSource(input.clientId, input.weekOf);

  // `??` (not `||`) throughout: an explicit `items: []` means "no foods" and
  // must never fall back to the source and resurrect deleted foods.
  const items = input.items ?? source?.items ?? [];
  const macroTargets = input.macroTargets ?? source?.macroTargets ?? [];
  const planExtras = input.planExtras ?? source?.planExtras;
  const supportContent =
    input.supportContent !== undefined ? input.supportContent : (source?.supportContent ?? undefined);

  // Never reads source.planMode, never inspects items/macroTargets.
  const planMode = input.planMode ?? (await resolveDefaultPlanMode(input.coachId, input.clientId));

  const { clientId, weekOf } = input;
  const plan = await createMealPlanWithNextVersion(clientId, weekOf, (version) => ({
    clientId,
    weekOf,
    version,
    status: "DRAFT",
    planMode,
    planExtras: planExtras ?? undefined,
    supportContent: supportContent ?? undefined,
    items: { create: items },
    macroTargets: { create: macroTargets },
  }));

  return { mealPlanId: plan.id, planMode, copiedFromMealPlanId: source?.id ?? null };
}

// ── Save / fork ──────────────────────────────────────────────────────────────

/** Mirrors `lib/meal-plans/publish.ts`'s two-function split for the same
 *  reason: the action calls `verifyCoachAccessToClient(target.clientId)` and
 *  throws, the route compares `target.clientId` against the URL segment and
 *  returns 403 JSON. Both must authorize BETWEEN reading the row and writing
 *  it. */
export type MealPlanSaveTarget = {
  id: string;
  clientId: string;
  weekOf: Date;
  status: MealPlanStatus;
  planMode: PlanMode;
  planExtras: Prisma.JsonValue | null;
  supportContent: string | null;
};

export type SaveMealPlanDraftInput = {
  items?: MealPlanItemInput[];
  macroTargets?: MealMacroTargetInput[];
  planExtras?: PlanExtras | null;
  supportContent?: string | null;
};

export type SaveMealPlanDraftResult = {
  mealPlanId: string;
  /** non-null ⇒ target was not a DRAFT and a fork was created (CB04). */
  forkedNewDraftId: string | null;
};

/**
 * Reads the row both surfaces need before their own authorization check.
 * Returns null when the plan does not exist. Performs no authorization.
 * Deliberately content-free — the items/macroTargets read only happens on the
 * fork branch, so the hot path (saving an existing draft) stays cheap.
 */
export async function getMealPlanSaveTarget(
  mealPlanId: string
): Promise<MealPlanSaveTarget | null> {
  return db.mealPlan.findUnique({
    where: { id: mealPlanId },
    select: {
      id: true,
      clientId: true,
      status: true,
      weekOf: true,
      planMode: true,
      planExtras: true,
      supportContent: true,
    },
  });
}

/**
 * Saves submitted content onto a draft, or forks a new draft when the target is
 * no longer a DRAFT. Callers MUST have authorized coach access to
 * `target.clientId` first.
 */
export async function saveMealPlanDraftContent(
  target: MealPlanSaveTarget,
  input: SaveMealPlanDraftInput
): Promise<SaveMealPlanDraftResult> {
  const { items, macroTargets, planExtras, supportContent } = input;

  // CB04: a PUBLISHED (or SUPERSEDED) plan is never mutated in place — the
  // client may be relying on its exact current content. Editing one instead
  // forks a brand-new draft carrying the submitted content, leaving the
  // published plan untouched. This also makes a stale client (e.g. a second
  // tab open after someone else already published) fail safe instead of
  // silently corrupting live content.
  //
  // Every part the payload does NOT carry is carried forward from the target,
  // including the representation the current editor doesn't use. Passing
  // `items: undefined` / `macroTargets: undefined` through to the fork (what
  // both copies used to do) silently dropped the other representation.
  if (target.status !== "DRAFT") {
    const existing = await db.mealPlan.findUniqueOrThrow({
      where: { id: target.id },
      select: {
        items: { orderBy: { sortOrder: "asc" }, select: carryForwardItemSelect },
        macroTargets: { orderBy: { sortOrder: "asc" }, select: carryForwardMacroTargetSelect },
      },
    });

    const forked = await createMealPlanWithNextVersion(target.clientId, target.weekOf, (version) => ({
      clientId: target.clientId,
      weekOf: target.weekOf,
      version,
      status: "DRAFT",
      planMode: target.planMode,
      planExtras: (planExtras !== undefined ? planExtras : target.planExtras) ?? undefined,
      supportContent: supportContent !== undefined ? supportContent : target.supportContent,
      items: {
        create:
          items !== undefined
            ? items.map((item, i) => ({
                ...item,
                sortOrder: i,
                servingDescription: item.servingDescription || null,
              }))
            : existing.items,
      },
      macroTargets: { create: macroTargets ?? existing.macroTargets },
    }));

    return { mealPlanId: target.id, forkedNewDraftId: forked.id };
  }

  const mealPlanId = target.id;

  // Replace all items/macroTargets (whichever was provided) + update metadata.
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
    ...(planExtras !== undefined || supportContent !== undefined
      ? [
          db.mealPlan.update({
            where: { id: mealPlanId },
            data: {
              // planExtras keeps today's semantics exactly: an explicit null is
              // a no-op. supportContent's explicit null DOES clear. The
              // asymmetry is deliberate and scoped to T-101; harmonizing
              // planExtras is out of scope.
              ...(planExtras !== undefined && { planExtras: planExtras ?? undefined }),
              ...(supportContent !== undefined && { supportContent }),
            },
          }),
        ]
      : []),
  ]);

  return { mealPlanId, forkedNewDraftId: null };
}
