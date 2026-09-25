import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

/**
 * A03 — staged confirmed intake and safety disclosure processing.
 *
 * Required regression (docs/ai-coach/09-Validation-Release-Operations.md
 * V09/V17): decline/unsure states work, no unsupported defaults; a valid
 * safety disclosure applies immediately regardless of unrelated draft
 * validity and never waits on a queue; a restriction can only be
 * escalated by a new disclosure, never cleared by one; clearing requires
 * an explicit reviewed-resolution grant.
 */

import { requireLocalTestDb } from "../helpers/require-local-test-db";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;

import { db } from "@/lib/db";
import { saveIntakeDraft, getIntakeDraft, confirmIntake } from "@/lib/ai-coach/intake";
import { submitSafetyDisclosure, clearSafetyRestriction } from "@/lib/ai-coach/safety";

suite("A03 — intake draft/confirm with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  async function makeClient() {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true } });
  }

  it("saves a partial draft without requiring completeness", async () => {
    const client = await makeClient();
    const result = await saveIntakeDraft(client.id, { goal: "GENERAL_FITNESS" });
    expect(result.success).toBe(true);

    const draft = await getIntakeDraft(client.id);
    expect(draft?.goal).toBe("GENERAL_FITNESS");
  });

  it("merges successive partial saves instead of overwriting", async () => {
    const client = await makeClient();
    await saveIntakeDraft(client.id, { goal: "STRENGTH" });
    await saveIntakeDraft(client.id, { experienceLevel: "NEW" });

    const draft = await getIntakeDraft(client.id);
    expect(draft?.goal).toBe("STRENGTH");
    expect(draft?.experienceLevel).toBe("NEW");
  });

  it("rejects confirmation of an incomplete intake", async () => {
    const client = await makeClient();
    const result = await confirmIntake(client.id, { goal: "GENERAL_FITNESS" });
    expect(result.success).toBe(false);
  });

  it("confirms a complete intake without height/weight — personalized nutrition stays pending, not defaulted", async () => {
    const client = await makeClient();
    const full = {
      goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3,
      equipmentAccess: ["HOME_BASIC"], dietaryRestrictions: [], allergies: [],
      foodBudgetLevel: "MODERATE", trackingPreference: "PORTIONS_ONLY", unitsPreference: "IMPERIAL",
    };
    const result = await confirmIntake(client.id, full);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.profileRevision).toBe(1);

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(profile.confirmedIntake).toMatchObject({ goal: "GENERAL_FITNESS" });
    expect((profile.confirmedIntake as Record<string, unknown>).heightCm).toBeUndefined();

    // Confirmed intake clears the draft — it's no longer "pending."
    const draftAfter = await getIntakeDraft(client.id);
    expect(draftAfter).toBeNull();
  });

  it("re-confirming bumps profileRevision again", async () => {
    const client = await makeClient();
    const full = {
      goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3,
      equipmentAccess: ["HOME_BASIC"], dietaryRestrictions: [], allergies: [],
      foodBudgetLevel: "MODERATE", trackingPreference: "PORTIONS_ONLY", unitsPreference: "IMPERIAL",
    };
    await confirmIntake(client.id, full);
    const second = await confirmIntake(client.id, { ...full, allergies: ["peanuts"] });
    expect(second.success).toBe(true);
    if (!second.success) throw new Error("unreachable");
    expect(second.profileRevision).toBe(2);
  });

  function v2Full(overrides: Record<string, unknown> = {}) {
    return {
      intakeVersion: 2,
      goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3,
      equipmentAccess: ["HOME_BASIC"], foodBudgetLevel: "MODERATE",
      trackingPreference: "PORTIONS_ONLY", unitsPreference: "IMPERIAL",
      ageYears: 31, ageStatus: "CONFIRMED",
      energyMethodPopulationCategory: "MALE_ADULT", energyMethodPopulationCategoryStatus: "CONFIRMED",
      physicalActivityCategory: "ACTIVE", physicalActivityCategoryStatus: "CONFIRMED",
      bodyMeasurementStatus: "CONFIRMED", heightCm: 180, weightKg: 82, weightMeasuredOn: "2026-09-20",
      bodyWeightIntent: "MAINTAIN", goalPaceClass: "MAINTAIN", weightNeutralAccepted: true, goalStatus: "CONFIRMED",
      resistanceTrainingContext: "REGULAR", sessionLengthBand: "MIN_45_60", trainingContextStatus: "CONFIRMED",
      cookingAccess: { equipment: ["FULL_KITCHEN"], refrigeration: "FRIDGE_AND_FREEZER", mealPrepCapacity: "BATCH", typicalPrepMinutesBand: "MIN_15_30" },
      cookingAccessStatus: "CONFIRMED",
      dislikes: [], cuisinePreferences: [],
      allergenDeclarations: {
        status: "CONFIRMED", noKnownAllergens: false,
        items: [{ category: "TREE_NUT", specificity: "cashew", kind: "ALLERGY", crossContactAvoidanceRequired: "YES" }],
      },
      dietaryPattern: { pattern: "OMNIVORE", otherLabel: null, mandatory: false, reason: "PREFERENCE", status: "CONFIRMED" },
      ...overrides,
    };
  }

  it("T-2024: a v2 confirm writes intakeVersion: 2, a server-set capturedAt, and derived allergies/dietaryRestrictions", async () => {
    const client = await makeClient();
    const before = new Date();
    const result = await confirmIntake(client.id, v2Full());
    expect(result.success).toBe(true);

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    const stored = profile.confirmedIntake as Record<string, unknown>;
    expect(stored.intakeVersion).toBe(2);
    expect(stored.allergies).toEqual(["TREE_NUT"]);
    expect(stored.dietaryRestrictions).toEqual([]);
    expect(typeof stored.capturedAt).toBe("string");
    expect(new Date(stored.capturedAt as string).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("T-2024: a client-supplied capturedAt in a v2 confirm is rejected", async () => {
    const client = await makeClient();
    const result = await confirmIntake(client.id, {
      ...v2Full(),
      capturedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("T-2024: a client-supplied allergies in a v2 confirm is rejected", async () => {
    const client = await makeClient();
    const result = await confirmIntake(client.id, { ...v2Full(), allergies: ["milk"] });
    expect(result.success).toBe(false);
  });

  it("T-2024: confirming v2 with ageStatus: UNKNOWN succeeds and stores no ageYears", async () => {
    const client = await makeClient();
    const result = await confirmIntake(client.id, v2Full({ ageStatus: "UNKNOWN", ageYears: undefined }));
    expect(result.success).toBe(true);

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    const stored = profile.confirmedIntake as Record<string, unknown>;
    expect(stored.ageStatus).toBe("UNKNOWN");
    expect(stored.ageYears).toBeUndefined();
  });
});

suite("A03 — safety disclosure processing with real PostgreSQL constraints", () => {
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { await db.$disconnect(); });

  async function makeClient() {
    const id = randomUUID();
    return db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true } });
  }

  const allClear = {
    chestPainDuringExercise: "NO" as const, dizzinessOrFainting: "NO" as const, heartCondition: "NO" as const,
    pregnantOrPostpartum: "NO" as const, recentInjuryOrSurgery: "NO" as const,
  };

  it("all-clear answers result in CLEAR disposition and ALLOW everywhere, with no prior profile required", async () => {
    const client = await makeClient();
    const result = await submitSafetyDisclosure(client.id, allClear);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.disposition).toBe("CLEAR");

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(profile.nutritionPermission).toBe("ALLOW");
    expect(profile.strengthPermission).toBe("ALLOW");
    expect(profile.cardioPermission).toBe("ALLOW");
  });

  it("a YES on a serious question immediately sets URGENT and pauses all domains", async () => {
    const client = await makeClient();
    const result = await submitSafetyDisclosure(client.id, { ...allClear, chestPainDuringExercise: "YES" });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.disposition).toBe("URGENT");

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(profile.nutritionPermission).toBe("PAUSED");
    expect(profile.strengthPermission).toBe("PAUSED");
    expect(profile.cardioPermission).toBe("PAUSED");
  });

  it("an UNSURE answer is treated as a real signal, not a negative — restricts, does not clear", async () => {
    const client = await makeClient();
    const result = await submitSafetyDisclosure(client.id, { ...allClear, recentInjuryOrSurgery: "UNSURE" });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.disposition).toBe("CLARIFY");

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(profile.strengthPermission).toBe("HOLD_ONLY");
    expect(profile.nutritionPermission).toBe("ALLOW"); // unrelated domain unaffected
  });

  it("a later, less severe disclosure never loosens an existing restriction", async () => {
    const client = await makeClient();
    await submitSafetyDisclosure(client.id, { ...allClear, heartCondition: "YES" });
    const second = await submitSafetyDisclosure(client.id, allClear); // all-clear submitted second
    expect(second.success).toBe(true);
    if (!second.success) throw new Error("unreachable");
    expect(second.disposition).toBe("URGENT"); // still URGENT, not reset to CLEAR

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(profile.strengthPermission).toBe("PAUSED");
  });

  it("rejects malformed disclosure input", async () => {
    const client = await makeClient();
    const result = await submitSafetyDisclosure(client.id, { chestPainDuringExercise: "MAYBE" });
    expect(result.success).toBe(false);
  });

  it("logs every disclosure as an immutable audit event", async () => {
    const client = await makeClient();
    await submitSafetyDisclosure(client.id, allClear);
    await submitSafetyDisclosure(client.id, { ...allClear, dizzinessOrFainting: "YES" });

    const events = await db.aiSafetyDisclosureEvent.findMany({ where: { clientId: client.id }, orderBy: { reportedAt: "asc" } });
    expect(events).toHaveLength(2);
    expect(events[0].dispositionAfter).toBe("CLEAR");
    expect(events[1].dispositionAfter).toBe("URGENT");
  });

  it("increments safetyRevision on every disclosure", async () => {
    const client = await makeClient();
    await submitSafetyDisclosure(client.id, allClear);
    const second = await submitSafetyDisclosure(client.id, allClear);
    if (!second.success) throw new Error("unreachable");
    expect(second.safetyRevision).toBe(2);
  });

  it("legacy clearance cannot bypass the scoped resolution workflow", async () => {
    const client = await makeClient();
    await submitSafetyDisclosure(client.id, { ...allClear, heartCondition: "YES" });

    const unauthorizedResult = await clearSafetyRestriction(client.id, randomUUID(), {
      disposition: "CLEAR", nutrition: "ALLOW", strength: "ALLOW", cardio: "ALLOW",
    });
    expect(unauthorizedResult.success).toBe(false);

    const reviewerClerkId = randomUUID();
    const reviewer = await db.user.create({ data: { clerkId: reviewerClerkId, email: `${reviewerClerkId}@example.test`, isCoach: true } });
    await db.aiCoachReviewerGrant.create({ data: { userId: reviewer.id, qualificationNote: "test fixture" } });

    const authorizedResult = await clearSafetyRestriction(client.id, reviewer.id, {
      disposition: "CLEAR", nutrition: "ALLOW", strength: "ALLOW", cardio: "ALLOW",
    });
    expect(authorizedResult.success).toBe(false);

    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } });
    expect(profile.safetyDisposition).not.toBe("CLEAR");
    expect(profile.strengthPermission).toBe("PAUSED");
  });

  it("clearSafetyRestriction rejects a revoked reviewer grant", async () => {
    const client = await makeClient();
    await submitSafetyDisclosure(client.id, { ...allClear, heartCondition: "YES" });

    const reviewerClerkId = randomUUID();
    const reviewer = await db.user.create({ data: { clerkId: reviewerClerkId, email: `${reviewerClerkId}@example.test`, isCoach: true } });
    await db.aiCoachReviewerGrant.create({ data: { userId: reviewer.id, qualificationNote: "test fixture", revokedAt: new Date() } });

    const result = await clearSafetyRestriction(client.id, reviewer.id, {
      disposition: "CLEAR", nutrition: "ALLOW", strength: "ALLOW", cardio: "ALLOW",
    });
    expect(result.success).toBe(false);
  });
});
