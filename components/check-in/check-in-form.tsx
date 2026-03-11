"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { PhotoUpload } from "./photo-upload";
import { createSignedUploadUrls } from "@/app/actions/storage";
import { createCheckIn } from "@/app/actions/check-in";

const formSchema = z.object({
  weight: z.string().min(1, "Weight is required"),
  dietCompliance: z.string().optional(),
  energyLevel: z.string().optional(),
  notes: z.string().max(5000).optional(),
});

type FormValues = z.infer<typeof formSchema>;

type TemplateQuestion = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
};

export function CheckInForm({
  previousWeight,
  templateId,
  templateQuestions,
}: {
  previousWeight: { weight: number; date: string } | null;
  templateId?: string;
  templateQuestions?: TemplateQuestion[];
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<
    "idle" | "getting-urls" | "uploading" | "submitting"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [conflictModal, setConflictModal] = useState<{
    submittedAt: string;
    pendingValues: FormValues;
    pendingPhotoPaths: string[];
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [customResponses, setCustomResponses] = useState<Record<string, string>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const weightRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {},
  });

  const dietValue = watch("dietCompliance");
  const energyValue = watch("energyLevel");
  const weightValue = watch("weight");
  const notesValue = watch("notes");

  // Auto-focus weight field
  useEffect(() => {
    weightRef.current?.focus();
  }, []);

  // Progress calculation
  const filledCount = [
    !!weightValue,
    !!dietValue,
    !!energyValue,
    !!notesValue,
  ].filter(Boolean).length;
  const progressPct = Math.round((filledCount / 4) * 100);

  // Keyboard nav for radio groups
  const handleRatingKeyDown = useCallback(
    (e: React.KeyboardEvent, labels: string[], currentVal: string | undefined, field: "dietCompliance" | "energyLevel") => {
      const currentIndex = labels.findIndex((_, i) => String((i + 1) * 2) === currentVal);
      let newIndex = currentIndex;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        newIndex = Math.min(currentIndex + 1, labels.length - 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        newIndex = Math.max(currentIndex - 1, 0);
      }
      if (newIndex !== currentIndex && newIndex >= 0) {
        setValue(field, String((newIndex + 1) * 2));
        // Focus the new button
        const container = e.currentTarget.parentElement;
        const buttons = container?.querySelectorAll<HTMLButtonElement>("[role='radio']");
        buttons?.[newIndex]?.focus();
      }
    },
    [setValue]
  );

  const sortedQuestions = templateQuestions
    ? [...templateQuestions].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  async function withRetry<T>(
    fn: () => Promise<T>,
    retries: number,
    delay: number
  ): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error("Unreachable");
  }

  async function uploadPhotos(): Promise<string[]> {
    const photoPaths: string[] = [];
    if (files.length > 0) {
      setUploadState("getting-urls");
      const fileNames = files.map((f) => f.name);
      const uploadUrls = await withRetry(
        () => createSignedUploadUrls(fileNames),
        2,
        1000
      );

      setUploadState("uploading");
      await Promise.all(
        uploadUrls.map(async ({ signedUrl, path }, i) => {
          await withRetry(async () => {
            const res = await fetch(signedUrl, {
              method: "PUT",
              headers: {
                "Content-Type": files[i].type,
                "x-upsert": "true",
              },
              body: files[i],
            });
            if (!res.ok) throw new Error(`Failed to upload ${files[i].name}`);
          }, 1, 1000);
          photoPaths.push(path);
        })
      );
    }
    return photoPaths;
  }

  function validateCustomQuestions(): boolean {
    if (!sortedQuestions.length) return true;

    const newErrors: Record<string, string> = {};
    for (const q of sortedQuestions) {
      if (q.required && !customResponses[q.id]?.trim()) {
        newErrors[q.id] = `${q.label} is required`;
      }
    }
    setCustomErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function submitCheckIn(
    values: FormValues,
    photoPaths: string[],
    overwriteToday?: boolean
  ) {
    setUploadState("submitting");

    // Build customResponses payload — only non-empty values
    const responsesPayload = Object.fromEntries(
      Object.entries(customResponses).filter(([, v]) => v !== "")
    );

    const result = await createCheckIn({
      weight: parseFloat(values.weight),
      dietCompliance: values.dietCompliance ? parseInt(values.dietCompliance) : undefined,
      energyLevel: values.energyLevel ? parseInt(values.energyLevel) : undefined,
      notes: values.notes,
      photoPaths,
      overwriteToday,
      templateId,
      customResponses: Object.keys(responsesPayload).length > 0 ? responsesPayload : undefined,
    });

    if ("error" in result && result.error) {
      const messages = Object.values(result.error)
        .filter((v): v is string[] => Array.isArray(v))
        .flat()
        .join(", ");
      setError(messages || "Validation failed");
      return;
    }

    if ("conflict" in result && result.conflict) {
      setConflictModal({
        submittedAt: result.conflict.existing.submittedAt,
        pendingValues: values,
        pendingPhotoPaths: photoPaths,
      });
      return;
    }

    if ("overwritten" in result && result.overwritten) {
      setToast("Check-in updated.");
      setTimeout(() => {
        router.push("/client");
        router.refresh();
      }, 1200);
      return;
    }

    setShowSuccess(true);
    setTimeout(() => {
      router.push("/client");
      router.refresh();
    }, 1600);
  }

  async function onSubmit(values: FormValues) {
    setError(null);

    if (!validateCustomQuestions()) return;

    setUploadState("getting-urls");

    try {
      const photoPaths = await uploadPhotos();
      await submitCheckIn(values, photoPaths, undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploadState("idle");
    }
  }

  async function handleOverwrite() {
    if (!conflictModal) return;
    const { pendingValues, pendingPhotoPaths } = conflictModal;
    setConflictModal(null);
    setError(null);
    setUploadState("submitting");

    try {
      await submitCheckIn(pendingValues, pendingPhotoPaths, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploadState("idle");
    }
  }

  async function handleAddNew() {
    if (!conflictModal) return;
    const { pendingValues, pendingPhotoPaths } = conflictModal;
    setConflictModal(null);
    setError(null);
    setUploadState("submitting");

    try {
      await submitCheckIn(pendingValues, pendingPhotoPaths, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUploadState("idle");
    }
  }

  const previousDateLabel = previousWeight
    ? new Date(previousWeight.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    })
    : null;

  const buttonLabel =
    uploadState === "getting-urls"
      ? "Preparing upload…"
      : uploadState === "uploading"
        ? "Uploading photos…"
        : uploadState === "submitting"
          ? "Saving…"
          : "Send to Coach →";

  const dietLabels = ["Off track", "Needs work", "OK", "Good", "Crushed it"];
  const dietEmojis = ["😞", "😕", "😐", "😊", "💪"];
  const dietColors = [
    "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.04] dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:border dark:border-white/[0.06]",
    "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.04] dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:border dark:border-white/[0.06]",
    "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.04] dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:border dark:border-white/[0.06]",
    "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.04] dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:border dark:border-white/[0.06]",
    "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.04] dark:text-zinc-400 dark:hover:bg-white/[0.08] dark:border dark:border-white/[0.06]",
  ];
  const dietColorsActive = [
    "bg-red-100 text-red-700 ring-2 ring-red-300 dark:bg-red-500/20 dark:text-red-300 dark:ring-red-500/40 dark:border-transparent",
    "bg-orange-100 text-orange-700 ring-2 ring-orange-300 dark:bg-orange-500/20 dark:text-orange-300 dark:ring-orange-500/40 dark:border-transparent",
    "bg-yellow-100 text-yellow-700 ring-2 ring-yellow-300 dark:bg-yellow-500/20 dark:text-yellow-300 dark:ring-yellow-500/40 dark:border-transparent",
    "bg-lime-100 text-lime-700 ring-2 ring-lime-300 dark:bg-lime-500/20 dark:text-lime-300 dark:ring-lime-500/40 dark:border-transparent",
    "bg-emerald-100 text-emerald-700 ring-2 ring-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/40 dark:border-transparent",
  ];
  const energyLabels = ["Drained", "Low", "Average", "Good", "Fired up"];
  const energyEmojis = ["🔋", "😴", "⚡", "🔥", "🚀"];
  const energyColors = dietColors;
  const energyColorsActive = dietColorsActive;

  const conflictTimeLabel = conflictModal
    ? new Date(conflictModal.submittedAt).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })
    : null;

  return (
    <>
      {/* Success animation */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/90 dark:bg-[#020815]/90">
          <div className="flex flex-col items-center gap-3 animate-fade-in">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl dark:bg-emerald-900/40">
              ✓
            </div>
            <p className="text-lg font-semibold">Sent!</p>
            <p className="text-sm text-gray-500 dark:text-zinc-400">Your coach will review this soon</p>
          </div>
        </div>
      )}

      {/* 3-button conflict modal */}
      {conflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900">
            <h3 className="text-lg font-bold">
              You already checked in today
            </h3>
            <p className="mt-2 text-sm text-zinc-500">
              You submitted a check-in at {conflictTimeLabel} today. What would you like to do?
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={handleOverwrite}
                className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Overwrite today&apos;s check-in
              </button>
              <button
                onClick={handleAddNew}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Add as new check-in
              </button>
              <button
                onClick={() => setConflictModal(null)}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-7" noValidate>
        {/* Progress bar */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-medium text-gray-400 dark:text-zinc-500">Progress</span>
            <span className="text-[11px] font-bold tabular-nums text-blue-500">{progressPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Form ${progressPct}% complete`}
            />
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
          >
            {error}
          </div>
        )}

        <fieldset className="space-y-7">
          <legend className="sr-only">Weekly update details</legend>

          {/* Weight */}
          <div>
            <label htmlFor="weight" className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10 text-xs dark:bg-blue-500/20">⚖️</span>
              Weight <span className="font-normal text-gray-400 dark:text-zinc-500">lbs</span>
            </label>
            <div className="flex gap-3">
              <input
                id="weight"
                type="number"
                step="0.1"
                placeholder="185.5"
                {...register("weight")}
                ref={(e) => {
                  register("weight").ref(e);
                  weightRef.current = e;
                }}
                aria-required="true"
                aria-invalid={errors.weight ? "true" : undefined}
                aria-describedby={errors.weight ? "weight-error" : "weight-hint"}
                className="block flex-1 rounded-xl border border-gray-300 bg-gray-50 px-4 py-3.5 text-xl font-bold tabular-nums transition-all focus-visible:border-blue-500 focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:focus-visible:border-blue-500 dark:focus-visible:bg-white/[0.06] dark:focus-visible:ring-blue-500/30"
              />
              <div
                id="weight-hint"
                className="shrink-0 rounded-xl bg-gray-100 px-3.5 py-2.5 dark:bg-white/[0.04] dark:border dark:border-white/[0.06]"
              >
                <p className="text-[10px] font-medium text-gray-400 dark:text-zinc-500">Last time</p>
                {previousWeight ? (
                  <p className="text-sm font-bold tabular-nums text-gray-800 dark:text-zinc-200">
                    {previousWeight.weight}
                    <span className="ml-1 text-[10px] font-normal text-gray-400 dark:text-zinc-500">
                      {previousDateLabel}
                    </span>
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-zinc-500">&mdash;</p>
                )}
              </div>
            </div>
            {errors.weight && (
              <p id="weight-error" className="mt-1.5 text-sm text-red-500">{errors.weight.message}</p>
            )}
          </div>

          {/* Diet — tap to rate */}
          <div>
            <label id="diet-label" className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/10 text-xs dark:bg-emerald-500/20">🥗</span>
              How was your nutrition?
            </label>
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-labelledby="diet-label" aria-describedby="diet-hint">
              {dietLabels.map((label, i) => {
                const val = String((i + 1) * 2);
                const isActive = dietValue === val;
                return (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={isActive || (!dietValue && i === 0) ? 0 : -1}
                    onClick={() => setValue("dietCompliance", val)}
                    onKeyDown={(e) => handleRatingKeyDown(e, dietLabels, dietValue, "dietCompliance")}
                    className={`flex flex-col items-center gap-1 rounded-xl py-3 text-[11px] font-semibold transition-all duration-200 ${isActive
                      ? `${dietColorsActive[i]} scale-[1.02]`
                      : dietColors[i]
                      }`}
                  >
                    <span className="text-base">{dietEmojis[i]}</span>
                    {label}
                  </button>
                );
              })}
            </div>
            <p id="diet-hint" className="mt-2 text-[11px] text-gray-400 dark:text-zinc-500">Tap to rate how well you stuck to your plan</p>
          </div>

          {/* Energy — tap to rate */}
          <div>
            <label id="energy-label" className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/10 text-xs dark:bg-amber-500/20">⚡</span>
              How&apos;s your energy?
            </label>
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-labelledby="energy-label" aria-describedby="energy-hint">
              {energyLabels.map((label, i) => {
                const val = String((i + 1) * 2);
                const isActive = energyValue === val;
                return (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={isActive || (!energyValue && i === 0) ? 0 : -1}
                    onClick={() => setValue("energyLevel", val)}
                    onKeyDown={(e) => handleRatingKeyDown(e, energyLabels, energyValue, "energyLevel")}
                    className={`flex flex-col items-center gap-1 rounded-xl py-3 text-[11px] font-semibold transition-all duration-200 ${isActive
                      ? `${energyColorsActive[i]} scale-[1.02]`
                      : energyColors[i]
                      }`}
                  >
                    <span className="text-base">{energyEmojis[i]}</span>
                    {label}
                  </button>
                );
              })}
            </div>
            <p id="energy-hint" className="mt-2 text-[11px] text-gray-400 dark:text-zinc-500">How did your energy feel throughout the week?</p>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes" className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-purple-500/10 text-xs dark:bg-purple-500/20">💬</span>
              Anything else?
            </label>
            <textarea
              id="notes"
              rows={3}
              {...register("notes")}
              placeholder="How was your week? Wins, struggles, anything on your mind…"
              aria-invalid={errors.notes ? "true" : undefined}
              aria-describedby={errors.notes ? "notes-error" : undefined}
              className="block w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-3.5 text-sm leading-relaxed transition-all focus-visible:border-blue-500 focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-zinc-200 dark:placeholder-zinc-600 dark:focus-visible:border-blue-500 dark:focus-visible:bg-white/[0.06] dark:focus-visible:ring-blue-500/30"
            />
            {errors.notes && (
              <p id="notes-error" className="mt-1.5 text-sm text-red-500">{errors.notes.message}</p>
            )}
          </div>
        </fieldset>

        {/* Custom Template Questions */}
        {sortedQuestions.length > 0 && (
          <fieldset className="space-y-4 border-t border-gray-100 pt-6 dark:border-white/[0.06]">
            <legend className="sr-only">Questions from your coach</legend>
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-zinc-200">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10 text-xs dark:bg-blue-500/20">📋</span>
              From your coach
            </p>
            {sortedQuestions.map((q) => (
              <CustomQuestionField
                key={q.id}
                question={q}
                value={customResponses[q.id] ?? ""}
                onChange={(val) =>
                  setCustomResponses((prev) => ({ ...prev, [q.id]: val }))
                }
                error={customErrors[q.id]}
              />
            ))}
          </fieldset>
        )}

        <PhotoUpload files={files} onFilesChange={setFiles} />

        <button
          type="submit"
          disabled={uploadState !== "idle"}
          className="w-full rounded-xl bg-gray-900 px-4 py-4 text-sm font-bold tracking-wide text-white transition-all hover:bg-gray-800 hover:shadow-lg active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:shadow-blue-500/30 dark:hover:brightness-110"
        >
          {buttonLabel}
        </button>
      </form>
    </>
  );
}

function CustomQuestionField({
  question,
  value,
  onChange,
  error,
}: {
  question: TemplateQuestion;
  value: string;
  onChange: (val: string) => void;
  error?: string;
}) {
  const fieldId = `custom-${question.id}`;
  const config = question.config as Record<string, unknown>;

  const inputClasses =
    "block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:focus-visible:bg-zinc-800";

  return (
    <div>
      <label
        htmlFor={fieldId}
        className="block text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1.5"
      >
        {question.label}
        {question.required && <span className="text-red-500"> *</span>}
      </label>

      {question.type === "shortText" && (
        <input
          id={fieldId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        />
      )}

      {question.type === "longText" && (
        <textarea
          id={fieldId}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClasses}
        />
      )}

      {question.type === "number" && (
        <div className="flex items-center gap-2">
          <input
            id={fieldId}
            type="number"
            step="any"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputClasses}
          />
          {typeof config.unit === "string" && config.unit && (
            <span className="shrink-0 text-sm text-zinc-400">
              {config.unit}
            </span>
          )}
        </div>
      )}

      {question.type === "boolean" && (
        <div className="flex gap-2" role="radiogroup" aria-labelledby={fieldId}>
          <button
            type="button"
            onClick={() => onChange(value === "yes" ? "" : "yes")}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${value === "yes"
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onChange(value === "no" ? "" : "no")}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${value === "no"
              ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
              : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              }`}
          >
            No
          </button>
        </div>
      )}

      {question.type === "scale" && (() => {
        const min = (config.min as number) ?? 1;
        const max = (config.max as number) ?? 10;
        const step = (config.step as number) ?? 1;
        return (
          <select
            id={fieldId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputClasses}
          >
            <option value="">Select...</option>
            {Array.from(
              { length: Math.floor((max - min) / step) + 1 },
              (_, i) => min + i * step
            ).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        );
      })()}

      {error && (
        <p className="mt-1 text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
