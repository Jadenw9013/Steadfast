import { z } from "zod";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const planMetadataSchema = z.object({
  phase: z.string().optional(),           // "cutting" | "bulking" | "maintenance" | custom
  startDate: z.string().optional(),
  bodyweight: z.string().optional(),
  coachNotes: z.string().optional(),
  highlightedChanges: z.string().optional(),
});

/** @deprecated Legacy flat override item — kept for backward compat with existing data */
export const dayOverrideItemSchema = z.object({
  food: z.string(),
  portion: z.string().default(""),
  replaces: z.string().optional(),
});

/** A single change to a food item within a specific meal */
export const mealChangeSchema = z.object({
  type: z.enum(["update", "add", "remove", "replace"]),
  food: z.string(),                       // target food (update/remove/replace) or new food (add)
  newPortion: z.string().optional(),      // new portion (update/add)
  replacementFood: z.string().optional(), // replacement food name (replace only)
  replacementPortion: z.string().optional(), // replacement portion (replace only)
});

/** A set of changes targeting a specific meal */
export const mealAdjustmentSchema = z.object({
  mealName: z.string(),                   // "Meal 1", "Meal 2", etc.
  notes: z.string().optional(),
  changes: z.array(mealChangeSchema),
});

export const dayOverrideSchema = z.object({
  label: z.string(),                      // "High Carb Day", "Free Meal", "Refeed", etc.
  color: z.string().optional(),           // "blue" | "emerald" | "amber" | "rose" | "purple" | "teal"
  weekdays: z.array(z.string()).optional(), // ["Monday", "Friday"]
  mealAdjustments: z.array(mealAdjustmentSchema).optional(), // new: per-meal changes
  items: z.array(dayOverrideItemSchema).optional(),          // legacy: flat food modifications
  notes: z.string().optional(),
});

export const supplementSchema = z.object({
  name: z.string(),
  dosage: z.string().optional(),
  timing: z.string(),                     // "upon waking" | "AM" | "with meal" | etc.
  required: z.boolean().optional(),
  notes: z.string().optional(),
});

export const allowanceSchema = z.object({
  category: z.string(),                   // "Spices", "Sauces", "Sweeteners", "Drinks"
  items: z.array(z.string()),
  restriction: z.string().optional(),     // "limit to 1 tbsp", "sugar-free only"
});

export const ruleSchema = z.object({
  category: z.string(),                   // "Hydration", "Meal Timing", "Cardio", etc.
  text: z.string(),
});

export const confidenceSchema = z.object({
  meals: z.number().min(0).max(1).optional(),
  supplements: z.number().min(0).max(1).optional(),
  overrides: z.number().min(0).max(1).optional(),
  allowances: z.number().min(0).max(1).optional(),
  rules: z.number().min(0).max(1).optional(),
});

export const planExtrasSchema = z.object({
  metadata: planMetadataSchema.optional(),
  dayOverrides: z.array(dayOverrideSchema).optional(),
  supplements: z.array(supplementSchema).optional(),
  allowances: z.array(allowanceSchema).optional(),
  rules: z.array(ruleSchema).optional(),
  confidence: confidenceSchema.optional(),
});

// ── TypeScript Types ─────────────────────────────────────────────────────────

export type PlanMetadata = z.infer<typeof planMetadataSchema>;
export type DayOverrideItem = z.infer<typeof dayOverrideItemSchema>;
export type MealChange = z.infer<typeof mealChangeSchema>;
export type MealAdjustment = z.infer<typeof mealAdjustmentSchema>;
export type DayOverride = z.infer<typeof dayOverrideSchema>;
export type Supplement = z.infer<typeof supplementSchema>;
export type Allowance = z.infer<typeof allowanceSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type PlanExtras = z.infer<typeof planExtrasSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Safely parse a raw JSON blob into validated PlanExtras, returning null on failure */
export function parsePlanExtras(raw: unknown): PlanExtras | null {
  if (raw == null) return null;
  const result = planExtrasSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Timing categories for supplements, ordered for display */
export const SUPPLEMENT_TIMING_ORDER = [
  "upon waking",
  "AM",
  "with meal",
  "after meal",
  "pre workout",
  "intra workout",
  "post workout",
  "PM",
  "before bed",
] as const;

/** Allowance category display order */
export const ALLOWANCE_CATEGORY_ORDER = [
  "Spices",
  "Sauces",
  "Sweeteners",
  "Drinks",
  "Other",
] as const;

/** Rule category display order */
export const RULE_CATEGORY_ORDER = [
  "Meal Timing",
  "Hydration",
  "Cardio",
  "Check-In",
  "Communication",
  "Cooking",
  "Other",
] as const;

/** Available colors for day overrides */
export const OVERRIDE_COLORS = [
  { id: "blue", label: "Blue", bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500", border: "border-blue-500/20" },
  { id: "emerald", label: "Green", bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", border: "border-emerald-500/20" },
  { id: "amber", label: "Amber", bg: "bg-amber-500/15", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500", border: "border-amber-500/20" },
  { id: "rose", label: "Rose", bg: "bg-rose-500/15", text: "text-rose-600 dark:text-rose-400", dot: "bg-rose-500", border: "border-rose-500/20" },
  { id: "purple", label: "Purple", bg: "bg-purple-500/15", text: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500", border: "border-purple-500/20" },
  { id: "teal", label: "Teal", bg: "bg-teal-500/15", text: "text-teal-600 dark:text-teal-400", dot: "bg-teal-500", border: "border-teal-500/20" },
] as const;

/** Get color config for an override, defaulting to blue */
export function getOverrideColor(colorId?: string) {
  return OVERRIDE_COLORS.find((c) => c.id === colorId) ?? OVERRIDE_COLORS[0];
}
