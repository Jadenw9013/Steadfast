"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markIntakeStarted, submitClientIntake } from "@/app/actions/client-intake";
import type { SubmitClientIntakeInput } from "@/lib/validations/client-intake";

// ─── Question definitions ────────────────────────────────────────────────────

type NumberQuestion = {
  id: keyof SubmitClientIntakeInput;
  type: "number";
  label: string;
  unit: string;
  placeholder: string;
  min: number;
  max: number;
  hint?: string;
};

type ChoiceQuestion = {
  id: keyof SubmitClientIntakeInput;
  type: "choice";
  label: string;
  options: string[];
  hint?: string;
};

type TextareaQuestion = {
  id: keyof SubmitClientIntakeInput;
  type: "textarea";
  label: string;
  placeholder: string;
  optional?: boolean;
  hint?: string;
};

type IntakeQuestion = NumberQuestion | ChoiceQuestion | TextareaQuestion;

const QUESTIONS: IntakeQuestion[] = [
  {
    id: "bodyweightLbs",
    type: "number",
    label: "What is your current bodyweight?",
    unit: "lbs",
    placeholder: "e.g. 175",
    min: 50,
    max: 700,
  },
  {
    id: "heightInches",
    type: "number",
    label: "How tall are you?",
    unit: "inches",
    placeholder: "e.g. 70",
    min: 24,
    max: 108,
    hint: "Enter your height in inches (e.g. 5\u20190\u2033 = 60 in, 5\u20196\u2033 = 66 in)",
  },
  {
    id: "ageYears",
    type: "number",
    label: "How old are you?",
    unit: "years",
    placeholder: "e.g. 28",
    min: 13,
    max: 100,
  },
  {
    id: "gender",
    type: "choice",
    label: "What is your gender?",
    options: ["Male", "Female", "Prefer not to say"],
  },
  {
    id: "primaryGoal",
    type: "choice",
    label: "What is your primary goal?",
    options: [
      "Lose body fat",
      "Build muscle",
      "Improve athletic performance",
      "Maintain weight",
      "General health",
    ],
  },

  {
    id: "trainingExperience",
    type: "choice",
    label: "How would you describe your training experience?",
    options: [
      "Beginner (0\u20131 year)",
      "Some experience (1\u20132 years)",
      "Intermediate (2\u20135 years)",
      "Advanced (5+ years)",
    ],
  },
  {
    id: "trainingDaysPerWeek",
    type: "number",
    label: "How many days per week can you train?",
    unit: "days/week",
    placeholder: "e.g. 4",
    min: 1,
    max: 7,
  },
  {
    id: "gymAccess",
    type: "choice",
    label: "What equipment do you have access to?",
    options: [
      "Full gym membership",
      "Home gym with equipment",
      "Minimal equipment (dumbbells / bands)",
      "No equipment (bodyweight only)",
    ],
  },
  {
    id: "injuries",
    type: "textarea",
    label: "Do you have any injuries or physical limitations?",
    placeholder:
      "Describe any injuries, pain, or movement restrictions\u2026 (or type \u201CNone\u201D)",
    optional: true,
  },
  {
    id: "dietaryRestrictions",
    type: "textarea",
    label: "Do you have any dietary restrictions?",
    placeholder: "e.g. Vegetarian, gluten-free, no dairy\u2026 (or type \u201CNone\u201D)",
    optional: true,
  },
  {
    id: "dietaryPreferences",
    type: "textarea",
    label: "Any other food preferences or dislikes?",
    placeholder: "e.g. I don\u2019t like fish, I prefer Mediterranean foods\u2026",
    optional: true,
  },
  {
    id: "currentDiet",
    type: "textarea",
    label: "Describe what you typically eat in a day",
    placeholder:
      "Walk me through a typical day of eating\u2014meals, snacks, rough portions\u2026",
    optional: true,
  },
];

const TOTAL = QUESTIONS.length;

// ─── Component ───────────────────────────────────────────────────────────────

type AnswerMap = Partial<Record<keyof SubmitClientIntakeInput, string>>;

export function IntakeStepper() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);

  const question = QUESTIONS[step];

  // Mark intake as started once on first render
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    markIntakeStarted().catch(() => {
      // Non-critical; ignore errors
    });
  }, []);

  // Navigate to a step: pre-fills input from saved answers
  // (done in event handlers, not effects, to avoid cascading re-renders)
  function goToStep(newStep: number, savedAnswers?: AnswerMap) {
    const map = savedAnswers ?? answers;
    setStep(newStep);
    setInputValue(map[QUESTIONS[newStep].id] ?? "");
    setError(null);
  }

  function validate(): string | null {
    const q = question;
    const val = inputValue.trim();

    if (q.type === "textarea" && q.optional) return null;
    if (!val) return "Please answer this question before continuing.";

    if (q.type === "number") {
      const n = parseFloat(val);
      if (isNaN(n)) return "Please enter a valid number.";
      if (n < q.min) return `Must be at least ${q.min}.`;
      if (n > q.max) return `Must be no more than ${q.max}.`;
    }

    return null;
  }

  function saveAndAdvance(value?: string) {
    const val = value !== undefined ? value : inputValue.trim();
    const q = question;

    // Validate unless optional textarea
    if (!(q.type === "textarea" && q.optional)) {
      if (!val) {
        setError("Please answer this question before continuing.");
        return;
      }
      if (q.type === "number") {
        const n = parseFloat(val);
        if (isNaN(n)) { setError("Please enter a valid number."); return; }
        if (n < q.min) { setError(`Must be at least ${q.min}.`); return; }
        if (n > q.max) { setError(`Must be no more than ${q.max}.`); return; }
      }
    }

    const updatedAnswers = { ...answers, [q.id]: val };
    setAnswers(updatedAnswers);

    if (step < TOTAL - 1) {
      goToStep(step + 1, updatedAnswers);
    } else {
      handleSubmit(updatedAnswers);
    }
  }

  async function handleSubmit(finalAnswers: AnswerMap) {
    setSubmitting(true);
    setError(null);

    const parseNum = (k: keyof SubmitClientIntakeInput) =>
      parseFloat(finalAnswers[k] ?? "0");
    const parseIntVal = (k: keyof SubmitClientIntakeInput) =>
      parseInt(finalAnswers[k] ?? "0", 10);
    const str = (k: keyof SubmitClientIntakeInput) => finalAnswers[k] ?? "";

    const payload: SubmitClientIntakeInput = {
      bodyweightLbs: parseNum("bodyweightLbs"),
      heightInches: parseNum("heightInches"),
      ageYears: parseIntVal("ageYears"),
      gender: str("gender"),
      primaryGoal: str("primaryGoal"),
      targetTimeline: "",
      injuries: str("injuries"),
      dietaryRestrictions: str("dietaryRestrictions"),
      dietaryPreferences: str("dietaryPreferences"),
      currentDiet: str("currentDiet"),
      trainingExperience: str("trainingExperience"),
      trainingDaysPerWeek: parseIntVal("trainingDaysPerWeek"),
      gymAccess: str("gymAccess"),
    };

    const result = await submitClientIntake(payload);

    if (result && "error" in result) {
      setError("Please check your answers and try again.");
      setSubmitting(false);
      return;
    }

    setDone(true);
    setSubmitting(false);
  }

  // ── Success screen ──────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex flex-col items-center gap-6 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-emerald-600 dark:text-emerald-400"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            All done!
          </h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Your coach will review your responses and prepare your plan.
          </p>
        </div>
        <button
          onClick={() => router.push("/client")}
          className="rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
        >
          Go to Dashboard
        </button>
      </div>
    );
  }

  // ── Progress bar ────────────────────────────────────────────────────────
  const progress = Math.round(((step + 1) / TOTAL) * 100);

  return (
    <div className="flex flex-col gap-8">
      {/* Progress */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">
            {step + 1} of {TOTAL}
          </span>
          <span className="text-xs font-medium text-zinc-400">{progress}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-zinc-900 transition-all duration-300 dark:bg-blue-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="min-h-[220px]">
        <h2 className="text-2xl font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
          {question.label}
        </h2>
        {question.hint && (
          <p className="mt-2 text-sm text-zinc-400">{question.hint}</p>
        )}

        {/* Input area */}
        <div className="mt-6">
          {question.type === "number" && (
            <div className="relative">
              <input
                type="number"
                inputMode="decimal"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") saveAndAdvance(); }}
                placeholder={question.placeholder}
                min={question.min}
                max={question.max}
                className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-4 text-xl font-semibold tabular-nums focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:ring-blue-500/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                autoFocus
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-zinc-400">
                {question.unit}
              </span>
            </div>
          )}

          {question.type === "choice" && (
            <div className="grid gap-2.5">
              {question.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => saveAndAdvance(opt)}
                  className={`w-full rounded-xl border px-5 py-4 text-left text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 ${
                    inputValue === opt
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-blue-500 dark:bg-blue-600 dark:text-white"
                      : "border-zinc-200 bg-white text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}

          {question.type === "textarea" && (
            <textarea
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setError(null); }}
              placeholder={question.placeholder}
              rows={4}
              maxLength={2000}
              className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm leading-relaxed focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:ring-blue-500/20"
              autoFocus
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => { if (step > 0) goToStep(step - 1); }}
          disabled={step === 0}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-500 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="Previous question"
        >
          &larr; Back
        </button>

        <div className="flex items-center gap-3">
          {/* Skip button for optional textarea steps */}
          {question.type === "textarea" && question.optional && !inputValue && (
            <button
              type="button"
              onClick={() => saveAndAdvance("")}
              className="text-xs font-medium text-zinc-400 underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Skip
            </button>
          )}

          {/* Next/Complete for non-choice questions */}
          {question.type !== "choice" && (
            <button
              type="button"
              onClick={() => {
                const valid = validate();
                if (valid) { setError(valid); return; }
                saveAndAdvance();
              }}
              disabled={submitting}
              className="flex items-center gap-1.5 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              {submitting
                ? "Submitting…"
                : step === TOTAL - 1
                ? "Complete"
                : "Next →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
