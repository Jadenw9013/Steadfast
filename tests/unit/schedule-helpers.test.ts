import { describe, it, expect } from "vitest";
import {
    getEffectiveScheduleDays,
    getNextDueDay,
    isCheckInDueToday,
} from "@/lib/scheduling/periods";

describe("getEffectiveScheduleDays", () => {
    it("uses client override when non-empty", () => {
        expect(getEffectiveScheduleDays([1, 3], [5])).toEqual([5]);
    });

    it("falls back to coach default when client override is empty", () => {
        expect(getEffectiveScheduleDays([1, 3], [])).toEqual([1, 3]);
    });

    it("falls back to [1] (Monday) when both are empty", () => {
        expect(getEffectiveScheduleDays([], [])).toEqual([1]);
    });
});

describe("isCheckInDueToday", () => {
    it("returns false for empty schedule", () => {
        expect(isCheckInDueToday([], "UTC")).toBe(false);
    });

    it("returns true when today's day is in the schedule", () => {
        const todayDay = new Date().getUTCDay();
        expect(isCheckInDueToday([todayDay], "UTC")).toBe(true);
    });

    it("returns false when today's day is not in the schedule", () => {
        const todayDay = new Date().getUTCDay();
        const otherDay = (todayDay + 3) % 7;
        expect(isCheckInDueToday([otherDay], "UTC")).toBe(false);
    });
});

describe("getNextDueDay", () => {
    it("returns null for empty schedule", () => {
        expect(getNextDueDay([], "America/New_York")).toBeNull();
    });

    it("returns a valid result with the correct day name", () => {
        const result = getNextDueDay([1, 3, 5], "America/New_York");
        expect(result).not.toBeNull();
        expect(result!.dayName).toBeTruthy();
        expect(result!.dayIndex).toBeGreaterThanOrEqual(0);
        expect(result!.dayIndex).toBeLessThanOrEqual(6);
        expect(result!.daysUntil).toBeGreaterThanOrEqual(0);
        expect(result!.daysUntil).toBeLessThanOrEqual(6);
    });

    it("returns daysUntil=0 when today is a due day", () => {
        const now = new Date();
        const todayDay = new Date(
            now.toLocaleString("en-US", { timeZone: "UTC" })
        ).getDay();
        const result = getNextDueDay([todayDay], "UTC");
        expect(result).not.toBeNull();
        expect(result!.daysUntil).toBe(0);
        expect(result!.dayIndex).toBe(todayDay);
    });

    it("returns correct offset for a single future day", () => {
        const now = new Date();
        const todayDay = new Date(
            now.toLocaleString("en-US", { timeZone: "UTC" })
        ).getDay();
        const futureDay = (todayDay + 2) % 7;
        const result = getNextDueDay([futureDay], "UTC");
        expect(result).not.toBeNull();
        expect(result!.daysUntil).toBe(2);
        expect(result!.dayIndex).toBe(futureDay);
    });
});

describe("cron schedule-awareness logic", () => {
    function isDueToday(scheduleDays: number[], tz: string, serverTime: Date): boolean {
        const d = new Date(serverTime.toLocaleString("en-US", { timeZone: tz }));
        return scheduleDays.includes(d.getDay());
    }

    it("identifies due day correctly for Monday schedule", () => {
        const now = new Date();
        const daysUntilMonday = (1 - now.getDay() + 7) % 7;
        const monday = new Date(now);
        monday.setDate(monday.getDate() + daysUntilMonday);
        monday.setHours(10, 0, 0, 0);
        expect(isDueToday([1], "UTC", monday)).toBe(true);
        expect(isDueToday([2], "UTC", monday)).toBe(false);
    });

    it("works with multiple due days", () => {
        const now = new Date();
        const todayDay = new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getDay();
        expect(isDueToday([todayDay, (todayDay + 3) % 7], "UTC", now)).toBe(true);
    });

    it("skips non-due days correctly", () => {
        const now = new Date();
        const todayDay = new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getDay();
        const otherDay = (todayDay + 1) % 7;
        expect(isDueToday([otherDay], "UTC", now)).toBe(false);
    });
});
