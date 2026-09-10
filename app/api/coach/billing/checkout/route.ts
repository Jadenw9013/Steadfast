import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { stripe, getStripePriceId } from "@/lib/stripe";

// ── POST — create a Stripe Checkout session for the coach's subscription ──────

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
    const url = await db.$transaction(async tx => {
      // Serialize Checkout creation for this coach across all server instances.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      let billing = await tx.coachSubscription.findUnique({ where: { coachId: user.id } });
      if (!billing) {
        const customer = await stripe.customers.create({ email: user.email, metadata: { coachId: user.id } }, { idempotencyKey: `coach-customer-${user.id}` });
        billing = await tx.coachSubscription.create({ data: { coachId: user.id, stripeCustomerId: customer.id, status: "INCOMPLETE" } });
      }
      // Stripe is authoritative even when its webhook has not reached us yet.
      const subscriptions = await stripe.subscriptions.list({ customer: billing.stripeCustomerId, status: "all", limit: 100 });
      if (subscriptions.data.some(subscription => !["canceled", "incomplete_expired"].includes(subscription.status))) {
        const portal = await stripe.billingPortal.sessions.create({ customer: billing.stripeCustomerId, return_url: "https://steadfast-coaching.com/coach/settings" });
        return portal.url;
      }
      if (billing.checkoutSessionId) {
        const pending = await stripe.checkout.sessions.retrieve(billing.checkoutSessionId);
        if (pending.status === "open" && pending.url) return pending.url;
      }
      const session = await stripe.checkout.sessions.create({
        mode: "subscription", customer: billing.stripeCustomerId,
        line_items: [{ price: getStripePriceId(), quantity: 1 }],
        client_reference_id: user.id, metadata: { coachId: user.id },
        subscription_data: { metadata: { coachId: user.id } },
        success_url: "https://steadfast-coaching.com/billing/success",
        cancel_url: "https://steadfast-coaching.com/billing/cancel",
      }, { idempotencyKey: `coach-checkout-${user.id}-${billing.checkoutSessionId ?? "initial"}` });
      if (!session.url) throw new Error("Checkout URL unavailable");
      await tx.coachSubscription.update({ where: { coachId: user.id }, data: { checkoutSessionId: session.id } });
      return session.url;
    }, { timeout: 30000 });

    return NextResponse.json({ url });
  } catch (err) {
    console.error("[POST /api/coach/billing/checkout]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
