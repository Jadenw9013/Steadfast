import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runExecutorSweep } from "@/lib/ai-coach/executor";
import { AiCoachError } from "@/lib/ai-coach/error";
import { CRON_FAILED } from "@/lib/observability/events";
import { reportServerError } from "@/lib/observability/report";

// T-503: must run on nodejs, never be inferred onto the edge runtime — the
// handler uses crypto.timingSafeEqual, Buffer and Prisma (matches
// app/api/health/route.ts). maxDuration = 135s provider ceiling (3 claims x
// 45s PROVIDER_TIMEOUT_MS, sequential) + 45s validation/persistence/
// reconciliation headroom = 180s total (doc 08 A05 requires >=120s).
export const runtime = "nodejs";
export const maxDuration = 180;

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

  try {
    return NextResponse.json(await runExecutorSweep());
  } catch (error) {
    if (error instanceof AiCoachError) {
      return NextResponse.json({ disabled: true, paused: true, reason: error.code }, { status: 200 });
    }
    reportServerError(CRON_FAILED.evt, error, {
      route: "/api/cron/ai-coach-executor",
      method: "GET",
      statusCode: 500,
      context: { job: "ai-coach-executor", phase: "executor-sweep" },
      allow: CRON_FAILED.allow,
    });
    return NextResponse.json({ error: "Executor sweep failed" }, { status: 500 });
  }
}
