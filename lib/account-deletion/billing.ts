import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";

/** Cancel every subscription on the account, including any historical duplicates. */
export async function stopAccountBilling(userId: string, immediately = false) {
  const billing = await db.coachSubscription.findUnique({ where: { coachId: userId } });
  if (!billing) return;
  for await (const subscription of stripe.subscriptions.list({ customer: billing.stripeCustomerId, status: "all", limit: 100 })) {
    if (["canceled", "incomplete_expired"].includes(subscription.status)) continue;
    if (immediately) {
      await stripe.subscriptions.cancel(subscription.id);
    } else if (!subscription.cancel_at_period_end) {
      await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
    }
  }
}
