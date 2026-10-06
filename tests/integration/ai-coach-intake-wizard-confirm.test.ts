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

import type { Prisma } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";
import { applyAiClientCommand } from "@/lib/ai-coach/client-commands";
import { intakeAnswersSchema, INTAKE_V2_STATUS_DEFAULTS } from "@/lib/ai-coach/intake";
import { SAFETY_DISCLOSURE_REQUIRED_MESSAGE } from "@/lib/ai-coach/safety";
import { SAFETY_RESTRICTED_PLAN_MESSAGE } from "@/lib/ai-coach/safety-restriction";
import { resolveAiSafety } from "@/lib/ai-coach/safety-resolution";
import { requestAiRun } from "@/lib/ai-coach/run-command";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { assignFixtureReviewer } from "../helpers/ai-reviewer";
import {
  buildAllergenDeclarations,
  buildConfirmPayload,
  confirmAndRedirect,
  deriveNeedsSafetyDisclosure,
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
  foodBudgetLevel: "MODERATE",
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
   * four steps and presses "Confirm my answers".
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

/**
 * S-19 — the three dead ends a self-serve client could not escape.
 *
 * Each case drives the wizard's own exported entry points
 * (`confirmAndRedirect`, `deriveNeedsSafetyDisclosure`) against the real
 * workspace read (`getAiWorkspace`) and the real command/run services, in the
 * order the UI calls them. All three reproduced on this database before the
 * fix; the assertions below are the ones that failed.
 */
suite("S-19 — the intake's three self-serve dead ends", () => {
  beforeEach(() => {
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    vi.stubEnv("FEATURE_AI_COACH_ENROLLMENT", "true");
    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
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

  /** The wizard's `command` prop: `post` supplies `requestKey`, `experience.tsx`
   * supplies `expectedProfileRevision` from the mounted workspace view. */
  function commandFor(clientId: string, profileRevision: number) {
    return (input: Record<string, unknown>) =>
      applyAiClientCommand(clientId, {
        requestKey: randomUUID(),
        expectedProfileRevision: profileRevision,
        ...input,
      });
  }

  /** Steps 1-3's Continue buttons. Step 3 saves allergens first (`advance(3, keys, true)`). */
  async function walkStages(
    clientId: string,
    selections: IntakeSelections,
    profileRevision: number
  ) {
    const mapped = mapSelectionsToAnswers(selections);
    const cmd = commandFor(clientId, profileRevision);
    const save = (keys: string[]) =>
      cmd({
        operation: "SAVE_INTAKE",
        answers: Object.fromEntries(Object.entries(mapped).filter(([k]) => keys.includes(k))),
      });
    await save(STAGE_SAVE_KEYS[0]);
    await save(STAGE_SAVE_KEYS[1]);
    await cmd({
      operation: "ALLERGIES",
      allergenDeclarations: buildAllergenDeclarations(selections),
    });
    await save(STAGE_SAVE_KEYS[2]);
  }

  /** One full pass of the wizard, reading the same view the component reads. */
  async function runWizardPass(clientId: string, selections: IntakeSelections) {
    const view = await getAiWorkspace(clientId);
    await walkStages(clientId, selections, view.profileRevision);
    const afterStages = await getAiWorkspace(clientId);
    await confirmAndRedirect({
      selections,
      safetyAnswers: SAFETY_ANSWERS,
      needsSafetyDisclosure: deriveNeedsSafetyDisclosure(afterStages),
      command: commandFor(clientId, afterStages.profileRevision),
      redirect: () => {},
    });
  }

  /** The home screen's consent card. */
  async function enrol(clientId: string) {
    const view = await getAiWorkspace(clientId);
    await commandFor(clientId, view.profileRevision)({
      operation: "ENROLL",
      consent: true,
      expectedContextRevision: view.contextRevision,
      reviewTimezone: "America/Los_Angeles",
    });
  }

  function requestPlan(clientId: string, view: Awaited<ReturnType<typeof getAiWorkspace>>) {
    return requestAiRun(clientId, {
      requestKey: randomUUID(),
      kind: "INITIAL",
      representation: "MEALS",
      expectedContextRevision: view.contextRevision,
      expectedProfileRevision: view.profileRevision,
    });
  }

  describe("dead end 1 — a client who re-runs their intake", () => {
    it("still pauses nutrition on a changed allergen, but now says so, names who lifts it, and predicts the refusal", async () => {
      const client = await seedClient();
      await runWizardPass(client.id, SELECTIONS);
      await enrol(client.id);

      // A clear, enrolled client has nothing to explain and can request a plan.
      const clear = await getAiWorkspace(client.id);
      expect(clear.safetyDisposition).toBe("CLEAR");
      expect(clear.safetyRestriction).toBeNull();

      // Second pass, one allergen changed. The pause is deliberate (a changed
      // allergen disclosure must pause nutrition) and is unchanged by S-19.
      await runWizardPass(client.id, { ...SELECTIONS, allergens: ["PEANUTS"] });

      const restricted = await getAiWorkspace(client.id);
      expect(restricted.safetyDisposition).toBe("RESTRICTED");
      expect(restricted.permissions.nutrition).toBe("PAUSED");
      // What changed: the client-facing DTO now carries the explanation.
      expect(restricted.safetyRestriction).toEqual({
        disposition: "RESTRICTED",
        restrictedDomains: ["NUTRITION"],
        planRequestBlocked: true,
        clientCanResolve: false,
        resolvedBy: "AUTHORIZED_REVIEWER",
      });

      // And `planRequestBlocked` is the run guard, not a second opinion: the
      // refusal the UI predicts is the refusal the server gives.
      await expect(requestPlan(client.id, restricted)).rejects.toMatchObject({
        code: "SAFETY_RESTRICTED",
        status: 409,
        message: SAFETY_RESTRICTED_PLAN_MESSAGE,
      });
    });

    it("keeps the restriction unliftable by any client-side action — re-confirming the same answers does not clear it", async () => {
      const client = await seedClient();
      await runWizardPass(client.id, SELECTIONS);
      await enrol(client.id);
      await runWizardPass(client.id, { ...SELECTIONS, allergens: ["PEANUTS"] });
      expect((await getAiWorkspace(client.id)).safetyRestriction?.planRequestBlocked).toBe(true);

      // A third pass declaring exactly the same allergens: no new concern, so
      // no new restriction — and, critically, no lifting either.
      await runWizardPass(client.id, { ...SELECTIONS, allergens: ["PEANUTS"] });
      const after = await getAiWorkspace(client.id);
      expect(after.permissions.nutrition).toBe("PAUSED");
      expect(after.safetyRestriction).toMatchObject({
        planRequestBlocked: true,
        clientCanResolve: false,
        resolvedBy: "AUTHORIZED_REVIEWER",
      });
      await expect(requestPlan(client.id, after)).rejects.toMatchObject({
        code: "SAFETY_RESTRICTED",
      });
    });

    it("lifts only through the reviewed resolution path, and then the plan request works again", async () => {
      const client = await seedClient();
      await runWizardPass(client.id, SELECTIONS);
      await enrol(client.id);
      await runWizardPass(client.id, { ...SELECTIONS, allergens: ["PEANUTS"] });

      const restricted = await getAiWorkspace(client.id);
      const grant = await assignFixtureReviewer(client.id);
      await resolveAiSafety(grant.userId, {
        requestKey: randomUUID(),
        clientId: client.id,
        expectedSafetyRevision: restricted.safetyRevision,
        domains: ["NUTRITION", "STRENGTH", "CARDIO"],
        reviewReference: "SYNTHETIC-S19-REVIEW",
        rationale: "Synthetic fixture resolution for the S-19 regression test.",
        confirmed: true,
      });

      const lifted = await getAiWorkspace(client.id);
      expect(lifted.safetyDisposition).toBe("CLEAR");
      expect(lifted.safetyRestriction).toBeNull();
      await expect(requestPlan(client.id, lifted)).resolves.toMatchObject({
        runId: expect.any(String),
      });
    });
  });

  describe("dead end 2 — the confirm button's promise", () => {
    it("confirms the intake and enrols nothing, which is exactly what the relabelled button now claims", async () => {
      const client = await seedClient();
      await runWizardPass(client.id, SELECTIONS);

      const after = await getAiWorkspace(client.id);
      expect(after.confirmedIntake).not.toBeNull();
      // No enrolment, no provider transition, no run — so the button must not
      // say "Confirm & Build Plan" (asserted on the rendered step in
      // tests/unit/ai-coach-intake-wizard-stages.test.ts).
      expect(after.origin).not.toBe("AI");
      expect(after.runs).toHaveLength(0);
      expect(
        await db.aiCoachProviderTransitionReceipt.count({ where: { clientId: client.id } })
      ).toBe(0);
      // This is the state that renders the consent card in experience.tsx.
      expect(after.origin !== "AI" || !after.consentedAt).toBe(true);
      // S-21: confirming an intake alone is not a consent decision — the
      // exact reproduction that found the defect — so `consentedAt` must be
      // null, not merely "falsy while origin isn't AI yet".
      expect(after.consentedAt).toBeNull();
    });

    it("the next step the new copy names actually completes: consent, then a plan request that starts a run", async () => {
      const client = await seedClient();
      await runWizardPass(client.id, SELECTIONS);
      await enrol(client.id);

      const enrolled = await getAiWorkspace(client.id);
      expect(enrolled.origin).toBe("AI");
      expect(enrolled.consentedAt).not.toBeNull();

      const run = await requestPlan(client.id, enrolled);
      expect(run).toMatchObject({ runId: expect.any(String) });
      const queued = await db.aiCoachRun.findUniqueOrThrow({ where: { id: run.runId } });
      expect(queued.clientId).toBe(client.id);
      expect(queued.status).toBe("QUEUED");
    });
  });

  describe("dead end 3 — the safety-disclosure decision", () => {
    it("asks the safety questions for a confirmed intake with no disclosure row, so the confirm succeeds", async () => {
      const client = await seedClient();
      // A directly seeded profile: confirmed intake, no AiSafetyDisclosureEvent.
      await db.aiCoachProfile.update({
        where: { clientId: client.id },
        data: {
          confirmedIntake: buildConfirmPayload(SELECTIONS) as unknown as Prisma.InputJsonValue,
          profileRevision: 1,
        },
      });
      expect(await db.aiSafetyDisclosureEvent.count({ where: { clientId: client.id } })).toBe(0);

      const view = await getAiWorkspace(client.id);
      expect(view.confirmedIntake).not.toBeNull();
      expect(view.safetyDisclosureCompleted).toBe(false);
      // The retired proxy (`view.confirmedIntake === null`) said false here,
      // so the wizard skipped SAFETY and CONFIRM_INTAKE then threw 422. The
      // two now disagree, and the disclosure row is what counts.
      expect(view.confirmedIntake === null).toBe(false);
      expect(deriveNeedsSafetyDisclosure(view)).toBe(true);

      await expect(runWizardPass(client.id, SELECTIONS)).resolves.toBeUndefined();
      expect(
        await db.aiSafetyDisclosureEvent.count({ where: { clientId: client.id } })
      ).toBeGreaterThan(0);
      expect((await getAiWorkspace(client.id)).safetyDisclosureCompleted).toBe(true);
    });

    it("does not ask again once a disclosure exists, even before any intake is confirmed", async () => {
      const client = await seedClient();
      await applyAiClientCommand(client.id, {
        requestKey: randomUUID(),
        expectedProfileRevision: 0,
        operation: "SAFETY",
        answers: SAFETY_ANSWERS,
      });
      const view = await getAiWorkspace(client.id);
      expect(view.confirmedIntake).toBeNull();
      expect(view.safetyDisclosureCompleted).toBe(true);
      expect(deriveNeedsSafetyDisclosure(view)).toBe(false);
    });

    it("has not weakened the server guard: skipping SAFETY is still a hard 422", async () => {
      const client = await seedClient();
      const view = await getAiWorkspace(client.id);
      await walkStages(client.id, SELECTIONS, view.profileRevision);
      await expect(
        confirmAndRedirect({
          selections: SELECTIONS,
          safetyAnswers: {},
          // A client (or an older app build) that decides wrongly.
          needsSafetyDisclosure: false,
          command: commandFor(client.id, view.profileRevision),
          redirect: () => {},
        })
      ).rejects.toMatchObject({ message: SAFETY_DISCLOSURE_REQUIRED_MESSAGE, status: 422 });
      expect(
        (await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } }))
          .confirmedIntake
      ).toBeNull();
    });
  });
});
