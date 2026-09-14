import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runExecutorSweep } from "@/lib/ai-coach/executor";

/** Timing-safe bearer token comparison — mirrors app/api/cron/checkin-reminders. */
function verifyCronSecret(authHeader: string | null, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const actual = authHeader || "";
  const bufA = Buffer.from(actual);
  const bufB = Buffer.from(expected);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * A05 — durable job executor sweep. Disabled entirely (no claims
 * attempted) unless FEATURE_AI_COACH_GENERATION is explicitly "true"; see
 * lib/ai-coach/executor.ts and lib/flags/ai-coach.ts.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !verifyCronSecret(authHeader, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runExecutorSweep();
  return NextResponse.json(summary);
}
