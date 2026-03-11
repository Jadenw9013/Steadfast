"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TrainingDayCard } from "./training-day-card";
import {
  saveTrainingTemplate,
  deleteTrainingTemplate,
} from "@/app/actions/training-templates";
import type { TrainingDayGroup, BlockType } from "@/types/training";

type InitialTemplate = {
  id: string;
  name: string;
  description: string | null;
  days: {
    dayName: string;
    blocks: { type: BlockType; title: string; content: string }[];
  }[];
};

type ViewMode = "editor" | "preview";

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  EXERCISE: "Exercise",
  ACTIVATION: "Activation",
  INSTRUCTION: "Instruction",
  SUPERSET: "Superset",
  CARDIO: "Cardio",
  OPTIONAL: "Optional",
};

const BLOCK_TYPE_BADGE: Record<BlockType, string> = {
  EXERCISE: "",
  ACTIVATION: "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  INSTRUCTION: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  SUPERSET: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  CARDIO: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  OPTIONAL: "bg-zinc-50 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400",
};

// Cardio is stored as a special day named "__CARDIO__" in the template
const CARDIO_DAY_NAME = "__CARDIO__";

function extractCardioDayFromDays(days: TrainingDayGroup[]) {
  const cardioDay = days.find((d) => d.dayName === CARDIO_DAY_NAME);
  const trainingDays = days.filter((d) => d.dayName !== CARDIO_DAY_NAME);

  if (cardioDay && cardioDay.blocks.length > 0) {
    const b = cardioDay.blocks[0];
    // Parse "modality|frequency|duration|intensity" from title, notes from content
    const parts = b.title.split("|");
    return {
      trainingDays,
      cardio: {
        modality: parts[0] ?? "",
        frequency: parts[1] ?? "",
        duration: parts[2] ?? "",
        intensity: parts[3] ?? "",
        notes: b.content,
      },
    };
  }
  return { trainingDays, cardio: null };
}

function buildCardioDayBlock(cardio: {
  modality: string;
  frequency: string;
  duration: string;
  intensity: string;
  notes: string;
}): TrainingDayGroup {
  return {
    dayName: CARDIO_DAY_NAME,
    blocks: [
      {
        type: "CARDIO" as BlockType,
        title: `${cardio.modality}|${cardio.frequency}|${cardio.duration}|${cardio.intensity}`,
        content: cardio.notes,
      },
    ],
  };
}

export function TemplateEditor({
  initialTemplate,
}: {
  initialTemplate: InitialTemplate;
}) {
  const router = useRouter();

  // Separate cardio from regular training days on load
  const extracted = extractCardioDayFromDays(
    initialTemplate.days.map((d) => ({
      dayName: d.dayName,
      blocks: d.blocks.map((b) => ({
        type: b.type,
        title: b.title,
        content: b.content,
      })),
    }))
  );

  const [name, setName] = useState(initialTemplate.name);
  const [description, setDescription] = useState(initialTemplate.description ?? "");
  const [days, setDays] = useState<TrainingDayGroup[]>(extracted.trainingDays);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cardio section
  const [showCardio, setShowCardio] = useState(!!extracted.cardio);
  const [cardioModality, setCardioModality] = useState(extracted.cardio?.modality ?? "");
  const [cardioFrequency, setCardioFrequency] = useState(extracted.cardio?.frequency ?? "");
  const [cardioDuration, setCardioDuration] = useState(extracted.cardio?.duration ?? "");
  const [cardioIntensity, setCardioIntensity] = useState(extracted.cardio?.intensity ?? "");
  const [cardioNotes, setCardioNotes] = useState(extracted.cardio?.notes ?? "");

  function addDay() {
    setDays((prev) => [...prev, { dayName: "", blocks: [] }]);
  }

  function removeDay(index: number) {
    setDays((prev) => prev.filter((_, i) => i !== index));
  }

  function updateDay(index: number, updated: TrainingDayGroup) {
    setDays((prev) => prev.map((d, i) => (i === index ? updated : d)));
  }

  function getDaysPayload(): TrainingDayGroup[] {
    const allDays = [...days];
    // Append cardio as a special hidden day if filled
    const hasCardioData = cardioModality || cardioFrequency || cardioDuration || cardioIntensity || cardioNotes;
    if (showCardio && hasCardioData) {
      allDays.push(
        buildCardioDayBlock({
          modality: cardioModality,
          frequency: cardioFrequency,
          duration: cardioDuration,
          intensity: cardioIntensity,
          notes: cardioNotes,
        })
      );
    }
    return allDays;
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Template name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await saveTrainingTemplate({
        templateId: initialTemplate.id,
        name: name.trim(),
        description: description.trim() || undefined,
        days: getDaysPayload(),
      });
      if ("error" in result) {
        setError("Save failed — check your inputs.");
      } else {
        router.refresh();
      }
    } catch {
      setError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this template? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await deleteTrainingTemplate({ templateId: initialTemplate.id });
      router.push("/coach/templates");
    } catch {
      setError("Delete failed. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Template metadata + top save */}
      <div className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 dark:border-zinc-800/80 dark:bg-[#0a1224]">
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="template-name" className="text-xs font-semibold text-zinc-500">
              Template name
            </label>
            <input
              id="template-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 4-Day Upper/Lower Split"
              className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="template-description" className="text-xs font-semibold text-zinc-500">
              Description{" "}
              <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <input
              id="template-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Who is this template for?"
              className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700"
            />
          </div>
          {/* Top save bar */}
          <div className="flex items-center justify-end gap-3 pt-1">
            {error && (
              <p className="text-xs font-medium text-red-500" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || deleting}
              className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
            >
              {saving ? "Saving…" : "Save template"}
            </button>
          </div>
        </div>
      </div>

      {/* Cardio section — collapsible */}
      {viewMode === "editor" && (
        !showCardio ? (
          <button
            type="button"
            onClick={() => setShowCardio(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-green-300 py-4 text-sm font-semibold text-green-700 transition-colors hover:border-green-400 hover:bg-green-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:border-green-800 dark:text-green-400 dark:hover:border-green-700 dark:hover:bg-green-900/20"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Cardio
          </button>
        ) : (
          <div className="rounded-2xl border-2 border-green-200 bg-white dark:border-green-900/60 dark:bg-[#0a1224]">
            <div className="flex items-center justify-between border-b border-green-100 px-5 py-3 dark:border-green-900/40">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-300">
                Cardio Prescription
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowCardio(false);
                  setCardioModality("");
                  setCardioFrequency("");
                  setCardioDuration("");
                  setCardioIntensity("");
                  setCardioNotes("");
                }}
                className="rounded-lg px-2 py-1 text-[11px] font-semibold text-red-500 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20"
              >
                Remove
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cardio-modality" className="text-xs font-semibold text-zinc-500">
                    Type / Machine
                  </label>
                  <input
                    id="cardio-modality"
                    type="text"
                    value={cardioModality}
                    onChange={(e) => setCardioModality(e.target.value)}
                    placeholder="e.g. Stairmaster, Incline walk"
                    className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:border-zinc-700"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cardio-frequency" className="text-xs font-semibold text-zinc-500">
                    Frequency
                  </label>
                  <input
                    id="cardio-frequency"
                    type="text"
                    value={cardioFrequency}
                    onChange={(e) => setCardioFrequency(e.target.value)}
                    placeholder="e.g. 5 days/week"
                    className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:border-zinc-700"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cardio-duration" className="text-xs font-semibold text-zinc-500">
                    Duration
                  </label>
                  <input
                    id="cardio-duration"
                    type="text"
                    value={cardioDuration}
                    onChange={(e) => setCardioDuration(e.target.value)}
                    placeholder="e.g. 30 min"
                    className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:border-zinc-700"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cardio-intensity" className="text-xs font-semibold text-zinc-500">
                    Intensity
                  </label>
                  <input
                    id="cardio-intensity"
                    type="text"
                    value={cardioIntensity}
                    onChange={(e) => setCardioIntensity(e.target.value)}
                    placeholder="e.g. Level 5, Zone 2"
                    className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:border-zinc-700"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cardio-notes" className="text-xs font-semibold text-zinc-500">
                  Notes
                </label>
                <textarea
                  id="cardio-notes"
                  value={cardioNotes}
                  onChange={(e) => setCardioNotes(e.target.value)}
                  placeholder="Any additional cardio instructions"
                  rows={2}
                  className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 dark:border-zinc-700"
                />
              </div>
            </div>
          </div>
        )
      )}

      {/* Training days */}
      <div className="rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-[#0a1224]">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Training Days</h2>
          <div className="flex items-center gap-2">
            {/* Editor / Preview toggle */}
            <div className="flex rounded-lg border border-zinc-200 p-0.5 text-xs dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setViewMode("editor")}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${viewMode === "editor"
                  ? "bg-zinc-900 text-white dark:bg-blue-600 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
              >
                Editor
              </button>
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 ${viewMode === "preview"
                  ? "bg-zinc-900 text-white dark:bg-blue-600 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
              >
                Preview
              </button>
            </div>
            {viewMode === "editor" && (
              <button
                type="button"
                onClick={addDay}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                + Add Day
              </button>
            )}
          </div>
        </div>

        {viewMode === "preview" ? (
          /* Preview */
          <div className="space-y-0 divide-y divide-zinc-100/80 dark:divide-zinc-800/60">
            {days.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm text-zinc-400">No training days yet.</p>
              </div>
            ) : (
              days.map((day, i) => (
                <div key={i} className="px-5 py-4">
                  <h3 className="mb-2 text-sm font-semibold">{day.dayName || `Day ${i + 1}`}</h3>
                  {day.blocks.length === 0 ? (
                    <p className="text-sm text-zinc-400">No blocks.</p>
                  ) : (
                    <div className="space-y-2">
                      {day.blocks.map((block, j) => (
                        <div key={j}>
                          <div className="flex items-baseline gap-2">
                            {block.type !== "EXERCISE" && (
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${BLOCK_TYPE_BADGE[block.type]}`}
                              >
                                {BLOCK_TYPE_LABELS[block.type]}
                              </span>
                            )}
                            {block.title && (
                              <span className="text-sm font-medium">{block.title}</span>
                            )}
                          </div>
                          {block.content && (
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                              {block.content}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          /* Editor */
          <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/60">
            {days.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm text-zinc-400">No training days yet.</p>
                <button
                  type="button"
                  onClick={addDay}
                  className="mt-3 text-sm font-semibold text-zinc-900 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:text-zinc-100"
                >
                  Add your first day
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
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || saving}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950/30"
        >
          {deleting ? "Deleting…" : "Delete template"}
        </button>

        <div className="flex items-center gap-3">
          {error && (
            <p className="text-xs font-medium text-red-500" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || deleting}
            className="rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
          >
            {saving ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </div>
  );
}
