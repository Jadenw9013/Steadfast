import { z } from "zod";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// ── Cadence types ────────────────────────────────────────────────────────────

export type CadenceType = "weekly" | "daily" | "every_n_days" | "every_n_hours";

export type WeeklyCadence = {
    type: "weekly";
    dayOfWeek: number; // 0=Sun..6=Sat
    timeOfDay: string; // "HH:MM"
};

export type DailyCadence = {
    type: "daily";
    timeOfDay: string;
};

export type EveryNDaysCadence = {
    type: "every_n_days";
    intervalDays: number; // >= 2
    timeOfDay: string;
};

export type EveryNHoursCadence = {
    type: "every_n_hours";
    intervalHours: number; // >= 2
};

export type CadenceConfig =
    | WeeklyCadence
    | DailyCadence
    | EveryNDaysCadence
    | EveryNHoursCadence;

// ── Zod schema ───────────────────────────────────────────────────────────────

const timeOfDayRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const weeklyCadenceSchema = z.object({
    type: z.literal("weekly"),
    dayOfWeek: z.number().int().min(0).max(6),
    timeOfDay: z.string().regex(timeOfDayRegex, "Must be HH:MM (24-hour)"),
});

const dailyCadenceSchema = z.object({
    type: z.literal("daily"),
    timeOfDay: z.string().regex(timeOfDayRegex, "Must be HH:MM (24-hour)"),
});

const everyNDaysCadenceSchema = z.object({
    type: z.literal("every_n_days"),
    intervalDays: z.number().int().min(2, "Interval must be at least 2 days"),
    timeOfDay: z.string().regex(timeOfDayRegex, "Must be HH:MM (24-hour)"),
});

const everyNHoursCadenceSchema = z.object({
    type: z.literal("every_n_hours"),
    intervalHours: z.number().int().min(2, "Interval must be at least 2 hours"),
});

export const cadenceConfigSchema = z.discriminatedUnion("type", [
    weeklyCadenceSchema,
    dailyCadenceSchema,
    everyNDaysCadenceSchema,
    everyNHoursCadenceSchema,
]);

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the effective cadence for a client.
 * Priority: client override → coach default → fallback weekly Monday 9 AM.
 */
export function getEffectiveCadence(
    coachConfig: CadenceConfig | null | undefined,
    clientOverride: CadenceConfig | null | undefined
): CadenceConfig {
    if (clientOverride) return clientOverride;
    if (coachConfig) return coachConfig;
    return { type: "weekly", dayOfWeek: 1, timeOfDay: "09:00" };
}

// ── Preview text ─────────────────────────────────────────────────────────────

const DAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

/**
 * Format a 24-hour time string to 12-hour display.
 * e.g. "09:00" → "9:00 AM", "14:30" → "2:30 PM"
 */
export function formatTime12h(time24: string): string {
    const [hStr, mStr] = time24.split(":");
    const h = parseInt(hStr, 10);
    const m = mStr;
    if (h === 0) return `12:${m} AM`;
    if (h < 12) return `${h}:${m} AM`;
    if (h === 12) return `12:${m} PM`;
    return `${h - 12}:${m} PM`;
}

/**
 * Get a human-readable preview of a cadence config.
 * Examples:
 *   "Every Friday at 9:00 AM"
 *   "Every day at 8:00 AM"
 *   "Every 3 days at 7:00 AM"
 *   "Every 2 hours"
 */
export function getCadencePreview(config: CadenceConfig): string {
    switch (config.type) {
        case "weekly":
            return `Every ${DAY_NAMES[config.dayOfWeek]} at ${formatTime12h(config.timeOfDay)}`;
        case "daily":
            return `Every day at ${formatTime12h(config.timeOfDay)}`;
        case "every_n_days":
            return `Every ${config.intervalDays} days at ${formatTime12h(config.timeOfDay)}`;
        case "every_n_hours":
            return `Every ${config.intervalHours} hours`;
    }
}

// ── Next due calculation ─────────────────────────────────────────────────────

/**
 * Calculate the next check-in due date for a given cadence config.
 *
 * @param config    - The active cadence configuration
 * @param anchor    - Reference point (last check-in time, or now if none)
 * @param tz        - Client timezone (e.g. "America/New_York")
 * @returns The next due date as a JS Date
 */
export function getNextDue(
    config: CadenceConfig,
    anchor: Date | null,
    tz: string
): Date {
    const now = dayjs().tz(tz);

    switch (config.type) {
        case "weekly": {
            const [hStr, mStr] = config.timeOfDay.split(":");
            const h = parseInt(hStr, 10);
            const m = parseInt(mStr, 10);

            // Start from today in client TZ
            let candidate = now.startOf("day").hour(h).minute(m).second(0);

            // Find the next occurrence of the target day
            const currentDay = now.day();
            const targetDay = config.dayOfWeek;
            let daysUntil = targetDay - currentDay;
            if (daysUntil < 0) daysUntil += 7;
            candidate = candidate.add(daysUntil, "day");

            // If that time has already passed today, move to next week
            if (candidate.isBefore(now)) {
                candidate = candidate.add(7, "day");
            }

            return candidate.toDate();
        }

        case "daily": {
            const [hStr, mStr] = config.timeOfDay.split(":");
            const h = parseInt(hStr, 10);
            const m = parseInt(mStr, 10);

            let candidate = now.startOf("day").hour(h).minute(m).second(0);
            if (candidate.isBefore(now)) {
                candidate = candidate.add(1, "day");
            }
            return candidate.toDate();
        }

        case "every_n_days": {
            const [hStr, mStr] = config.timeOfDay.split(":");
            const h = parseInt(hStr, 10);
            const m = parseInt(mStr, 10);

            if (!anchor) {
                // No prior check-in: next due is today (or tomorrow if past time)
                let candidate = now.startOf("day").hour(h).minute(m).second(0);
                if (candidate.isBefore(now)) {
                    candidate = candidate.add(1, "day");
                }
                return candidate.toDate();
            }

            const anchorLocal = dayjs(anchor).tz(tz);
            let candidate = anchorLocal
                .startOf("day")
                .add(config.intervalDays, "day")
                .hour(h)
                .minute(m)
                .second(0);

            // If the computed next due is in the past, step forward by intervals
            while (candidate.isBefore(now)) {
                candidate = candidate.add(config.intervalDays, "day");
            }

            return candidate.toDate();
        }

        case "every_n_hours": {
            if (!anchor) {
                // No prior check-in: due now
                return now.toDate();
            }

            const anchorLocal = dayjs(anchor).tz(tz);
            let candidate = anchorLocal.add(config.intervalHours, "hour");

            // If the computed next due is in the past, step forward by intervals
            while (candidate.isBefore(now)) {
                candidate = candidate.add(config.intervalHours, "hour");
            }

            return candidate.toDate();
        }
    }
}

// ── Legacy conversion ────────────────────────────────────────────────────────

/**
 * Convert legacy checkInDaysOfWeek array to a CadenceConfig.
 * Takes the first day in the array as the weekly day.
 * Used for backward-compatible display when cadenceConfig is null.
 */
export function cadenceFromLegacyDays(days: number[]): CadenceConfig {
    const sortedDays = [...days].sort((a, b) => a - b);
    const primaryDay = sortedDays[0] ?? 1;
    return { type: "weekly", dayOfWeek: primaryDay, timeOfDay: "09:00" };
}

// ── Cadence-aware status derivation ──────────────────────────────────────────

export type CadenceStatus = "due" | "overdue" | "upcoming" | "submitted" | "reviewed";

/**
 * Derive the cadence-aware workflow status for a client.
 *
 * @param config       - Effective cadence for this client
 * @param lastCheckIn  - Most recent check-in (null if none)
 * @param tz           - Client timezone
 * @returns status, nextDue date, and human-readable label
 */
export function getClientCadenceStatus(
    config: CadenceConfig,
    lastCheckIn: { submittedAt: Date; status: string } | null,
    tz: string
): { status: CadenceStatus; nextDue: Date; label: string } {
    const now = dayjs().tz(tz);

    // No check-in ever → compute first due date
    if (!lastCheckIn) {
        const nextDue = getNextDue(config, null, tz);
        const nextDueLocal = dayjs(nextDue).tz(tz);
        if (now.isAfter(nextDueLocal)) {
            return { status: "overdue", nextDue, label: "Your check-in is overdue" };
        }
        const graceMs = getDueGraceMs(config);
        if (nextDueLocal.diff(now, "millisecond") <= graceMs) {
            return { status: "due", nextDue, label: "Your check-in is due now" };
        }
        return { status: "upcoming", nextDue, label: formatNextDueLabel(nextDue, tz) };
    }

    // Determine the due date that the last check-in should satisfy
    // getNextDue always returns a future date (steps forward past now)
    const nextDue = getNextDue(config, lastCheckIn.submittedAt, tz);
    const nextDueLocal = dayjs(nextDue).tz(tz);
    const submittedLocal = dayjs(lastCheckIn.submittedAt).tz(tz);
    const intervalMs = getIntervalMs(config);

    // previousDue = the deadline that should have been met by now.
    // getNextDue() always returns a future date (steps forward past now),
    // so we subtract one interval to find the most recent past deadline.
    // If lastCheckIn doesn't cover this period and previousDue has passed → overdue.
    const previousDueLocal = nextDueLocal.subtract(intervalMs, "millisecond");

    // Was the last check-in submitted recently enough to cover the current period?
    // "Current period" = the window between previousDue and nextDue
    const isCurrentPeriodCovered = submittedLocal.isAfter(previousDueLocal);

    if (isCurrentPeriodCovered) {
        if (lastCheckIn.status === "REVIEWED") {
            return { status: "reviewed", nextDue, label: "Your coach reviewed your check-in" };
        }
        return { status: "submitted", nextDue, label: "Waiting for coach review" };
    }

    // Current period is NOT covered — did the previous due date already pass?
    if (previousDueLocal.isBefore(now)) {
        return { status: "overdue", nextDue, label: "Your check-in is overdue" };
    }

    // nextDue is in the future, check grace window
    const graceMs = getDueGraceMs(config);
    if (nextDueLocal.diff(now, "millisecond") <= graceMs) {
        return { status: "due", nextDue, label: "Your check-in is due now" };
    }
    return { status: "upcoming", nextDue, label: formatNextDueLabel(nextDue, tz) };
}

/**
 * Get a short coach-facing status label.
 */
export function getCoachStatusLabel(status: CadenceStatus): string {
    switch (status) {
        case "due": return "Due now";
        case "overdue": return "Overdue";
        case "upcoming": return "Upcoming";
        case "submitted": return "Submitted";
        case "reviewed": return "Reviewed";
    }
}

/** Grace window before due time where status transitions from "upcoming" to "due". */
function getDueGraceMs(config: CadenceConfig): number {
    switch (config.type) {
        case "every_n_hours": return 1 * 60 * 60 * 1000;   // 1 hour
        case "daily": return 2 * 60 * 60 * 1000;   // 2 hours
        case "every_n_days": return 6 * 60 * 60 * 1000;   // 6 hours
        case "weekly": return 12 * 60 * 60 * 1000;  // 12 hours
    }
}

/** Get the interval duration in ms for a cadence config. */
function getIntervalMs(config: CadenceConfig): number {
    switch (config.type) {
        case "weekly": return 7 * 24 * 60 * 60 * 1000;
        case "daily": return 24 * 60 * 60 * 1000;
        case "every_n_days": return config.intervalDays * 24 * 60 * 60 * 1000;
        case "every_n_hours": return config.intervalHours * 60 * 60 * 1000;
    }
}

/** Format next due as plain-English label. */
function formatNextDueLabel(nextDue: Date, tz: string): string {
    const d = dayjs(nextDue).tz(tz);
    const now = dayjs().tz(tz);

    if (d.isSame(now, "day")) {
        return `Next check-in due today at ${d.format("h:mm A")}`;
    }
    const tomorrow = now.add(1, "day");
    if (d.isSame(tomorrow, "day")) {
        return `Next check-in due tomorrow at ${d.format("h:mm A")}`;
    }
    return `Next check-in due ${d.format("ddd, MMM D")} at ${d.format("h:mm A")}`;
}

// ── JSON parse helper ────────────────────────────────────────────────────────

/**
 * Safely parse a JSON cadence config from a Prisma Json? field.
 * Returns null if the value is null/undefined or fails validation.
 */
export function parseCadenceConfig(
    value: unknown
): CadenceConfig | null {
    if (!value) return null;
    const result = cadenceConfigSchema.safeParse(value);
    return result.success ? result.data : null;
}
