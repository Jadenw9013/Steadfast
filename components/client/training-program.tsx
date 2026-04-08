"use client";

import { useState, useTransition, useRef } from "react";
import type { BlockType } from "@/app/generated/prisma/enums";
import { toggleExerciseCheckoff } from "@/app/actions/adherence";
import { saveExerciseResult, deleteExerciseResult, clearExerciseHistory } from "@/app/actions/exercise-results";

type TrainingBlock = {
  id: string;
  type: BlockType;
  title: string;
  content: string;
  sortOrder: number;
};

type TrainingDay = {
  id: string;
  dayName: string;
  blocks: TrainingBlock[];
};

type TrainingProgramData = {
  publishedAt: Date | null;
  weeklyFrequency: number | null;
  clientNotes: string | null;
  days: TrainingDay[];
};

type ExerciseCheckoffData = {
  dayLabel: string;
  exerciseName: string;
  exerciseOrder: number;
  completed: boolean;
};

type WorkoutAdherenceProps = {
  date: string; // YYYY-MM-DD
  exercises: ExerciseCheckoffData[];
};

type ExerciseResultData = {
  id: string;
  exerciseName: string;
  programDay: string;
  weight: number;
  reps: number;
  createdAt: string;
};

type ExerciseProgressProps = {
  /** Map key: "programDay::exerciseName::setNumber" */
  currentWeek: Record<string, ExerciseResultData>;
  previousWeek: Record<string, ExerciseResultData>;
};

const BLOCK_TYPE_LABELS: Partial<Record<BlockType, string>> = {
  ACTIVATION: "Activation",
  INSTRUCTION: "Note",
  SUPERSET: "Superset",
  CARDIO: "Cardio",
  OPTIONAL: "Optional",
};

const BLOCK_TYPE_BADGE: Partial<Record<BlockType, string>> = {
  ACTIVATION: "bg-yellow-900/30 text-yellow-300",
  INSTRUCTION: "bg-zinc-800 text-zinc-300",
  SUPERSET: "bg-purple-900/30 text-purple-300",
  CARDIO: "bg-green-900/30 text-green-300",
  OPTIONAL: "bg-zinc-800/60 text-zinc-400",
};

/** Types that represent exercises (have sets/reps) rather than instructions */
const EXERCISE_TYPES = new Set<string>(["EXERCISE", "SUPERSET", "CARDIO", "ACTIVATION"]);

function parseExerciseContent(content: string) {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  const equipment: string[] = [];
  const details: string[] = [];
  const notes: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes("machine") ||
      lower.includes("dumbell") ||
      lower.includes("dumbbell") ||
      lower.includes("barbell") ||
      lower.includes("cable") ||
      lower.includes("band") ||
      lower.includes("bodyweight")
    ) {
      equipment.push(line);
    } else if (
      lower.includes("set") ||
      lower.includes("rep") ||
      lower.includes("×") ||
      lower.includes("x ") ||
      lower.match(/^\d/)
    ) {
      details.push(line);
    } else {
      notes.push(line);
    }
  }

  return { equipment, details, notes };
}

/** Parse the number of sets from a plan detail string like "3 sets × 5–8 reps" or "2 working sets × 6–8 reps" */
function parseSetCount(details: string[]): number {
  for (const detail of details) {
    // Matches "3 sets", "2 working sets", "4 warmup sets", etc.
    const m = detail.match(/(\d+)\s*(?:\w+\s+)?sets?/i);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 10) return n;
    }
  }
  return 1;
}

/** Build a unique key for an exercise checkoff: dayName + exerciseOrder */
function exerciseKey(dayName: string, exerciseOrder: number): string {
  return `${dayName}::${exerciseOrder}`;
}

export function TrainingProgram({
  program,
  adherence,
  progress,
}: {
  program: TrainingProgramData;
  adherence?: WorkoutAdherenceProps;
  progress?: ExerciseProgressProps;
}) {
  const workoutDays = program.days.filter((d) => d.dayName !== "__CARDIO__");

  // Custom expand/collapse state — all days closed by default
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set()
  );

  // Per-exercise completion state
  const [completedExercises, setCompletedExercises] = useState<Set<string>>(() => {
    const set = new Set<string>();
    if (adherence) {
      for (const ex of adherence.exercises) {
        if (ex.completed) {
          set.add(exerciseKey(ex.dayLabel, ex.exerciseOrder));
        }
      }
    }
    return set;
  });
  const [isPending, startTransition] = useTransition();

  function toggleExpand(dayId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) {
        next.delete(dayId);
      } else {
        next.add(dayId);
      }
      return next;
    });
  }

  function handleExerciseToggle(dayName: string, exName: string, exOrder: number) {
    if (!adherence?.date) return;
    const key = exerciseKey(dayName, exOrder);
    const alreadyDone = completedExercises.has(key);
    const next = !alreadyDone;

    // Optimistic update
    setCompletedExercises((prev) => {
      const s = new Set(prev);
      if (next) s.add(key); else s.delete(key);
      return s;
    });

    startTransition(async () => {
      const result = await toggleExerciseCheckoff({
        date: adherence.date,
        dayLabel: dayName,
        exerciseName: exName,
        exerciseOrder: exOrder,
        completed: next,
      });
      if (result?.error) {
        // Revert
        setCompletedExercises((prev) => {
          const s = new Set(prev);
          if (alreadyDone) s.add(key); else s.delete(key);
          return s;
        });
      }
    });
  }

  /** Count exercises in a day and how many are completed */
  function getDayProgress(day: TrainingDay) {
    let exerciseIndex = 0;
    let total = 0;
    let done = 0;
    for (const block of day.blocks) {
      const isExercise = EXERCISE_TYPES.has(block.type) || (!BLOCK_TYPE_LABELS[block.type] && block.title);
      if (block.type === ("INSTRUCTION" as BlockType) && block.title?.toLowerCase().includes("goal")) {
        continue;
      }
      if (isExercise) {
        total++;
        if (completedExercises.has(exerciseKey(day.dayName, exerciseIndex))) {
          done++;
        }
        exerciseIndex++;
      }
    }
    return { total, done };
  }

  return (
    <div className="space-y-3">
      {/* Frequency / notes banner */}
      {(program.weeklyFrequency || program.clientNotes) && (
        <div className="sf-glass-card px-5 py-4">
          {program.weeklyFrequency && (
            <p className="text-sm">
              <span className="font-semibold">{program.weeklyFrequency}×</span>{" "}
              <span className="text-zinc-500">per week</span>
            </p>
          )}
          {program.clientNotes && (
            <p className="mt-1 text-sm text-zinc-500">
              {program.clientNotes}
            </p>
          )}
        </div>
      )}

      {/* Cardio section — extracted from __CARDIO__ day */}
      {(() => {
        const cardioDay = program.days.find((d) => d.dayName === "__CARDIO__");
        if (!cardioDay || cardioDay.blocks.length === 0) return null;
        const b = cardioDay.blocks[0];
        const parts = b.title.split("|");
        const modality = parts[0] ?? "";
        const frequency = parts[1] ?? "";
        const duration = parts[2] ?? "";
        const intensity = parts[3] ?? "";
        const notes = b.content;
        const hasData = modality || frequency || duration || intensity || notes;
        if (!hasData) return null;

        const cardioDetails = [frequency, duration, intensity].filter(Boolean).join(" \u00b7 ");

        return (
          <div className="sf-glass-card" style={{ borderColor: "rgba(34, 197, 94, 0.20)" }}>
            <div className="flex items-center gap-2 border-b border-green-900/30 px-5 py-3">
              <span className="rounded-full bg-green-900/40 px-2 py-0.5 text-xs font-semibold text-green-300">
                Cardio
              </span>
              {modality && (
                <h3 className="text-sm font-semibold">{modality}</h3>
              )}
            </div>
            <div className="px-5 py-3.5 space-y-1">
              {cardioDetails && (
                <p className="text-sm text-zinc-400">{cardioDetails}</p>
              )}
              {notes && (
                <p className="text-xs italic text-zinc-500">{notes}</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Workout day cards with custom expand/collapse */}
      {workoutDays.map((day, dayIndex) => {
        const isExpanded = expandedIds.has(day.id);
        const dayProgress = adherence ? getDayProgress(day) : null;
        const allDone = dayProgress ? dayProgress.total > 0 && dayProgress.done === dayProgress.total : false;

        // Parse day name: e.g. "Day 1 — Chest" => label: "Day 1", name: "Chest"
        const dashMatch = day.dayName?.match(/^(Day\s*\d+)\s*[—–-]\s*(.+)$/i);
        const dayLabel = dashMatch ? dashMatch[1] : `Day ${dayIndex + 1}`;
        const dayTitle = dashMatch ? dashMatch[2] : day.dayName || "Untitled Day";

        // Find the goal/instruction block if any
        const goalBlock = day.blocks.find(
          (b) => b.type === ("INSTRUCTION" as BlockType) && b.title?.toLowerCase().includes("goal")
        );

        return (
          <div
            key={day.id}
            className={`overflow-hidden sf-glass-card ${
              allDone
                ? "border-emerald-900/40"
                : ""
            }`}
          >
            {/* Card header row */}
            <button
              type="button"
              onClick={() => toggleExpand(day.id)}
              className="flex w-full items-center gap-3 border-l-4 px-5 py-4 text-left transition-colors hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500 cursor-pointer"
              style={{
                borderLeftColor: isExpanded
                  ? allDone ? "rgb(16 185 129)" : "currentColor"
                  : "transparent",
              }}
              aria-expanded={isExpanded}
              aria-controls={`day-body-${day.id}`}
              aria-label={`${dayLabel}: ${dayTitle}, ${dayProgress ? `${dayProgress.done}/${dayProgress.total} completed` : ""}`}
            >
              <div className="flex-1 min-w-0">
                <p
                  className={`text-xs font-medium uppercase tracking-wider ${
                    allDone
                      ? "text-emerald-500"
                      : "text-zinc-500"
                  }`}
                >
                  {dayLabel}
                </p>
                <h3
                  className={`text-base font-semibold tracking-tight ${
                    allDone
                      ? "text-emerald-400"
                      : ""
                  }`}
                >
                  {dayTitle}
                </h3>
                {goalBlock && goalBlock.content && (
                  <p className="mt-0.5 text-xs italic text-zinc-500 truncate">
                    {goalBlock.content}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {allDone && (
                  <svg
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-emerald-500"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {dayProgress && (
                  <span className="sf-section-label text-xs">
                    {dayProgress.done}/{dayProgress.total}
                  </span>
                )}
                <svg
                  className={`h-4 w-4 text-zinc-500 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Per-day progress bar */}
            {isExpanded && adherence && dayProgress && dayProgress.total > 0 && (
              <div className="border-t border-zinc-800 px-5 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-zinc-500">
                    Progress
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-zinc-400">
                    {dayProgress.done} / {dayProgress.total}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-zinc-700"
                  role="progressbar"
                  aria-valuenow={dayProgress.done}
                  aria-valuemin={0}
                  aria-valuemax={dayProgress.total}
                  aria-label={`${dayProgress.done} of ${dayProgress.total} exercises completed`}
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{ width: dayProgress.total > 0 ? `${Math.round((dayProgress.done / dayProgress.total) * 100)}%` : "0%" }}
                  />
                </div>
              </div>
            )}

            {/* Collapsible body — animated */}
            <div
              id={`day-body-${day.id}`}
              className={`grid transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                isExpanded
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                {day.blocks.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-zinc-500">
                    No exercises added yet.
                  </p>
                ) : (
                  <div className="divide-y divide-zinc-800/60 border-t border-zinc-800">
                    {(() => {
                      let exerciseNum = 0;
                      return day.blocks.map((block) => {
                        const badgeClass = BLOCK_TYPE_BADGE[block.type];
                        const badgeLabel = BLOCK_TYPE_LABELS[block.type];
                        const isExercise =
                          EXERCISE_TYPES.has(block.type) || (!badgeLabel && block.title);

                        // Skip the goal block in the body since it's shown in the header
                        if (
                          block.type === ("INSTRUCTION" as BlockType) &&
                          block.title?.toLowerCase().includes("goal")
                        ) {
                          return null;
                        }

                        const currentExerciseIndex = isExercise ? exerciseNum : -1;
                        if (isExercise) exerciseNum++;
                        const parsed = isExercise
                          ? parseExerciseContent(block.content || "")
                          : null;
                        const setCount = parsed ? parseSetCount(parsed.details) : 1;

                        const isChecked = isExercise && adherence
                          ? completedExercises.has(exerciseKey(day.dayName, currentExerciseIndex))
                          : false;

                        return (
                          <div key={block.id} className={`px-5 py-3.5 ${isChecked ? "bg-emerald-950/10" : ""}`}>
                            <div className="flex items-start gap-3">
                              {/* Exercise checkbox or number */}
                              {isExercise && adherence ? (
                                <label
                                  className="mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center"
                                  aria-label={`${block.title}: ${isChecked ? "mark incomplete" : "mark complete"}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => handleExerciseToggle(day.dayName, block.title, currentExerciseIndex)}
                                    disabled={isPending}
                                    className="h-[18px] w-[18px] cursor-pointer rounded border-2 border-zinc-600 accent-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0a1224] disabled:opacity-50"
                                  />
                                </label>
                              ) : isExercise ? (
                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-400">
                                  {currentExerciseIndex + 1}
                                </span>
                              ) : null}

                              <div className="min-w-0 flex-1">
                                {/* Title + badge */}
                                <div className="flex flex-wrap items-baseline gap-2">
                                  {block.title && (
                                    <span className={`text-sm font-semibold ${isChecked ? "text-emerald-400" : ""}`}>
                                      {block.title}
                                    </span>
                                  )}
                                  {badgeLabel && (
                                    <span
                                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}
                                    >
                                      {badgeLabel}
                                    </span>
                                  )}
                                  {/* Equipment pills */}
                                  {parsed?.equipment.map((eq, eqI) => (
                                    <span
                                      key={eqI}
                                      className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400"
                                    >
                                      {eq}
                                    </span>
                                  ))}
                                </div>

                                {/* Inline details for exercises */}
                                {parsed && parsed.details.length > 0 && (
                                  <p className="mt-1 text-sm text-zinc-400">
                                    {parsed.details.join(" · ")}
                                  </p>
                                )}

                                {/* Notes as italic */}
                                {parsed && parsed.notes.length > 0 && (
                                  <p className="mt-0.5 text-xs italic text-zinc-500">
                                    {parsed.notes.join(" · ")}
                                  </p>
                                )}

                                {/* Non-exercise content (instructions etc) */}
                                {!isExercise && block.content && (
                                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">
                                    {block.content}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Inline exercise progress logging */}
                            {isExercise && progress && (
                              <ExerciseProgressInput
                                exerciseName={block.title}
                                programDay={day.dayName}
                                setCount={setCount}
                                currentAll={progress.currentWeek}
                                previousAll={progress.previousWeek}
                              />
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {program.publishedAt && (
        <p className="text-xs text-zinc-500">
          Updated{" "}
          {program.publishedAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </p>
      )}
    </div>
  );
}

// ── Inline Exercise Progress Logger (append-only, matching iOS UX) ───────────

type ExerciseProgressInputProps = {
  exerciseName: string;
  programDay: string;
  setCount: number;
  currentAll: Record<string, ExerciseResultData>;
  previousAll: Record<string, ExerciseResultData>;
};

type LoggedSet = { id: string; weight: string; reps: string; createdAt: string };

function formatLogTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (isToday) return `Today at ${time}`;
    if (isYesterday) return `Yesterday at ${time}`;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + ` at ${time}`;
  } catch {
    return "";
  }
}

function ExerciseProgressInput({
  exerciseName,
  programDay,
  currentAll,
  previousAll,
}: ExerciseProgressInputProps) {
  // Collect all previously-saved sets from currentAll that match this exercise
  // Keys are formatted as "programDay::exerciseName::setNumber"
  const keyPrefix = `${programDay}::${exerciseName}::`;
  const initialLogged: LoggedSet[] = [];
  for (const [key, val] of Object.entries(currentAll)) {
    if (key.startsWith(keyPrefix)) {
      initialLogged.push({
        id: val.id,
        weight: val.weight?.toString() ?? "",
        reps: val.reps?.toString() ?? "",
        createdAt: val.createdAt ?? "",
      });
    }
  }
  // Sort by createdAt ascending (oldest first)
  initialLogged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const [logged, setLogged] = useState<LoggedSet[]>(initialLogged);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nextSetNumber = logged.length + 1;

  // Previous week data for reference — grab the first set's result
  const prevResult = previousAll[`${programDay}::${exerciseName}::1`];

  function handleSave() {
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (!weight || !reps || isNaN(w) || isNaN(r) || w <= 0 || r <= 0) return;

    setSaveState("saving");
    if (timerRef.current) clearTimeout(timerRef.current);

    startTransition(async () => {
      const result = await saveExerciseResult({
        exerciseName,
        programDay,
        setNumber: nextSetNumber,
        weight: w,
        reps: r,
      });

      if (result?.error) {
        setSaveState("error");
        timerRef.current = setTimeout(() => setSaveState("idle"), 3000);
      } else {
        // Move to history, clear form
        setLogged((prev) => [...prev, {
          id: result.id ?? `temp-${Date.now()}`,
          weight,
          reps,
          createdAt: result.createdAt ?? new Date().toISOString(),
        }]);
        setWeight("");
        setReps("");
        setSaveState("saved");
        timerRef.current = setTimeout(() => setSaveState("idle"), 2000);
      }
    });
  }

  function handleDeleteSingle(id: string) {
    setDeletingId(id);
    startTransition(async () => {
      const result = await deleteExerciseResult(id);
      if (result?.success) {
        setLogged((prev) => prev.filter((s) => s.id !== id));
      }
      setDeletingId(null);
    });
  }

  function handleClearAll() {
    setClearConfirm(false);
    startTransition(async () => {
      const result = await clearExerciseHistory(exerciseName);
      if (result?.success) {
        setLogged([]);
      }
    });
  }

  const totalReps = logged.reduce((sum, s) => sum + (parseInt(s.reps, 10) || 0), 0);
  const bestWeight = logged.length > 0 ? Math.max(...logged.map((s) => parseFloat(s.weight) || 0)) : 0;

  return (
    <div className="ml-9 mt-2 sf-glass-card px-3 py-3 space-y-3">
      {/* Summary metrics */}
      {logged.length > 0 && (
        <div className="flex items-center gap-3 text-xs">
          <span className="rounded-full bg-emerald-900/30 px-2 py-0.5 font-semibold text-emerald-400">
            {logged.length} logged
          </span>
          {bestWeight > 0 && (
            <span className="text-zinc-400">
              Best: <span className="font-semibold text-zinc-300">{bestWeight} lbs</span>
            </span>
          )}
          {totalReps > 0 && (
            <span className="text-zinc-400">
              Total: <span className="font-semibold text-zinc-300">{totalReps} reps</span>
            </span>
          )}
        </div>
      )}

      {/* Current set editor */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500">Log a set</span>
          {prevResult && (
            <span className="text-xs text-zinc-500">
              Last week:{" "}
              <span className="font-semibold text-zinc-400">
                {prevResult.weight} × {prevResult.reps}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label htmlFor={`w-${programDay}-${exerciseName}`} className="text-xs font-medium text-zinc-400">Weight</label>
            <input
              id={`w-${programDay}-${exerciseName}`}
              type="number" inputMode="decimal" step="any" min="0"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              placeholder="lbs"
              style={{ fontSize: "max(1rem, 16px)" }}
              className="sf-input w-16 px-2 py-1.5 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              aria-label={`Weight for ${exerciseName}`}
            />
          </div>
          <span className="text-zinc-600">×</span>
          <div className="flex items-center gap-1.5">
            <label htmlFor={`r-${programDay}-${exerciseName}`} className="text-xs font-medium text-zinc-400">Reps</label>
            <input
              id={`r-${programDay}-${exerciseName}`}
              type="number" inputMode="numeric" min="0"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              placeholder="0"
              style={{ fontSize: "max(1rem, 16px)" }}
              className="sf-input w-14 px-2 py-1.5 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              aria-label={`Reps for ${exerciseName}`}
            />
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving" || !weight || !reps}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-[var(--sf-accent)] px-3 py-1.5 text-xs font-bold text-white transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saveState === "saving" ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : saveState === "saved" ? (
              <>
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Saved
              </>
            ) : saveState === "error" ? (
              <span className="text-red-200">Failed</span>
            ) : (
              <>
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Log Set
              </>
            )}
          </button>
        </div>
      </div>

      {/* Logged history */}
      {logged.length > 0 && (
        <div className="border-t border-zinc-800/60 pt-2 space-y-1">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">History</p>
            {logged.length > 1 && !clearConfirm && (
              <button
                type="button"
                onClick={() => setClearConfirm(true)}
                className="text-[10px] font-semibold text-red-400/60 hover:text-red-400 transition-colors"
              >
                Clear All
              </button>
            )}
            {clearConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-red-400">Delete all logs?</span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setClearConfirm(false)}
                  className="text-[10px] font-semibold text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {[...logged].reverse().map((s) => (
            <div key={s.id} className="group flex items-center justify-between rounded-lg bg-zinc-800/30 px-2.5 py-1.5">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-zinc-300">{s.weight} lbs × {s.reps} reps</span>
                {s.createdAt && (
                  <p className="text-[10px] text-zinc-500">{formatLogTimestamp(s.createdAt)}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDeleteSingle(s.id)}
                disabled={deletingId === s.id}
                className="opacity-0 group-hover:opacity-100 transition-opacity ml-2 p-1 rounded hover:bg-red-500/20"
                aria-label="Delete this log entry"
              >
                {deletingId === s.id ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-red-400/30 border-t-red-400" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400/60 hover:text-red-400">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
