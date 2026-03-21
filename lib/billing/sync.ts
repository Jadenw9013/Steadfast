import Stripe from "stripe";
import { db } from "@/lib/db";
import type {
  SubscriptionTier,
  SubscriptionStatus,
  BillingState,
} from "@/app/generated/prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStripeStatus(
  stripeStatus: Stripe.Subscription.Status
): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
      return "ACTIVE";
    case "trialing":
      return "TRIALING";
    case "past_due":
      return "PAST_DUE";
    case "canceled":
    case "unpaid":
      return "CANCELED";
    default:
      return "NONE";
  }
}

function deriveBillingState(status: SubscriptionStatus): BillingState {
  switch (status) {
    case "ACTIVE":
    case "TRIALING":
      return "ACTIVE";
    case "PAST_DUE":
      return "GRACE_PERIOD";
    default:
      return "REQUIRES_PAYMENT";
  }
}

// ---------------------------------------------------------------------------
// Sync functions — called from webhook handler
// ---------------------------------------------------------------------------

/**
 * Sync a completed Stripe Checkout session to the local DB.
 */
export async function syncCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  const tier = session.metadata?.tier;

  if (tier !== "STARTER" && tier !== "PRO") {
    throw new Error(
      `Invalid subscription tier in checkout metadata: "${tier}"`
    );
  }

  const user = await db.user.findUnique({
    where: { stripeCustomerId: customerId },
  });

  if (!user) {
    console.warn(
      `[billing/sync] syncCheckoutCompleted: No user found for stripeCustomerId=${customerId}`
    );
    return;
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      subscriptionTier: tier as SubscriptionTier,
      subscriptionStatus: "ACTIVE",
      billingState: "ACTIVE",
      stripeSubscriptionId: subscriptionId,
    },
  });
}

/**
 * Sync a Stripe subscription update (created or changed) to the local DB.
 */
export async function syncSubscriptionUpdated(
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId = subscription.customer as string;
  const subscriptionStatus = mapStripeStatus(subscription.status);
  const billingState = deriveBillingState(subscriptionStatus);

  const user = await db.user.findUnique({
    where: { stripeCustomerId: customerId },
  });

  if (!user) {
    console.warn(
      `[billing/sync] syncSubscriptionUpdated: No user found for stripeCustomerId=${customerId}`
    );
    return;
  }

  // Do not overwrite beta users unless they explicitly subscribed
  if (user.billingState === "BETA" && subscriptionStatus === "NONE") {
    return;
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      subscriptionStatus,
      billingState,
    },
  });
}

/**
 * Sync a deleted Stripe subscription to the local DB.
 */
export async function syncSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId = subscription.customer as string;

  const user = await db.user.findUnique({
    where: { stripeCustomerId: customerId },
  });

  if (!user) {
    console.warn(
      `[billing/sync] syncSubscriptionDeleted: No user found for stripeCustomerId=${customerId}`
    );
    return;
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      subscriptionStatus: "CANCELED",
      billingState: "REQUIRES_PAYMENT",
    },
  });
}

/**
 * Sync a failed Stripe invoice payment to the local DB.
 */
export async function syncInvoicePaymentFailed(
  invoice: Stripe.Invoice
): Promise<void> {
  const customerId = invoice.customer as string;

  const user = await db.user.findUnique({
    where: { stripeCustomerId: customerId },
  });

  if (!user) {
    console.warn(
      `[billing/sync] syncInvoicePaymentFailed: No user found for stripeCustomerId=${customerId}`
    );
    return;
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      subscriptionStatus: "PAST_DUE",
      billingState: "GRACE_PERIOD",
    },
  });
}
