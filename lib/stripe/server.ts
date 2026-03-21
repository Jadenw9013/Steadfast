import "server-only";
import Stripe from "stripe";

let _stripe: Stripe | undefined;

/**
 * Lazy-initialized Stripe client — throws on first use if STRIPE_SECRET_KEY
 * is missing, but does NOT throw at import/build time.
 */
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("Missing STRIPE_SECRET_KEY environment variable");
    }
    _stripe = new Stripe(key, {
      apiVersion: "2026-02-25.clover",
    });
  }
  return _stripe;
}

const stripeProxy = new Proxy({} as Stripe, {
  get(_target, prop) {
    return Reflect.get(getStripe(), prop);
  },
});

export default stripeProxy;
