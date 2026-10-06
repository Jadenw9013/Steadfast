import { intakeAnswersSchema, isV2Intake, type IntakeAnswers } from "./intake";
import { planPayloadSchema, type PlanPayload, type ReviewDecision } from "./plan-contract";
import { FOOD_CATALOG_VERSION } from "./catalog/food-catalog";
import { EXERCISE_CATALOG_VERSION } from "./catalog/exercise-catalog";
import { ACTIVE_POLICY_VERSION } from "./policy/policy-version";
import { computeNutrientTotals } from "./nutrition-totals";
import { checkMealComposition } from "./composition-feasibility";
import { getFoodItem } from "./catalog/loader";
import type { FoodItem } from "./catalog/schema";
import { mealTargetsMatch } from "./representation";
import {
  buildPrescriptionInput,
  computePrescription,
  nutritionRequiredForGoal,
  type Prescription,
  type PrescriptionResult,
  type ResolvedPrescriptionParameters,
} from "./prescription";
import {
  classifyPrescriptionReasonCodes,
  type PrescriptionReasonClass,
} from "./prescription-reason-classes";
import { daySpread, composeTraining } from "./training";
import type {
  ResolvedTrainingParameters,
  TrainingCatalogSource,
  TrainingReasonCode,
} from "./training/types";
import { trainingCatalogSourceFromDraftFile } from "./training/catalog-source";
import type { MealTemplateSet } from "./catalog/meal-template-schema";
import type { FoodCatalogSource } from "./catalog/food-source";
import { composeWeekFromTemplates, type ComposeConstraints, type ComposeReason } from "./meal-composer";
import { foodCatalogIsServedInCode } from "./catalog/loader";
import { mealComposerConstraintsFromIntake } from "./meal-constraints";

/** All doses, targets and templates below are SYNTHETIC TEST FIXTURES (G01/G02).
 * The runtime must additionally require a synthetic subject and nonproduction
 * fixture mode. No combination of public flags authorizes real use of this code.
 */
export function composeFixtureMeals(answers: IntakeAnswers, scale = 1): NonNullable<PlanPayload["meals"]> | null {
  const grams = (value: number) => Math.round(value * scale / 5) * 5;
  const ingredients = [
    { foodId: "chicken-breast-raw", catalogVersion: FOOD_CATALOG_VERSION, grams: grams(150), state: "RAW" as const },
    { foodId: "brown-rice-cooked", catalogVersion: FOOD_CATALOG_VERSION, grams: grams(200), state: "COOKED" as const },
    { foodId: "broccoli-steamed", catalogVersion: FOOD_CATALOG_VERSION, grams: grams(100), state: "COOKED" as const },
  ];
  // This tiny fixture catalog cannot satisfy every preference. Never silently
  // drop an unknown restriction or claim a diet is feasible when it is not.
  if (answers.dietaryRestrictions.some(r => !["GLUTEN_FREE", "DAIRY_FREE"].includes(r.trim().toUpperCase().replace(/[\s-]+/g, "_")))) return null;
  if (!checkMealComposition({ components: ingredients, allergies: answers.allergies, dietaryRestrictions: answers.dietaryRestrictions, nutritionPermission: "ALLOW", policyVersion: ACTIVE_POLICY_VERSION }).feasible) return null;
  return { days: Array.from({ length: 7 }, (_, day) => ({ day: day + 1, meals: Array.from({ length: 3 }, (_, meal) => ({ id: `fixture-meal-${day + 1}-${meal + 1}`, name: "Fixture chicken, rice and broccoli", ingredients, servings: 1, preparation: "Synthetic portion example; reviewed preparation and food-safety instructions are not available." })) })) };
}

/** Shared by the legacy synthetic path and the v2 prescription-first path
 * (CLAUDE.md rule 1: one implementation, not a copy per branch). */
function buildFixtureTrainingSections(answers: IntakeAnswers) {
  const days = Array.from({ length: answers.trainingDaysPerWeek }, (_, i) => daySpread(i, answers.trainingDaysPerWeek));
  return {
    strength: days.map(day => ({ sessionId: `strength-${day}`, templateId: "fixture-beginner-v1", day, exercises: [{ exerciseId: answers.equipmentAccess.some(e => e !== "NONE") ? "goblet-squat" : "bodyweight-squat", catalogVersion: EXERCISE_CATALOG_VERSION, sets: 2, reps: 8, restSeconds: 90, effort: "Synthetic starting-dose fixture; no live exercise guidance." }] })),
    cardio: [{ sessionId: "cardio-1", exerciseId: "brisk-walk", catalogVersion: EXERCISE_CATALOG_VERSION, day: days[0], durationMinutes: 15, intensity: "Synthetic intensity fixture; qualified review required." }],
  };
}

export type ComposeInitialPlanResult = {
  payload: PlanPayload;
  decision: ReviewDecision;
  prescription: PrescriptionResult;
};

/**
 * T-2033 — today's `buildInitialFixturePlan` body, moved **verbatim** (T-2003
 * spec, file item 2), renamed. Still stamps `method: "SYNTHETIC_CATALOG_MATCH"`
 * and `tolerancePercent: 5`; the only addition is the new, always-present
 * `prescriptionOutcome` field so every payload from every path carries it.
 */
export function composeLegacySyntheticPlan(
  rawAnswers: unknown,
  prescriptionId: string,
  mode: "MACROS" | "MEALS"
): ComposeInitialPlanResult {
  const answers = intakeAnswersSchema.parse(rawAnswers);
  const scale = answers.weightKg && answers.heightCm ? Math.max(0.5, Math.min(2, answers.weightKg / 70)) : null;
  const meals = scale === null ? null : composeFixtureMeals(answers, scale);
  const totals = meals ? computeNutrientTotals(meals.days[0].meals.flatMap(m => m.ingredients)) : null;
  const targets = totals?.success ? {
    energyKcal: Math.round(totals.totals.energyKcal), proteinG: Math.round(totals.totals.proteinG * 10) / 10,
    carbsG: Math.round(totals.totals.carbsG * 10) / 10, fatG: Math.round(totals.totals.fatG * 10) / 10,
  } : null;
  const { strength, cardio } = buildFixtureTrainingSections(answers);
  const payload = planPayloadSchema.parse({
    schemaVersion: 1, contentKind: "SYNTHETIC_FIXTURE",
    nutrition: targets ? { prescriptionId, method: "SYNTHETIC_CATALOG_MATCH", targets, tolerancePercent: 5, assumptions: ["Synthetic values for software testing, not a dietary recommendation.", "Micronutrient adequacy is unknown; real policy and catalog review are required."] } : null,
    meals: mode === "MEALS" ? meals : null,
    strength, cardio,
    policyVersion: ACTIVE_POLICY_VERSION, catalogVersions: { food: FOOD_CATALOG_VERSION, exercise: EXERCISE_CATALOG_VERSION },
    // T-2033: the legacy synthetic path never runs the prescription engine —
    // it stamps PRESCRIBED/UNAVAILABLE purely from whether it produced
    // targets, with an empty reasonCodes list and no digest (T-2003 file
    // item 2). `nutritionRequired` stays `false` on this path by design: the
    // v1 corpus never populated a goal-derived requirement and must not
    // start reaching a different gate outcome now.
    prescriptionOutcome: {
      status: targets ? "PRESCRIBED" : "UNAVAILABLE",
      reasonCodes: [],
      nutritionRequired: false,
      parameterSetDigest: null,
    },
  });
  return {
    payload,
    decision: {
      action: targets ? "HOLD" : "CLARIFY", reasonCodes: [targets ? "INITIAL_FIXTURE" : scale === null ? "MISSING_INPUT" : "NO_FEASIBLE_MEALS"],
      explanation: targets ? "Your synthetic proposal is ready for review. It is not active until review and acceptance are complete." : "Nutrition remains unavailable because required measurements or a compatible meal template are missing.",
      limitations: ["Synthetic software demonstration only; not for real-world use."], nextAction: "Review the proposal when it has been approved.", changeClass: "INITIAL",
    },
    // The engine never ran on this path; there is no PrescriptionResult to
    // report. `payload.prescriptionOutcome` above is the durable signal for
    // every downstream reader (gate, safety, weekly guard); this field is
    // "engine did not run" for every legacy call, not a second copy of it.
    prescription: { status: "UNAVAILABLE", prescription: null, reasonCodes: [] },
  };
}

/** @deprecated synthetic corpus only. Thin wrapper: parameters=null, compile-time catalog constants. */
export function buildInitialFixturePlan(
  rawAnswers: unknown,
  prescriptionId: string,
  mode: "MACROS" | "MEALS"
): { payload: PlanPayload; decision: ReviewDecision } {
  const { payload, decision } = composeLegacySyntheticPlan(rawAnswers, prescriptionId, mode);
  return { payload, decision };
}

const COMPOSITION_FOOD_IDS = ["chicken-breast-raw", "brown-rice-cooked", "broccoli-steamed"] as const;
const COMPOSITION_FOOD_STATES: Record<(typeof COMPOSITION_FOOD_IDS)[number], "RAW" | "COOKED"> = {
  "chicken-breast-raw": "RAW",
  "brown-rice-cooked": "COOKED",
  "broccoli-steamed": "COOKED",
};

function midpoint(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2;
}

function det3(m: readonly (readonly number[])[]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/** Generic 3x3 linear solve via Cramer's rule. `null` for a singular (or
 * non-finite) system — treated as an infeasible composition, same as a
 * rejected gram amount. */
function solveLinear3x3(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const determinant = det3(a);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) return null;
  const solved: number[] = [];
  for (let col = 0; col < 3; col++) {
    const replaced = a.map((row, r) => row.map((value, c) => (c === col ? b[r] : value)));
    solved.push(det3(replaced) / determinant);
  }
  return solved.every((value) => Number.isFinite(value)) ? solved : null;
}

/**
 * T-2033 — prescription-first portion solver (board/tickets/T-2003.md
 * "### Composer"). Solves the 3x3 linear system on (protein, carbohydrate,
 * fat) grams per 100 g for the same three fixture components
 * `composeFixtureMeals` uses, rounds to the nearest 5 g (structural, matching
 * `composeFixtureMeals`'s own `grams()`), rejects a non-positive or >3000 g
 * component, then **verifies** the rounded composition against the
 * prescription using `mealTargetsMatch` — the same tolerance predicate
 * `representFixturePlan` already uses, not a copy of it. Carbohydrate/fat
 * targets for the solve are the midpoints of the prescribed ranges; energy is
 * verified, not solved (`computeNutrientTotals` uses the source's own energy
 * value and never recomputes it from macros). Deterministic: the same
 * prescription always composes to the same rounded grams.
 */
export type ComposeMealsToPrescriptionOptions = {
  templateSet: MealTemplateSet;
  source: FoodCatalogSource;
  constraints: ComposeConstraints;
  nutritionPermission?: "ALLOW" | "PAUSED" | "REVOKED";
  /** Defaults to ACTIVE_POLICY_VERSION / EXERCISE_CATALOG_VERSION so every
   *  existing caller (the T-2036 unit corpus) compiles and behaves identically. */
  policyVersion?: string;
  exerciseCatalogVersion?: string;
};

export type ComposeMealsWithReasonsResult = {
  meals: NonNullable<PlanPayload["meals"]> | null;
  reasons: ComposeReason[];
};

export function composeMealsToPrescriptionWithReasons(
  answers: IntakeAnswers,
  prescription: Prescription,
  foodCatalogVersion: string,
  options?: ComposeMealsToPrescriptionOptions
): ComposeMealsWithReasonsResult {
  const carbTarget = midpoint(prescription.carbohydrateRangeG);
  const fatTarget = midpoint(prescription.fatRangeG);

  if (options) {
    // Cross-check & merge allergies and dietaryRestrictions from answers into constraints (BLOCK-5)
    const combinedAllergies = Array.from(
      new Set([...answers.allergies, ...(options.constraints.allergies ?? [])])
    );
    const combinedRestrictions = Array.from(
      new Set([...answers.dietaryRestrictions, ...(options.constraints.dietaryRestrictions ?? [])])
    );
    const mergedConstraints: ComposeConstraints = {
      ...options.constraints,
      allergies: combinedAllergies,
      dietaryRestrictions: combinedRestrictions,
      allergenDeclarations:
        options.constraints.allergenDeclarations ?? (answers as any).allergenDeclarations,
    };

    const permission = options.nutritionPermission ?? "ALLOW";
    if (permission !== "ALLOW") {
      return {
        meals: null,
        reasons: [{ code: "NUTRITION_DOMAIN_NOT_ALLOWED", detail: { permission } }],
      };
    }

    // S-36a defect 2 & 4: `policyVersion` is resolved once from the caller's
    // binding (defaulting to the compile-time fixture for every existing
    // caller) and used identically for the compose-time check AND the
    // verification payload below, so the two can never disagree about which
    // policy this composition is bound to. Passing the SAME value as both
    // `policyVersion` and `runtimePolicyArtifactKey` makes the compose-time
    // usability check an identity by construction; the load-bearing checks on
    // this value live elsewhere (`mealTargetsMatch` on a *stored* payload, and
    // `autonomy/gate.ts`'s `bindingsMatch`), not here.
    const policyVersion = options.policyVersion ?? ACTIVE_POLICY_VERSION;
    const exerciseCatalogVersion = options.exerciseCatalogVersion ?? EXERCISE_CATALOG_VERSION;

    const result = composeWeekFromTemplates({
      targets: {
        energyKcal: prescription.targetEnergyKcal,
        proteinG: prescription.proteinG,
        carbsG: carbTarget,
        fatG: fatTarget,
      },
      tolerancePercent: prescription.tolerancePercent,
      mealsPerDay: 3,
      constraints: mergedConstraints,
      templateSet: options.templateSet,
      source: options.source,
      policyVersion,
      runtimePolicyArtifactKey: policyVersion,
      payloadCatalogVersion: foodCatalogVersion,
      nutritionPermission: permission,
      maxRepeatsPerWeek: 3,
    });

    if (!result.feasible) {
      return { meals: null, reasons: result.reasons };
    }

    const meals: NonNullable<PlanPayload["meals"]> = { days: result.days };
    const verification: PlanPayload = {
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: {
        prescriptionId: "verification-only",
        method: "REVIEWED_PRESCRIPTION_V1",
        targets: {
          energyKcal: prescription.targetEnergyKcal,
          proteinG: prescription.proteinG,
          carbsG: carbTarget,
          fatG: fatTarget,
        },
        tolerancePercent: prescription.tolerancePercent,
        assumptions: prescription.assumptions,
      },
      meals,
      strength: [],
      cardio: [],
      policyVersion,
      catalogVersions: { food: foodCatalogVersion, exercise: exerciseCatalogVersion },
    };

    if (!mealTargetsMatch(verification, answers, options.source, policyVersion)) {
      return {
        meals: null,
        reasons: [{ code: "NO_FEASIBLE_MEALS", detail: { reason: "VERIFICATION_FAILED" } }],
      };
    }

    return { meals, reasons: [] };
  }

  // S-36a defect 5 (one-side-of-S-36b guard): a run bound to a catalog key
  // this build does not carry in code must never fall back to the three
  // hard-wired fixture ids. Today the only bound food key is the fixture
  // itself, so this is unreachable; it is what guarantees that stays true
  // once a run binds to a reviewed catalog key.
  const legacyCatalogServed = foodCatalogIsServedInCode(foodCatalogVersion);
  const legacyMeals = legacyCatalogServed
    ? composeLegacyMealsInternal(answers, prescription, foodCatalogVersion, carbTarget, fatTarget)
    : null;
  if (!legacyCatalogServed) {
    return {
      meals: null,
      reasons: [
        { code: "CATALOG_REFERENCE_INVALID", detail: { reason: "CATALOG_NOT_SERVED_IN_CODE" } },
      ],
    };
  }
  return {
    meals: legacyMeals,
    reasons: legacyMeals ? [] : [{ code: "NO_FEASIBLE_MEALS", detail: { reason: "LEGACY_COMPOSITION_FAILED" } }],
  };
}

export function composeMealsToPrescription(
  answers: IntakeAnswers,
  prescription: Prescription,
  foodCatalogVersion: string,
  options?: ComposeMealsToPrescriptionOptions
): NonNullable<PlanPayload["meals"]> | null {
  return composeMealsToPrescriptionWithReasons(answers, prescription, foodCatalogVersion, options).meals;
}

function composeLegacyMealsInternal(
  answers: IntakeAnswers,
  prescription: Prescription,
  foodCatalogVersion: string,
  carbTarget: number,
  fatTarget: number
): NonNullable<PlanPayload["meals"]> | null {
  // S-36a defect 5: never compose the three hard-wired fixture ids against a
  // catalog key this build does not actually carry in code. The caller
  // (`composeMealsToPrescriptionWithReasons`) already checks this and reports
  // a specific reason; this is the defense-in-depth guard for any other
  // caller of this internal function.
  if (!foodCatalogIsServedInCode(foodCatalogVersion)) return null;

  // Same fixture-catalog dietary-restriction guard as composeFixtureMeals:
  // never silently drop an unknown restriction or claim feasibility that
  // isn't verified.
  if (answers.dietaryRestrictions.some(r => !["GLUTEN_FREE", "DAIRY_FREE"].includes(r.trim().toUpperCase().replace(/[\s-]+/g, "_")))) return null;

  const lookups = COMPOSITION_FOOD_IDS.map((id) => getFoodItem(id, foodCatalogVersion));
  if (lookups.some((lookup) => !lookup.success)) return null;
  const foods = lookups as { success: true; item: FoodItem }[];

  const perGram = foods.map(({ item }) => ({
    protein: item.proteinGPerServing / item.servingGrams,
    carbs: item.carbsGPerServing / item.servingGrams,
    fat: item.fatGPerServing / item.servingGrams,
  }));

  const matrix = [
    perGram.map((c) => c.protein),
    perGram.map((c) => c.carbs),
    perGram.map((c) => c.fat),
  ];
  const solved = solveLinear3x3(matrix, [prescription.proteinG, carbTarget, fatTarget]);
  if (!solved) return null;

  const grams = solved.map((value) => Math.round(value / 5) * 5);
  if (grams.some((value) => value <= 0 || value > 3000)) return null;

  const ingredients = COMPOSITION_FOOD_IDS.map((foodId, index) => ({
    foodId,
    catalogVersion: foodCatalogVersion,
    grams: grams[index],
    state: COMPOSITION_FOOD_STATES[foodId],
  }));

  if (
    !checkMealComposition({
      components: ingredients,
      allergies: answers.allergies,
      dietaryRestrictions: answers.dietaryRestrictions,
      nutritionPermission: "ALLOW",
      policyVersion: ACTIVE_POLICY_VERSION,
    }).feasible
  ) {
    return null;
  }

  const meals = {
    days: Array.from({ length: 7 }, (_, day) => ({
      day: day + 1,
      meals: [
        {
          id: `rx-meal-${day + 1}-1`,
          name: "Prescription-composed chicken, rice and broccoli",
          ingredients,
          servings: 1,
          preparation:
            "Prescription-composed portion example; reviewed preparation and food-safety instructions are not available.",
        },
      ],
    })),
  };

  // Verification-only payload: only the fields mealTargetsMatch reads
  // (`nutrition`, `meals`, `policyVersion`) are meaningful here.
  const verification: PlanPayload = {
    schemaVersion: 1,
    contentKind: "SYNTHETIC_FIXTURE",
    nutrition: {
      prescriptionId: "verification-only",
      method: "REVIEWED_PRESCRIPTION_V1",
      targets: {
        energyKcal: prescription.targetEnergyKcal,
        proteinG: prescription.proteinG,
        carbsG: carbTarget,
        fatG: fatTarget,
      },
      tolerancePercent: prescription.tolerancePercent,
      assumptions: prescription.assumptions,
    },
    meals,
    strength: [],
    cardio: [],
    policyVersion: ACTIVE_POLICY_VERSION,
    catalogVersions: { food: foodCatalogVersion, exercise: EXERCISE_CATALOG_VERSION },
  };

  return mealTargetsMatch(verification, answers) ? meals : null;
}

export type ComposeInitialPlanInput = {
  rawAnswers: unknown;
  prescriptionId: string;
  mode: "MACROS" | "MEALS";
  evaluatedOn: string;
  /** `null` => legacy synthetic path, OR (for a v2 intake) the caller could
   * not resolve engine parameters at all — see the guard below for why that
   * second case is not routed through the legacy composer. */
  parameters: ResolvedPrescriptionParameters | null;
  binding: { policyVersion: string; foodCatalogVersion: string; exerciseCatalogVersion: string };
  trainingParameters?: ResolvedTrainingParameters | null;
  trainingCatalog?: TrainingCatalogSource | null;
  trainingEffortText?: { strength: string; cardio: string } | null;
  activeContraindicationRuleIds?: readonly string[];
  /** When present AND `mode === "MEALS"`, the prescribed plan is composed
   *  from this reviewed template set against this catalog source instead of
   *  the three in-code fixture ids. `null`/absent keeps today's behaviour
   *  exactly: no production call site passes this (`managed-executor.ts`
   *  calls `composeInitialPlan` with no `mealComposer`). */
  mealComposer?: { templateSet: MealTemplateSet; source: FoodCatalogSource } | null;
};

/**
 * T-2033 — `composeInitialPlan` (board/tickets/T-2003.md "### Composer").
 * Routes on `answers.intakeVersion`: v1 answers always use
 * `composeLegacySyntheticPlan` byte-for-byte, unchanged. v2 answers with a
 * resolved parameter set run the prescription engine first, then compose
 * catalog meals to the result.
 *
 * **Judgment call, flagged for the reviewer:** the frozen spec text describes
 * routing as "v1, or parameters === null -> composeLegacySyntheticPlan". For
 * a v2 intake, that literal reading would mean a `resolvePrescriptionParameters`
 * failure (a broken/unsigned bundle) falls back to the *legacy* fixture-scaled
 * composer, which derives targets straight from body weight and stamps
 * `SYNTHETIC_CATALOG_MATCH` — i.e. a v2-confirmed client would silently
 * receive fixture numbers dressed as though the reviewed engine produced
 * them. That directly contradicts the same spec's file item 4, which is
 * specific and unambiguous: "A resolvePrescriptionParameters failure is not
 * an exception: it produces `prescriptionOutcome.status: 'UNAVAILABLE'` ...
 * so the client sees a HOLD with a reason rather than a spinner." Item 4 is
 * exactly the scenario this function's `parameters === null` case addresses
 * for a v2 intake, so it governs here: a v2 intake with `parameters === null`
 * produces an honest `UNAVAILABLE` prescriptionOutcome (reasonCodes:
 * `["PRESCRIPTION_PARAMETER_MISSING"]`, the closest frozen code for "the
 * bundle's parameter set could not be resolved"), never a legacy fallback.
 * `composeLegacySyntheticPlan` is reached only when the answers are not v2 at
 * all. See `ai-coach-composer.test.ts`'s "v2 + unresolved parameters never
 * falls back to the legacy composer" test.
 */
function assembleV2Plan(
  binding: ComposeInitialPlanInput["binding"],
  mode: "MACROS" | "MEALS",
  strength: PlanPayload["strength"],
  cardio: PlanPayload["cardio"],
  nutrition: PlanPayload["nutrition"],
  meals: PlanPayload["meals"],
  prescriptionOutcome: NonNullable<PlanPayload["prescriptionOutcome"]>
): PlanPayload {
  return planPayloadSchema.parse({
    schemaVersion: 1,
    contentKind: "SYNTHETIC_FIXTURE",
    nutrition,
    meals: mode === "MEALS" ? meals : null,
    strength,
    cardio,
    policyVersion: binding.policyVersion,
    catalogVersions: { food: binding.foodCatalogVersion, exercise: binding.exerciseCatalogVersion },
    prescriptionOutcome,
  });
}

/**
 * T-2033 review r1 (MINOR 5) — the decision is routed off the same three
 * reason classes the autonomy gate uses (`prescription/reason-classes.ts`),
 * so a client is only ever asked to fix their intake for a reason their
 * intake can fix. `PRESCRIPTION_PARAMETER_MISSING` /
 * `PRESCRIPTION_METHOD_UNSUPPORTED` / `PRESCRIPTION_EXPLANATION_TEMPLATE_UNAVAILABLE`
 * mean the RD has not signed the content this needs; no client action
 * resolves those, and the decision must not claim otherwise. All three texts
 * are operational status, not clinical advice, and invent no policy: the
 * client-facing escalation copy for a HOLD/PAUSE_REFER still comes from the
 * reviewed escalation template the gate resolves.
 */
const UNAVAILABLE_DECISION_BY_REASON_CLASS: Record<
  PrescriptionReasonClass,
  Pick<ReviewDecision, "action" | "reasonCodes" | "explanation" | "nextAction">
> = {
  CLIENT_FIXABLE: {
    action: "CLARIFY",
    reasonCodes: ["MISSING_INPUT"],
    explanation: "Nutrition remains unavailable because a required prescription input is missing or no longer current.",
    nextAction: "Review and confirm the requested intake fields.",
  },
  OUT_OF_SCOPE: {
    action: "PAUSE_REFER",
    reasonCodes: ["SAFETY_CONCERN"],
    explanation: "Nutrition remains unavailable because this request falls outside the reviewed scope of this program.",
    nextAction: "This request is outside the reviewed scope of this program; changing your intake answers will not make it available.",
  },
  POLICY_NOT_READY: {
    action: "HOLD",
    reasonCodes: ["WEEKLY_POLICY_PARAMETERS_UNAVAILABLE"],
    explanation: "Nutrition remains unavailable because the reviewed policy content this prescription needs is not available.",
    nextAction: "No action is needed from you. This is waiting on reviewed policy content, not on your answers.",
  },
};

function classifyTrainingReasonCode(
  code: TrainingReasonCode
): "MISSING_INPUT" | "SAFETY_CONCERN" | "WEEKLY_POLICY_PARAMETERS_UNAVAILABLE" {
  if (code === "TRAINING_INPUT_MISSING" || code === "TRAINING_INTAKE_VERSION_UNSUPPORTED") {
    return "MISSING_INPUT";
  }
  if (
    code === "TRAINING_CONTRAINDICATED_NO_SUBSTITUTE" ||
    code === "TRAINING_WORKLOAD_INFEASIBLE"
  ) {
    return "SAFETY_CONCERN";
  }
  return "WEEKLY_POLICY_PARAMETERS_UNAVAILABLE";
}

function unavailableV2Result(
  binding: ComposeInitialPlanInput["binding"],
  mode: "MACROS" | "MEALS",
  strength: PlanPayload["strength"],
  cardio: PlanPayload["cardio"],
  nutritionRequired: boolean,
  reasonCodes: PrescriptionResult["reasonCodes"]
): ComposeInitialPlanResult {
  const decision = UNAVAILABLE_DECISION_BY_REASON_CLASS[classifyPrescriptionReasonCodes(reasonCodes)];
  return {
    payload: assembleV2Plan(binding, mode, strength, cardio, null, null, {
      status: "UNAVAILABLE",
      reasonCodes,
      nutritionRequired,
      parameterSetDigest: null,
    }),
    decision: {
      ...decision,
      limitations: ["Synthetic controller and catalog; this result does not establish clinical suitability."],
      changeClass: "INITIAL",
    },
    prescription: { status: "UNAVAILABLE", prescription: null, reasonCodes },
  };
}

/**
 * T-2033 (T-2003 file item 4) — builds an honest `UNAVAILABLE` v2 payload
 * directly from the *real* reason codes a caller already has (e.g.
 * `resolvePrescriptionParametersForArtifacts` failed to resolve the engine's
 * parameter set from the reviewed bundle). Exported so `managed-executor.ts`
 * calls this instead of routing a resolve-parameters failure through
 * `composeInitialPlan`'s `parameters === null` branch, which only has a
 * generic reason code available (see that branch's doc comment) and exists
 * for a defensive/caller-error case, not this one. Shares
 * `assembleV2Plan`/`unavailableV2Result` with `composeInitialPlan` — one
 * implementation of "assemble an UNAVAILABLE v2 payload", not two.
 * `rawAnswers` must already be a v2 intake (`isV2Intake`); the caller is
 * responsible for that check, mirroring `composeInitialPlan`'s own routing.
 */
export function composeUnavailablePrescriptionPlan(
  rawAnswers: unknown,
  mode: "MACROS" | "MEALS",
  binding: ComposeInitialPlanInput["binding"],
  reasonCodes: PrescriptionResult["reasonCodes"]
): ComposeInitialPlanResult {
  const answers = intakeAnswersSchema.parse(rawAnswers);
  const { strength, cardio } = buildFixtureTrainingSections(answers);
  const nutritionRequired = nutritionRequiredForGoal({ bodyWeightIntent: answers.bodyWeightIntent ?? null });
  return unavailableV2Result(binding, mode, strength, cardio, nutritionRequired, reasonCodes);
}

export function composeInitialPlan(input: ComposeInitialPlanInput): ComposeInitialPlanResult {
  if (!isV2Intake(input.rawAnswers)) {
    return composeLegacySyntheticPlan(input.rawAnswers, input.prescriptionId, input.mode);
  }

  const answers = intakeAnswersSchema.parse(input.rawAnswers);

  let strength: PlanPayload["strength"];
  let cardio: PlanPayload["cardio"];
  const trainingReasonCodes: TrainingReasonCode[] = [];

  if (input.trainingParameters !== undefined) {
    if (input.trainingParameters === null) {
      strength = [];
      cardio = [];
      trainingReasonCodes.push("TRAINING_PARAMETER_MISSING");
    } else {
      const catalog = input.trainingCatalog ?? trainingCatalogSourceFromDraftFile();
      const effortText = input.trainingEffortText ?? {
        strength: "Synthetic starting-dose fixture; no live exercise guidance.",
        cardio: "Synthetic intensity fixture; qualified review required.",
      };
      const built = buildPrescriptionInput(input.rawAnswers, input.evaluatedOn);
      let energyReducedRelativeToMaintenance: boolean | null = null;
      if (built.ok && input.parameters) {
        const pres = computePrescription(input.parameters, built.input);
        if (pres.status === "PRESCRIBED") {
          energyReducedRelativeToMaintenance =
            pres.prescription.targetEnergyKcal < pres.prescription.maintenanceEnergyKcal;
        }
      }
      const trainingResult = composeTraining(input.trainingParameters, catalog, effortText, {
        intakeVersion: 2,
        trainingDaysPerWeek: answers.trainingDaysPerWeek,
        equipmentAccess: answers.equipmentAccess,
        experienceLevel: answers.experienceLevel,
        sessionLengthBand: answers.sessionLengthBand ?? null,
        trainingContextStatus: answers.trainingContextStatus ?? null,
        energyReducedRelativeToMaintenance,
        activeContraindicationRuleIds: input.activeContraindicationRuleIds ?? [],
      });
      if (trainingResult.status === "COMPOSED") {
        strength = trainingResult.strength;
        cardio = trainingResult.cardio;
      } else {
        strength = [];
        cardio = [];
        trainingReasonCodes.push(...trainingResult.reasonCodes);
      }
    }
  } else {
    const fixtureTraining = buildFixtureTrainingSections(answers);
    strength = fixtureTraining.strength;
    cardio = fixtureTraining.cardio;
  }

  if (input.parameters === null) {
    // Documented judgment call (see composeUnavailablePrescriptionPlan's own
    // comment and this file's module doc): a real caller resolves engine
    // parameters first and, on failure, calls `composeUnavailablePrescriptionPlan`
    // directly with the specific reason codes rather than ever invoking this
    // function with `parameters: null` for a v2 intake. This branch only
    // guards against that not happening (a caller bug), and fails closed the
    // same way with a generic reason code instead of ever reaching the
    // legacy fixture-scaled composer.
    return unavailableV2Result(
      input.binding,
      input.mode,
      strength,
      cardio,
      nutritionRequiredForGoal({ bodyWeightIntent: answers.bodyWeightIntent ?? null }),
      ["PRESCRIPTION_PARAMETER_MISSING"]
    );
  }

  const built = buildPrescriptionInput(input.rawAnswers, input.evaluatedOn);
  if (!built.ok) {
    return unavailableV2Result(input.binding, input.mode, strength, cardio, false, built.reasonCodes);
  }

  const nutritionRequired = nutritionRequiredForGoal(built.input);
  const prescriptionResult = computePrescription(input.parameters, built.input);
  if (prescriptionResult.status === "UNAVAILABLE") {
    return unavailableV2Result(input.binding, input.mode, strength, cardio, nutritionRequired, prescriptionResult.reasonCodes);
  }

  const prescription = prescriptionResult.prescription;
  const targets = {
    energyKcal: prescription.targetEnergyKcal,
    proteinG: prescription.proteinG,
    carbsG: midpoint(prescription.carbohydrateRangeG),
    fatG: midpoint(prescription.fatRangeG),
  };
  // S-36a: when a reviewed template set + catalog source is supplied for a
  // MEALS request, route through the shared intake->constraints mapper and
  // the real composer instead of the three in-code fixture ids. Absent
  // `mealComposer` (every production call site today) keeps the exact
  // existing call.
  let meals: PlanPayload["meals"] = null;
  let mealsDegrade: { explanation: string; nextAction: string } | null = null;
  if (input.mode === "MEALS") {
    if (input.mealComposer) {
      const mapped = mealComposerConstraintsFromIntake(answers);
      if (!mapped.composable) {
        mealsDegrade =
          mapped.block === "COOKING_ACCESS_NOT_CONFIRMED"
            ? {
                explanation:
                  "Targets are shown without a meal plan because your cooking equipment and storage have not been confirmed. Meals are matched to the equipment you tell us you have.",
                nextAction: "Confirm your cooking equipment, storage and usual prep time in your intake.",
              }
            : {
                explanation:
                  "Targets are shown without a meal plan because your allergy answers have not been confirmed. Specific foods are not suggested until they are.",
                nextAction: "Confirm your allergy answers in your intake.",
              };
      } else {
        const composed = composeMealsToPrescriptionWithReasons(
          answers,
          prescription,
          input.binding.foodCatalogVersion,
          {
            templateSet: input.mealComposer.templateSet,
            source: input.mealComposer.source,
            constraints: mapped.constraints,
            policyVersion: input.binding.policyVersion,
            exerciseCatalogVersion: input.binding.exerciseCatalogVersion,
          }
        );
        meals = composed.meals;
      }
    } else {
      meals = composeMealsToPrescription(answers, prescription, input.binding.foodCatalogVersion);
    }
  }
  // Degrade, never disappear: a prescribed macro-only plan asked for MEALS
  // that the catalog cannot compose keeps its nutrition targets.
  const feasible = input.mode !== "MEALS" || meals !== null;
  const payload = assembleV2Plan(
    input.binding,
    input.mode,
    strength,
    cardio,
    {
      prescriptionId: input.prescriptionId,
      method: "REVIEWED_PRESCRIPTION_V1",
      targets,
      tolerancePercent: prescription.tolerancePercent,
      assumptions: prescription.assumptions,
    },
    meals,
    {
      status: "PRESCRIBED",
      reasonCodes: [],
      nutritionRequired,
      parameterSetDigest: prescription.parameterSetDigest,
    }
  );
  return {
    payload,
    decision: {
      action: "HOLD",
      reasonCodes: Array.from(
        new Set([
          feasible ? "INITIAL_FIXTURE" : "NO_FEASIBLE_MEALS",
          ...trainingReasonCodes.map(classifyTrainingReasonCode),
        ])
      ),
      explanation: feasible
        ? "Your proposal is ready for review. It is not active until review and acceptance are complete."
        : (mealsDegrade?.explanation ??
          "The catalog cannot compose meals within tolerance of the reviewed prescription; targets are shown without a meal plan."),
      limitations: ["Synthetic catalog only; nutrient adequacy is not established."],
      nextAction: feasible
        ? "Review the proposal when it has been approved."
        : (mealsDegrade?.nextAction ?? "Review the proposal when it has been approved."),
      changeClass: "INITIAL",
    },
    prescription: prescriptionResult,
  };
}
