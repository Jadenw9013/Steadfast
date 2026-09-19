"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreMealPlanVersion } from "@/app/actions/meal-plans";
import { draftExistsMessage, sourceNotRestorableMessage } from "@/lib/meal-plans/history-messages";

/**
 * T-801 — Restore confirm + call. Wording is driven by the server-computed
 * `weekHasDraft` flag (never guessed client-side). `isRestorable` greys the
 * button instead of letting the coach discover the 409.
 */
export function RestoreVersionButton({
  clientId,
  sourceMealPlanId,
  version,
  weekLabel,
  weekHasDraft,
  isRestorable,
}: {
  clientId: string;
  sourceMealPlanId: string;
  version: number;
  weekLabel: string;
  weekHasDraft: boolean;
  isRestorable: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirm" | "confirm-replace">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runRestore(replaceExistingDraft: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await restoreMealPlanVersion({
          clientId,
          sourceMealPlanId,
          replaceExistingDraft,
        });
        if ("success" in result && result.success) {
          setStep("idle");
          router.push(`/coach/clients/${clientId}/review/${result.weekStartDate}`);
          return;
        }
        if ("code" in result && result.code === "DRAFT_EXISTS") {
          setError(result.error);
          setStep("confirm-replace");
          return;
        }
        setError("error" in result ? result.error : "Restore failed. Please try again.");
        setStep("idle");
      } catch {
        // Server Action throws are redacted/minified in production builds —
        // show a fixed sentence rather than the thrown message (mirrors the
        // publish catch in meal-plan-editor-v2.tsx).
        setError("Restore failed. Please try again.");
        setStep("idle");
      }
    });
  }

  if (!isRestorable) {
    return (
      <button
        type="button"
        disabled
        title={sourceNotRestorableMessage()}
        className="min-h-[48px] cursor-not-allowed rounded-xl border border-zinc-800 px-5 text-sm font-semibold text-zinc-600"
      >
        Restore this version
      </button>
    );
  }

  if (step === "idle") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setStep("confirm")}
          className="min-h-[48px] rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-500 hover:shadow-blue-500/40 active:scale-[0.98]"
        >
          Restore this version
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  const confirmingReplace = step === "confirm-replace";
  const message = confirmingReplace
    ? (error ?? draftExistsMessage())
    : weekHasDraft
      ? `Restore version ${version}? This creates a new draft for the week of ${weekLabel}. Your client won't see any change until you publish it. The existing draft for that week will be replaced.`
      : `Restore version ${version}? This creates a new draft for the week of ${weekLabel}. Your client won't see any change until you publish it.`;

  return (
    <div className="sf-glass-card w-full max-w-md space-y-4 p-5">
      <p className="text-sm text-zinc-200">{message}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => runRestore(confirmingReplace ? true : weekHasDraft)}
          disabled={isPending}
          className="min-h-[48px] rounded-xl bg-blue-600 px-5 text-sm font-bold text-white transition-all hover:bg-blue-500 active:scale-[0.98] disabled:opacity-50"
        >
          {isPending ? "Restoring…" : confirmingReplace ? "Replace draft & restore" : "Confirm restore"}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("idle");
            setError(null);
          }}
          disabled={isPending}
          className="min-h-[48px] rounded-xl border border-zinc-700 px-5 text-sm font-semibold text-zinc-300 transition-all hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
