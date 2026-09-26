import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { assignFixtureReviewer } from "../helpers/ai-reviewer";
import { applyAiClientCommand } from "@/lib/ai-coach/client-commands";
import { requestAiRun } from "@/lib/ai-coach/run-command";
import { claimQueuedRun } from "@/lib/ai-coach/runs";
import { processClaimedRun } from "@/lib/ai-coach/executor";
import { SyntheticFixtureProvider } from "@/lib/ai-coach/provider/synthetic-provider";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import { reviewAiPlan } from "@/lib/ai-coach/reviewer";
import { approvalStateHash } from "@/lib/ai-coach/validated-plan";
import { acceptPlanVersionAtomic } from "@/lib/ai-coach/plan-acceptance";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");
suite("beginner shared-command journey with real persistence", () => {
  beforeEach(() => {
    for (const flag of [
      "AI_COACH_FIXTURE_MODE",
      "FEATURE_AI_COACH_ENROLLMENT",
      "FEATURE_AI_COACH_GENERATION",
      "FEATURE_AI_COACH_PUBLICATION",
    ])
      vi.stubEnv(flag, "true");
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => db.$disconnect());
  it("completes onboarding and generation without allowing reviewer activation", async () => {
    const seed = randomUUID();
    const client = await db.user.create({ data: { clerkId: seed, email: `${seed}@example.test` } });
    const grant = await assignFixtureReviewer(client.id);
    await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    const command = (fields: object) =>
      applyAiClientCommand(client.id, {
        requestKey: randomUUID(),
        expectedProfileRevision: 0,
        ...fields,
      });
    const answers = {
      goal: "GENERAL_FITNESS",
      experienceLevel: "NEW",
      trainingDaysPerWeek: 2,
      equipmentAccess: ["NONE"],
      allergies: [],
      dietaryRestrictions: [],
      foodBudgetLevel: "LOW",
      trackingPreference: "PORTIONS_ONLY",
      unitsPreference: "METRIC",
      heightCm: 175,
      weightKg: 75,
    };
    await command({
      operation: "SAFETY",
      answers: {
        chestPainDuringExercise: "NO",
        dizzinessOrFainting: "NO",
        heartCondition: "NO",
        pregnantOrPostpartum: "NO",
        recentInjuryOrSurgery: "NO",
      },
    });
    await command({ operation: "ALLERGIES", allergies: [] });
    await command({ operation: "CONFIRM_INTAKE", answers });
    // T-2024: a v1-shaped confirm still produces the exact same workspace DTO
    // shape, plus the new intakeSchemaVersions capability field.
    const afterV1Confirm = await getAiWorkspace(client.id);
    expect(afterV1Confirm.intakeSchemaVersions).toEqual([1, 2]);
    expect(afterV1Confirm.schemaVersion).toBe(1);
    expect(afterV1Confirm.confirmedIntake).toMatchObject({ goal: "GENERAL_FITNESS" });
    expect(afterV1Confirm.confirmedIntake).not.toHaveProperty("intakeVersion");
    await command({
      operation: "ENROLL",
      expectedProfileRevision: 1,
      expectedContextRevision: 0,
      consent: true,
      reviewTimezone: "UTC",
    });
    async function execute(kind: "INITIAL" | "WEEKLY_REVIEW") {
      const w = await getAiWorkspace(client.id);
      const result = await requestAiRun(client.id, {
        requestKey: randomUUID(),
        kind,
        representation: "MEALS",
        expectedContextRevision: w.contextRevision,
        expectedProfileRevision: w.profileRevision,
      });
      const claim = await claimQueuedRun(result.runId);
      if (!claim.claimed) throw new Error("Claim failed");
      expect(await processClaimedRun(claim, new SyntheticFixtureProvider())).toBe("completed");
      return db.aiCoachRun.findUniqueOrThrow({ where: { id: result.runId } });
    }
    const initial = await execute("INITIAL");
    const candidate = await db.aiPlanVersion.findUniqueOrThrow({
      where: { id: initial.resultPlanVersionId! },
    });
    expect((await getAiWorkspace(client.id)).proposals[0].payload).toBeNull();
    await reviewAiPlan(grant.userId, candidate.id, {
      requestKey: randomUUID(),
      expectedStateHash: approvalStateHash(candidate),
      approved: true,
      rationale: "Synthetic workflow verification only",
    });
    const proposal = (await getAiWorkspace(client.id)).proposals[0];
    const { id, status, payload } = proposal;
    expect(status).toBe("PENDING_FINALIZATION");
    expect(payload).toBeNull();
    const accept = {
      requestKey: randomUUID(),
      expectedBaseVersionId: proposal.expectedBaseVersionId,
      expectedContextRevision: proposal.expectedContextRevision,
      expectedProfileRevision: proposal.expectedProfileRevision,
      expectedObservationRevision: proposal.expectedObservationRevision,
      expectedSafetyRevision: proposal.expectedSafetyRevision,
    };
    expect(await acceptPlanVersionAtomic(client.id, id, accept)).toMatchObject({
      success: false,
      code: "REVIEWER_APPROVAL_REQUIRED",
    });
    expect((await getAiWorkspace(client.id)).activePlan).toBeNull();
    expect(await db.mealPlan.count({ where: { clientId: client.id } })).toBe(0);
    expect(await db.coachClient.count({ where: { clientId: client.id } })).toBe(0);
    expect(await db.aiPlanAcceptanceOutbox.count({ where: { clientId: client.id } })).toBe(0);
  });
});
