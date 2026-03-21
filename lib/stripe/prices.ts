export function getStripePriceIdForTier(tier: "STARTER" | "PRO"): string {
  switch (tier) {
    case "STARTER": {
      const id = process.env.STRIPE_PRICE_STARTER_MONTHLY;
      if (!id) throw new Error("Missing STRIPE_PRICE_STARTER_MONTHLY env var");
      return id;
    }
    case "PRO": {
      const id = process.env.STRIPE_PRICE_PRO_MONTHLY;
      if (!id) throw new Error("Missing STRIPE_PRICE_PRO_MONTHLY env var");
      return id;
    }
  }
}
