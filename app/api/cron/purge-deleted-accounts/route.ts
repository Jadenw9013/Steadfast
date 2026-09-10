import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sweepAccountDeletions } from "@/lib/account-deletion/sweep";

/**
 * Cron endpoint: purge accounts whose 30-day grace period has expired.
 * Called by the checkin-reminders cron or manually with CRON_SECRET.
 */

/** Timing-safe bearer token comparison. */
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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || !verifyCronSecret(authHeader, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try { return NextResponse.json(await sweepAccountDeletions()); }
  catch (error) {
    console.error("[purge-cron]", error);
    return NextResponse.json({ error: "Purge sweep failed" }, { status: 500 });
  }
}
