"use client";
import { useState } from "react";
import type { AiWorkspace } from "@/lib/queries/ai-coach";
// Leaf module only — no `lib/db.ts` in its import graph (T-2024 review
// round 4). Never import from "@/lib/ai-coach/intake" here; that module
// imports `db`/`pg`, and Next.js bundles by module, not by tree-shaken
// export, so any value import from it would pull `pg`'s Node-only
// internals (dns/fs/net/tls) into this client component's browser bundle.
import { PENDING_G01_WORDING, intakeV2ConfirmObjectSchema } from "@/lib/ai-coach/intake-contract";
// `intake-allergens.ts` is client-safe too (only a type-only import from
// `intake-contract.ts`, no runtime import at all) — reuse its
// `EMPTY_ALLERGEN_DECLARATIONS` instead of duplicating it here.
import { EMPTY_ALLERGEN_DECLARATIONS } from "@/lib/ai-coach/intake-allergens";
import { button, primary, fieldClass, inputStyle } from "./controls";

/**
 * T-2002/T-2024 — five-stage intake wizard (eligibility → about you → food →
 * training → review), replacing the single long form that used to live
 * inline in `experience.tsx`. Continue is never disabled because a status
 * is DECLINED/UNKNOWN — it is disabled only when a chosen CONFIRMED status
 * is missing its value. Each stage's Continue saves only that stage's
 * fields (SAVE_INTAKE, or ALLERGIES for the allergen sub-section) before
 * advancing, so a dropped connection never loses more than one stage.
 *
 * No calorie/gram/rate/coefficient anywhere below. The physiological
 * category and activity classification questions use the neutral
 * `PENDING_G01_WORDING` placeholder — the real wording is gate G01's
 * deliverable, not an engineering decision.
 */

type Answers = Record<string, unknown>;
type Dislike = { label: string; canonicalFoodId: string | null };

const safetyFields: Record<string, string> = {
  chestPainDuringExercise: "Chest pain during exercise?",
  dizzinessOrFainting: "Dizziness or fainting?",
  heartCondition: "A known heart condition?",
  pregnantOrPostpartum: "Pregnant or postpartum?",
  recentInjuryOrSurgery: "A recent injury or surgery?",
  ageEligibilityConcern: "Any age-eligibility concern?",
  eatingDisorderHistoryOrConcern: "Any eating-disorder history or concern?",
  type1Diabetes: "Type 1 diabetes?",
};

const EMPTY_DIETARY_PATTERN = {
  pattern: "NONE_DECLARED",
  otherLabel: null,
  mandatory: false,
  reason: "NOT_STATED",
  status: "UNKNOWN",
};

export function defaultAnswers(seed: Answers): Answers {
  return {
    intakeVersion: 2,
    ageStatus: "UNKNOWN",
    energyMethodPopulationCategoryStatus: "UNKNOWN",
    physicalActivityCategoryStatus: "UNKNOWN",
    bodyMeasurementStatus: "UNKNOWN",
    goalStatus: "UNKNOWN",
    trainingContextStatus: "UNKNOWN",
    cookingAccessStatus: "UNKNOWN",
    dislikes: [],
    cuisinePreferences: [],
    allergenDeclarations: EMPTY_ALLERGEN_DECLARATIONS,
    dietaryPattern: EMPTY_DIETARY_PATTERN,
    ...seed,
  };
}

/** Strips a governed value when its status is not CONFIRMED — "absent" per
 * the frozen contract means the key is omitted, not null/zero. */
export function pruneUnconfirmed(answers: Answers): Answers {
  const a = { ...answers };
  if (a.ageStatus !== "CONFIRMED") delete a.ageYears;
  if (a.energyMethodPopulationCategoryStatus !== "CONFIRMED") delete a.energyMethodPopulationCategory;
  if (a.physicalActivityCategoryStatus !== "CONFIRMED") delete a.physicalActivityCategory;
  if (a.bodyMeasurementStatus !== "CONFIRMED") {
    delete a.heightCm;
    delete a.weightKg;
    delete a.weightMeasuredOn;
  }
  if (a.goalStatus !== "CONFIRMED") {
    delete a.bodyWeightIntent;
    delete a.goalPaceClass;
    delete a.weightNeutralAccepted;
  }
  if (a.trainingContextStatus !== "CONFIRMED") {
    delete a.resistanceTrainingContext;
    delete a.sessionLengthBand;
  }
  if (a.cookingAccessStatus !== "CONFIRMED") delete a.cookingAccess;
  return a;
}

/** Every status-governed group the frozen `superRefine` on
 * `intakeV2ConfirmSchema` enforces jointly: `CONFIRMED` requires every
 * `valueKeys` entry present, else they must be absent. `stage` is the
 * wizard stage (0-indexed) that collects it, used to scope the Continue
 * disable rule to the stage the client is actually on. */
const GOVERNED_GROUPS: { statusKey: string; valueKeys: string[]; label: string; stage: number }[] = [
  { statusKey: "ageStatus", valueKeys: ["ageYears"], label: "Age", stage: 1 },
  {
    statusKey: "energyMethodPopulationCategoryStatus",
    valueKeys: ["energyMethodPopulationCategory"],
    label: "Physiological category",
    stage: 1,
  },
  {
    statusKey: "physicalActivityCategoryStatus",
    valueKeys: ["physicalActivityCategory"],
    label: "Activity level",
    stage: 1,
  },
  {
    statusKey: "bodyMeasurementStatus",
    valueKeys: ["heightCm", "weightKg", "weightMeasuredOn"],
    label: "Height and weight",
    stage: 1,
  },
  {
    statusKey: "goalStatus",
    valueKeys: ["bodyWeightIntent", "goalPaceClass", "weightNeutralAccepted"],
    label: "Goal and pace",
    stage: 1,
  },
  {
    statusKey: "trainingContextStatus",
    valueKeys: ["resistanceTrainingContext", "sessionLengthBand"],
    label: "Training context and session length",
    stage: 3,
  },
  { statusKey: "cookingAccessStatus", valueKeys: ["cookingAccess"], label: "Cooking and storage access", stage: 3 },
];

/** `select()` writes `""` when a client re-picks the placeholder option —
 * treated identically to `undefined` ("absent") everywhere a required or
 * status-governed value is checked, so an emptied dropdown can never look
 * "answered" to `confirmedWithoutValue`/`buildConfirmPayload`/
 * `requiredAnswerIssues`. */
export function isAbsent(value: unknown): boolean {
  return value === undefined || value === "";
}

/** Named groups whose status is CONFIRMED but a required value is missing
 * — the *only* thing Continue may ever be disabled by (T-2002 "Web UI
 * rules"). Scope to a single stage, or omit `stage` for every group
 * (used by the review summary). */
export function confirmedWithoutValue(
  a: Answers,
  stage?: number
): { statusKey: string; valueKeys: string[]; label: string; stage: number }[] {
  return GOVERNED_GROUPS.filter((group) => stage === undefined || group.stage === stage).filter(
    (group) => a[group.statusKey] === "CONFIRMED" && group.valueKeys.some((key) => isAbsent(a[key]))
  );
}

/** The seven v1 fields `intakeV2ConfirmSchema` requires unconditionally
 * (no governing status) — `trainingDaysPerWeek`/`equipmentAccess` are
 * already named by `trainingStageIssues`; these five plain selects had no
 * equivalent guard (T-2024 review round 3, MAJOR 1 = parity BLOCKER 1). */
const REQUIRED_V1_SCALAR_FIELDS: { key: string; label: string; stage: number }[] = [
  { key: "goal", label: "Goal", stage: 1 },
  { key: "experienceLevel", label: "Training experience", stage: 1 },
  { key: "trackingPreference", label: "Preferred nutrition display", stage: 1 },
  { key: "unitsPreference", label: "Preferred units", stage: 1 },
  { key: "foodBudgetLevel", label: "Food budget", stage: 2 },
];

export function requiredAnswerIssues(a: Answers, stage?: number): string[] {
  return REQUIRED_V1_SCALAR_FIELDS.filter((field) => stage === undefined || field.stage === stage)
    .filter((field) => isAbsent(a[field.key]))
    .map((field) => `${field.label}: choose an answer.`);
}

function pendingItems(a: Answers): string[] {
  const items: string[] = [];
  for (const group of GOVERNED_GROUPS) {
    if (a[group.statusKey] !== "CONFIRMED") items.push(group.label);
  }
  const declarations = a.allergenDeclarations as { status?: string } | undefined;
  if (declarations?.status !== "CONFIRMED") items.push("Allergy disclosures");
  const pattern = a.dietaryPattern as { status?: string } | undefined;
  if (pattern?.status !== "CONFIRMED") items.push("Dietary pattern");
  return items;
}

const ALLERGEN_SPECIFICITY_CATEGORIES = ["TREE_NUT", "FISH", "CRUSTACEAN_SHELLFISH", "OTHER"];

/** T-2024 review round 3, parity MINOR 7 — mirrors iOS's self-repair
 * (`AICoachAllergenEditor`): adding a declaration or checking "no known
 * allergens" sets status to CONFIRMED; emptying both back out (no
 * declarations and the checkbox unchecked) resets it to UNKNOWN. The
 * client-facing Status picker is a separate, manual override and is not
 * touched by this helper. */
export function autoAllergenStatus(noKnownAllergens: boolean, items: unknown[]): string {
  return noKnownAllergens || items.length > 0 ? "CONFIRMED" : "UNKNOWN";
}

/** Named, inline-shown reasons Continue is blocked on the Food stage — the
 * same client-side invariants the frozen `superRefine`s on
 * `allergenDeclarationSchema`/`allergenDeclarationsSchema`/`dietaryPatternSchema`
 * enforce server-side, checked here so an ordinary interaction (adding a
 * declaration while status is still "Not sure", an unfinished "Other" box,
 * a blank dislike) surfaces a named message instead of an opaque 422. */
export function foodStageIssues(a: Answers): string[] {
  const issues: string[] = [];
  const declarations =
    (a.allergenDeclarations as {
      status?: string;
      noKnownAllergens?: boolean;
      items?: { category?: string; specificity?: string | null }[];
    }) ?? EMPTY_ALLERGEN_DECLARATIONS;
  const items = declarations.items ?? [];
  if (declarations.status === "CONFIRMED") {
    if (Boolean(declarations.noKnownAllergens) === (items.length > 0))
      issues.push('Allergy disclosures: choose "no known allergens" or add at least one declaration, not both.');
  } else if (declarations.noKnownAllergens || items.length > 0) {
    issues.push('Allergy disclosures: set status to "Answer now" to save these, or clear them.');
  }
  for (const item of items) {
    const category = item.category ?? "";
    if (category === "OTHER" && !item.specificity?.trim())
      issues.push('Allergy disclosures: describe the "Other" allergen or remove it.');
    if (!ALLERGEN_SPECIFICITY_CATEGORIES.includes(category) && item.specificity)
      issues.push(`Allergy disclosures: ${category.replaceAll("_", " ").toLowerCase()} cannot include a specific type.`);
  }
  const pattern = (a.dietaryPattern as Record<string, unknown>) ?? EMPTY_DIETARY_PATTERN;
  if (pattern.pattern === "OTHER" && !(pattern.otherLabel as string | null)?.trim())
    issues.push("Dietary pattern: describe your pattern or choose a different option.");
  const dislikes = (a.dislikes as Dislike[] | undefined) ?? [];
  if (dislikes.some((dislike) => !dislike.label.trim()))
    issues.push("Foods you dislike: remove the blank entry or give it a name.");
  const cuisines = (a.cuisinePreferences as string[] | undefined) ?? [];
  if (cuisines.length > 10) issues.push("Cuisines you enjoy: choose at most 10.");
  return issues;
}

/** Named reasons Continue is blocked on the Training stage: the two
 * frozen bounds (`trainingDaysPerWeek` 1–7, `equipmentAccess` non-empty)
 * `intakeV2ConfirmSchema` already enforces server-side. */
export function trainingStageIssues(a: Answers): string[] {
  const issues: string[] = [];
  const days = a.trainingDaysPerWeek as number | undefined;
  if (days === undefined || days < 1 || days > 7)
    issues.push("Available training days: enter a number from 1 to 7.");
  const equipment = (a.equipmentAccess as string[] | undefined) ?? [];
  if (equipment.length === 0) issues.push("Available equipment: choose at least one option.");
  if (a.cookingAccessStatus === "CONFIRMED") {
    const cookingEquipment = (a.cookingAccess as { equipment?: string[] } | undefined)?.equipment ?? [];
    if (cookingEquipment.length === 0)
      issues.push("Cooking and storage access: choose at least one cooking equipment option.");
  }
  return issues;
}

/** The only things that may ever block Confirm: a CONFIRMED status missing
 * its value anywhere in the intake, or an ordinary interaction invariant
 * (allergen status/items mismatch, an unfinished "Other" box, a blank
 * dislike, an out-of-range training-days/empty-equipment value) — never a
 * DECLINED/UNKNOWN status by itself. */
export function reviewBlockingIssues(a: Answers): string[] {
  return [
    ...requiredAnswerIssues(a),
    ...confirmedWithoutValue(a).map((group) => `${group.label}: add the value or change its status.`),
    ...foodStageIssues(a),
    ...trainingStageIssues(a),
  ];
}

const STAGE_LABELS = ["Eligibility", "About you", "Food", "Training", "Review"];

// The exact 31 frozen `intakeV2ConfirmSchema` keys, read off the schema
// itself (never hand-duplicated) so this can never drift from what the
// server actually accepts. `answers` in this component is hydrated from
// `confirmedIntake`/`draft`, both of which may legitimately carry
// server-owned keys (`allergies`, `dietaryRestrictions`, `capturedAt`) that
// `intakeV2ConfirmSchema` is `.strict()` about rejecting — building the
// confirm body from this allow-list, instead of forwarding `answers`
// as-is, is what keeps those keys out.
const CONFIRM_KEYS = Object.keys(intakeV2ConfirmObjectSchema.shape);

/** Picks only the frozen confirm keys with a defined value out of a working
 * answers object. */
export function buildConfirmPayload(answers: Answers): Answers {
  const payload: Answers = {};
  for (const key of CONFIRM_KEYS) {
    if (!isAbsent(answers[key])) payload[key] = answers[key];
  }
  return payload;
}

export function IntakeWizard({
  view,
  busy,
  act,
  command,
  post,
  initialStage = 0,
}: {
  view: AiWorkspace;
  busy: boolean;
  act: (work: () => Promise<unknown>, success: string) => Promise<void>;
  command: (input: Record<string, unknown>) => Promise<unknown>;
  post: (url: string, input: Record<string, unknown>) => Promise<unknown>;
  /** Test-only: renders straight to a given stage without simulating every
   * Continue click. Production never passes this (always starts at 0). */
  initialStage?: number;
}) {
  const [stage, setStage] = useState(initialStage);
  const [safety, setSafety] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Answers>(() =>
    // A draft row is a subset by construction (each stage's Continue saves
    // only that stage's keys) — it must layer OVER the confirmed intake,
    // never shadow it, or every stage the client hasn't revisited since
    // their last edit renders empty despite the row still holding the data
    // (release-safety rule 4).
    defaultAnswers({
      ...((view.confirmedIntake as Answers | null) ?? {}),
      ...((view.draft as Answers | null) ?? {}),
    })
  );

  function set<K extends string>(key: K, value: unknown) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  const saveFields = (keys: string[]) =>
    command({
      operation: "SAVE_INTAKE",
      answers: Object.fromEntries(
        Object.entries(pruneUnconfirmed(answers)).filter(([key]) => keys.includes(key))
      ),
    });

  const saveAllergies = () =>
    command({ operation: "ALLERGIES", allergenDeclarations: answers.allergenDeclarations });

  function statusSelect(key: string, label: string) {
    return (
      <label key={key} className="block text-sm text-zinc-300">
        {label}
        <select
          className={fieldClass}
          style={inputStyle}
          value={(answers[key] as string) ?? "UNKNOWN"}
          onChange={(e) => set(key, e.target.value)}
        >
          <option value="CONFIRMED">Answer now</option>
          <option value="DECLINED">Prefer not to say</option>
          <option value="UNKNOWN">Not sure</option>
        </select>
      </label>
    );
  }

  function select(key: string, label: string, options: [string, string][]) {
    return (
      <label key={key} className="block text-sm text-zinc-300">
        {label}
        <select
          className={fieldClass}
          style={inputStyle}
          value={(answers[key] as string) ?? ""}
          onChange={(e) => set(key, e.target.value === "" ? undefined : e.target.value)}
        >
          <option value="">Choose an answer</option>
          {options.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function numberInput(key: string, label: string) {
    return (
      <label key={key} className="block text-sm text-zinc-300">
        {label}
        <input
          type="number"
          inputMode="decimal"
          className={fieldClass}
          style={inputStyle}
          value={(answers[key] as number | undefined) ?? ""}
          onChange={(e) => set(key, e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </label>
    );
  }

  function dateInput(key: string, label: string) {
    return (
      <label key={key} className="block text-sm text-zinc-300">
        {label}
        <input
          type="date"
          className={fieldClass}
          style={inputStyle}
          value={(answers[key] as string) ?? ""}
          onChange={(e) => set(key, e.target.value || undefined)}
        />
      </label>
    );
  }

  function checkbox(key: string, label: string) {
    return (
      <label key={key} className="flex min-h-12 items-center gap-3 text-zinc-300">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={Boolean(answers[key])}
          onChange={(e) => set(key, e.target.checked)}
        />
        {label}
      </label>
    );
  }

  function tagListInput(key: string, label: string) {
    const value = (answers[key] as string[] | undefined) ?? [];
    return (
      <label key={key} className="block text-sm text-zinc-300">
        {label} (comma-separated)
        <input
          className={fieldClass}
          style={inputStyle}
          value={value.join(", ")}
          onChange={(e) =>
            set(
              key,
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
        />
      </label>
    );
  }

  async function goTo(next: number, saveKeys?: string[], saveAllergensToo = false) {
    if (busy) return;
    // `act` (experience.tsx) catches and swallows — it never rejects, so a
    // failed save must not silently be followed by `setStage`. Track
    // success via this flag rather than relying on `act`'s return value
    // (release-safety: "a dropped connection never loses more than one
    // stage" only holds if a *failed* save keeps the client on the stage
    // whose answers only exist in React state).
    let succeeded = false;
    await act(async () => {
      if (saveAllergensToo) await saveAllergies();
      if (saveKeys) await saveFields(saveKeys);
      succeeded = true;
    }, "Saved. You can return to this step later.");
    if (succeeded) setStage(next);
  }

  return (
    <div className="space-y-6">
      <ol aria-label="Intake steps" className="flex flex-wrap gap-2 text-sm text-zinc-400">
        {STAGE_LABELS.map((label, index) => (
          <li
            key={label}
            className={`min-h-12 rounded-xl border px-3 py-2 flex items-center ${
              index === stage ? "border-blue-500 text-zinc-100" : "border-white/10"
            }`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {stage === 0 && (
        <section className="sf-glass-card space-y-4 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl font-semibold text-zinc-100">1. Eligibility and safety</h2>
          <p className="text-sm text-zinc-400">
            Choose Yes, No, or Unsure for every question. A new concern is saved independently of
            the rest of your intake.
          </p>
          {Object.entries(safetyFields).map(([key, label]) => (
            <label key={key} className="block text-sm text-zinc-300">
              {label}
              <select
                className={fieldClass}
                style={inputStyle}
                value={safety[key] ?? ""}
                onChange={(e) => setSafety({ ...safety, [key]: e.target.value })}
              >
                <option value="">Choose an answer</option>
                <option value="YES">Yes</option>
                <option value="NO">No</option>
                <option value="UNSURE">Unsure</option>
              </select>
            </label>
          ))}
          <button
            className={button}
            disabled={busy || !Object.values(safety).some((v) => v === "YES" || v === "UNSURE")}
            onClick={() =>
              act(
                () =>
                  post("/api/client/ai-coach/concerns", {
                    payload: {
                      safetyChanged: Object.values(safety).includes("YES") ? "YES" : "UNSURE",
                    },
                  }),
                "Concern saved. Affected advice is restricted while you complete the remaining answers."
              )
            }
          >
            Save selected concern now
          </button>
          {!Object.keys(safetyFields).every((k) => safety[k]) && (
            <p className="text-sm text-amber-300">
              Answer all eight questions to save your safety answers now. You can continue without
              finishing — nothing here is lost — but confirming your intake later requires coming
              back to this stage first.
            </p>
          )}
          <button
            className={primary}
            disabled={busy}
            onClick={() =>
              act(async () => {
                if (Object.keys(safetyFields).every((k) => safety[k]))
                  await command({ operation: "SAFETY", answers: safety });
                setStage(1);
              }, "Safety answers saved.")
            }
          >
            Continue
          </button>
        </section>
      )}

      {stage === 1 && (
        <section className="sf-glass-card space-y-4 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl font-semibold text-zinc-100">2. About you</h2>
          {select("goal", "Goal", [
            ["GENERAL_FITNESS", "General fitness"],
            ["STRENGTH", "Strength"],
            ["ENDURANCE", "Endurance"],
            ["BODY_COMPOSITION", "Body composition"],
          ])}
          {select("experienceLevel", "Training experience", [
            ["NEW", "New"],
            ["RETURNING", "Returning"],
            ["EXPERIENCED", "Experienced"],
          ])}
          {select("trackingPreference", "Preferred nutrition display", [
            ["NUMBERS_VISIBLE", "Show numbers"],
            ["PORTIONS_ONLY", "Prefer portions"],
          ])}
          {select("unitsPreference", "Preferred units", [
            ["METRIC", "Metric"],
            ["IMPERIAL", "Imperial"],
          ])}

          {statusSelect("ageStatus", "Age")}
          {answers.ageStatus === "CONFIRMED" && numberInput("ageYears", "Age in whole years")}

          {statusSelect("energyMethodPopulationCategoryStatus", PENDING_G01_WORDING)}
          {answers.energyMethodPopulationCategoryStatus === "CONFIRMED" &&
            select("energyMethodPopulationCategory", PENDING_G01_WORDING, [
              ["MALE_ADULT", "Male adult"],
              ["FEMALE_ADULT", "Female adult"],
              ["PREGNANCY", "Pregnancy"],
              ["LACTATION", "Lactation"],
              ["NOT_LISTED", "Not listed"],
            ])}

          {statusSelect("physicalActivityCategoryStatus", PENDING_G01_WORDING)}
          {answers.physicalActivityCategoryStatus === "CONFIRMED" &&
            select("physicalActivityCategory", PENDING_G01_WORDING, [
              ["INACTIVE", "Inactive"],
              ["LOW_ACTIVE", "Low active"],
              ["ACTIVE", "Active"],
              ["VERY_ACTIVE", "Very active"],
            ])}

          {statusSelect("bodyMeasurementStatus", "Height and weight")}
          {answers.bodyMeasurementStatus === "CONFIRMED" && (
            <>
              {numberInput("heightCm", "Height in centimetres")}
              {numberInput("weightKg", "Weight in kilograms")}
              {dateInput("weightMeasuredOn", "Date measured")}
            </>
          )}

          {statusSelect("goalStatus", "Goal and pace")}
          {answers.goalStatus === "CONFIRMED" && (
            <>
              {select("bodyWeightIntent", "Body weight intent", [
                ["LOSE", "Lose"],
                ["MAINTAIN", "Maintain"],
                ["GAIN", "Gain"],
                ["NO_PREFERENCE", "No preference"],
              ])}
              {select("goalPaceClass", "Goal pace", [
                ["MAINTAIN", "Maintain"],
                ["GRADUAL", "Gradual"],
                ["MODERATE", "Moderate"],
                ["UNDECIDED", "Undecided"],
              ])}
              {checkbox("weightNeutralAccepted", "I would accept a weight-neutral plan")}
            </>
          )}

          {(() => {
            const stage1Issues = [
              ...requiredAnswerIssues(answers, 1),
              ...confirmedWithoutValue(answers, 1).map((group) => `${group.label}: add the value or change its status.`),
            ];
            return (
              stage1Issues.length > 0 && (
                <ul className="space-y-1 text-sm text-amber-300">
                  {stage1Issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )
            );
          })()}
          <div className="flex flex-wrap gap-3">
            <button className={button} disabled={busy} onClick={() => setStage(0)}>
              Back
            </button>
            <button
              className={primary}
              disabled={
                busy || requiredAnswerIssues(answers, 1).length > 0 || confirmedWithoutValue(answers, 1).length > 0
              }
              onClick={() =>
                goTo(2, [
                  "intakeVersion",
                  "goal",
                  "experienceLevel",
                  "trackingPreference",
                  "unitsPreference",
                  "ageStatus",
                  "ageYears",
                  "energyMethodPopulationCategoryStatus",
                  "energyMethodPopulationCategory",
                  "physicalActivityCategoryStatus",
                  "physicalActivityCategory",
                  "bodyMeasurementStatus",
                  "heightCm",
                  "weightKg",
                  "weightMeasuredOn",
                  "goalStatus",
                  "bodyWeightIntent",
                  "goalPaceClass",
                  "weightNeutralAccepted",
                ])
              }
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {stage === 2 && (
        <section className="sf-glass-card space-y-4 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl font-semibold text-zinc-100">3. Food</h2>
          {select("foodBudgetLevel", "Food budget", [
            ["LOW", "Low"],
            ["MODERATE", "Moderate"],
            ["FLEXIBLE", "Flexible"],
          ])}
          {tagListInput("cuisinePreferences", "Cuisines you enjoy")}

          <fieldset className="space-y-3">
            <legend className="text-sm text-zinc-300">Foods you dislike</legend>
            {((answers.dislikes as Dislike[] | undefined) ?? []).map((dislike, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  className={fieldClass}
                  style={inputStyle}
                  value={dislike.label}
                  onChange={(e) => {
                    const next: Dislike[] = [...((answers.dislikes as Dislike[]) ?? [])];
                    next[index] = { label: e.target.value, canonicalFoodId: null };
                    set("dislikes", next);
                  }}
                />
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    const next = ((answers.dislikes as Dislike[]) ?? []).filter((_, i) => i !== index);
                    set("dislikes", next);
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className={button}
              onClick={() =>
                set("dislikes", [
                  ...((answers.dislikes as Dislike[]) ?? []),
                  { label: "", canonicalFoodId: null } satisfies Dislike,
                ])
              }
            >
              Add a dislike
            </button>
          </fieldset>

          <div className="space-y-3 rounded-xl border border-white/10 p-4">
            <h3 className="font-semibold text-zinc-100">Dietary pattern</h3>
            {(() => {
              const pattern = (answers.dietaryPattern as Record<string, unknown>) ?? EMPTY_DIETARY_PATTERN;
              const setPattern = (patch: Record<string, unknown>) =>
                set("dietaryPattern", { ...pattern, ...patch });
              return (
                <>
                  <label className="block text-sm text-zinc-300">
                    Pattern
                    <select
                      className={fieldClass}
                      style={inputStyle}
                      value={(pattern.pattern as string) ?? "NONE_DECLARED"}
                      onChange={(e) =>
                        setPattern({
                          pattern: e.target.value,
                          otherLabel: e.target.value === "OTHER" ? (pattern.otherLabel ?? "") : null,
                        })
                      }
                    >
                      <option value="OMNIVORE">Omnivore</option>
                      <option value="LACTO_OVO_VEGETARIAN">Lacto-ovo vegetarian</option>
                      <option value="VEGAN">Vegan</option>
                      <option value="PESCATARIAN">Pescatarian</option>
                      <option value="OTHER">Other</option>
                      <option value="NONE_DECLARED">Prefer not to say</option>
                    </select>
                  </label>
                  {pattern.pattern === "OTHER" && (
                    <label className="block text-sm text-zinc-300">
                      Describe your pattern
                      <input
                        className={fieldClass}
                        style={inputStyle}
                        value={(pattern.otherLabel as string) ?? ""}
                        onChange={(e) => setPattern({ otherLabel: e.target.value })}
                      />
                    </label>
                  )}
                  <label className="flex min-h-12 items-center gap-3 text-zinc-300">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={Boolean(pattern.mandatory)}
                      onChange={(e) => setPattern({ mandatory: e.target.checked })}
                    />
                    This is a hard exclusion, not just a preference
                  </label>
                  <label className="block text-sm text-zinc-300">
                    Reason
                    <select
                      className={fieldClass}
                      style={inputStyle}
                      value={(pattern.reason as string) ?? "NOT_STATED"}
                      onChange={(e) => setPattern({ reason: e.target.value })}
                    >
                      <option value="PREFERENCE">Preference</option>
                      <option value="RELIGIOUS_OR_ETHICAL">Religious or ethical</option>
                      <option value="MEDICAL_OR_CLINICIAN_DIRECTED">Medical or clinician-directed</option>
                      <option value="NOT_STATED">Prefer not to say</option>
                    </select>
                  </label>
                  <label className="block text-sm text-zinc-300">
                    Status
                    <select
                      className={fieldClass}
                      style={inputStyle}
                      value={(pattern.status as string) ?? "UNKNOWN"}
                      onChange={(e) => setPattern({ status: e.target.value })}
                    >
                      <option value="CONFIRMED">Answer now</option>
                      <option value="DECLINED">Prefer not to say</option>
                      <option value="UNKNOWN">Not sure</option>
                    </select>
                  </label>
                </>
              );
            })()}
          </div>

          <div className="space-y-3 rounded-xl border border-white/10 p-4">
            <h3 className="font-semibold text-zinc-100">Allergy disclosures</h3>
            <p className="text-sm text-zinc-400">Saved immediately and separately from the rest of this step.</p>
            {(() => {
              const declarations =
                (answers.allergenDeclarations as {
                  status: string;
                  noKnownAllergens: boolean;
                  items: Record<string, unknown>[];
                }) ?? EMPTY_ALLERGEN_DECLARATIONS;
              const setDeclarations = (patch: Record<string, unknown>) =>
                set("allergenDeclarations", { ...declarations, ...patch });
              return (
                <>
                  <label className="block text-sm text-zinc-300">
                    Status
                    <select
                      className={fieldClass}
                      style={inputStyle}
                      value={declarations.status}
                      onChange={(e) => setDeclarations({ status: e.target.value })}
                    >
                      <option value="CONFIRMED">Answer now</option>
                      <option value="DECLINED">Prefer not to say</option>
                      <option value="UNKNOWN">Not sure</option>
                    </select>
                  </label>
                  <label className="flex min-h-12 items-center gap-3 text-zinc-300">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={declarations.noKnownAllergens}
                      onChange={(e) => {
                        const nextItems = e.target.checked ? [] : declarations.items;
                        setDeclarations({
                          noKnownAllergens: e.target.checked,
                          items: nextItems,
                          status: autoAllergenStatus(e.target.checked, nextItems),
                        });
                      }}
                    />
                    No known allergens or intolerances
                  </label>
                  {!declarations.noKnownAllergens &&
                    declarations.items.map((item, index) => {
                      const category = item.category as string;
                      const acceptsSpecificity = ["TREE_NUT", "FISH", "CRUSTACEAN_SHELLFISH", "OTHER"].includes(
                        category
                      );
                      const update = (patch: Record<string, unknown>) => {
                        const next = [...declarations.items];
                        next[index] = { ...item, ...patch };
                        setDeclarations({ items: next });
                      };
                      return (
                        <div key={index} className="space-y-2 rounded-xl border border-white/10 p-3">
                          <select
                            className={fieldClass}
                            style={inputStyle}
                            value={category ?? "MILK"}
                            onChange={(e) =>
                              update({
                                category: e.target.value,
                                specificity: ["TREE_NUT", "FISH", "CRUSTACEAN_SHELLFISH"].includes(e.target.value)
                                  ? null
                                  : e.target.value === "OTHER"
                                    ? ""
                                    : null,
                              })
                            }
                          >
                            {[
                              "MILK",
                              "EGG",
                              "FISH",
                              "CRUSTACEAN_SHELLFISH",
                              "TREE_NUT",
                              "PEANUT",
                              "WHEAT",
                              "SOYBEAN",
                              "SESAME",
                              "OTHER",
                            ].map((c) => (
                              <option key={c} value={c}>
                                {c.replaceAll("_", " ")}
                              </option>
                            ))}
                          </select>
                          {acceptsSpecificity && (
                            <input
                              className={fieldClass}
                              style={inputStyle}
                              placeholder={category === "OTHER" ? "Describe (required)" : "Specific type (optional)"}
                              value={(item.specificity as string) ?? ""}
                              onChange={(e) => update({ specificity: e.target.value || (category === "OTHER" ? "" : null) })}
                            />
                          )}
                          <select
                            className={fieldClass}
                            style={inputStyle}
                            value={(item.kind as string) ?? "ALLERGY"}
                            onChange={(e) => update({ kind: e.target.value })}
                          >
                            <option value="ALLERGY">Allergy</option>
                            <option value="INTOLERANCE_OR_SENSITIVITY">Intolerance or sensitivity</option>
                          </select>
                          <select
                            className={fieldClass}
                            style={inputStyle}
                            value={(item.crossContactAvoidanceRequired as string) ?? "UNSURE"}
                            onChange={(e) => update({ crossContactAvoidanceRequired: e.target.value })}
                          >
                            <option value="YES">Cross-contact avoidance required</option>
                            <option value="NO">Cross-contact avoidance not required</option>
                            <option value="UNSURE">Unsure about cross-contact</option>
                          </select>
                          <button
                            type="button"
                            className={button}
                            onClick={() => {
                              const nextItems = declarations.items.filter((_, i) => i !== index);
                              setDeclarations({
                                items: nextItems,
                                status: autoAllergenStatus(declarations.noKnownAllergens, nextItems),
                              });
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  {!declarations.noKnownAllergens && (
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        const nextItems = [
                          ...declarations.items,
                          { category: "MILK", specificity: null, kind: "ALLERGY", crossContactAvoidanceRequired: "UNSURE" },
                        ];
                        setDeclarations({
                          items: nextItems,
                          status: autoAllergenStatus(declarations.noKnownAllergens, nextItems),
                        });
                      }}
                    >
                      Add a declaration
                    </button>
                  )}
                </>
              );
            })()}
          </div>

          {(() => {
            const stage2Issues = [...requiredAnswerIssues(answers, 2), ...foodStageIssues(answers)];
            return (
              stage2Issues.length > 0 && (
                <ul className="space-y-1 text-sm text-amber-300">
                  {stage2Issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )
            );
          })()}
          <div className="flex flex-wrap gap-3">
            <button className={button} disabled={busy} onClick={() => setStage(1)}>
              Back
            </button>
            <button
              className={primary}
              disabled={busy || requiredAnswerIssues(answers, 2).length > 0 || foodStageIssues(answers).length > 0}
              onClick={() =>
                goTo(3, ["intakeVersion", "foodBudgetLevel", "cuisinePreferences", "dislikes", "dietaryPattern"], true)
              }
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {stage === 3 && (
        <section className="sf-glass-card space-y-4 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl font-semibold text-zinc-100">4. Training</h2>
          {numberInput("trainingDaysPerWeek", "Available training days each week (1–7)")}
          <fieldset className="space-y-2">
            <legend className="text-sm text-zinc-300">Available equipment</legend>
            {["NONE", "HOME_BASIC", "FULL_GYM"].map((value) => {
              const current = (answers.equipmentAccess as string[] | undefined) ?? [];
              return (
                <label key={value} className="flex min-h-12 items-center gap-3 text-zinc-300">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={current.includes(value)}
                    onChange={(e) =>
                      set(
                        "equipmentAccess",
                        e.target.checked ? [...current, value] : current.filter((v) => v !== value)
                      )
                    }
                  />
                  {value === "NONE" ? "No equipment" : value === "HOME_BASIC" ? "Basic home equipment" : "Full gym"}
                </label>
              );
            })}
          </fieldset>

          {statusSelect("trainingContextStatus", "Training context and session length")}
          {answers.trainingContextStatus === "CONFIRMED" && (
            <>
              {select("resistanceTrainingContext", "Resistance training", [
                ["NONE", "None"],
                ["OCCASIONAL", "Occasional"],
                ["REGULAR", "Regular"],
              ])}
              {select("sessionLengthBand", "Typical session length", [
                ["UNDER_30", "Under 30 minutes"],
                ["MIN_30_45", "30–45 minutes"],
                ["MIN_45_60", "45–60 minutes"],
                ["MIN_60_90", "60–90 minutes"],
                ["OVER_90", "Over 90 minutes"],
              ])}
            </>
          )}

          {statusSelect("cookingAccessStatus", "Cooking and storage access")}
          {answers.cookingAccessStatus === "CONFIRMED" &&
            (() => {
              const cookingAccess =
                (answers.cookingAccess as Record<string, unknown>) ?? {
                  equipment: [],
                  refrigeration: "FRIDGE",
                  mealPrepCapacity: "SOME",
                  typicalPrepMinutesBand: "MIN_15_30",
                };
              const setCooking = (patch: Record<string, unknown>) => set("cookingAccess", { ...cookingAccess, ...patch });
              const equipment = (cookingAccess.equipment as string[]) ?? [];
              return (
                <div className="space-y-2 rounded-xl border border-white/10 p-4">
                  <fieldset className="space-y-2">
                    <legend className="text-sm text-zinc-300">Cooking equipment</legend>
                    {["NONE", "MICROWAVE", "STOVETOP", "OVEN", "FULL_KITCHEN"].map((value) => (
                      <label key={value} className="flex min-h-12 items-center gap-3 text-zinc-300">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={equipment.includes(value)}
                          onChange={(e) =>
                            setCooking({
                              equipment: e.target.checked
                                ? [...equipment, value]
                                : equipment.filter((v) => v !== value),
                            })
                          }
                        />
                        {value.replaceAll("_", " ")}
                      </label>
                    ))}
                  </fieldset>
                  <label className="block text-sm text-zinc-300">
                    Refrigeration
                    <select
                      className={fieldClass}
                      style={inputStyle}
                      value={(cookingAccess.refrigeration as string) ?? "FRIDGE"}
                      onChange={(e) => setCooking({ refrigeration: e.target.value })}
                    >
                      <option value="NONE">None</option>
                      <option value="FRIDGE">Fridge</option>
                      <option value="FRIDGE_AND_FREEZER">Fridge and freezer</option>
                    </select>
                  </label>
                  <label className="block text-sm text-zinc-300">
                    Meal prep capacity
                    <select
                      className={fieldClass}
                      style={inputStyle}
                      value={(cookingAccess.mealPrepCapacity as string) ?? "SOME"}
                      onChange={(e) => setCooking({ mealPrepCapacity: e.target.value })}
                    >
                      <option value="NONE">None</option>
                      <option value="SOME">Some</option>
                      <option value="BATCH">Batch cooking</option>
                    </select>
                  </label>
                  <label className="block text-sm text-zinc-300">
                    Typical prep time
                    <select
                      className={fieldClass}
                      style={inputStyle}
                      value={(cookingAccess.typicalPrepMinutesBand as string) ?? "MIN_15_30"}
                      onChange={(e) => setCooking({ typicalPrepMinutesBand: e.target.value })}
                    >
                      <option value="UNDER_15">Under 15 minutes</option>
                      <option value="MIN_15_30">15–30 minutes</option>
                      <option value="MIN_30_60">30–60 minutes</option>
                      <option value="OVER_60">Over 60 minutes</option>
                    </select>
                  </label>
                </div>
              );
            })()}

          {[...trainingStageIssues(answers), ...confirmedWithoutValue(answers, 3).map((g) => `${g.label}: choose a value or set status to "Prefer not to say"/"Not sure".`)].length > 0 && (
            <ul className="space-y-1 text-sm text-amber-300">
              {[
                ...trainingStageIssues(answers),
                ...confirmedWithoutValue(answers, 3).map(
                  (g) => `${g.label}: choose a value or set status to "Prefer not to say"/"Not sure".`
                ),
              ].map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <button className={button} disabled={busy} onClick={() => setStage(2)}>
              Back
            </button>
            <button
              className={primary}
              disabled={
                busy || trainingStageIssues(answers).length > 0 || confirmedWithoutValue(answers, 3).length > 0
              }
              onClick={() =>
                goTo(4, [
                  "intakeVersion",
                  "trainingDaysPerWeek",
                  "equipmentAccess",
                  "trainingContextStatus",
                  "resistanceTrainingContext",
                  "sessionLengthBand",
                  "cookingAccessStatus",
                  "cookingAccess",
                ])
              }
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {stage === 4 && (
        <section className="sf-glass-card space-y-4 rounded-2xl border border-white/10 p-5">
          <h2 className="text-xl font-semibold text-zinc-100">5. Review</h2>
          {pendingItems(answers).length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-zinc-300">
              <p className="font-semibold text-amber-200">Personalized nutrition stays pending for:</p>
              <ul className="mt-2 list-disc pl-5">
                {pendingItems(answers).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-zinc-400">
                You can confirm now and answer these later — nothing here blocks confirmation.
              </p>
            </div>
          )}
          {reviewBlockingIssues(answers).length > 0 ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-300">
              <p className="font-semibold">Fix these before confirming:</p>
              <ul className="mt-2 list-disc pl-5">
                {reviewBlockingIssues(answers).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-zinc-300">Ready to confirm.</p>
          )}
          <div className="flex flex-wrap gap-3">
            <button className={button} disabled={busy} onClick={() => setStage(3)}>
              Back
            </button>
            <button
              className={primary}
              disabled={busy || reviewBlockingIssues(answers).length > 0}
              onClick={() =>
                act(async () => {
                  await saveAllergies();
                  const finalAnswers = buildConfirmPayload(
                    pruneUnconfirmed({ ...answers, intakeVersion: 2 })
                  );
                  await command({ operation: "CONFIRM_INTAKE", answers: finalAnswers });
                  if (typeof window !== "undefined") {
                    window.location.assign("/client/ai-coach");
                  }
                }, "Intake confirmed. Returning to your coaching plan...")
              }
            >
              Confirm intake
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
