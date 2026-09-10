import type Stripe from "stripe";
import { db } from "@/lib/db";
import { SubscriptionStatus } from "@/app/generated/prisma/client";

/** Maps a Stripe subscription status string onto our SubscriptionStatus enum. */
export function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "past_due":
      return SubscriptionStatus.PAST_DUE;
    case "canceled":
      return SubscriptionStatus.CANCELED;
    case "incomplete":
      return SubscriptionStatus.INCOMPLETE;
    case "incomplete_expired":
      return SubscriptionStatus.INCOMPLETE_EXPIRED;
    case "unpaid":
      return SubscriptionStatus.UNPAID;
    case "paused":
      return SubscriptionStatus.PAUSED;
    default:
      // Stripe's type includes an open-ended `OtherString` member for forward
      // compatibility — fail loudly rather than silently mis-recording billing
      // state if it ever sends a status we don't recognize yet.
      throw new Error(`Unknown Stripe subscription status: ${status}`);
  }
}

/**
 * Upserts a CoachSubscription row from a Stripe Subscription object.
 *
 * `current_period_start`/`current_period_end` live on the subscription's line
 * item (not the subscription itself) as of the pinned Stripe API version, so
 * they're read off `items.data[0]`.
 *
 * Resolution order for which coach this belongs to:
 *   1. `subscription.metadata.coachId` (set at Checkout creation time via
 *      `subscription_data.metadata`) — the fast path for every subscription
 *      created through our own checkout flow.
 *   2. Fall back to matching an existing row by `stripeCustomerId` (covers
 *      subscription-lifecycle events that arrive for a customer we already
 *      have a row for).
 *
 * If neither resolves to a known coach, the event is logged and skipped —
 * there is nothing in our system to attach it to.
 */
export async function upsertCoachSubscriptionFromStripeSubscription(
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const item = subscription.items.data[0];
  const status = mapStripeStatus(subscription.status);

  const data = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: item?.price.id ?? null,
    status,
    currentPeriodStart: item ? new Date(item.current_period_start * 1000) : null,
    currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
  };

  const coachId = subscription.metadata?.coachId;

  if (coachId) {
    await db.coachSubscription.upsert({
      where: { coachId },
      create: { coachId, ...data },
      update: data,
    });
    return;
  }

  const result = await db.coachSubscription.updateMany({
    where: { stripeCustomerId: customerId },
    data,
  });

  if (result.count === 0) {
    console.error(
      `[billing] Stripe subscription ${subscription.id} for customer ${customerId} has no coachId metadata and no matching CoachSubscription row — skipped`
    );
  }
}
