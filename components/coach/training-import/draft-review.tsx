"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TrainingDayCard } from "@/components/coach/training/training-day-card";
import type { TrainingDayGroup, BlockType } from "@/types/training";

type DestinationMode = "template" | "client";

type DraftData = {
  draftId: string;
  importId: string;
  parsedJson: {
    name: string;
    notes?: string;
    days: {
      dayName: string;
      blocks: { type: string; title: string; content: string }[];
    }[];
  };
  filename: string | null;
  clientId: string | null;
};

function parseDays(raw: DraftData["parsedJson"]["days"]): TrainingDayGroup[] {
  return raw.map((d) => ({
    dayName: d.dayName,
    blocks: d.blocks.map((b) => ({
      type: b.type as BlockType,
      title: b.title,
      content: b.content,
    })),
  }));
}

export function WorkoutDraftReview({
  importId,
  clientId,
  onBack,
}: {
  importId: string;
  clientId?: string;
  onBack: () => void;
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string>("");

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [days, setDays] = useState<TrainingDayGroup[]>([]);

  const [destination, setDestination] = useState<DestinationMode>("template");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDraft() {
      try {
        const res = await fetch(`/api/workout-import/draft?importId=${importId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load draft");
        }
        const data: DraftData = await res.json();
        setDraftId(data.draftId);
        setName(data.parsedJson.name || "Imported Workout Plan");
        setNotes(data.parsedJson.notes || "");
        setDays(parseDays(data.parsedJson.days));
        // If the import has a client context, default to client mode
        if (data.clientId) setDestination("client");
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Failed to load draft");
      } finally {
        setLoading(false);
      }
    }
    fetchDraft();
  }, [importId]);

  function addDay() {
    setDays((prev) => [...prev, { dayName: "", blocks: [] }]);
  }

  function removeDay(index: number) {
    setDays((prev) => prev.filter((_, i) => i !== index));
  }

  function updateDay(index: number, updated: TrainingDayGroup) {
    setDays((prev) => prev.map((d, i) => (i === index ? updated : d)));
  }

  function buildPayload() {
    return {
      draftId,
      parsedJson: { name, notes, days },
      saveAsTemplate: destination === "template",
      clientId: destination === "client" ? clientId : undefined,
      publish: false, // never auto-publish
    };
  }

  async function handleSave() {
    if (!name.trim()) {
      setSaveError("Program name is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch("/api/workout-import/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");

      if (data.mode === "template") {
        router.push(`/coach/templates/${data.templateId}`);
      } else {
        router.push(`/coach/clients/${data.clientId}/review/${data.weekStartDate}`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed. Please try again.");
      setSaving(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white px-6 py-8 dark:border-zinc-800/80 dark:bg-[#0a1224]">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        <p className="text-sm text-zinc-500">Loading parsed workout…</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 dark:border-red-900 dark:bg-red-950/50"
        >
          <p className="font-medium text-red-700 dark:text-red-400">Failed to load parsed workout</p>
          <p className="mt-1 text-sm text-red-600 dark:text-red-400/80">{fetchError}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          &larr; Back
        </button>
      </div>
    );
  }

  // ── Review UI ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label="Back"
        >
          &larr;
        </button>
        <div>
          <h2 className="text-base font-bold">Review Parsed Workout</h2>
          <p className="text-xs text-zinc-500">
            Review and edit before saving. Nothing is saved until you confirm.
          </p>
        </div>
      </div>

      {/* Program name + notes */}
      <div className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 dark:border-zinc-800/80 dark:bg-[#0a1224]">
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-name" className="text-xs font-semibold text-zinc-500">
              Program name
            </label>
            <input
              id="import-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 4-Week Hypertrophy Block"
              className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-notes" className="text-xs font-semibold text-zinc-500">
              Program notes{" "}
              <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <textarea
              id="import-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="General notes, coaching context, or instructions…"
              rows={3}
              className="w-full resize-y rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm leading-relaxed placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700"
            />
          </div>
        </div>
      </div>

      {/* Training days */}
      <div className="rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-[#0a1224]">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Training Days
            <span className="ml-2 font-normal normal-case text-zinc-400">
              — edit names, types, or content
            </span>
          </h3>
          <button
            type="button"
            onClick={addDay}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            + Add Day
          </button>
        </div>

        <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/60">
          {days.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-zinc-400">No training days parsed.</p>
              <button
                type="button"
                onClick={addDay}
                className="mt-3 text-sm font-semibold text-zinc-900 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:text-zinc-100"
              >
                Add a day manually
              </button>
            </div>
          ) : (
            days.map((day, i) => (
              <TrainingDayCard
                key={i}
                day={day}
                index={i}
                onChange={(updated) => updateDay(i, updated)}
                onRemove={() => removeDay(i)}
              />
            ))
          )}
        </div>
      </div>

      {/* Destination */}
      {clientId && (
        <div className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 dark:border-zinc-800/80 dark:bg-[#0a1224]">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Save as
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setDestination("template")}
              className={`flex-1 rounded-xl border py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${
                destination === "template"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-blue-600 dark:text-white"
                  : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              Reusable Template
            </button>
            <button
              type="button"
              onClick={() => setDestination("client")}
              className={`flex-1 rounded-xl border py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${
                destination === "client"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-blue-600 dark:text-white"
                  : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              Client Draft
            </button>
          </div>
          {destination === "client" && (
            <p className="mt-2 text-xs text-zinc-400">
              Saved as a draft for this client&apos;s current week. You can publish from the review workspace.
            </p>
          )}
          {destination === "template" && (
            <p className="mt-2 text-xs text-zinc-400">
              Saved as a reusable template you can assign to any client.
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {saveError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950/50"
        >
          <p className="font-medium text-red-700 dark:text-red-400">Save failed</p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-400/80">{saveError}</p>
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-400">
          {destination === "template"
            ? "Will be saved as a reusable training template."
            : "Will be saved as a draft — not visible to the client until published."}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
        >
          {saving
            ? "Saving…"
            : destination === "template"
              ? "Save as Template"
              : "Save as Client Draft"}
        </button>
      </div>
    </div>
  );
}
