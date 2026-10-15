import { describe, expect, it } from "vitest";
import { estimateSpendMinorUnits, type ProviderTokenPricing } from "@/lib/ai-coach/provider/spend-limits";

const PRICING: ProviderTokenPricing = {
  currency: "USD",
  inputMinorUnitsPerMillionTokens: 300,
  outputMinorUnitsPerMillionTokens: 1_500,
};

describe("estimateSpendMinorUnits", () => {
  it("rounds up rather than truncating", () => {
    // (1 * 300 + 0) / 1_000_000 = 0.0003 -> ceil to 1.
    expect(estimateSpendMinorUnits({ inputTokens: 1, outputTokens: 0 }, PRICING)).toBe(1);
  });

  it("is zero at zero tokens", () => {
    expect(estimateSpendMinorUnits({ inputTokens: 0, outputTokens: 0 }, PRICING)).toBe(0);
  });

  it("is never negative given garbage usage", () => {
    expect(
      estimateSpendMinorUnits({ inputTokens: -100, outputTokens: -100 }, PRICING)
    ).toBe(0);
    expect(
      estimateSpendMinorUnits({ inputTokens: Number.NaN, outputTokens: Number.POSITIVE_INFINITY }, PRICING)
    ).toBe(0);
    expect(
      estimateSpendMinorUnits({ inputTokens: -1, outputTokens: 1_000_000 }, PRICING)
    ).toBeGreaterThanOrEqual(0);
  });

  it("is monotone in both token counts", () => {
    const base = estimateSpendMinorUnits({ inputTokens: 10_000, outputTokens: 10_000 }, PRICING);
    const moreInput = estimateSpendMinorUnits({ inputTokens: 20_000, outputTokens: 10_000 }, PRICING);
    const moreOutput = estimateSpendMinorUnits({ inputTokens: 10_000, outputTokens: 20_000 }, PRICING);
    expect(moreInput).toBeGreaterThanOrEqual(base);
    expect(moreOutput).toBeGreaterThanOrEqual(base);
  });

  it("exact integer for a realistic call", () => {
    // (1_000_000 * 300 + 500_000 * 1_500) / 1_000_000 = 300 + 750 = 1050
    expect(
      estimateSpendMinorUnits({ inputTokens: 1_000_000, outputTokens: 500_000 }, PRICING)
    ).toBe(1_050);
  });
});
