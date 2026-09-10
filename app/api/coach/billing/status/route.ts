import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";

// ── GET — the coach's current billing status, for the iOS status banner ───────
// Plain state only — no Stripe objects, no price/amount info.

export async function GET() {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const subscription = await db.coachSubscription.findUnique({
      where: { coachId: user.id },
      select: {
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        trialEnd: true,
      },
    });

    if (!subscription) {
      return NextResponse.json({
        status: "NONE",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
      });
    }

    return NextResponse.json({
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      trialEnd: subscription.trialEnd?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("[GET /api/coach/billing/status]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
