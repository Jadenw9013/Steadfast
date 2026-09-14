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
import { submitAiCheckIn } from "@/lib/check-ins/ai-observation";
import { submitAiSession } from "@/lib/workouts/ai-session";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) { const u = new URL(process.env.DATABASE_URL ?? ""); if (u.hostname !== "127.0.0.1" || u.pathname !== "/steadfast_security_test") throw new Error("Dedicated local test database required"); }
const suite = enabled ? describe : describe.skip;
suite("beginner shared-command journey with real persistence", () => {
  beforeEach(() => { for (const flag of ["AI_COACH_FIXTURE_MODE", "FEATURE_AI_COACH_ENROLLMENT", "FEATURE_AI_COACH_GENERATION", "FEATURE_AI_COACH_PUBLICATION"]) vi.stubEnv(flag, "true"); });
  afterEach(() => vi.unstubAllEnvs()); afterAll(() => db.$disconnect());
  it("completes intake, initial review/acceptance, activity and check-in without inventing an early weekly adjustment", async () => {
    const seed = randomUUID(); const client = await db.user.create({ data: { clerkId: seed, email: `${seed}@example.test` } });
    const grant = await assignFixtureReviewer(client.id);
    await db.aiCoachProfile.create({ data: { clientId: client.id, isSynthetic: true } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    const command = (fields: object) => applyAiClientCommand(client.id, { requestKey: randomUUID(), expectedProfileRevision: 0, ...fields });
    const answers = { goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 2, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "PORTIONS_ONLY", unitsPreference: "METRIC", heightCm: 175, weightKg: 75 };
    await command({ operation: "SAFETY", answers: { chestPainDuringExercise: "NO", dizzinessOrFainting: "NO", heartCondition: "NO", pregnantOrPostpartum: "NO", recentInjuryOrSurgery: "NO" } });
    await command({ operation: "ALLERGIES", allergies: [] }); await command({ operation: "CONFIRM_INTAKE", answers });
    await command({ operation: "ENROLL", expectedProfileRevision: 1, expectedContextRevision: 0, consent: true, reviewTimezone: "UTC" });
    async function execute(kind: "INITIAL" | "WEEKLY_REVIEW") {
      const w = await getAiWorkspace(client.id);
      const result = await requestAiRun(client.id, { requestKey: randomUUID(), kind, representation: "MEALS", expectedContextRevision: w.contextRevision, expectedProfileRevision: w.profileRevision });
      const claim = await claimQueuedRun(result.runId); if (!claim.claimed) throw new Error("Claim failed");
      expect(await processClaimedRun(claim, new SyntheticFixtureProvider())).toBe("completed");
      return db.aiCoachRun.findUniqueOrThrow({ where: { id: result.runId } });
    }
    const initial = await execute("INITIAL");
    const candidate = await db.aiPlanVersion.findUniqueOrThrow({ where: { id: initial.resultPlanVersionId! } });
    expect((await getAiWorkspace(client.id)).proposals[0].payload).toBeNull();
    await reviewAiPlan(grant.userId, candidate.id, { requestKey: randomUUID(), expectedStateHash: approvalStateHash(candidate), approved: true, rationale: "Synthetic workflow verification only" });
    const proposal = (await getAiWorkspace(client.id)).proposals[0]; const { id, status, payload, ...revisions } = proposal;
    expect(status).toBe("READY"); expect(payload).not.toBeNull();
    const accept = { ...revisions, requestKey: randomUUID() };
    expect(await acceptPlanVersionAtomic(client.id, id, accept)).toMatchObject({ success: true });
    expect(await acceptPlanVersionAtomic(client.id, id, accept)).toMatchObject({ success: true });
    const active = (await getAiWorkspace(client.id)).activePlan!; const session = active.payload.strength[0]; const exercise = session.exercises[0];
    await submitAiSession(client.id, { requestKey: randomUUID(), clientEventId: randomUUID(), sessionInstanceId: randomUUID(), expectedRevision: 0, planVersionId: active.id, prescriptionSessionId: session.sessionId, exerciseId: exercise.exerciseId, occurredAt: new Date().toISOString(), modality: "STRENGTH", setIndex: 0, resultStatus: "REPORTED_PARTIAL", reps: exercise.reps, loadValue: 0, loadUnit: null, loadKind: "BODYWEIGHT", durationMinutes: null, effortRating: 5, painReported: false });
    await submitAiCheckIn(client.id, { requestKey: randomUUID(), clientEventId: randomUUID(), expectedRevision: 0, occurredAt: new Date().toISOString(), submit: true, payload: { schemaVersion: 1, completeness: "REPORTED_PARTIAL", followingDays: null, weight: null, energy: "OK", recovery: "GOOD", hunger: "MANAGEABLE", barrier: "NONE", safetyChanged: "NO" } });
    const weekly = await execute("WEEKLY_REVIEW"); expect(weekly.resultReviewAction).toBe("CLARIFY"); expect(weekly.resultPlanVersionId).toBeNull();
    expect((await getAiWorkspace(client.id)).activePlan?.id).toBe(active.id);
    expect(await db.mealPlan.count({ where: { clientId: client.id } })).toBe(0); expect(await db.coachClient.count({ where: { clientId: client.id } })).toBe(0);
    expect(await db.aiPlanAcceptanceOutbox.count({ where: { clientId: client.id } })).toBe(1);
  });
});
