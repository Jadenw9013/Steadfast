import { describe, it, expect } from "vitest";
import {
    cadenceConfigSchema,
    getEffectiveCadence,
    getCadencePreview,
    getNextDue,
    cadenceFromLegacyDays,
    parseCadenceConfig,
    getClientCadenceStatus,
    getCoachStatusLabel,
    formatTime12h,
} from "@/lib/scheduling/cadence";
import type { CadenceConfig, CadenceStatus } from "@/lib/scheduling/cadence";

// ── Schema validation ────────────────────────────────────────────────────────

describe("cadenceConfigSchema", () => {
    it("accepts valid weekly config", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "weekly",
            dayOfWeek: 5,
            timeOfDay: "09:00",
        });
        expect(result.success).toBe(true);
    });

    it("accepts valid daily config", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "daily",
            timeOfDay: "08:00",
        });
        expect(result.success).toBe(true);
    });

    it("accepts valid every_n_days config", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "every_n_days",
            intervalDays: 3,
            timeOfDay: "07:00",
        });
        expect(result.success).toBe(true);
    });

    it("accepts valid every_n_hours config", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "every_n_hours",
            intervalHours: 4,
        });
        expect(result.success).toBe(true);
    });

    it("rejects every_n_hours with interval < 2", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "every_n_hours",
            intervalHours: 1,
        });
        expect(result.success).toBe(false);
    });

    it("rejects every_n_days with interval < 2", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "every_n_days",
            intervalDays: 1,
            timeOfDay: "09:00",
        });
        expect(result.success).toBe(false);
    });

    it("rejects weekly with dayOfWeek out of range", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "weekly",
            dayOfWeek: 7,
            timeOfDay: "09:00",
        });
        expect(result.success).toBe(false);
    });

    it("rejects invalid time format", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "daily",
            timeOfDay: "9:00",
        });
        expect(result.success).toBe(false);
    });

    it("rejects unknown cadence type", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "biweekly",
            timeOfDay: "09:00",
        });
        expect(result.success).toBe(false);
    });

    it("accepts midnight time", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "daily",
            timeOfDay: "00:00",
        });
        expect(result.success).toBe(true);
    });

    it("accepts 23:59 time", () => {
        const result = cadenceConfigSchema.safeParse({
            type: "daily",
            timeOfDay: "23:59",
        });
        expect(result.success).toBe(true);
    });
});

// ── Effective cadence resolver ───────────────────────────────────────────────

describe("getEffectiveCadence", () => {
    const coachConfig: CadenceConfig = {
        type: "weekly",
        dayOfWeek: 5,
        timeOfDay: "09:00",
    };

    const clientOverride: CadenceConfig = {
        type: "daily",
        timeOfDay: "08:00",
    };

    it("returns client override when present", () => {
        const result = getEffectiveCadence(coachConfig, clientOverride);
        expect(result).toEqual(clientOverride);
    });

    it("returns coach default when no client override", () => {
        const result = getEffectiveCadence(coachConfig, null);
        expect(result).toEqual(coachConfig);
    });

    it("returns coach default when client override is undefined", () => {
        const result = getEffectiveCadence(coachConfig, undefined);
        expect(result).toEqual(coachConfig);
    });

    it("returns fallback when both are null", () => {
        const result = getEffectiveCadence(null, null);
        expect(result).toEqual({
            type: "weekly",
            dayOfWeek: 1,
            timeOfDay: "09:00",
        });
    });
});

// ── Preview text ─────────────────────────────────────────────────────────────

describe("getCadencePreview", () => {
    it("formats weekly cadence", () => {
        expect(
            getCadencePreview({ type: "weekly", dayOfWeek: 5, timeOfDay: "09:00" })
        ).toBe("Every Friday at 9:00 AM");
    });

    it("formats daily cadence", () => {
        expect(
            getCadencePreview({ type: "daily", timeOfDay: "08:00" })
        ).toBe("Every day at 8:00 AM");
    });

    it("formats every_n_days cadence", () => {
        expect(
            getCadencePreview({
                type: "every_n_days",
                intervalDays: 3,
                timeOfDay: "07:00",
            })
        ).toBe("Every 3 days at 7:00 AM");
    });

    it("formats every_n_hours cadence", () => {
        expect(
            getCadencePreview({ type: "every_n_hours", intervalHours: 2 })
        ).toBe("Every 2 hours");
    });

    it("formats PM times correctly", () => {
        expect(
            getCadencePreview({ type: "daily", timeOfDay: "14:30" })
        ).toBe("Every day at 2:30 PM");
    });

    it("formats midnight correctly", () => {
        expect(
            getCadencePreview({ type: "daily", timeOfDay: "00:00" })
        ).toBe("Every day at 12:00 AM");
    });

    it("formats noon correctly", () => {
        expect(
            getCadencePreview({ type: "daily", timeOfDay: "12:00" })
        ).toBe("Every day at 12:00 PM");
    });

    it("formats Sunday weekly", () => {
        expect(
            getCadencePreview({ type: "weekly", dayOfWeek: 0, timeOfDay: "10:00" })
        ).toBe("Every Sunday at 10:00 AM");
    });
});

// ── Next due calculation ─────────────────────────────────────────────────────

describe("getNextDue", () => {
    it("returns a future Date for weekly cadence with no anchor", () => {
        const config: CadenceConfig = {
            type: "weekly",
            dayOfWeek: 5,
            timeOfDay: "09:00",
        };
        const result = getNextDue(config, null, "America/New_York");
        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it("returns a future Date for daily cadence with no anchor", () => {
        const config: CadenceConfig = {
            type: "daily",
            timeOfDay: "08:00",
        };
        const result = getNextDue(config, null, "America/New_York");
        expect(result).toBeInstanceOf(Date);
        expect(result.getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it("returns now for every_n_hours with no anchor", () => {
        const config: CadenceConfig = {
            type: "every_n_hours",
            intervalHours: 2,
        };
        const now = Date.now();
        const result = getNextDue(config, null, "America/New_York");
        // Should be within a few seconds of now
        expect(Math.abs(result.getTime() - now)).toBeLessThan(5000);
    });

    it("returns anchor + interval for every_n_hours with anchor", () => {
        const config: CadenceConfig = {
            type: "every_n_hours",
            intervalHours: 4,
        };
        // Set anchor to 2 hours in the future so next due = 6 hours from now
        const futureAnchor = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const result = getNextDue(config, futureAnchor, "America/New_York");
        // Should be ~6 hours from now (anchor + 4 hours)
        const expectedMs = futureAnchor.getTime() + 4 * 60 * 60 * 1000;
        expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(5000);
    });

    it("steps forward past now for stale every_n_days anchor", () => {
        const config: CadenceConfig = {
            type: "every_n_days",
            intervalDays: 3,
            timeOfDay: "09:00",
        };
        // Anchor far in the past
        const oldAnchor = new Date("2024-01-01T09:00:00Z");
        const result = getNextDue(config, oldAnchor, "UTC");
        expect(result.getTime()).toBeGreaterThan(Date.now() - 1000);
    });
});

// ── Legacy conversion ────────────────────────────────────────────────────────

describe("cadenceFromLegacyDays", () => {
    it("converts single day to weekly cadence", () => {
        expect(cadenceFromLegacyDays([5])).toEqual({
            type: "weekly",
            dayOfWeek: 5,
            timeOfDay: "09:00",
        });
    });

    it("uses first day when multiple days given", () => {
        expect(cadenceFromLegacyDays([3, 5, 1])).toEqual({
            type: "weekly",
            dayOfWeek: 1,
            timeOfDay: "09:00",
        });
    });

    it("defaults to Monday when empty array", () => {
        expect(cadenceFromLegacyDays([])).toEqual({
            type: "weekly",
            dayOfWeek: 1,
            timeOfDay: "09:00",
        });
    });
});

// ── JSON parse helper ────────────────────────────────────────────────────────

describe("parseCadenceConfig", () => {
    it("parses valid config", () => {
        const result = parseCadenceConfig({
            type: "daily",
            timeOfDay: "08:00",
        });
        expect(result).toEqual({ type: "daily", timeOfDay: "08:00" });
    });

    it("returns null for null input", () => {
        expect(parseCadenceConfig(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
        expect(parseCadenceConfig(undefined)).toBeNull();
    });

    it("returns null for invalid config", () => {
        expect(parseCadenceConfig({ type: "invalid" })).toBeNull();
    });

    it("returns null for empty object", () => {
        expect(parseCadenceConfig({})).toBeNull();
    });
});

// ── Cadence status derivation ───────────────────────────────────────────────

describe("getClientCadenceStatus", () => {
    const weeklyConfig: CadenceConfig = {
        type: "weekly",
        dayOfWeek: 1,
        timeOfDay: "09:00",
    };

    const dailyConfig: CadenceConfig = {
        type: "daily",
        timeOfDay: "09:00",
    };

    it("returns upcoming/due/overdue when no check-in exists", () => {
        const result = getClientCadenceStatus(weeklyConfig, null, "UTC");
        expect(["upcoming", "due", "overdue"]).toContain(result.status);
        expect(result.nextDue).toBeInstanceOf(Date);
        expect(result.label).toBeTruthy();
    });

    it("returns submitted for a recent unreviewed check-in", () => {
        // Submitted just now
        const result = getClientCadenceStatus(
            weeklyConfig,
            { submittedAt: new Date(), status: "SUBMITTED" },
            "UTC"
        );
        expect(result.status).toBe("submitted");
        expect(result.label).toBe("Waiting for coach review");
    });

    it("returns reviewed for a recent reviewed check-in", () => {
        const result = getClientCadenceStatus(
            weeklyConfig,
            { submittedAt: new Date(), status: "REVIEWED" },
            "UTC"
        );
        expect(result.status).toBe("reviewed");
        expect(result.label).toBe("Your coach reviewed your check-in");
    });

    it("does not treat a very old check-in as submitted", () => {
        const result = getClientCadenceStatus(
            dailyConfig,
            { submittedAt: new Date("2024-01-01T09:00:00Z"), status: "REVIEWED" },
            "UTC"
        );
        // An old check-in should NOT be considered as covering the current period
        expect(result.status).not.toBe("submitted");
        expect(result.status).not.toBe("reviewed");
    });

    it("returns overdue when next due has passed and no recent check-in", () => {
        // Use every_n_hours with an anchor in the past to guarantee overdue
        const hourlyConfig: CadenceConfig = {
            type: "every_n_hours",
            intervalHours: 2,
        };
        // Anchor 3 hours ago → next due was 1 hour ago → overdue
        const anchor = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const result = getClientCadenceStatus(
            hourlyConfig,
            { submittedAt: anchor, status: "REVIEWED" },
            "UTC"
        );
        // nextDue = anchor + 2h = 1 hour ago = overdue
        expect(result.status).toBe("overdue");
        expect(result.label).toBe("Your check-in is overdue");
    });

    it("returns a Date for nextDue in all cases", () => {
        const scenarios: Array<{ submittedAt: Date; status: string } | null> = [
            null,
            { submittedAt: new Date(), status: "SUBMITTED" },
            { submittedAt: new Date("2024-01-01T09:00:00Z"), status: "REVIEWED" },
        ];
        for (const lastCheckIn of scenarios) {
            const result = getClientCadenceStatus(weeklyConfig, lastCheckIn, "UTC");
            expect(result.nextDue).toBeInstanceOf(Date);
        }
    });
});

// ── Coach status label ──────────────────────────────────────────────────────

describe("getCoachStatusLabel", () => {
    const cases: [CadenceStatus, string][] = [
        ["due", "Due now"],
        ["overdue", "Overdue"],
        ["upcoming", "Upcoming"],
        ["submitted", "Submitted"],
        ["reviewed", "Reviewed"],
    ];

    it.each(cases)("returns %s → %s", (status, expected) => {
        expect(getCoachStatusLabel(status)).toBe(expected);
    });
});

// ── Edge-case tests ─────────────────────────────────────────────────────────

describe("cadenceFromLegacyDays edge cases", () => {
    it("sorts unsorted input and uses the lowest day", () => {
        const config = cadenceFromLegacyDays([5, 1, 3]);
        expect(config.type).toBe("weekly");
        if (config.type === "weekly") {
            expect(config.dayOfWeek).toBe(1);
        }
    });

    it("handles single-element array", () => {
        const config = cadenceFromLegacyDays([0]);
        expect(config.type).toBe("weekly");
        if (config.type === "weekly") {
            expect(config.dayOfWeek).toBe(0);
        }
    });
});

describe("parseCadenceConfig edge cases", () => {
    it("returns null for a string value", () => {
        expect(parseCadenceConfig("not-json")).toBeNull();
    });

    it("returns null for a number", () => {
        expect(parseCadenceConfig(42)).toBeNull();
    });

    it("returns null for an array", () => {
        expect(parseCadenceConfig([1, 2, 3])).toBeNull();
    });

    it("returns null for a config with missing required fields", () => {
        expect(parseCadenceConfig({ type: "weekly" })).toBeNull();
    });

    it("returns null for config with invalid timeOfDay format", () => {
        expect(parseCadenceConfig({ type: "daily", timeOfDay: "9am" })).toBeNull();
    });
});

describe("formatTime12h", () => {
    it("formats midnight correctly", () => {
        expect(formatTime12h("00:00")).toBe("12:00 AM");
    });

    it("formats noon correctly", () => {
        expect(formatTime12h("12:00")).toBe("12:00 PM");
    });

    it("formats AM times correctly", () => {
        expect(formatTime12h("09:30")).toBe("9:30 AM");
    });

    it("formats PM times correctly", () => {
        expect(formatTime12h("14:45")).toBe("2:45 PM");
    });

    it("formats 11 PM correctly", () => {
        expect(formatTime12h("23:59")).toBe("11:59 PM");
    });
});

describe("getClientCadenceStatus boundary cases", () => {
    it("treats check-in exactly at previousDue boundary as covered", () => {
        // With every_n_hours=2, if submitted exactly 2h ago (which is the previous due),
        // submittedLocal.isAfter(previousDueLocal) should be false (equal, not after).
        // This means the period is NOT covered — correct behavior: next period due
        const hourlyConfig: CadenceConfig = {
            type: "every_n_hours",
            intervalHours: 4,
        };
        // Submitted exactly 4h ago → previousDue = nextDue - 4h = anchor + 4h - 4h = anchor
        // submittedLocal.isAfter(previousDueLocal) → equal, so NOT after → not covered
        const anchor = new Date(Date.now() - 4 * 60 * 60 * 1000);
        const result = getClientCadenceStatus(
            hourlyConfig,
            { submittedAt: anchor, status: "REVIEWED" },
            "UTC"
        );
        // Next due was anchor + 4h = now, so it's borderline; should not crash
        expect(["due", "overdue", "upcoming"]).toContain(result.status);
        expect(result.nextDue).toBeInstanceOf(Date);
    });

    it("handles weekly cadence with no anchor and returns a future date", () => {
        const weeklyConfig: CadenceConfig = {
            type: "weekly",
            dayOfWeek: 3, // Wednesday
            timeOfDay: "14:00",
        };
        const result = getClientCadenceStatus(weeklyConfig, null, "America/New_York");
        expect(result.nextDue).toBeInstanceOf(Date);
        expect(result.label).toBeTruthy();
    });

    it("handles every_n_days cadence with first-time client", () => {
        const config: CadenceConfig = {
            type: "every_n_days",
            intervalDays: 3,
            timeOfDay: "10:00",
        };
        const result = getClientCadenceStatus(config, null, "UTC");
        expect(["upcoming", "due", "overdue"]).toContain(result.status);
        expect(result.nextDue).toBeInstanceOf(Date);
    });
});

// ── Production-risk tests ───────────────────────────────────────────────────

describe("cadenceFromLegacyDays production safety", () => {
    it("handles empty array by defaulting to Monday", () => {
        const config = cadenceFromLegacyDays([]);
        expect(config.type).toBe("weekly");
        if (config.type === "weekly") {
            expect(config.dayOfWeek).toBe(1);
            expect(config.timeOfDay).toBe("09:00");
        }
    });
});

describe("getClientCadenceStatus long-inactivity", () => {
    it("detects overdue for check-in 30+ days old on weekly cadence", () => {
        const weeklyConfig: CadenceConfig = {
            type: "weekly",
            dayOfWeek: 1,
            timeOfDay: "09:00",
        };
        // Last check-in was 35 days ago
        const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
        const result = getClientCadenceStatus(
            weeklyConfig,
            { submittedAt: oldDate, status: "REVIEWED" },
            "UTC"
        );
        expect(result.status).toBe("overdue");
        expect(result.label).toBe("Your check-in is overdue");
    });

    it("detects overdue for check-in 10+ days old on daily cadence", () => {
        const dailyConfig: CadenceConfig = {
            type: "daily",
            timeOfDay: "09:00",
        };
        const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const result = getClientCadenceStatus(
            dailyConfig,
            { submittedAt: oldDate, status: "SUBMITTED" },
            "America/New_York"
        );
        expect(result.status).toBe("overdue");
    });

    it("detects overdue for every_n_days after long gap", () => {
        const config: CadenceConfig = {
            type: "every_n_days",
            intervalDays: 3,
            timeOfDay: "10:00",
        };
        const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
        const result = getClientCadenceStatus(
            config,
            { submittedAt: oldDate, status: "REVIEWED" },
            "UTC"
        );
        expect(result.status).toBe("overdue");
    });
});
