import Stripe from "stripe";

let stripeInstance: Stripe | undefined;

function createStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Copy .env.example to .env.local and fill in your Stripe secret key."
    );
  }
  return new Stripe(secretKey);
}

/** Lazy-initialized Stripe client — throws on first use if STRIPE_SECRET_KEY is missing. */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    if (!stripeInstance) {
      stripeInstance = createStripeClient();
    }
    return Reflect.get(stripeInstance, prop);
  },
});

/** Throws a clear error if STRIPE_WEBHOOK_SECRET is missing rather than crashing at import time. */
export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set. Copy .env.example to .env.local and fill in your Stripe webhook signing secret."
    );
  }
  return secret;
}

/** Throws a clear error if STRIPE_PRICE_ID is missing rather than crashing at import time. */
export function getStripePriceId(): string {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    throw new Error(
      "STRIPE_PRICE_ID is not set. Copy .env.example to .env.local and fill in your Stripe Price ID."
    );
  }
  return priceId;
}
