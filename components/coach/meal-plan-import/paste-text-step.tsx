"use client";

import { useState } from "react";
import { ProcessingIndicator } from "./processing-indicator";

const MIN_LENGTH = 10;
const MAX_LENGTH = 10_000;

type Status = "idle" | "processing" | "error";

export function PasteTextStep({
  clientId,
  onProcessing,
  onDraftReady,
}: {
  clientId: string;
  onProcessing?: () => void;
  onDraftReady: (uploadId: string) => void;
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
      const res = await fetch("/api/mealplans/parse-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, text }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Processing failed");
      }

      if (data.status === "needs_review" && data.uploadId) {
        onDraftReady(data.uploadId);
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
        <h2 className="text-lg font-bold tracking-tight">Paste Meal Plan</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Paste the text of a meal plan below. We&apos;ll structure it so you
          can review before importing.
        </p>
      </div>

      {/* Textarea */}
      <div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
            if (status === "error") setStatus("idle");
          }}
          disabled={isProcessing}
          placeholder={`Example:\nBreakfast\n3 whole eggs\n2 slices sourdough toast\n1 tbsp butter\n\nLunch\n6oz chicken breast\n1 cup white rice\n1 cup steamed broccoli`}
          rows={10}
          className={`w-full rounded-xl border-2 bg-white px-4 py-3 text-sm transition-colors placeholder:text-zinc-400 focus:outline-none dark:bg-zinc-900 ${
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

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950/50"
        >
          <p className="font-medium text-red-700 dark:text-red-400">
            Processing failed
          </p>
          <p className="mt-1 text-xs text-red-600 dark:text-red-400/80">
            {error}
          </p>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && <ProcessingIndicator />}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleProcess}
          disabled={!isValid || isProcessing}
          className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
        >
          {isProcessing ? "Processing..." : "Process Text"}
        </button>
      </div>
    </div>
  );
}
