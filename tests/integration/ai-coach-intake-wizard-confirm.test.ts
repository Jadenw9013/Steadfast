/**
 * S-16 — the four-step wizard's real command sequence must confirm cleanly.
 *
 * Every payload below is built by the wizard's own exported mappers
 * (`mapSelectionsToAnswers`, `buildAllergenDeclarations`,
 * `buildConfirmPayload`) and posted through `applyAiClientCommand` in the
 * order `IntakeWizard` posts them — the two stage saves, the stage-3
 * allergen save, the nutrition-stage save, the safety disclosure, the
 * confirm-time allergen re-save and finally CONFIRM_INTAKE. Hand-copying a
 * payload here would prove nothing about the wizard; deriving it is what
 * makes this a regression test for the next time the wizard changes.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: client-scoped only; safe to run beside other shared files.
lockGlobalAiCoachState("shared");

import { db } from "@/lib/db";
import { applyAiClientCommand } from "@/lib/ai-coach/client-commands";
import { intakeAnswersSchema, INTAKE_V2_STATUS_DEFAULTS } from "@/lib/ai-coach/intake";
import {
  buildAllergenDeclarations,
  buildConfirmPayload,
  mapSelectionsToAnswers,
  type IntakeSelections,
} from "@/components/ai-coach/intake-wizard";

/** A client who filled in all four steps: the exact selection set the UI can
 * produce, nothing the UI cannot. */
const SELECTIONS: IntakeSelections = {
  goal: "FAT_LOSS",
  experience: "INTERMEDIATE",
  trainingDaysPerWeek: 4,
  equipment: "HOME_DUMBBELLS",
  sessionLength: "MIN_45_60",
  dietaryStyle: "HIGH_PROTEIN",
  trackingStyle: "PORTIONS",
  allergens: ["NONE"],
  unitSystem: "IMPERIAL",
  heightCm: 175.3,
  weightKg: 78.25,
  ageYears: 34,
  weightMeasuredOn: "2026-09-27",
};

/** The eight questions the wizard's "None of these apply" button answers. */
const SAFETY_ANSWERS = {
  chestPainDuringExercise: "NO",
  dizzinessOrFainting: "NO",
  heartCondition: "NO",
  pregnantOrPostpartum: "NO",
  recentInjuryOrSurgery: "NO",
  ageEligibilityConcern: "NO",
  eatingDisorderHistoryOrConcern: "NO",
  type1Diabetes: "NO",
} as const;

/** The key lists the wizard's four Continue buttons pass to `saveFields`. */
const STAGE_SAVE_KEYS = [
  [
    "intakeVersion",
    "goal",
    "experienceLevel",
    "goalStatus",
    "bodyWeightIntent",
    "goalPaceClass",
    "weightNeutralAccepted",
  ],
  [
    "intakeVersion",
    "trainingDaysPerWeek",
    "equipmentAccess",
    "trainingContextStatus",
    "resistanceTrainingContext",
    "sessionLengthBand",
  ],
  [
    "intakeVersion",
    "foodBudgetLevel",
    "trackingPreference",
    "dietaryPattern",
    "dislikes",
    "cuisinePreferences",
  ],
];

const STATUS_KEYS = Object.keys(INTAKE_V2_STATUS_DEFAULTS);

suite("S-16 — the four-step intake wizard confirms without a 422", () => {
  beforeEach(() => {
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    vi.stubEnv("FEATURE_AI_COACH_ENROLLMENT", "true");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => db.$disconnect());

  async function seedClient() {
    const id = randomUUID();
    const client = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true },
    });
    await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    return client;
  }

  /**
   * Replays every command `IntakeWizard` posts for a client who completes all
   * four steps and presses "Confirm & Build Plan".
   * `confirmTransform` stands in for a client (an older app build, a future
   * wizard, iOS) that omits some keys the frozen contract requires.
   */
  async function walkTheWizard(
    clientId: string,
    selections: IntakeSelections,
    confirmTransform: (payload: Record<string, unknown>) => Record<string, unknown> = (p) => p
  ) {
    const mapped = mapSelectionsToAnswers(selections);
    const declarations = buildAllergenDeclarations(selections);
    const cmd = (input: Record<string, unknown>) =>
      applyAiClientCommand(clientId, {
        requestKey: randomUUID(),
        expectedProfileRevision: 0,
        ...input,
      });
    const save = (keys: string[]) =>
      cmd({
        operation: "SAVE_INTAKE",
        answers: Object.fromEntries(Object.entries(mapped).filter(([key]) => keys.includes(key))),
      });

    await save(STAGE_SAVE_KEYS[0]);
    await save(STAGE_SAVE_KEYS[1]);
    // Stage 3's Continue saves the allergen declarations first, then the
    // nutrition-stage keys (`advance(3, keys, true)`).
    await cmd({ operation: "ALLERGIES", allergenDeclarations: declarations });
    await save(STAGE_SAVE_KEYS[2]);
    // `confirmAndRedirect`: safety, then allergies again, then the confirm.
    await cmd({ operation: "SAFETY", answers: SAFETY_ANSWERS });
    await cmd({ operation: "ALLERGIES", allergenDeclarations: declarations });
    return cmd({
      operation: "CONFIRM_INTAKE",
      answers: confirmTransform(buildConfirmPayload(selections) as unknown as Record<string, unknown>),
    });
  }

  it("confirms cleanly for a client who fills in every step", async () => {
    const client = await seedClient();

    await expect(walkTheWizard(client.id, SELECTIONS)).resolves.toEqual({
      saved: true,
      profileRevision: 1,
    });

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    // The stored intake must round-trip through the read schema every other
    // consumer (run snapshots, weekly replay, the workspace DTO) uses.
    const stored = intakeAnswersSchema.safeParse(profile.confirmedIntake);
    expect(stored.success).toBe(true);
    expect(stored.success && stored.data.intakeVersion).toBe(2);
    expect(stored.success && stored.data.goal).toBe("BODY_COMPOSITION");
    // The draft is consumed by the confirm.
    expect(await db.aiIntakeDraft.count({ where: { clientId: client.id } })).toBe(0);
  });

  it("confirms cleanly when the client omits every bookkeeping status field", async () => {
    const client = await seedClient();

    const result = await walkTheWizard(client.id, SELECTIONS, (payload) => {
      const stripped = { ...payload };
      // Also drop the values those statuses govern, exactly as a client that
      // never asked the question would.
      for (const key of [
        ...STATUS_KEYS,
        "ageYears",
        "heightCm",
        "weightKg",
        "weightMeasuredOn",
        "bodyWeightIntent",
        "goalPaceClass",
        "weightNeutralAccepted",
        "resistanceTrainingContext",
        "sessionLengthBand",
      ]) {
        delete stripped[key];
      }
      return stripped;
    });

    expect(result).toEqual({ saved: true, profileRevision: 1 });

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    const stored = profile.confirmedIntake as Record<string, unknown>;
    for (const key of STATUS_KEYS) expect(stored[key]).toBe("UNKNOWN");
    // Nothing was invented for the values those statuses govern.
    for (const key of ["ageYears", "heightCm", "weightKg", "weightMeasuredOn"]) {
      expect(stored).not.toHaveProperty(key);
    }
  });

  it("never overwrites a status the client did answer", async () => {
    const client = await seedClient();

    await walkTheWizard(client.id, SELECTIONS, (payload) => {
      const partial = { ...payload };
      // The client answered age and body measurements; the other five
      // statuses were never asked.
      for (const key of [
        "energyMethodPopulationCategoryStatus",
        "physicalActivityCategoryStatus",
        "cookingAccessStatus",
        "goalStatus",
        "trainingContextStatus",
      ]) {
        delete partial[key];
      }
      delete partial.bodyWeightIntent;
      delete partial.goalPaceClass;
      delete partial.weightNeutralAccepted;
      delete partial.resistanceTrainingContext;
      delete partial.sessionLengthBand;
      return partial;
    });

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    const stored = profile.confirmedIntake as Record<string, unknown>;
    expect(stored.ageStatus).toBe("CONFIRMED");
    expect(stored.ageYears).toBe(34);
    expect(stored.bodyMeasurementStatus).toBe("CONFIRMED");
    expect(stored.weightKg).toBe(SELECTIONS.weightKg);
    expect(stored.goalStatus).toBe("UNKNOWN");
    expect(stored.cookingAccessStatus).toBe("UNKNOWN");
  });

  it("still refuses a confirm that omits the allergen declarations", async () => {
    const client = await seedClient();

    // The defaulting must not have widened the safety-relevant guard: an
    // absent allergen declaration is still a hard 422, as it was before.
    await expect(
      walkTheWizard(client.id, SELECTIONS, (payload) => {
        const stripped = { ...payload };
        delete stripped.allergenDeclarations;
        return stripped;
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(profile.confirmedIntake).toBeNull();
  });
});
