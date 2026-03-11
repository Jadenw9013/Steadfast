"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrainingDayCard } from "./training-day-card";
import {
  saveTrainingProgram,
  publishTrainingProgram,
} from "@/app/actions/training-programs";
import type { TrainingDayGroup, TrainingBlock, BlockType } from "@/types/training";

type TemplateOption = {
  id: string;
  name: string;
  days: {
    dayName: string;
    blocks: { type: BlockType; title: string; content: string }[];
  }[];
};

// Cardio stored as a special day named "__CARDIO__" using the same pattern as templates
const CARDIO_DAY_NAME = "__CARDIO__";

function extractCardioFromDays(allDays: TrainingDayGroup[]) {
  const cardioDay = allDays.find((d) => d.dayName === CARDIO_DAY_NAME);
  const trainingDays = allDays.filter((d) => d.dayName !== CARDIO_DAY_NAME);

  if (cardioDay && cardioDay.blocks.length > 0) {
    const b = cardioDay.blocks[0];
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

type InitialProgram = {
  id: string;
  status: "DRAFT" | "PUBLISHED";
  templateSourceId: string | null;
  weeklyFrequency: number | null;
  clientNotes: string | null;
  injuries: string | null;
  equipment: string | null;
  days: {
    dayName: string;
    blocks: { type: BlockType; title: string; content: string }[];
  }[];
} | null;

type Mode = "empty" | "assign" | "edit";
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

function ProgramPreview({
  days,
  weeklyFrequency,
  clientNotes,
}: {
  days: TrainingDayGroup[];
  weeklyFrequency: string;
  clientNotes: string;
}) {
  return (
    <div className="space-y-3">
      {(weeklyFrequency || clientNotes) && (
        <div className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3 dark:border-zinc-800/80 dark:bg-[#0a1224]">
          {weeklyFrequency && (
            <p className="text-sm">
              <span className="font-semibold">{weeklyFrequency}×</span>{" "}
              <span className="text-zinc-500">per week</span>
            </p>
          )}
          {clientNotes && (
            <p className="mt-1 text-sm text-zinc-500">{clientNotes}</p>
          )}
        </div>
      )}
      {days.map((day, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-[#0a1224]"
        >
          <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">{day.dayName || `Day ${i + 1}`}</h3>
          </div>
          {day.blocks.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400">No blocks yet.</p>
          ) : (
            <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/60">
              {day.blocks.map((block, j) => (
                <div key={j} className="px-4 py-3">
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
      ))}
      {days.length === 0 && (
        <p className="py-6 text-center text-sm text-zinc-400">No training days added yet.</p>
      )}
    </div>
  );
}

export function TrainingProgramEditor({
  clientId,
  weekStartDate,
  initialProgram,
  templates = [],
}: {
  clientId: string;
  weekStartDate: string;
  initialProgram: InitialProgram;
  templates?: TemplateOption[];
}) {
  const router = useRouter();

  // Extract cardio from days on load
  const _extracted = (() => {
    if (!initialProgram) return { trainingDays: [] as TrainingDayGroup[], cardio: null };
    return extractCardioFromDays(
      initialProgram.days.map((d) => ({
        dayName: d.dayName,
        blocks: d.blocks.map((b) => ({
          type: b.type,
          title: b.title,
          content: b.content,
        })),
      }))
    );
  })();

  const [mode, setMode] = useState<Mode>(initialProgram ? "edit" : "empty");
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [programId, setProgramId] = useState<string | null>(initialProgram?.id ?? null);
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED" | null>(
    initialProgram?.status ?? null
  );
  const [days, setDays] = useState<TrainingDayGroup[]>(_extracted.trainingDays);

  // Assignment form fields
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    initialProgram?.templateSourceId ?? ""
  );
  const [weeklyFrequency, setWeeklyFrequency] = useState(
    initialProgram?.weeklyFrequency?.toString() ?? ""
  );
  const [injuries, setInjuries] = useState(initialProgram?.injuries ?? "");
  const [equipment, setEquipment] = useState(initialProgram?.equipment ?? "");
  const [clientNotes, setClientNotes] = useState(initialProgram?.clientNotes ?? "");

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cardio section
  const [showCardio, setShowCardio] = useState(!!_extracted.cardio);
  const [cardioModality, setCardioModality] = useState(_extracted.cardio?.modality ?? "");
  const [cardioFrequency, setCardioFrequency] = useState(_extracted.cardio?.frequency ?? "");
  const [cardioDuration, setCardioDuration] = useState(_extracted.cardio?.duration ?? "");
  const [cardioIntensity, setCardioIntensity] = useState(_extracted.cardio?.intensity ?? "");
  const [cardioNotes, setCardioNotes] = useState(_extracted.cardio?.notes ?? "");

  const activeTemplateName =
    templates.find((t) => t.id === (selectedTemplateId || initialProgram?.templateSourceId))
      ?.name ?? null;

  function addDay() {
    setDays((prev) => [...prev, { dayName: "", blocks: [] }]);
  }

  function removeDay(index: number) {
    setDays((prev) => prev.filter((_, i) => i !== index));
  }

  function updateDay(index: number, updated: TrainingDayGroup) {
    setDays((prev) => prev.map((d, i) => (i === index ? updated : d)));
  }

  function getDaysPayload(overrideDays?: TrainingDayGroup[]): TrainingDayGroup[] {
    const allDays = [...(overrideDays ?? days)];
    const hasCardioData = cardioModality || cardioFrequency || cardioDuration || cardioIntensity || cardioNotes;
    console.log("[getDaysPayload] showCardio:", showCardio, "hasCardioData:", hasCardioData, "modality:", cardioModality);
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
    console.log("[getDaysPayload] total days:", allDays.length, "names:", allDays.map(d => d.dayName));
    return allDays;
  }

  function buildPayload(overrideDays?: TrainingDayGroup[]) {
    const payload = {
      clientId,
      weekStartDate,
      days: getDaysPayload(overrideDays),
      weeklyFrequency: weeklyFrequency ? Number(weeklyFrequency) : undefined,
      clientNotes: clientNotes || undefined,
      injuries: injuries || undefined,
      equipment: equipment || undefined,
      templateSourceId: selectedTemplateId || undefined,
    };
    console.log("[buildPayload] days count:", payload.days.length);
    return payload;
  }

  function getTemplateDays(templateId: string): TrainingDayGroup[] {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return [];
    const allDays = tpl.days.map((d) => ({
      dayName: d.dayName,
      blocks: d.blocks.map((b) => ({
        type: b.type as BlockType,
        title: b.title,
        content: b.content,
      })),
    }));
    // Extract cardio from template and populate cardio state
    const { trainingDays, cardio } = extractCardioFromDays(allDays);
    if (cardio) {
      setShowCardio(true);
      setCardioModality(cardio.modality);
      setCardioFrequency(cardio.frequency);
      setCardioDuration(cardio.duration);
      setCardioIntensity(cardio.intensity);
      setCardioNotes(cardio.notes);
    } else {
      setShowCardio(false);
      setCardioModality("");
      setCardioFrequency("");
      setCardioDuration("");
      setCardioIntensity("");
      setCardioNotes("");
    }
    return trainingDays;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      let payloadDays = days;
      if (mode === "assign" && selectedTemplateId) {
        payloadDays = getTemplateDays(selectedTemplateId);
        setDays(payloadDays);
      }

      const result = await saveTrainingProgram(buildPayload(payloadDays));
      if ("error" in result) {
        setError("Save failed — check your inputs.");
      } else {
        setProgramId(result.programId);
        setStatus("DRAFT");
        setMode("edit");
        router.refresh();
      }
    } catch {
      setError("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      let payloadDays = days;
      if (mode === "assign" && selectedTemplateId) {
        payloadDays = getTemplateDays(selectedTemplateId);
        setDays(payloadDays);
      }

      // Always save the latest data (including cardio) before publishing
      const result = await saveTrainingProgram(buildPayload(payloadDays));
      if ("error" in result) {
        setError("Failed to save before publishing.");
        setPublishing(false);
        return;
      }
      const id = result.programId;
      setProgramId(id);

      await publishTrainingProgram({ programId: id });
      setStatus("PUBLISHED");
      setMode("edit");
      router.refresh();
    } catch {
      setError("Publish failed. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (mode === "empty") {
    return (
      <div className="rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-[#0a1224]">
        <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Training Plan</h2>
          <p className="mt-0.5 text-xs text-zinc-400">No training plan assigned yet</p>
        </div>
        <div className="px-5 py-6 space-y-3">
          <button
            type="button"
            onClick={() => setMode(templates.length > 0 ? "assign" : "edit")}
            className="w-full rounded-xl bg-zinc-900 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
          >
            {templates.length > 0 ? "Assign from Template" : "Create Training Plan"}
          </button>
          {templates.length > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setDays([]); setMode("edit"); }}
                className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Custom Plan
              </button>
              <Link
                href={`/coach/clients/${clientId}/import-training`}
                className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-center text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Import
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Assign state ─────────────────────────────────────────────────────────
  if (mode === "assign") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMode(programId ? "edit" : "empty")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Back"
          >
            &larr;
          </button>
          <h2 className="text-sm font-semibold">Assign Training Plan</h2>
        </div>

        <div className="rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-[#0a1224]">
          {/* Template picker — card list */}
          <div className="border-b border-zinc-100 dark:border-zinc-800">
            <p className="px-5 pt-4 pb-2 text-xs font-semibold text-zinc-500">
              Choose a template
            </p>
            {templates.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-zinc-400">
                No templates yet.{" "}
                <Link
                  href="/coach/templates"
                  className="font-semibold text-zinc-700 underline underline-offset-2 dark:text-zinc-300"
                >
                  Create one
                </Link>{" "}
                first.
              </p>
            ) : (
              <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/60">
                {templates.map((t) => {
                  const isSelected = selectedTemplateId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(t.id)}
                      aria-pressed={isSelected}
                      className={`w-full px-5 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 ${isSelected
                        ? "bg-zinc-50 dark:bg-zinc-900/50"
                        : "hover:bg-zinc-50/60 dark:hover:bg-zinc-900/30"
                        }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold">{t.name}</span>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-zinc-400">
                            {t.days.length} {t.days.length === 1 ? "day" : "days"}
                          </span>
                          {isSelected && (
                            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              ✓
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Client adjustments — only shown once a template is selected */}
          {selectedTemplateId && (
            <div className="px-5 py-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Client adjustments{" "}
                <span className="font-normal normal-case">(optional)</span>
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="assign-frequency" className="text-xs font-semibold text-zinc-500">
                    Days per week
                  </label>
                  <input
                    id="assign-frequency"
                    type="number"
                    min={1}
                    max={7}
                    value={weeklyFrequency}
                    onChange={(e) => setWeeklyFrequency(e.target.value)}
                    placeholder="e.g. 4"
                    className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="assign-injuries" className="text-xs font-semibold text-zinc-500">
                    Injuries / limitations
                  </label>
                  <input
                    id="assign-injuries"
                    type="text"
                    value={injuries}
                    onChange={(e) => setInjuries(e.target.value)}
                    placeholder="e.g. right shoulder"
                    className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="assign-equipment" className="text-xs font-semibold text-zinc-500">
                    Equipment
                  </label>
                  <input
                    id="assign-equipment"
                    type="text"
                    value={equipment}
                    onChange={(e) => setEquipment(e.target.value)}
                    placeholder="e.g. full gym, home dumbbells"
                    className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="assign-notes" className="text-xs font-semibold text-zinc-500">
                    Client notes
                  </label>
                  <input
                    id="assign-notes"
                    type="text"
                    value={clientNotes}
                    onChange={(e) => setClientNotes(e.target.value)}
                    placeholder="Anything the client should know"
                    className="rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs font-medium text-red-500" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!selectedTemplateId || saving || publishing}
            className="flex-1 rounded-xl border border-zinc-200 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {saving ? "Saving…" : "Save as Draft"}
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={!selectedTemplateId || saving || publishing}
            className="flex-1 rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
          >
            {publishing ? "Publishing…" : "Assign & Publish"}
          </button>
        </div>
      </div>
    );
  }

  // ── Edit state ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold">Training Plan</h2>
          {status && (
            <span
              aria-live="polite"
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status === "PUBLISHED"
                ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                }`}
            >
              {status === "PUBLISHED" ? "Published" : "Draft"}
            </span>
          )}
          {activeTemplateName && (
            <span className="hidden text-xs text-zinc-400 sm:inline">{activeTemplateName}</span>
          )}
        </div>
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
          {templates.length > 0 && (
            <button
              type="button"
              onClick={() => setMode("assign")}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              Change Template
            </button>
          )}
          {/* Top save/publish */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || publishing}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={saving || publishing}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
          >
            {publishing ? "Publishing…" : status === "PUBLISHED" ? "Republish" : "Publish"}
          </button>
        </div>
      </div>

      {/* Preview mode */}
      {viewMode === "preview" ? (
        <ProgramPreview
          days={days}
          weeklyFrequency={weeklyFrequency}
          clientNotes={clientNotes}
        />
      ) : (
        <>
          {/* Cardio section — collapsible */}
          {!showCardio ? (
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
          )}

          {/* Training Days */}
          <div className="rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-[#0a1224]">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Training Days
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
                  <p className="text-sm text-zinc-400">No training days yet.</p>
                  <button
                    type="button"
                    onClick={addDay}
                    className="mt-3 text-sm font-semibold text-zinc-900 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:text-zinc-100"
                  >
                    Add a day to start
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
        </>
      )}



      {/* Actions */}
      {error && (
        <p className="text-xs font-medium text-red-500" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || publishing}
          className="flex-1 rounded-xl border border-zinc-200 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {saving ? "Saving…" : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={saving || publishing}
          className="flex-1 rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
        >
          {publishing ? "Publishing…" : status === "PUBLISHED" ? "Republish" : "Publish"}
        </button>
      </div>
    </div>
  );
}
