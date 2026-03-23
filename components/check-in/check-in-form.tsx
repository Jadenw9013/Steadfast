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

// ── Step config ────────────────────────────────────────────────────────────────

const STEPS = [
  { label: "Weight" },
  { label: "Photos" },
  { label: "Details" },
  { label: "Submit" },
] as const;

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
  const [, setToast] = useState<string | null>(null);
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

  useEffect(() => {
    weightRef.current?.focus();
  }, []);

  // Derive active step for the sticky header (0-indexed)
  const activeStep = !weightValue ? 0 : files.length === 0 ? 1 : !dietValue && !energyValue ? 2 : 3;

  // Progress bar: 4 segments
  const filledSegments = [
    !!weightValue,
    files.length > 0,
    !!(dietValue || energyValue || notesValue),
    false, // step 4 = submit — never pre-filled
  ];

  // Keyboard nav
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

  async function withRetry<T>(fn: () => Promise<T>, retries: number, delay: number): Promise<T> {
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
      const uploadUrls = await withRetry(() => createSignedUploadUrls(fileNames), 2, 1000);
      setUploadState("uploading");
      await Promise.all(
        uploadUrls.map(async ({ signedUrl, path }, i) => {
          await withRetry(async () => {
            const res = await fetch(signedUrl, {
              method: "PUT",
              headers: { "Content-Type": files[i].type, "x-upsert": "true" },
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

  async function submitCheckIn(values: FormValues, photoPaths: string[], overwriteToday?: boolean) {
    setUploadState("submitting");
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
      const messages = Object.values(result.error).filter((v): v is string[] => Array.isArray(v)).flat().join(", ");
      setError(messages || "Validation failed");
      return;
    }
    if ("conflict" in result && result.conflict) {
      setConflictModal({ submittedAt: result.conflict.existing.submittedAt, pendingValues: values, pendingPhotoPaths: photoPaths });
      return;
    }
    if ("overwritten" in result && result.overwritten) {
      setToast("Check-in updated.");
      setTimeout(() => { router.push("/client"); router.refresh(); }, 1200);
      return;
    }
    setShowSuccess(true);
    setTimeout(() => { router.push("/client"); router.refresh(); }, 1800);
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
    try { await submitCheckIn(pendingValues, pendingPhotoPaths, true); }
    catch (err) { setError(err instanceof Error ? err.message : "Something went wrong"); }
    finally { setUploadState("idle"); }
  }

  async function handleAddNew() {
    if (!conflictModal) return;
    const { pendingValues, pendingPhotoPaths } = conflictModal;
    setConflictModal(null);
    setError(null);
    setUploadState("submitting");
    try { await submitCheckIn(pendingValues, pendingPhotoPaths, false); }
    catch (err) { setError(err instanceof Error ? err.message : "Something went wrong"); }
    finally { setUploadState("idle"); }
  }

  const previousDateLabel = previousWeight
    ? new Date(previousWeight.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  const buttonLabel =
    uploadState === "getting-urls" ? "Preparing upload…"
    : uploadState === "uploading" ? "Uploading photos…"
    : uploadState === "submitting" ? "Saving…"
    : "Send to Coach";

  const conflictTimeLabel = conflictModal
    ? new Date(conflictModal.submittedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  // Diet options
  const dietLabels = ["Off track", "Needs work", "OK", "Good", "Crushed it"];
  const dietIcons = [
    <svg key="offtrack" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>,
    <svg key="needswork" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>,
    <svg key="ok" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" /></svg>,
    <svg key="good" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#84cc16" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>,
    <svg key="crushedit" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" /><circle cx="12" cy="8" r="6" /></svg>,
  ];
  const dietActiveColors = [
    "ring-2 ring-red-500/60 bg-red-500/20 text-red-300",
    "ring-2 ring-orange-500/60 bg-orange-500/20 text-orange-300",
    "ring-2 ring-yellow-500/60 bg-yellow-500/20 text-yellow-300",
    "ring-2 ring-lime-500/60 bg-lime-500/20 text-lime-300",
    "ring-2 ring-emerald-500/60 bg-emerald-500/20 text-emerald-300",
  ];

  // Energy options
  const energyLabels = ["Drained", "Low", "Average", "Good", "Fired up"];
  const energyIcons = [
    <svg key="drained" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v6" /><path d="M4.93 4.93A10 10 0 1 0 19.07 19.07" /></svg>,
    <svg key="low" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="8" y1="12" x2="16" y2="12" /></svg>,
    <svg key="average" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="8" y1="15" x2="16" y2="15" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>,
    <svg key="good" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></svg>,
    <svg key="firedup" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="m13 9-3 4h4l-3 4" /></svg>,
  ];
  const energyActiveColors = [
    "ring-2 ring-red-500/60 bg-red-500/20 text-red-300",
    "ring-2 ring-orange-500/60 bg-orange-500/20 text-orange-300",
    "ring-2 ring-yellow-500/60 bg-yellow-500/20 text-yellow-300",
    "ring-2 ring-lime-500/60 bg-lime-500/20 text-lime-300",
    "ring-2 ring-indigo-500/60 bg-indigo-500/20 text-indigo-300",
  ];

  const stepCard = "rounded-2xl border border-white/[0.07] bg-[#111827] p-5 shadow-lg";
  const stepLabel = "mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400/80";
  const stepTitle = "text-xl font-bold text-white";
  const stepSub = "mt-0.5 text-[12px] text-zinc-500";
  const emojiBtn = "flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.04] py-3 text-[11px] font-semibold text-zinc-400 transition-all duration-150 active:scale-95 cursor-pointer";
  const emojiBtnActive = "scale-[1.04]";

  return (
    <>
      {/* Success overlay */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020815]/95">
          <div className="flex flex-col items-center gap-5 animate-fade-in">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-white">Sent to your coach!</p>
              <p className="mt-1 text-sm text-zinc-400">They&apos;ll review it soon</p>
            </div>
          </div>
        </div>
      )}

      {/* Conflict modal */}
      {conflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#111827] p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Already checked in today</h3>
            <p className="mt-2 text-sm text-zinc-400">
              You submitted at {conflictTimeLabel} today. What would you like to do?
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button onClick={handleOverwrite} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 cursor-pointer">
                Overwrite today&apos;s check-in
              </button>
              <button onClick={handleAddNew} className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.05] cursor-pointer">
                Add as new check-in
              </button>
              <button onClick={() => setConflictModal(null)} className="w-full rounded-xl px-4 py-3 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-300 cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sticky progress header */}
      <div className="sticky top-0 z-20 -mx-4 bg-[#070d1a]/90 px-4 pt-3 pb-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        {/* Step labels */}
        <div className="mb-2 flex justify-between">
          {STEPS.map((step, i) => (
            <span
              key={step.label}
              className={`text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                i <= activeStep ? "text-blue-400" : "text-zinc-600"
              }`}
            >
              {step.label}
            </span>
          ))}
        </div>
        {/* Segmented bar */}
        <div className="flex gap-1.5">
          {filledSegments.map((filled, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                filled ? "bg-blue-500" : i === activeStep ? "bg-blue-500/30" : "bg-white/10"
              }`}
            />
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3 pb-28" noValidate>

        {error && (
          <div role="alert" className="rounded-xl border border-red-900/50 bg-red-950/50 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* STEP 1 — Weight */}
        <div className={stepCard}>
          <p className={stepLabel}>Step 1 · Weight</p>
          <p className={stepTitle}>What&apos;s your weight?</p>
          <p className={stepSub}>Morning weight, after bathroom</p>

          {weightValue && (
            <p className="mt-3 font-display text-5xl font-black tabular-nums text-white">
              {weightValue}<span className="ml-1.5 text-xl font-normal text-zinc-500">lbs</span>
            </p>
          )}
          {!weightValue && (
            <p className="mt-3 font-display text-5xl font-black tabular-nums text-zinc-600">—<span className="ml-1.5 text-xl font-normal text-zinc-700">lbs</span></p>
          )}

          {previousWeight && (
            <p className="mt-1 text-xs text-zinc-600">
              Last week: <span className="text-zinc-400">{previousWeight.weight} lbs</span>
              <span className="ml-1.5 text-zinc-600">{previousDateLabel}</span>
            </p>
          )}

          <div className="mt-4">
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
              style={{ fontSize: "max(1rem, 16px)" }}
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-center font-bold tabular-nums text-white placeholder-zinc-700 transition-all focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
            />
          </div>
          {errors.weight && (
            <p className="mt-2 text-sm text-red-400">{errors.weight.message}</p>
          )}
        </div>

        {/* STEP 2 — Progress photos */}
        <div className={stepCard}>
          <p className={stepLabel}>Step 2 · Photos</p>
          <p className={stepTitle}>Add your photos</p>
          <p className={stepSub}>Front, side, and back — required on Fridays</p>
          <div className="mt-4">
            <PhotoUpload files={files} onFilesChange={setFiles} />
          </div>
        </div>

        {/* STEP 3 — Details: Nutrition + Energy + Notes */}
        <div className={stepCard}>
          <p className={stepLabel}>Step 3 · Details</p>
          <p className={stepTitle}>How was your week?</p>
          <p className={stepSub}>Nutrition, energy, and anything on your mind</p>

          {/* Nutrition */}
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Nutrition</p>
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Nutrition rating">
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
                    className={`${emojiBtn} ${isActive ? `${dietActiveColors[i]} ${emojiBtnActive}` : ""}`}
                  >
                    {dietIcons[i]}
                    <span className="leading-tight">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Energy */}
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Energy</p>
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Energy rating">
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
                    className={`${emojiBtn} ${isActive ? `${energyActiveColors[i]} ${emojiBtnActive}` : ""}`}
                  >
                    {energyIcons[i]}
                    <span className="leading-tight">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Notes */}
          <div className="mt-5">
            <label htmlFor="notes" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Notes <span className="font-normal normal-case tracking-normal text-zinc-600">(optional)</span>
            </label>
            <textarea
              id="notes"
              rows={4}
              {...register("notes")}
              placeholder="Wins, struggles, questions — your coach reads every word"
              aria-invalid={errors.notes ? "true" : undefined}
              style={{ fontSize: "max(1rem, 16px)" }}
              className="block w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 leading-relaxed text-zinc-200 placeholder-zinc-700 transition-all focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
            />
            {errors.notes && (
              <p className="mt-2 text-sm text-red-400">{errors.notes.message}</p>
            )}
          </div>
        </div>

        {/* Custom template questions */}
        {sortedQuestions.length > 0 && (
          <div className={stepCard}>
            <p className={`${stepLabel} !text-blue-300/60`}>From your coach</p>
            <div className="mt-3 space-y-4">
              {sortedQuestions.map((q) => (
                <CustomQuestionField
                  key={q.id}
                  question={q}
                  value={customResponses[q.id] ?? ""}
                  onChange={(val) => setCustomResponses((prev) => ({ ...prev, [q.id]: val }))}
                  error={customErrors[q.id]}
                />
              ))}
            </div>
          </div>
        )}

      </form>

      {/* Fixed bottom CTA — step 4 */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/[0.06] bg-[#070d1a]/95 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        <div className="mx-auto max-w-lg">
          <button
            type="submit"
            form="checkin-form"
            disabled={uploadState !== "idle"}
            onClick={handleSubmit(onSubmit)}
            style={{ minHeight: "56px" }}
            className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl bg-blue-600 px-4 py-3.5 text-base font-bold tracking-wide text-white shadow-lg shadow-blue-600/25 transition-all hover:bg-blue-500 hover:shadow-blue-500/30 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070d1a] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadState !== "idle" ? (
              <>
                <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                {buttonLabel}
              </>
            ) : (
              <>
                {buttonLabel}
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12 14 0" /><path d="m13 5 7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
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
    "block w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30";

  return (
    <div>
      <label htmlFor={fieldId} className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
        {question.label}
        {question.required && <span className="text-red-400"> *</span>}
      </label>

      {question.type === "shortText" && (
        <input id={fieldId} type="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ fontSize: "max(1rem, 16px)" }} className={inputClasses} />
      )}

      {question.type === "longText" && (
        <textarea id={fieldId} rows={3} value={value} onChange={(e) => onChange(e.target.value)} style={{ fontSize: "max(1rem, 16px)" }} className={inputClasses} />
      )}

      {question.type === "number" && (
        <div className="flex items-center gap-2">
          <input id={fieldId} type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} style={{ fontSize: "max(1rem, 16px)" }} className={inputClasses} />
          {typeof config.unit === "string" && config.unit && (
            <span className="shrink-0 text-sm text-zinc-500">{config.unit}</span>
          )}
        </div>
      )}

      {question.type === "boolean" && (
        <div className="flex gap-2" role="radiogroup" aria-labelledby={fieldId}>
          <button type="button" onClick={() => onChange(value === "yes" ? "" : "yes")}
            style={{ minHeight: "48px" }}
            className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${value === "yes" ? "border-blue-500 bg-blue-500/20 text-blue-300" : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-300"}`}>
            Yes
          </button>
          <button type="button" onClick={() => onChange(value === "no" ? "" : "no")}
            style={{ minHeight: "48px" }}
            className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${value === "no" ? "border-red-500/60 bg-red-500/20 text-red-300" : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-zinc-300"}`}>
            No
          </button>
        </div>
      )}

      {question.type === "scale" && (() => {
        const min = (config.min as number) ?? 1;
        const max = (config.max as number) ?? 10;
        const step = (config.step as number) ?? 1;
        return (
          <select id={fieldId} value={value} onChange={(e) => onChange(e.target.value)}
            style={{ fontSize: "max(1rem, 16px)", minHeight: "48px" }}
            className="block w-full rounded-xl border border-white/[0.08] bg-[#111827] px-3 py-2.5 text-zinc-200 focus-visible:border-blue-500 focus-visible:outline-none">
            <option value="">Select...</option>
            {Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        );
      })()}

      {error && <p className="mt-1.5 text-sm text-red-400">{error}</p>}
    </div>
  );
}
