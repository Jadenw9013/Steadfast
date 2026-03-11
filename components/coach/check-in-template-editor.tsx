"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCheckInTemplate,
  updateCheckInTemplate,
} from "@/app/actions/check-in-templates";
import type { QuestionType } from "@/lib/validations/check-in-template";

type Question = {
  id: string;
  type: string;
  label: string;
  required: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
};

const questionTypeLabels: Record<QuestionType, string> = {
  shortText: "Short Text",
  longText: "Long Text",
  number: "Number",
  boolean: "Yes / No",
  scale: "Scale",
};

const questionTypeOptions: QuestionType[] = [
  "shortText",
  "longText",
  "number",
  "boolean",
  "scale",
];

function generateId() {
  return "q_" + Math.random().toString(36).slice(2, 10);
}

function defaultConfigForType(type: QuestionType): Record<string, unknown> {
  if (type === "scale") return { min: 1, max: 10, step: 1 };
  if (type === "number") return {};
  return {};
}

export function TemplateEditor({
  templateId,
  templateName,
  templateQuestions,
}: {
  templateId: string | null;
  templateName: string;
  templateQuestions: Question[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(templateName || "Custom Check-in");
  const [questions, setQuestions] = useState<Question[]>(
    templateQuestions.length > 0
      ? templateQuestions
      : [
          {
            id: generateId(),
            type: "scale" as string,
            label: "Sleep Quality",
            required: false,
            sortOrder: 0,
            config: { min: 1, max: 10, step: 1 },
          },
        ],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      {
        id: generateId(),
        type: "shortText",
        label: "",
        required: false,
        sortOrder: prev.length,
        config: {},
      },
    ]);
  }

  function removeQuestion(id: string) {
    setQuestions((prev) =>
      prev
        .filter((q) => q.id !== id)
        .map((q, i) => ({ ...q, sortOrder: i })),
    );
  }

  function updateQuestion(id: string, patch: Partial<Question>) {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...patch } : q)),
    );
  }

  function changeQuestionType(id: string, newType: QuestionType) {
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === id
          ? { ...q, type: newType, config: defaultConfigForType(newType) }
          : q,
      ),
    );
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    setQuestions((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((q, i) => ({ ...q, sortOrder: i }));
    });
  }

  function handleSave() {
    setError(null);
    setSaved(false);

    const hasEmptyLabel = questions.some((q) => !q.label.trim());
    if (hasEmptyLabel) {
      setError("All questions must have a label.");
      return;
    }
    if (!name.trim()) {
      setError("Template name is required.");
      return;
    }

    startTransition(async () => {
      try {
        const payload = {
          name: name.trim(),
          isDefault: true,
          questions: questions.map((q) => ({
            ...q,
            type: q.type as QuestionType,
          })),
        };

        let result;
        if (templateId) {
          result = await updateCheckInTemplate({
            templateId,
            ...payload,
          });
        } else {
          result = await createCheckInTemplate(payload);
        }

        if (result && "error" in result && result.error) {
          const msgs = Object.values(
            result.error as Record<string, string[]>,
          )
            .flat()
            .filter(Boolean)
            .join(", ");
          setError(msgs || "Validation failed");
          return;
        }

        setSaved(true);
        router.push("/coach/settings");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Template name */}
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <label
            htmlFor="template-name"
            className="block text-xs font-medium uppercase tracking-wider text-zinc-500 mb-1.5"
          >
            Template Name
          </label>
          <input
            id="template-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
      </div>

      {/* Core fields note */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/50">
        <p className="text-xs font-medium text-zinc-500">
          Core fields (weight, diet compliance, energy level, notes, photos)
          are always included in every check-in. Add custom questions below.
        </p>
      </div>

      {/* Questions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Custom Questions ({questions.length})
          </h2>
          <button
            type="button"
            onClick={addQuestion}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            + Add Question
          </button>
        </div>

        {questions.map((q, i) => (
          <div
            key={q.id}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start gap-3">
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5 pt-1">
                <button
                  type="button"
                  onClick={() => moveQuestion(i, -1)}
                  disabled={i === 0}
                  className="text-xs text-zinc-400 hover:text-zinc-600 disabled:opacity-30 dark:hover:text-zinc-300"
                  aria-label="Move up"
                >
                  &#9650;
                </button>
                <button
                  type="button"
                  onClick={() => moveQuestion(i, 1)}
                  disabled={i === questions.length - 1}
                  className="text-xs text-zinc-400 hover:text-zinc-600 disabled:opacity-30 dark:hover:text-zinc-300"
                  aria-label="Move down"
                >
                  &#9660;
                </button>
              </div>

              {/* Fields */}
              <div className="flex-1 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={q.label}
                    onChange={(e) =>
                      updateQuestion(q.id, { label: e.target.value })
                    }
                    placeholder="Question label"
                    className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                  />
                  <select
                    value={q.type}
                    onChange={(e) =>
                      changeQuestionType(
                        q.id,
                        e.target.value as QuestionType,
                      )
                    }
                    className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus-visible:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
                  >
                    {questionTypeOptions.map((t) => (
                      <option key={t} value={t}>
                        {questionTypeLabels[t]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Scale config */}
                {q.type === "scale" && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>Min:</span>
                    <input
                      type="number"
                      value={
                        (q.config as { min?: number }).min ?? 1
                      }
                      onChange={(e) =>
                        updateQuestion(q.id, {
                          config: {
                            ...q.config,
                            min: parseInt(e.target.value) || 0,
                          },
                        })
                      }
                      className="w-14 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <span>Max:</span>
                    <input
                      type="number"
                      value={
                        (q.config as { max?: number }).max ?? 10
                      }
                      onChange={(e) =>
                        updateQuestion(q.id, {
                          config: {
                            ...q.config,
                            max: parseInt(e.target.value) || 10,
                          },
                        })
                      }
                      className="w-14 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                    />
                  </div>
                )}

                {/* Number unit config */}
                {q.type === "number" && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>Unit:</span>
                    <input
                      type="text"
                      value={
                        (q.config as { unit?: string }).unit ?? ""
                      }
                      onChange={(e) =>
                        updateQuestion(q.id, {
                          config: {
                            ...q.config,
                            unit: e.target.value,
                          },
                        })
                      }
                      placeholder="e.g. lbs, inches"
                      className="w-28 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                    />
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) =>
                        updateQuestion(q.id, {
                          required: e.target.checked,
                        })
                      }
                      className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-600"
                    />
                    Required
                  </label>
                </div>
              </div>

              {/* Delete */}
              <button
                type="button"
                onClick={() => removeQuestion(q.id)}
                disabled={questions.length <= 1}
                className="mt-1 text-xs text-zinc-400 transition-colors hover:text-red-500 disabled:opacity-30"
                aria-label="Remove question"
              >
                &#10005;
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Error / Success */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
        >
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
          Template saved. Redirecting...
        </div>
      )}

      {/* Save button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={isPending}
        className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-gradient-to-r dark:from-blue-600 dark:to-blue-500 dark:text-white dark:shadow-lg dark:shadow-blue-500/20 dark:hover:brightness-110"
      >
        {isPending ? "Saving..." : templateId ? "Save Changes" : "Create Template"}
      </button>
    </div>
  );
}
