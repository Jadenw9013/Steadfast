"use server";

import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import stripe from "@/lib/stripe/server";
import { getStripePriceIdForTier } from "@/lib/stripe/prices";

const checkoutSchema = z.object({
  tier: z.enum(["STARTER", "PRO"]),
});

export async function createCheckoutSession(input: unknown) {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const user = await getCurrentDbUser();
  if (!user.isCoach) throw new Error("Only coaches can manage billing");
  if (user.activeRole !== "COACH")
    throw new Error("Switch to your coach account to manage billing");

  // Get or create Stripe customer
  let stripeCustomerId = user.stripeCustomerId;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
      metadata: { userId: user.id },
    });

    stripeCustomerId = customer.id;

    await db.user.update({
      where: { id: user.id },
      data: { stripeCustomerId },
    });
  }

  const priceId = getStripePriceIdForTier(parsed.data.tier);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { tier: parsed.data.tier, userId: user.id },
    success_url: `${appUrl}/coach/settings/billing`,
    cancel_url: `${appUrl}/coach/settings/billing`,
    allow_promotion_codes: true,
  });

  return { url: session.url };
}

export async function createCustomerPortalSession() {
  const user = await getCurrentDbUser();
  if (!user.isCoach) throw new Error("Only coaches can manage billing");
  if (!user.stripeCustomerId)
    throw new Error("No billing account found");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${appUrl}/coach/settings/billing`,
  });

  return { url: session.url };
}
