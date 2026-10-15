import { describe, it, expect } from "vitest";
import { formatTotal } from "@/components/client/daily-totals-card";

/**
 * T-802a review r2 — parity item 5. Settles the daily-totals number-format
 * rule so T-802b (iOS) can copy it byte-for-byte: round to the nearest
 * integer, then thousands-separate with `toLocaleString("en-US")`.
 */
describe("formatTotal", () => {
  it("rounds a floating-point value to a clean integer with thousands separators", () => {
    // On web the summed columns are Prisma Int, so a raw total is always a
    // whole number here — this artifact shape is the iOS side (Double macro
    // fields). Rounding is kept for cross-platform parity with iOS's
    // formatter (T-802a review r3, NIT 5).
    expect(formatTotal(1234.5000000000002)).toBe("1,235");
  });

  it("matches T-802 §2.2's mockup value", () => {
    expect(formatTotal(2340)).toBe("2,340");
  });

  it("passes through a clean whole number unchanged", () => {
    expect(formatTotal(0)).toBe("0");
  });
});
