import { NextRequest, NextResponse } from "next/server";
import { consumeQuota } from "@/lib/security/quota";
import { readBoundedBody } from "@/lib/security/body";
import { z } from "zod";
import { estimateMealMacros } from "@/lib/llm/estimate-meal-macros";
import { getCurrentDbUser } from "@/lib/auth/roles";

export const maxDuration = 60; // Allow up to 60s for LLM

const requestSchema = z.object({
  privacyConsent: z.literal(true),
  meals: z
    .array(
      z.object({
        name: z.string().max(200),
        items: z.array(
          z.object({
            food: z.string().max(500),
            portion: z.string().max(200),
          })
        ),
      })
    )
    .max(50),
});

export async function POST(req: NextRequest) {
  try {
    // Verify authentication — throws if not logged in
    const user = await getCurrentDbUser();
    if (!user.isCoach) {
      return NextResponse.json({ error: "Not a coach" }, { status: 403 });
    }

    // Same bucket the AI plan editor already uses — same coach, same OpenAI spend.
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
      return NextResponse.json(
        { error: `Invalid request${readableErrors ? ` — ${readableErrors}` : ""}`, details: fieldErrors },
        { status: 400 }
      );
    }

    const result = await estimateMealMacros({ meals: parsed.data.meals });
    return NextResponse.json({ meals: result.meals });
  } catch (error) {
    console.error("[estimate-macros] Error:", error);
    const isAuthError = error instanceof Error && error.message === "Not authenticated";
    return NextResponse.json(
      { error: isAuthError ? "Not authenticated" : "Failed to estimate macros" },
      { status: isAuthError ? 401 : 500 }
    );
  }
}
