import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { submitAiSession } from "@/lib/workouts/ai-session";
import { getAiSessions } from "@/lib/queries/ai-sessions";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
import {
  enableDraftExerciseCatalog,
  disableDraftExerciseCatalog,
} from "@/lib/ai-coach/catalog/draft-exercise-catalog";
import { trainingCatalogSourceFromDraftFile } from "@/lib/ai-coach/training/catalog-source";
import { composeTraining } from "@/lib/ai-coach/training/index";
import { buildSyntheticArtifactSet } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { resolveTrainingParameters } from "@/lib/ai-coach/training/parameters";
import { planPayloadSchema, type PlanPayload } from "@/lib/ai-coach/plan-contract";
import type {
  EscalationTemplatesContent,
  PolicyBundleContent,
} from "@/lib/ai-coach/artifacts/schema";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");
suite("typed AI activity evidence", () => {
  beforeEach(() => vi.stubEnv("AI_COACH_FIXTURE_MODE", "true"));
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => {
    disableDraftExerciseCatalog();
    return db.$disconnect();
  });
  async function fixture() {
    const id = randomUUID(); const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic: true } }); await db.aiCoachEntitlement.create({ data: { clientId: user.id } }); await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    const { payload } = buildInitialFixturePlan({ goal: "GENERAL_FITNESS", experienceLevel: "NEW", trainingDaysPerWeek: 3, equipmentAccess: ["NONE"], allergies: [], dietaryRestrictions: [], foodBudgetLevel: "LOW", trackingPreference: "NUMBERS_VISIBLE", unitsPreference: "METRIC" }, randomUUID(), "MACROS");
    const plan = await db.aiPlanVersion.create({ data: { clientId: user.id, version: 1, status: "ACCEPTED", acceptedAt: new Date(), payload, payloadHash: contentHash(payload), policyVersion: payload.policyVersion, catalogVersions: payload.catalogVersions, contextRevision: 0, profileRevision: 0, observationRevision: 0, safetyRevision: 0 } });
    const input = { requestKey: randomUUID(), clientEventId: randomUUID(), sessionInstanceId: randomUUID(), expectedRevision: 0, planVersionId: plan.id, prescriptionSessionId: payload.strength[0].sessionId, exerciseId: payload.strength[0].exercises[0].exerciseId, occurredAt: new Date().toISOString(), modality: "STRENGTH", setIndex: 0, resultStatus: "REPORTED_COMPLETE", reps: 8, loadValue: 0, loadUnit: null, loadKind: "BODYWEIGHT", durationMinutes: null, effortRating: 5, painReported: false };
    return { user, plan, payload, input };
  }
  it("keeps bodyweight zero, units, and repeated workout instances distinct", async () => {
    const { user, input } = await fixture(); await submitAiSession(user.id, input);
    await submitAiSession(user.id, { ...input, requestKey: randomUUID(), clientEventId: randomUUID(), sessionInstanceId: randomUUID(), loadKind: "ASSISTED", loadValue: 20, loadUnit: "LB" });
    const records = await getAiSessions(user.id); expect(records).toHaveLength(2);
    expect(records.find(r => r.loadKind === "BODYWEIGHT")).toMatchObject({ loadValue: 0, loadUnit: null, revision: 1 });
  });
  it("deduplicates retries, rejects duplicate sets and stale corrections", async () => {
    const { user, input } = await fixture(); await Promise.all([submitAiSession(user.id, input), submitAiSession(user.id, { ...input, requestKey: randomUUID() })]);
    expect(await getAiSessions(user.id)).toHaveLength(1);
    await expect(submitAiSession(user.id, { ...input, requestKey: randomUUID(), clientEventId: randomUUID() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await submitAiSession(user.id, { ...input, requestKey: randomUUID(), expectedRevision: 1, reps: 7 });
    await expect(submitAiSession(user.id, { ...input, requestKey: randomUUID(), expectedRevision: 1, reps: 6 })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
  it("records cardio without fabricated repetitions or load and rejects mixed fields", async () => {
    const { user, input, payload } = await fixture(); const cardio = { ...input, modality: "CARDIO", prescriptionSessionId: payload.cardio[0].sessionId, exerciseId: payload.cardio[0].exerciseId, reps: null, loadValue: null, loadKind: null, durationMinutes: 12 };
    await submitAiSession(user.id, cardio); expect((await getAiSessions(user.id))[0]).toMatchObject({ modality: "CARDIO", durationMinutes: 12, reps: null, loadKind: null });
    await expect(submitAiSession(user.id, { ...cardio, requestKey: randomUUID(), reps: 2 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("enforces plan ownership, prescribed activity, and explicit missing data", async () => {
    const { user, input } = await fixture(); const other = await fixture();
    await expect(submitAiSession(other.user.id, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(submitAiSession(user.id, { ...input, exerciseId: "invented" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await submitAiSession(user.id, { ...input, resultStatus: "REPORTED_NOT_DONE", reps: null, loadKind: null, loadValue: null });
    expect((await getAiSessions(user.id))[0]).toMatchObject({ resultStatus: "REPORTED_NOT_DONE", reps: null });
  });
  it("preserves a pain restriction despite invalid workout data", async () => {
    const { user, input } = await fixture(); await expect(submitAiSession(user.id, { ...input, painReported: true, reps: -1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await db.aiCoachProfile.findUnique({ where: { clientId: user.id } })).toMatchObject({ strengthPermission: "PAUSED", safetyRevision: 1 });
    expect(await getAiSessions(user.id)).toHaveLength(0);
  });

  async function composedFixture() {
    enableDraftExerciseCatalog();
    const id = randomUUID();
    const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    await db.aiCoachProfile.create({ data: { clientId: user.id, isSynthetic: true } });
    await db.aiCoachEntitlement.create({ data: { clientId: user.id } });
    await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });

    const catalog = trainingCatalogSourceFromDraftFile();
    const set = buildSyntheticArtifactSet();
    const escalation = set.escalationTemplates.content as EscalationTemplatesContent;
    if (!("templates" in escalation)) throw new Error("fixture shape changed");
    const explanationTexts = escalation.templates.map((t) => ({ id: t.id, text: t.nextStepText }));
    const resolved = resolveTrainingParameters(
      set.policyBundle.content as PolicyBundleContent,
      explanationTexts
    );
    if (!resolved.ok) throw new Error("Synthetic parameter resolution failed");

    const trainingResult = composeTraining(resolved.parameters, catalog, resolved.effortText, {
      intakeVersion: 2,
      trainingDaysPerWeek: 3,
      equipmentAccess: ["HOME_BASIC"],
      experienceLevel: "NEW",
      sessionLengthBand: "MIN_45_60",
      trainingContextStatus: "CONFIRMED",
      energyReducedRelativeToMaintenance: false,
      activeContraindicationRuleIds: [],
    });
    if (trainingResult.status !== "COMPOSED") throw new Error("composeTraining failed");

    const payloadCandidate: PlanPayload = {
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: null,
      meals: null,
      strength: trainingResult.strength,
      cardio: trainingResult.cardio,
      policyVersion: "policy-bundle-nutrition:v1",
      catalogVersions: {
        food: "food-fixture-v1",
        exercise: catalog.catalogVersion,
      },
      prescriptionOutcome: {
        status: "UNAVAILABLE",
        reasonCodes: [],
        nutritionRequired: false,
        parameterSetDigest: null,
      },
    };
    const payload = planPayloadSchema.parse(payloadCandidate);

    const plan = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "ACCEPTED",
        acceptedAt: new Date(),
        payload,
        payloadHash: contentHash(payload),
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        contextRevision: 0,
        profileRevision: 0,
        observationRevision: 0,
        safetyRevision: 0,
      },
    });

    return { user, plan, payload, trainingResult };
  }

  it("T-2039: accepts sets for each (sessionId, exerciseId, setIndex) from composed multi-exercise plan and enforces validation and conflict rules", async () => {
    const { user, plan, payload } = await composedFixture();
    expect(payload.strength.length).toBeGreaterThan(1);
    const session0 = payload.strength[0];
    expect(session0.exercises.length).toBeGreaterThan(1);

    // Accept sets for each (sessionId, exerciseId, setIndex) in session 0
    const sessionInstanceId1 = randomUUID();
    for (let setIdx = 0; setIdx < 2; setIdx++) {
      for (const ex of session0.exercises) {
        const input = {
          requestKey: randomUUID(),
          clientEventId: randomUUID(),
          sessionInstanceId: sessionInstanceId1,
          expectedRevision: 0,
          planVersionId: plan.id,
          prescriptionSessionId: session0.sessionId,
          exerciseId: ex.exerciseId,
          occurredAt: new Date().toISOString(),
          modality: "STRENGTH" as const,
          setIndex: setIdx,
          resultStatus: "REPORTED_COMPLETE" as const,
          reps: ex.reps,
          loadValue: 15,
          loadUnit: "KG" as const,
          loadKind: "EXTERNAL" as const,
          durationMinutes: null,
          effortRating: 4,
          painReported: false,
        };
        const record = (await submitAiSession(user.id, input)) as {
          id: string;
          revision: number;
        };
        expect(record.revision).toBe(1);
      }
    }

    // Rejects an exerciseId that is not in that session (ai-session.ts:28-31 -> VALIDATION_ERROR)
    await expect(
      submitAiSession(user.id, {
        requestKey: randomUUID(),
        clientEventId: randomUUID(),
        sessionInstanceId: randomUUID(),
        expectedRevision: 0,
        planVersionId: plan.id,
        prescriptionSessionId: session0.sessionId,
        exerciseId: "unknown-exercise-id",
        occurredAt: new Date().toISOString(),
        modality: "STRENGTH",
        setIndex: 0,
        resultStatus: "REPORTED_COMPLETE",
        reps: 8,
        loadValue: 10,
        loadUnit: "KG",
        loadKind: "EXTERNAL",
        durationMinutes: null,
        effortRating: 4,
        painReported: false,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Repeated sessions stay distinct: two different sessionInstanceIds against the same
    // prescriptionSessionId, exerciseId, and setIndex both persist
    const targetExercise = session0.exercises[0];
    const sessionInstanceId2 = randomUUID();
    const secondInstanceInput = {
      requestKey: randomUUID(),
      clientEventId: randomUUID(),
      sessionInstanceId: sessionInstanceId2,
      expectedRevision: 0,
      planVersionId: plan.id,
      prescriptionSessionId: session0.sessionId,
      exerciseId: targetExercise.exerciseId,
      occurredAt: new Date().toISOString(),
      modality: "STRENGTH" as const,
      setIndex: 0,
      resultStatus: "REPORTED_COMPLETE" as const,
      reps: targetExercise.reps,
      loadValue: 20,
      loadUnit: "KG" as const,
      loadKind: "EXTERNAL" as const,
      durationMinutes: null,
      effortRating: 5,
      painReported: false,
    };
    await submitAiSession(user.id, secondInstanceInput);

    // Duplicate (sessionInstanceId, exerciseId, setIndex) is refused with REVISION_CONFLICT
    const duplicateSetInput = {
      ...secondInstanceInput,
      requestKey: randomUUID(),
      clientEventId: randomUUID(),
      reps: 10,
    };
    await expect(submitAiSession(user.id, duplicateSetInput)).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
  });
});

