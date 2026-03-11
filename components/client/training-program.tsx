"use client";

import { useState, useTransition, useRef, useCallback } from "react";
import type { BlockType } from "@/app/generated/prisma/enums";
import { toggleExerciseCheckoff } from "@/app/actions/adherence";
import { saveExerciseResult } from "@/app/actions/exercise-results";

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
  exerciseName: string;
  programDay: string;
  weight: number;
  reps: number;
};

type ExerciseProgressProps = {
  /** Map key: "programDay::exerciseName" */
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
  ACTIVATION:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  INSTRUCTION:
    "bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300",
  SUPERSET:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  CARDIO:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  OPTIONAL:
    "bg-gray-50 text-gray-500 dark:bg-zinc-800/60 dark:text-zinc-400",
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

  // Custom expand/collapse state — first day open by default
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(workoutDays[0] ? [workoutDays[0].id] : [])
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
        <div className="rounded-2xl border border-gray-200/60 bg-white px-5 py-4 shadow-sm dark:border-zinc-800/80 dark:bg-[#0a1224] dark:shadow-none">
          {program.weeklyFrequency && (
            <p className="text-sm">
              <span className="font-semibold">{program.weeklyFrequency}×</span>{" "}
              <span className="text-gray-500 dark:text-zinc-500">per week</span>
            </p>
          )}
          {program.clientNotes && (
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-500">
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
          <div className="rounded-2xl border border-green-200/60 bg-white shadow-sm dark:border-green-900/40 dark:bg-[#0a1224] dark:shadow-none">
            <div className="flex items-center gap-2 border-b border-green-100 px-5 py-3 dark:border-green-900/30">
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-300">
                Cardio
              </span>
              {modality && (
                <h3 className="text-sm font-semibold">{modality}</h3>
              )}
            </div>
            <div className="px-5 py-3.5 space-y-1">
              {cardioDetails && (
                <p className="text-sm text-gray-600 dark:text-zinc-400">{cardioDetails}</p>
              )}
              {notes && (
                <p className="text-xs italic text-gray-400 dark:text-zinc-500">{notes}</p>
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
            className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-[#0a1224] dark:shadow-none ${
              allDone
                ? "border-emerald-200 dark:border-emerald-900/40"
                : "border-gray-200/60 dark:border-zinc-800/80"
            }`}
          >
            {/* Card header row */}
            <button
              type="button"
              onClick={() => toggleExpand(day.id)}
              className="flex w-full items-center gap-3 border-l-4 px-5 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-500"
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
                  className={`text-[11px] font-medium uppercase tracking-wider ${
                    allDone
                      ? "text-emerald-600 dark:text-emerald-500"
                      : "text-gray-400 dark:text-zinc-500"
                  }`}
                >
                  {dayLabel}
                </p>
                <h3
                  className={`text-base font-semibold tracking-tight ${
                    allDone
                      ? "text-emerald-700 dark:text-emerald-400"
                      : ""
                  }`}
                >
                  {dayTitle}
                </h3>
                {goalBlock && goalBlock.content && (
                  <p className="mt-0.5 text-xs italic text-gray-400 dark:text-zinc-500 truncate">
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
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {dayProgress.done}/{dayProgress.total}
                  </span>
                )}
                <svg
                  className={`h-4 w-4 text-gray-400 transition-transform dark:text-zinc-500 ${isExpanded ? "rotate-180" : ""}`}
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
              <div className="border-t border-gray-100 px-5 py-2.5 dark:border-zinc-800">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-medium text-gray-400 dark:text-zinc-500">
                    Progress
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums text-gray-500 dark:text-zinc-400">
                    {dayProgress.done} / {dayProgress.total}
                  </span>
                </div>
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
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

            {/* Collapsible body */}
            {isExpanded && (
              <div id={`day-body-${day.id}`}>
                {day.blocks.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-gray-400 dark:text-zinc-500">
                    No exercises added yet.
                  </p>
                ) : (
                  <div className="divide-y divide-gray-100/80 border-t border-gray-100 dark:divide-zinc-800/60 dark:border-zinc-800">
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

                        const isChecked = isExercise && adherence
                          ? completedExercises.has(exerciseKey(day.dayName, currentExerciseIndex))
                          : false;

                        return (
                          <div key={block.id} className={`px-5 py-3.5 ${isChecked ? "bg-emerald-50/40 dark:bg-emerald-950/10" : ""}`}>
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
                                    className="h-[18px] w-[18px] cursor-pointer rounded border-2 border-zinc-300 accent-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 disabled:opacity-50 dark:border-zinc-600"
                                  />
                                </label>
                              ) : isExercise ? (
                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
                                  {currentExerciseIndex + 1}
                                </span>
                              ) : null}

                              <div className="min-w-0 flex-1">
                                {/* Title + badge */}
                                <div className="flex flex-wrap items-baseline gap-2">
                                  {block.title && (
                                    <span className={`text-sm font-semibold ${isChecked ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                                      {block.title}
                                    </span>
                                  )}
                                  {badgeLabel && (
                                    <span
                                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeClass}`}
                                    >
                                      {badgeLabel}
                                    </span>
                                  )}
                                  {/* Equipment pills */}
                                  {parsed?.equipment.map((eq, eqI) => (
                                    <span
                                      key={eqI}
                                      className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-zinc-800 dark:text-zinc-400"
                                    >
                                      {eq}
                                    </span>
                                  ))}
                                </div>

                                {/* Inline details for exercises */}
                                {parsed && parsed.details.length > 0 && (
                                  <p className="mt-1 text-sm text-gray-600 dark:text-zinc-400">
                                    {parsed.details.join(" · ")}
                                  </p>
                                )}

                                {/* Notes as italic */}
                                {parsed && parsed.notes.length > 0 && (
                                  <p className="mt-0.5 text-xs italic text-gray-400 dark:text-zinc-500">
                                    {parsed.notes.join(" · ")}
                                  </p>
                                )}

                                {/* Non-exercise content (instructions etc) */}
                                {!isExercise && block.content && (
                                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-500 dark:text-zinc-400">
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
                                current={progress.currentWeek[`${day.dayName}::${block.title}`]}
                                previous={progress.previousWeek[`${day.dayName}::${block.title}`]}
                              />
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {program.publishedAt && (
        <p className="text-xs text-gray-400 dark:text-zinc-500">
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

// ── Inline Exercise Progress Logger ─────────────────────────────────────────

type ExerciseProgressInputProps = {
  exerciseName: string;
  programDay: string;
  current?: ExerciseResultData;
  previous?: ExerciseResultData;
};

function ExerciseProgressInput({
  exerciseName,
  programDay,
  current,
  previous,
}: ExerciseProgressInputProps) {
  const [weight, setWeight] = useState(current?.weight?.toString() ?? "");
  const [reps, setReps] = useState(current?.reps?.toString() ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startTransition] = useTransition();

  const save = useCallback(
    (w: string, r: string) => {
      const weightNum = parseFloat(w);
      const repsNum = parseInt(r, 10);
      if (!w || !r || isNaN(weightNum) || isNaN(repsNum) || weightNum <= 0 || repsNum <= 0) return;

      // Don't save if values haven't changed from what's already persisted
      if (current && current.weight === weightNum && current.reps === repsNum) return;

      setSaveState("saving");
      if (timerRef.current) clearTimeout(timerRef.current);

      startTransition(async () => {
        const result = await saveExerciseResult({
          exerciseName,
          programDay,
          weight: weightNum,
          reps: repsNum,
        });
        if (result?.error) {
          setSaveState("error");
        } else {
          setSaveState("saved");
          timerRef.current = setTimeout(() => setSaveState("idle"), 2000);
        }
      });
    },
    [exerciseName, programDay, current, startTransition]
  );

  function handleBlur() {
    save(weight, reps);
  }

  return (
    <div className="ml-9 mt-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/40">
      {/* Last week result */}
      <div className="mb-2 text-[11px] text-gray-400 dark:text-zinc-500">
        {previous ? (
          <>
            Last week:{" "}
            <span className="font-semibold text-gray-600 dark:text-zinc-300">
              {previous.weight} × {previous.reps}
            </span>
          </>
        ) : (
          "No previous result"
        )}
      </div>

      {/* This week inputs */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={`w-${programDay}-${exerciseName}`}
            className="text-[11px] font-medium text-gray-500 dark:text-zinc-400"
          >
            Weight
          </label>
          <input
            id={`w-${programDay}-${exerciseName}`}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            onBlur={handleBlur}
            placeholder="lbs"
            className="w-16 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm tabular-nums text-gray-800 placeholder:text-gray-300 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500 dark:focus:ring-zinc-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            aria-label={`Weight for ${exerciseName}`}
          />
        </div>
        <span className="text-gray-300 dark:text-zinc-600">×</span>
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={`r-${programDay}-${exerciseName}`}
            className="text-[11px] font-medium text-gray-500 dark:text-zinc-400"
          >
            Reps
          </label>
          <input
            id={`r-${programDay}-${exerciseName}`}
            type="number"
            inputMode="numeric"
            min="0"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            onBlur={handleBlur}
            placeholder="0"
            className="w-14 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm tabular-nums text-gray-800 placeholder:text-gray-300 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500 dark:focus:ring-zinc-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            aria-label={`Reps for ${exerciseName}`}
          />
        </div>

        {/* Save state indicator */}
        {saveState === "saving" && (
          <span className="text-[11px] text-gray-400 dark:text-zinc-500">Saving…</span>
        )}
        {saveState === "saved" && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Saved
          </span>
        )}
        {saveState === "error" && (
          <span className="text-[11px] font-medium text-red-500">Failed</span>
        )}
      </div>
    </div>
  );
}
