import type { Prisma } from "@/app/generated/prisma/client";
/** T-2041 — a stored-shape run snapshot exactly as `requestAiRun` wrote it
 * BEFORE this change: no `runtimeBinding` key, the four fixture constants
 * inline. The golden hash below was captured by running this same object
 * through the PRE-CHANGE `runSnapshotSchema` at base commit 7bd49f1. */
export const LEGACY_RUN_SNAPSHOT = {
  schemaVersion: 1,
  synthetic: true,
  intake: {
    goal: "GENERAL_FITNESS",
    experienceLevel: "NEW",
    trainingDaysPerWeek: 3,
    equipmentAccess: ["NONE"],
    allergies: [],
    dietaryRestrictions: [],
    foodBudgetLevel: "LOW",
    trackingPreference: "NUMBERS_VISIBLE",
    unitsPreference: "METRIC",
    heightCm: 170,
    weightKg: 70,
  },
  policyVersion: "policy-fixture-v1",
  catalogVersions: { food: "food-fixture-v2", exercise: "exercise-fixture-v1" },
  modelConfiguration: "synthetic-template-v1",
  baseVersionId: null,
  basePayload: null,
  representation: "MACROS",
  reviewWindowKey: "2026-W39",
  reviewTimezone: "America/Los_Angeles",
  lastSafetyResolutionAt: null,
  sourceRefs: [],
  evidence: { observations: [], sessions: [] },
  history: [],
  substitution: null,
} as const;

/**
 * The `AiCoachRun` row a pre-T-2041 `requestAiRun` would have written for
 * `LEGACY_RUN_SNAPSHOT` — the "QUEUED before the deploy, executed after it"
 * case. `businessKey` is randomised because the real one is a content hash of
 * (clientId, kind, snapshot, revisions) and these rows are inserted directly.
 */
export function legacyRunRowData(
  clientId: string,
  businessKey: string,
  kind: "INITIAL" | "WEEKLY_REVIEW" | "REPRESENTATION" = "INITIAL"
) {
  const now = new Date();
  return {
    clientId,
    kind,
    businessKey,
    contextRevision: 0,
    profileRevision: 0,
    observationRevision: 0,
    safetyRevision: 0,
    inputSnapshot: LEGACY_RUN_SNAPSHOT as unknown as Prisma.InputJsonValue,
    snapshotCutoffAt: now,
    activationStartsAt: new Date(now.getTime() - 3_600_000),
    activationEndsAt: new Date(now.getTime() + 7 * 86_400_000),
    lookbackStart: new Date(now.getTime() - 7 * 86_400_000),
    lookbackEnd: now,
  };
}
