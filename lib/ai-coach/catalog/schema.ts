import { z } from "zod";

/**
 * A04 — reviewed food/exercise catalog schema.
 *
 * Shape only. The actual reviewed content (real foods/recipes/exercises,
 * verified allergen data, nutrient sourcing) is gate G02's deliverable
 * (docs/ai-coach/13-Sources-and-Open-Decisions.md). Every catalog item
 * here is a SYNTHETIC FIXTURE for engineering purposes and must never be
 * served to a real user as reviewed content.
 */

export const allergenSchema = z.enum(["MILK", "EGG", "PEANUT", "TREE_NUT", "WHEAT", "GLUTEN", "SOY", "FISH", "SHELLFISH"]);
export type Allergen = z.infer<typeof allergenSchema>;

export const dietaryTagSchema = z.enum(["VEGETARIAN", "VEGAN", "GLUTEN_FREE", "DAIRY_FREE"]);
export type DietaryTag = z.infer<typeof dietaryTagSchema>;

export const foodItemSchema = z.object({
  id: z.string().min(1),
  catalogVersion: z.string().min(1),
  name: z.string().min(1),
  sourceId: z.string().min(1),
  energyMethod: z.string().min(1),
  servingGrams: z.number().positive(),
  energyKcalPerServing: z.number().nonnegative(),
  proteinGPerServing: z.number().nonnegative(),
  carbsGPerServing: z.number().nonnegative(),
  fatGPerServing: z.number().nonnegative(),
  allergens: z.array(allergenSchema),
  dietaryTags: z.array(dietaryTagSchema),
  hasCompleteMicronutrients: z.boolean(),
}).strict();
export type FoodItem = z.infer<typeof foodItemSchema>;

export const exerciseModalitySchema = z.enum(["STRENGTH", "CARDIO"]);
export type ExerciseModality = z.infer<typeof exerciseModalitySchema>;

export const equipmentSchema = z.enum(["NONE", "HOME_BASIC", "FULL_GYM"]);
export type Equipment = z.infer<typeof equipmentSchema>;

export const exerciseItemSchema = z.object({
  id: z.string().min(1),
  catalogVersion: z.string().min(1),
  name: z.string().min(1),
  modality: exerciseModalitySchema,
  requiredEquipment: z.array(equipmentSchema).min(1),
  substitutionIds: z.array(z.string().min(1)),
}).strict();
export type ExerciseItem = z.infer<typeof exerciseItemSchema>;
