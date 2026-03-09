"use client";

import { useState, useTransition } from "react";
import { updateCoachCadence, updateClientCadenceOverride } from "@/app/actions/notification-preferences";
import { getCadencePreview, formatTime12h } from "@/lib/scheduling/cadence";
import type { CadenceConfig, CadenceType } from "@/lib/scheduling/cadence";

const CADENCE_TYPES: { value: CadenceType; label: string }[] = [
    { value: "weekly", label: "Weekly" },
    { value: "daily", label: "Daily" },
    { value: "every_n_days", label: "Every N days" },
    { value: "every_n_hours", label: "Every N hours" },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIME_OPTIONS = Array.from({ length: 24 }, (_, i) => {
    const h = i.toString().padStart(2, "0");
    return { value: `${h}:00`, label: formatTime12h(`${h}:00`) };
});



function buildConfig(
    type: CadenceType,
    dayOfWeek: number,
    timeOfDay: string,
    intervalDays: number,
    intervalHours: number
): CadenceConfig {
    switch (type) {
        case "weekly":
            return { type: "weekly", dayOfWeek, timeOfDay };
        case "daily":
            return { type: "daily", timeOfDay };
        case "every_n_days":
            return { type: "every_n_days", intervalDays, timeOfDay };
        case "every_n_hours":
            return { type: "every_n_hours", intervalHours };
    }
}

export function CadenceEditor({
    mode,
    clientId,
    initialConfig,
    coachConfig,
}: {
    mode: "coach" | "client";
    clientId?: string;
    initialConfig: CadenceConfig | null;
    coachConfig?: CadenceConfig | null;
}) {
    const effectiveInitial = initialConfig ?? coachConfig ?? {
        type: "weekly" as const,
        dayOfWeek: 1,
        timeOfDay: "09:00",
    };

    const hasOverride = mode === "client" && initialConfig !== null;
    const [editing, setEditing] = useState(false);
    const [cadenceType, setCadenceType] = useState<CadenceType>(effectiveInitial.type);
    const [dayOfWeek, setDayOfWeek] = useState(
        effectiveInitial.type === "weekly" ? effectiveInitial.dayOfWeek : 1
    );
    const [timeOfDay, setTimeOfDay] = useState(
        "timeOfDay" in effectiveInitial ? effectiveInitial.timeOfDay : "09:00"
    );
    const [intervalDays, setIntervalDays] = useState(
        effectiveInitial.type === "every_n_days" ? effectiveInitial.intervalDays : 2
    );
    const [intervalHours, setIntervalHours] = useState(
        effectiveInitial.type === "every_n_hours" ? effectiveInitial.intervalHours : 2
    );
    const [isPending, startTransition] = useTransition();

    const currentConfig = buildConfig(cadenceType, dayOfWeek, timeOfDay, intervalDays, intervalHours);
    const previewText = getCadencePreview(currentConfig);

    function handleSave() {
        startTransition(async () => {
            if (mode === "coach") {
                await updateCoachCadence({ cadenceConfig: currentConfig });
            } else if (clientId) {
                await updateClientCadenceOverride({ clientId, cadenceConfig: currentConfig });
            }
            setEditing(false);
        });
    }

    function handleReset() {
        if (mode !== "client" || !clientId) return;
        startTransition(async () => {
            await updateClientCadenceOverride({ clientId, cadenceConfig: null });
            // Reset local state to coach default
            const fallback = coachConfig ?? { type: "weekly" as const, dayOfWeek: 1, timeOfDay: "09:00" };
            setCadenceType(fallback.type);
            if (fallback.type === "weekly") setDayOfWeek(fallback.dayOfWeek);
            if ("timeOfDay" in fallback) setTimeOfDay(fallback.timeOfDay);
            if (fallback.type === "every_n_days") setIntervalDays(fallback.intervalDays);
            if (fallback.type === "every_n_hours") setIntervalHours(fallback.intervalHours);
            setEditing(false);
        });
    }

    // ── Read-only display ──────────────────────────────────────────────────────

    if (!editing) {
        const displayConfig = initialConfig ?? coachConfig ?? currentConfig;
        const displayPreview = getCadencePreview(displayConfig);

        return (
            <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                        {displayPreview}
                    </span>
                    {mode === "client" && !hasOverride && (
                        <span className="text-xs text-zinc-400">(coach default)</span>
                    )}
                    {mode === "client" && hasOverride && (
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Custom</span>
                    )}
                </div>
                <button
                    onClick={() => setEditing(true)}
                    className="text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                    {mode === "coach" ? "Edit" : "Customize"}
                </button>
            </div>
        );
    }

    // ── Editor ─────────────────────────────────────────────────────────────────

    return (
        <div className="space-y-4">
            {/* Cadence type selector */}
            <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                    Cadence
                </label>
                <div className="flex flex-wrap gap-1.5">
                    {CADENCE_TYPES.map((ct) => (
                        <button
                            key={ct.value}
                            onClick={() => setCadenceType(ct.value)}
                            aria-pressed={cadenceType === ct.value}
                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${cadenceType === ct.value
                                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                                }`}
                        >
                            {ct.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Conditional fields */}
            <div className="flex flex-wrap items-end gap-3">
                {cadenceType === "weekly" && (
                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-zinc-500">
                            Day
                        </label>
                        <div className="flex flex-wrap gap-1">
                            {DAY_NAMES.map((name, i) => (
                                <button
                                    key={i}
                                    onClick={() => setDayOfWeek(i)}
                                    aria-pressed={dayOfWeek === i}
                                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${dayOfWeek === i
                                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                                        }`}
                                >
                                    {name}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {cadenceType === "every_n_days" && (
                    <div>
                        <label htmlFor="cadence-interval-days" className="mb-1.5 block text-xs font-medium text-zinc-500">
                            Every
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                id="cadence-interval-days"
                                type="number"
                                min={2}
                                max={90}
                                value={intervalDays}
                                onChange={(e) => setIntervalDays(Math.max(2, parseInt(e.target.value) || 2))}
                                className="w-16 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                            />
                            <span className="text-xs text-zinc-500">days</span>
                        </div>
                    </div>
                )}

                {cadenceType === "every_n_hours" && (
                    <div>
                        <label htmlFor="cadence-interval-hours" className="mb-1.5 block text-xs font-medium text-zinc-500">
                            Every
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                id="cadence-interval-hours"
                                type="number"
                                min={2}
                                max={23}
                                value={intervalHours}
                                onChange={(e) => setIntervalHours(Math.max(2, parseInt(e.target.value) || 2))}
                                className="w-16 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                            />
                            <span className="text-xs text-zinc-500">hours</span>
                        </div>
                    </div>
                )}

                {cadenceType !== "every_n_hours" && (
                    <div>
                        <label htmlFor="cadence-time" className="mb-1.5 block text-xs font-medium text-zinc-500">
                            Time
                        </label>
                        <select
                            id="cadence-time"
                            value={timeOfDay}
                            onChange={(e) => setTimeOfDay(e.target.value)}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                        >
                            {TIME_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* Preview */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/50">
                <p className="text-xs text-zinc-500">Preview</p>
                <p className="text-sm font-medium">{previewText}</p>
            </div>

            {/* Scope explanation */}
            {mode === "coach" && (
                <p className="text-xs text-zinc-400">
                    This schedule applies to all clients unless overridden per-client.
                </p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
                <button
                    onClick={handleSave}
                    disabled={isPending}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                    {isPending ? "Saving..." : "Save"}
                </button>
                {mode === "client" && hasOverride && (
                    <button
                        onClick={handleReset}
                        disabled={isPending}
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                        Reset to default
                    </button>
                )}
                <button
                    onClick={() => {
                        // Reset to initial values
                        setCadenceType(effectiveInitial.type);
                        if (effectiveInitial.type === "weekly") setDayOfWeek(effectiveInitial.dayOfWeek);
                        if ("timeOfDay" in effectiveInitial) setTimeOfDay(effectiveInitial.timeOfDay);
                        if (effectiveInitial.type === "every_n_days") setIntervalDays(effectiveInitial.intervalDays);
                        if (effectiveInitial.type === "every_n_hours") setIntervalHours(effectiveInitial.intervalHours);
                        setEditing(false);
                    }}
                    className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
