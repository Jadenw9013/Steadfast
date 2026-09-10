import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";

// ── POST — create a Stripe Billing Portal session for the coach ───────────────

export async function POST() {
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
      select: { stripeCustomerId: true },
    });

    if (!subscription) {
      return NextResponse.json(
        { error: "No billing account yet — start a subscription first" },
        { status: 422 }
      );
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      // Placeholder — the web app should build a real return page eventually.
      return_url: "https://steadfast-coaching.com/billing",
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("[POST /api/coach/billing/portal]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
