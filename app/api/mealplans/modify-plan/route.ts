import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { modifyMealPlan } from "@/lib/llm/modify-meal-plan";
import { getCurrentDbUser } from "@/lib/auth/roles";

export const maxDuration = 60; // Allow up to 60s for LLM

const requestSchema = z.object({
  currentPlan: z.object({
    title: z.string().default("Meal Plan"),
    meals: z.array(
      z.object({
        name: z.string(),
        items: z.array(
          z.object({
            food: z.string(),
            portion: z.string(),
          })
        ),
      })
    ),
    // Use z.any() — PlanExtras contains arrays which z.record() rejects
    extras: z.any().optional(),
  }),
  instruction: z.string().min(1).max(2000),
});

export async function POST(req: NextRequest) {
  try {
    // Verify authentication — throws if not logged in
    const user = await getCurrentDbUser();
    if (!user.isCoach) {
      return NextResponse.json({ error: "Not a coach" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      const readableErrors = Object.entries(fieldErrors)
        .map(([field, msgs]) => `${field}: ${(msgs ?? []).join(", ")}`)
        .join("; ");
      console.error("[modify-plan] Validation failed:", fieldErrors);
      return NextResponse.json(
        {
          error: `Invalid request${readableErrors ? ` — ${readableErrors}` : ""}`,
          details: fieldErrors,
        },
        { status: 400 }
      );
    }

    const result = await modifyMealPlan(parsed.data);
    return NextResponse.json({ plan: result });
  } catch (error) {
    console.error("[modify-plan] Error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to modify plan";
    const status =
      message === "Not authenticated" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
