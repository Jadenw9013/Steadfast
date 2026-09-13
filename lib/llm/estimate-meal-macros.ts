/**
 * LLM-powered per-meal macro estimation.
 *
 * Takes a plan's meals (names + foods/portions) and returns an estimated
 * calorie/protein/carb/fat total for each meal, in the same order. Used to
 * autofill a MACROS-mode plan's targets from an existing MEAL_PLAN-mode
 * plan's foods, since MealPlanItem.calories/protein/carbs/fats default to 0
 * and are often never filled in by coaches — summing them would usually
 * just produce zeroes, so this asks the LLM to estimate from the actual
 * foods/portions text instead.
 *
 * Reuses: OPENAI_API_KEY, OPENAI_MODEL env vars (same as modify-meal-plan.ts)
 */

import { z } from "zod";

const ESTIMATE_SYSTEM_PROMPT = `You are a registered-dietitian-level nutrition estimator. You receive a list of named meals, each with the foods and portions a client eats for that meal. For EACH meal, estimate a single reasonable total: calories, protein (g), carbs (g), and fats (g).

RULES:
1. Output ONLY valid JSON matching the exact schema below. No markdown, no explanation.
2. Return exactly one estimate per input meal, in the SAME ORDER, using the exact same "name" value given.
3. All four numbers must be non-negative integers.
4. Use standard nutrition knowledge for common foods and realistic portion sizes. If a portion is vague ("a bowl", "some"), use a typical reasonable serving.
5. If a meal has no foods listed at all, estimate zero for all four fields.
6. Be a reasonable, real-world estimate — not a worst-case or best-case bound.

JSON Schema:
{
  "meals": [
    { "name": "string", "calories": number, "protein": number, "carbs": number, "fats": number }
  ]
}`;

export const estimatedMealMacrosSchema = z.object({
  meals: z.array(
    z.object({
      name: z.string(),
      calories: z.coerce.number().int().min(0).max(20000),
      protein: z.coerce.number().int().min(0).max(2000),
      carbs: z.coerce.number().int().min(0).max(2000),
      fats: z.coerce.number().int().min(0).max(2000),
    })
  ),
});

export type EstimatedMealMacros = z.infer<typeof estimatedMealMacrosSchema>;

type EstimateInput = {
  meals: { name: string; items: { food: string; portion: string }[] }[];
};

export async function estimateMealMacros(input: EstimateInput): Promise<EstimatedMealMacros> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Add it to your environment variables.");
  }
  if (input.meals.length === 0) {
    return { meals: [] };
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4o";

  const mealsJson = JSON.stringify(input.meals, null, 2);
  const userPrompt = `Here are the meals to estimate:

${mealsJson}

Return one macro estimate per meal, same order, same "name" values.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: ESTIMATE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error("[estimate-meal-macros] LLM returned invalid JSON", { model, contentLength: content.length });
    throw new Error("AI returned an invalid response. Please try again.");
  }

  const validated = estimatedMealMacrosSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("[estimate-meal-macros] Schema validation failed", {
      model,
      errors: validated.error.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message })),
    });
    throw new Error("AI produced an unexpected format. Please try again.");
  }

  if (validated.data.meals.length !== input.meals.length) {
    throw new Error("AI returned a different number of meals than requested. Please try again.");
  }

  return validated.data;
}
