import { NextRequest, NextResponse } from "next/server";
import { consumeQuota } from "@/lib/security/quota";
import { readBoundedBody } from "@/lib/security/body";
import { z } from "zod";
import { modifyMealPlan } from "@/lib/llm/modify-meal-plan";
import { getCurrentDbUser } from "@/lib/auth/roles";

export const maxDuration = 60; // Allow up to 60s for LLM

const requestSchema = z.object({
  privacyConsent: z.literal(true),
  currentPlan: z.object({
    title: z.string().max(500).default("Meal Plan"),
    meals: z.array(
      z.object({
        name: z.string().max(200),
        items: z.array(
          z.object({
            food: z.string().max(500),
            portion: z.string().max(200),
          })
        ),
      })
    ),
    // Use z.any() — PlanExtras contains arrays which z.record() rejects
    extras: z.any().optional(),
    supportContent: z.string().max(20000).nullable().optional(),
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

    if (!await consumeQuota("ai-plan", user.id, 30, 600)) {
      return NextResponse.json({ error: "Too many AI requests. Please try again in a few minutes." }, { status: 429, headers: { "Retry-After": "600" } });
    }
    const body = JSON.parse(new TextDecoder().decode(await readBoundedBody(req, 128 * 1024)));
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
    const isAuthError = error instanceof Error && error.message === "Not authenticated";
    return NextResponse.json(
      { error: isAuthError ? "Not authenticated" : "Failed to modify plan" },
      { status: isAuthError ? 401 : 500 }
    );
  }
}
