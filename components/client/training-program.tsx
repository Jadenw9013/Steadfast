import type { BlockType } from "@/app/generated/prisma/enums";

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
  // First line is often equipment or primary detail
  // Look for patterns like "3 sets × 5-8 reps", "Machine or Dumbell", rest times
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

export function TrainingProgram({ program }: { program: TrainingProgramData }) {
  return (
    <div className="space-y-3">
      {/* Frequency / notes banner */}
      {(program.weeklyFrequency || program.clientNotes) && (
        <div className="rounded-2xl border border-gray-200/60 bg-white px-5 py-4 shadow-sm dark:border-zinc-800/80 dark:bg-[#121215] dark:shadow-none">
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

      {program.days.map((day, dayIndex) => {
        // Count actual exercises (not instruction blocks)
        const exerciseCount = day.blocks.filter(
          (b) => EXERCISE_TYPES.has(b.type) || (!BLOCK_TYPE_LABELS[b.type] && b.title)
        ).length;

        // Parse day name: e.g. "Day 1 — Chest" => label: "Day 1", name: "Chest"
        const dashMatch = day.dayName?.match(/^(Day\s*\d+)\s*[—–-]\s*(.+)$/i);
        const dayLabel = dashMatch ? dashMatch[1] : `Day ${dayIndex + 1}`;
        const dayTitle = dashMatch ? dashMatch[2] : day.dayName || "Untitled Day";

        // Find the goal/instruction block if any
        const goalBlock = day.blocks.find(
          (b) => b.type === ("INSTRUCTION" as BlockType) && b.title?.toLowerCase().includes("goal")
        );

        return (
          <details
            key={day.id}
            className="group overflow-hidden rounded-2xl border border-gray-200/60 bg-white shadow-sm transition-all open:shadow-md dark:border-zinc-800/80 dark:bg-[#121215] dark:shadow-none dark:open:shadow-none"
            open={dayIndex === 0}
          >
            <summary
              className="flex cursor-pointer select-none items-center gap-4 border-l-4 border-transparent px-5 py-4 transition-colors hover:bg-gray-50 group-open:border-l-gray-900 dark:hover:bg-zinc-800/50 dark:group-open:border-l-white [&::-webkit-details-marker]:hidden"
              aria-label={`${dayLabel}: ${dayTitle}, ${exerciseCount} exercises`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                  {dayLabel}
                </p>
                <h3 className="text-base font-semibold tracking-tight">{dayTitle}</h3>
                {goalBlock && goalBlock.content && (
                  <p className="mt-0.5 text-xs italic text-gray-400 dark:text-zinc-500 truncate">
                    {goalBlock.content}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {exerciseCount} {exerciseCount === 1 ? "exercise" : "exercises"}
                </span>
                <svg
                  className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180 dark:text-zinc-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </summary>

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
                    const isExercise = EXERCISE_TYPES.has(block.type) || (!badgeLabel && block.title);

                    // Skip the goal block in the body since it's shown in the header
                    if (
                      block.type === ("INSTRUCTION" as BlockType) &&
                      block.title?.toLowerCase().includes("goal")
                    ) {
                      return null;
                    }

                    if (isExercise) exerciseNum++;
                    const parsed = isExercise ? parseExerciseContent(block.content || "") : null;

                    return (
                      <div key={block.id} className="px-5 py-3.5">
                        <div className="flex items-start gap-3">
                          {/* Exercise number */}
                          {isExercise && (
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
                              {exerciseNum}
                            </span>
                          )}

                          <div className="min-w-0 flex-1">
                            {/* Title + badge */}
                            <div className="flex flex-wrap items-baseline gap-2">
                              {block.title && (
                                <span className="text-sm font-semibold">{block.title}</span>
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
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </details>
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
