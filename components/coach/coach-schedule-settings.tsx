"use client";

import { useState } from "react";
import { updateCoachSchedule } from "@/app/actions/notification-preferences";

const DAYS = [
    { index: 1, label: "Mon" },
    { index: 2, label: "Tue" },
    { index: 3, label: "Wed" },
    { index: 4, label: "Thu" },
    { index: 5, label: "Fri" },
    { index: 6, label: "Sat" },
    { index: 0, label: "Sun" },
];

const COMMON_TIMEZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "Pacific/Honolulu",
    "America/Anchorage",
    "America/Toronto",
    "America/Vancouver",
    "Europe/London",
    "Europe/Berlin",
    "Australia/Sydney",
];

export function CoachScheduleSettings({
    initialDays,
    initialTimezone,
}: {
    initialDays: number[];
    initialTimezone: string;
}) {
    const [selected, setSelected] = useState<number[]>(initialDays);
    const [timezone, setTimezone] = useState(initialTimezone);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

    const hasChanges =
        JSON.stringify([...selected].sort()) !== JSON.stringify([...initialDays].sort()) ||
        timezone !== initialTimezone;

    function toggleDay(dayIndex: number) {
        setFeedback(null);
        setSelected((prev) => {
            if (prev.includes(dayIndex)) {
                // Don't allow removing the last day
                if (prev.length <= 1) return prev;
                return prev.filter((d) => d !== dayIndex);
            }
            return [...prev, dayIndex];
        });
    }

    async function handleSave() {
        if (saving || !hasChanges) return;
        setSaving(true);
        setFeedback(null);
        try {
            await updateCoachSchedule({
                checkInDaysOfWeek: selected,
                timezone,
            });
            setFeedback({ success: true, message: "Schedule updated." });
        } catch (err: unknown) {
            setFeedback({
                success: false,
                message: err instanceof Error ? err.message : "Failed to save.",
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-4">
            {/* Day picker */}
            <div>
                <p className="mb-2 text-sm font-medium">Check-in due days</p>
                <div className="flex flex-wrap gap-2">
                    {DAYS.map((day) => {
                        const isActive = selected.includes(day.index);
                        return (
                            <button
                                key={day.index}
                                onClick={() => toggleDay(day.index)}
                                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${isActive
                                        ? "bg-zinc-900 text-white dark:bg-blue-600 dark:text-white"
                                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                                    }`}
                                aria-pressed={isActive}
                                type="button"
                            >
                                {day.label}
                            </button>
                        );
                    })}
                </div>
                <p className="mt-1.5 text-xs text-zinc-400">
                    Clients will be prompted to check in on these days. At least one day required.
                </p>
            </div>

            {/* Timezone */}
            <div>
                <label htmlFor="coach-tz" className="mb-1 block text-sm font-medium">
                    Timezone
                </label>
                <select
                    id="coach-tz"
                    value={timezone}
                    onChange={(e) => {
                        setTimezone(e.target.value);
                        setFeedback(null);
                    }}
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
                >
                    {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                            {tz.replace(/_/g, " ")}
                        </option>
                    ))}
                </select>
            </div>

            {/* Save + feedback */}
            <div className="flex items-center gap-3">
                <button
                    onClick={handleSave}
                    disabled={saving || !hasChanges}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-zinc-700 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
                >
                    {saving ? "Saving..." : "Save Schedule"}
                </button>

                {feedback && (
                    <p
                        className={`text-xs font-medium ${feedback.success
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                    >
                        {feedback.message}
                    </p>
                )}
            </div>
        </div>
    );
}
