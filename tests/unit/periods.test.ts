import { describe, it, expect } from "vitest";
import {
  getEffectiveScheduleDays,
  computeCurrentPeriod,
  formatPeriodLabel,
  formatPeriodDateLabel,
  isCheckInDueToday,
  getNextDueDay,
} from "@/lib/scheduling/periods";

// ── getEffectiveScheduleDays ──────────────────────────────────────────────────

describe("getEffectiveScheduleDays", () => {
  it("returns client override when non-empty", () => {
    expect(getEffectiveScheduleDays([1, 3], [5])).toEqual([5]);
  });

  it("returns coach days when client override is empty", () => {
    expect(getEffectiveScheduleDays([2, 4], [])).toEqual([2, 4]);
  });

  it("falls back to [1] (Monday) when both are empty", () => {
    expect(getEffectiveScheduleDays([], [])).toEqual([1]);
  });

  it("client override wins even with multi-day coach default", () => {
    expect(getEffectiveScheduleDays([1, 2, 3, 4, 5], [0, 6])).toEqual([0, 6]);
  });
});

// ── computeCurrentPeriod ──────────────────────────────────────────────────────

describe("computeCurrentPeriod", () => {
  // Use a known date: Wednesday April 9, 2025 in America/Los_Angeles
  const wednesday = new Date("2025-04-09T12:00:00Z");

  it("finds period start as the most-recent scheduled day", () => {
    // Schedule on Mondays [1]. Wednesday → start should be Monday (Apr 7)
    const result = computeCurrentPeriod([1], wednesday, "America/Los_Angeles");
    expect(result.periodStartDate).toBe("2025-04-07");
  });

  it("finds period end as the next scheduled day after start", () => {
    // Schedule on Mondays [1]. Start is Mon Apr 7 → next Mon is Apr 14
    const result = computeCurrentPeriod([1], wednesday, "America/Los_Angeles");
    expect(result.periodEndDate).toBe("2025-04-14");
  });

  it("handles multi-day schedules correctly", () => {
    // Schedule Mon [1] and Thu [4]. Wednesday → start should be Mon Apr 7, end Thu Apr 10
    const result = computeCurrentPeriod([1, 4], wednesday, "America/Los_Angeles");
    expect(result.periodStartDate).toBe("2025-04-07");
    expect(result.periodEndDate).toBe("2025-04-10");
  });

  it("handles when today IS a scheduled day", () => {
    // Schedule on Wednesdays [3]. Wednesday → start IS today
    const result = computeCurrentPeriod([3], wednesday, "America/Los_Angeles");
    expect(result.periodStartDate).toBe("2025-04-09");
  });

  it("falls back to Monday when checkInDays is empty", () => {
    const result = computeCurrentPeriod([], wednesday, "America/Los_Angeles");
    expect(result.periodStartDate).toBe("2025-04-07");
  });

  it("deduplicates scheduled days", () => {
    const result = computeCurrentPeriod([1, 1, 1], wednesday, "America/Los_Angeles");
    expect(result.periodStartDate).toBe("2025-04-07");
    expect(result.periodEndDate).toBe("2025-04-14");
  });

  it("returns a label string", () => {
    const result = computeCurrentPeriod([1], wednesday, "America/Los_Angeles");
    expect(result.label).toContain("–");
    expect(result.label).toContain("Apr");
  });
});

// ── formatPeriodLabel ─────────────────────────────────────────────────────────

describe("formatPeriodLabel", () => {
  it("formats a date range as 'Mon D – Mon D'", () => {
    const start = new Date("2025-02-10T00:00:00Z");
    const end = new Date("2025-02-16T23:59:59Z");
    const label = formatPeriodLabel(start, end);
    expect(label).toBe("Feb 10 \u2013 Feb 16");
  });

  it("handles cross-month ranges", () => {
    const start = new Date("2025-01-27T00:00:00Z");
    const end = new Date("2025-02-02T23:59:59Z");
    const label = formatPeriodLabel(start, end);
    expect(label).toBe("Jan 27 \u2013 Feb 2");
  });
});

// ── formatPeriodDateLabel ─────────────────────────────────────────────────────

describe("formatPeriodDateLabel", () => {
  it("formats YYYY-MM-DD strings as 'Mon D – Mon D'", () => {
    const label = formatPeriodDateLabel("2025-02-10", "2025-02-14");
    expect(label).toBe("Feb 10 \u2013 Feb 14");
  });

  it("returns dash for empty input", () => {
    expect(formatPeriodDateLabel("", "")).toBe("—");
  });

  it("returns start date when end is empty", () => {
    expect(formatPeriodDateLabel("2025-02-10", "")).toBe("2025-02-10");
  });
});

// ── isCheckInDueToday ─────────────────────────────────────────────────────────

describe("isCheckInDueToday", () => {
  it("returns false for empty schedule", () => {
    expect(isCheckInDueToday([], "America/New_York")).toBe(false);
  });

  // Note: This test's result depends on what day it runs.
  // We verify the function's behavior contract rather than a fixed result.
  it("returns a boolean", () => {
    const result = isCheckInDueToday([0, 1, 2, 3, 4, 5, 6], "America/New_York");
    expect(result).toBe(true); // every day is scheduled
  });
});

// ── getNextDueDay ─────────────────────────────────────────────────────────────

describe("getNextDueDay", () => {
  it("returns null for empty schedule", () => {
    expect(getNextDueDay([], "America/New_York")).toBeNull();
  });

  it("returns a valid day structure for non-empty schedule", () => {
    const result = getNextDueDay([1], "America/New_York");
    expect(result).not.toBeNull();
    expect(result!.dayName).toBe("Monday");
    expect(result!.dayIndex).toBe(1);
    expect(result!.daysUntil).toBeGreaterThanOrEqual(0);
    expect(result!.daysUntil).toBeLessThanOrEqual(6);
  });

  it("daysUntil is 0 when every day is scheduled", () => {
    const result = getNextDueDay([0, 1, 2, 3, 4, 5, 6], "America/New_York");
    expect(result).not.toBeNull();
    expect(result!.daysUntil).toBe(0);
  });

  it("returns correct day names", () => {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (let d = 0; d <= 6; d++) {
      const result = getNextDueDay([d], "America/New_York");
      expect(result).not.toBeNull();
      expect(result!.dayName).toBe(dayNames[d]);
      expect(result!.dayIndex).toBe(d);
    }
  });
});
