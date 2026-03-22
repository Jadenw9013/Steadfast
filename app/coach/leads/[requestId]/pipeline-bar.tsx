"use client";

const STAGES = [
    { key: "PENDING", label: "Pending" },
    { key: "CONSULTATION_SCHEDULED", label: "Consultation" },
    { key: "CONSULTATION_DONE", label: "Done" },
    { key: "INTAKE_SENT", label: "Intake Sent" },
    { key: "INTAKE_SUBMITTED", label: "Intake Done" },
    { key: "FORMS_SENT", label: "Forms Sent" },
    { key: "FORMS_SIGNED", label: "Signed" },
    { key: "ACTIVE", label: "Active" },
] as const;

type StageKey = typeof STAGES[number]["key"];

function stageIndex(key: string): number {
    return STAGES.findIndex((s) => s.key === key);
}

export function PipelineBar({ currentStage }: { currentStage: string }) {
    const currentIdx = stageIndex(currentStage);
    const isDeclined = currentStage === "DECLINED";

    if (isDeclined) {
        return (
            <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/50 px-4 py-3" role="status" aria-label="Pipeline stage: Inactive">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                <span className="text-sm font-medium text-zinc-500">Inactive</span>
            </div>
        );
    }

    return (
        <nav aria-label="Pipeline progress" className="overflow-x-auto">
            <ol className="flex items-center gap-1">
                {STAGES.map((stage, idx) => {
                    const isCompleted = idx < currentIdx;
                    const isCurrent = idx === currentIdx;
                    const isUpcoming = idx > currentIdx;

                    return (
                        <li
                            key={stage.key}
                            className="flex items-center gap-1"
                            aria-current={isCurrent ? "step" : undefined}
                            aria-label={`${stage.label}${isCompleted ? " (completed)" : isCurrent ? " (current)" : " (upcoming)"}`}
                        >
                            <div
                                className={`flex min-h-[48px] items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                                    isCompleted
                                        ? "text-emerald-400/70"
                                        : isCurrent
                                            ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30"
                                            : "text-zinc-600"
                                }`}
                            >
                                {/* Icon */}
                                {isCompleted ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M20 6 9 17l-5-5"/></svg>
                                ) : isCurrent ? (
                                    <span className="flex h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                                ) : isUpcoming && stage.key === "ACTIVE" && currentStage === "FORMS_SIGNED" ? (
                                    <span className="flex h-2 w-2 shrink-0 rounded-full bg-blue-400 animate-pulse" />
                                ) : (
                                    <span className="flex h-2 w-2 shrink-0 rounded-full bg-zinc-700" />
                                )}
                                <span className="whitespace-nowrap">{stage.label}</span>
                            </div>

                            {/* Connector */}
                            {idx < STAGES.length - 1 && (
                                <div
                                    className={`h-px w-3 shrink-0 ${
                                        isCompleted || isCurrent ? "bg-emerald-500/40" : "bg-zinc-800"
                                    }`}
                                    aria-hidden="true"
                                />
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
