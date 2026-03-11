"use client";

import { useState } from "react";

const MIN_LENGTH = 10;
const MAX_LENGTH = 10_000;

type Status = "idle" | "processing" | "error";

export function WorkoutPasteTextStep({
  onProcessing,
  onDraftReady,
  clientId,
}: {
  onProcessing?: () => void;
  onDraftReady: (importId: string) => void;
  clientId?: string;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const charCount = text.length;
  const tooShort = charCount > 0 && charCount < MIN_LENGTH;
  const tooLong = charCount > MAX_LENGTH;
  const isValid = charCount >= MIN_LENGTH && charCount <= MAX_LENGTH;
  const isProcessing = status === "processing";

  async function handleProcess() {
    if (!isValid) return;
    setError(null);
    setStatus("processing");
    onProcessing?.();

    try {
      const res = await fetch("/api/workout-import/parse-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, clientId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Processing failed");
      }

      if (data.status === "needs_review" && data.importId) {
        onDraftReady(data.importId);
      } else {
        throw new Error(data.error || "Unexpected response");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold tracking-tight">Paste Workout Plan</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Paste the text of a workout program below. We&apos;ll structure it into
          days and blocks for you to review.
        </p>
      </div>

      <div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
            if (status === "error") setStatus("idle");
          }}
          disabled={isProcessing}
          placeholder={`Example:\nDAY 1 — PUSH\nWarm-Up: 5 min light cardio\nBarbell Bench Press — 4×8 @ RPE 8\nIncline DB Press — 3×10\nTricep Pushdown — 3×12-15\n\nDAY 2 — PULL\nDeadlift — 4×5 @ RPE 8\nPendlay Row — 4×8`}
          rows={12}
          className={`w-full rounded-xl border-2 bg-white px-4 py-3 text-sm leading-relaxed transition-colors placeholder:text-zinc-400 focus:outline-none dark:bg-zinc-900 ${
            tooLong
              ? "border-red-400 focus:border-red-500 dark:border-red-600"
              : "border-zinc-200 focus:border-zinc-400 dark:border-zinc-700 dark:focus:border-zinc-500"
          } ${isProcessing ? "opacity-60" : ""}`}
        />
        <div className="mt-1.5 flex items-center justify-between">
          <p className="text-xs text-zinc-400">
            {tooShort && "At least 10 characters required"}
          </p>
          <p
            className={`text-xs tabular-nums ${
              tooLong
                ? "font-medium text-red-500"
                : charCount > 0
                  ? "text-zinc-500"
                  : "text-zinc-400"
            }`}
          >
            {charCount.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950/50"
        >
          <p className="font-medium text-red-700 dark:text-red-400">Processing failed</p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-400/80">{error}</p>
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Parsing workout program with AI…
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleProcess}
          disabled={!isValid || isProcessing}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
        >
          {isProcessing ? "Processing…" : "Parse Workout"}
        </button>
      </div>
    </div>
  );
}
