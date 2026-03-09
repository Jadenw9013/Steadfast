"use client";

import { useState, useTransition } from "react";
import { updateClientScheduleOverride } from "@/app/actions/notification-preferences";
import { CadenceEditor } from "@/components/coach/cadence-editor";
import { getCadencePreview } from "@/lib/scheduling/cadence";
import type { CadenceConfig } from "@/lib/scheduling/cadence";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ClientSchedule({
  clientId,
  coachDays,
  clientOverride,
  effectiveDays,
  coachCadence,
  clientCadenceOverride,
}: {
  clientId: string;
  coachDays: number[];
  clientOverride: number[];
  effectiveDays: number[];
  coachCadence: CadenceConfig | null;
  clientCadenceOverride: CadenceConfig | null;
}) {
  // If cadence configs are available, use the new CadenceEditor
  if (coachCadence) {
    return (
      <CadenceEditor
        mode="client"
        clientId={clientId}
        initialConfig={clientCadenceOverride}
        coachConfig={coachCadence}
      />
    );
  }

  // Fallback: legacy day-of-week picker for backwards compatibility
  return (
    <LegacyDayPicker
      clientId={clientId}
      coachDays={coachDays}
      clientOverride={clientOverride}
      effectiveDays={effectiveDays}
    />
  );
}

// ── Legacy day-of-week picker (preserved for backward compat) ────────────────

function LegacyDayPicker({
  clientId,
  coachDays,
  clientOverride,
  effectiveDays,
}: {
  clientId: string;
  coachDays: number[];
  clientOverride: number[];
  effectiveDays: number[];
}) {
  const hasOverride = clientOverride.length > 0;
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number[]>(
    hasOverride ? clientOverride : coachDays
  );
  const [isPending, startTransition] = useTransition();

  function toggleDay(day: number) {
    setSelected((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  function handleSave() {
    startTransition(async () => {
      await updateClientScheduleOverride({
        clientId,
        checkInDaysOfWeek: selected,
      });
      setEditing(false);
    });
  }

  function handleReset() {
    startTransition(async () => {
      await updateClientScheduleOverride({
        clientId,
        checkInDaysOfWeek: [],
      });
      setSelected(coachDays);
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {DAY_LABELS.map((label, i) => (
          <span
            key={i}
            className={`rounded-md px-2 py-1 text-xs font-medium ${effectiveDays.includes(i)
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
              }`}
          >
            {label}
          </span>
        ))}
        {!hasOverride && (
          <span className="text-xs text-zinc-400">(default)</span>
        )}
        <button
          onClick={() => setEditing(true)}
          className="ml-1 text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Customize
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {DAY_LABELS.map((label, i) => (
          <button
            key={i}
            onClick={() => toggleDay(i)}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${selected.includes(i)
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={isPending || selected.length === 0}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        {hasOverride && (
          <button
            onClick={handleReset}
            disabled={isPending}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Reset to default
          </button>
        )}
        <button
          onClick={() => {
            setSelected(hasOverride ? clientOverride : coachDays);
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
