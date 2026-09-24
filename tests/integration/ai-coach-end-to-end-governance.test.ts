import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import {
  publishArtifactVersion,
  registerArtifactVersion,
  revokeArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { finalizeCurrentClientPlan } from "@/lib/ai-coach/finalization";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import {
  acceptPlanVersionAtomic,
  type AcceptPlanVersionInput,
} from "@/lib/ai-coach/plan-acceptance";
import { submitSafetyDisclosure } from "@/lib/ai-coach/safety";
import {
  getAiCoachOperationalMonitoring,
  setAiCoachOperationalControl,
} from "@/lib/ai-coach/operations";

vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/steadfast_security_test") {
    throw new Error("Dedicated local test database required");
  }
}
const suite = enabled ? describe : describe.skip;
const authMock = vi.mocked(getCurrentDbUser);
const intake = {
  goal: "GENERAL_FITNESS" as const,
  experienceLevel: "NEW" as const,
  trainingDaysPerWeek: 2,
  equipmentAccess: ["NONE" as const],
  dietaryRestrictions: [],
  allergies: [],
  foodBudgetLevel: "LOW" as const,
  trackingPreference: "NUMBERS_VISIBLE" as const,
  unitsPreference: "METRIC" as const,
  heightCm: 170,
  weightKg: 70,
};
const clearSafety = {
  chestPainDuringExercise: "NO" as const,
  dizzinessOrFainting: "NO" as const,
  heartCondition: "NO" as const,
  pregnantOrPostpartum: "NO" as const,
  recentInjuryOrSurgery: "NO" as const,
  ageEligibilityConcern: "NO" as const,
  eatingDisorderHistoryOrConcern: "NO" as const,
  type1Diabetes: "NO" as const,
};

suite("T-1008 through T-1010 synthetic end-to-end and governance controls", () => {
  const originalFixtureMode = process.env.AI_COACH_FIXTURE_MODE;
  const originalPublication = process.env.FEATURE_AI_COACH_PUBLICATION;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.AI_COACH_FIXTURE_MODE = "true";
    process.env.FEATURE_AI_COACH_PUBLICATION = "true";
    await db.aiCoachOperationalControl.deleteMany();
  });
  afterEach(async () => {
    process.env.AI_COACH_FIXTURE_MODE = originalFixtureMode;
    process.env.FEATURE_AI_COACH_PUBLICATION = originalPublication;
    await db.aiCoachOperationalControl.deleteMany();
  });
  afterAll(() => db.$disconnect());

  async function ensureRuntimeArtifacts() {
    const set = buildSyntheticArtifactSet("t1008-runtime");
    const effectiveAt = new Date(Date.now() - 60_000);
    const expiresAt = new Date(Date.now() + 86_400_000);
    for (const artifact of [
      set.foodCatalog,
      set.exerciseCatalog,
      set.evidenceRegistry,
      set.escalationTemplates,
      set.policyBundle,
    ]) {
      const existing = await db.aiCoachArtifactVersion.findUnique({ where: { id: artifact.id } });
      if (!existing) await registerArtifactVersion(artifact);
      const current = await db.aiCoachArtifactVersion.findUniqueOrThrow({
        where: { id: artifact.id },
      });
      if (current.state === "DRAFT") {
        await publishArtifactVersion({
          id: artifact.id,
          effectiveAt,
          expiresAt,
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
        });
      }
      expect(
        (await db.aiCoachArtifactVersion.findUniqueOrThrow({ where: { id: artifact.id } })).state
      ).toBe("PUBLISHED");
    }
  }

  async function clientFixture() {
    await ensureRuntimeArtifacts();
    const id = randomUUID();
    const user = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true },
    });
    await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: user.id } });
    await db.aiCoachProfile.create({
      data: {
        clientId: user.id,
        isSynthetic: true,
        confirmedIntake: intake,
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
      },
    });
    await submitSafetyDisclosure(user.id, clearSafety);
    authMock.mockResolvedValue(user);
    const context = await db.clientCoachingContext.findUniqueOrThrow({
      where: { clientId: user.id },
    });
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
    const { payload } = buildInitialFixturePlan(intake, "synthetic-rx", "MEALS");
    const candidate = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        payload,
        payloadHash: contentHash(payload),
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        changeClass: "INITIAL",
        reviewerStatus: "PENDING",
        validationReport: { engine: "managed-v1", passed: true, inputHash: "a".repeat(64) },
        sourceRefs: [],
      },
    });
    const acceptInput: AcceptPlanVersionInput = {
      requestKey: randomUUID(),
      expectedBaseVersionId: null,
      expectedContextRevision: candidate.contextRevision,
      expectedProfileRevision: candidate.profileRevision,
      expectedObservationRevision: candidate.observationRevision,
      expectedSafetyRevision: candidate.safetyRevision,
    };
    return { user, candidate, acceptInput };
  }

  it("runs draft candidate → deterministic finalization → atomic acceptance without reviewer authority", async () => {
    const { user, candidate, acceptInput } = await clientFixture();
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    const approval = await db.aiAutomaticPlanApproval.findUniqueOrThrow({
      where: { planVersionId: candidate.id },
    });
    expect(approval.clientId).toBe(user.id);
    expect(JSON.stringify(approval.providerSelection)).not.toMatch(/prompt|trace|clientId/i);

    await expect(
      acceptPlanVersionAtomic(user.id, candidate.id, acceptInput)
    ).resolves.toMatchObject({
      success: true,
      alreadyAccepted: false,
      activeVersionId: candidate.id,
    });
    expect(
      await db.aiPlanActivationAttempt.findFirst({ where: { planVersionId: candidate.id } })
    ).toMatchObject({
      outcome: "ACCEPTED",
      reasonCode: "AUTOMATIC_GATE_APPROVED",
    });
  });

  it("does not let reviewer state bypass automatic finalization", async () => {
    const { user, candidate, acceptInput } = await clientFixture();
    await db.aiPlanVersion.update({
      where: { id: candidate.id },
      data: { reviewerStatus: "APPROVED" },
    });
    await expect(
      acceptPlanVersionAtomic(user.id, candidate.id, acceptInput)
    ).resolves.toMatchObject({
      success: false,
      code: "REVIEWER_APPROVAL_REQUIRED",
    });
  });

  it("fails closed when state changes after approval and records the rejected attempt", async () => {
    const { user, candidate, acceptInput } = await clientFixture();
    await finalizeCurrentClientPlan(candidate.id);
    await db.aiCoachProfile.update({
      where: { clientId: user.id },
      data: { observationRevision: { increment: 1 } },
    });
    await expect(
      acceptPlanVersionAtomic(user.id, candidate.id, acceptInput)
    ).resolves.toMatchObject({
      success: false,
    });
    expect(
      await db.aiPlanActivationAttempt.findFirst({
        where: { planVersionId: candidate.id, outcome: "REJECTED" },
      })
    ).not.toBeNull();
  });

  it("database rejects a forged automatic approval without matching gate and provider records", async () => {
    const { user, candidate } = await clientFixture();
    await expect(
      db.aiAutomaticPlanApproval.create({
        data: {
          clientId: user.id,
          planVersionId: candidate.id,
          gateDecisionId: "forged-gate",
          providerBoundaryAuditId: `forged-provider-${randomUUID()}`,
          evaluationKey: "forged",
          candidatePayloadHash: candidate.payloadHash,
          artifactRequest: {},
          artifactRefs: [],
          sourceRefs: [],
          gateInput: {},
          providerSelection: {},
          stateDigest: "0".repeat(64),
        },
      })
    ).rejects.toThrow();
  });

  it("requires a governance grant, exposes aggregates only, and enforces a kill switch", async () => {
    const { candidate } = await clientFixture();
    await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
      outcome: "APPROVE_AUTOMATICALLY",
    });
    const actorKey = randomUUID();
    const actor = await db.user.create({
      data: { clerkId: actorKey, email: `${actorKey}@example.test`, isCoach: true },
    });
    await expect(
      setAiCoachOperationalControl(actor.id, {
        scope: "FINALIZATION",
        disabled: true,
        reasonCode: "INCIDENT_TEST",
        incidentReference: "synthetic-incident",
        expectedRevision: null,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.aiCoachGovernanceGrant.create({
      data: {
        userId: actor.id,
        scopes: ["CONTROL_OPERATIONS", "VIEW_AGGREGATE_MONITORING"],
        grantRef: "synthetic-governance-test",
      },
    });
    await setAiCoachOperationalControl(actor.id, {
      scope: "FINALIZATION",
      disabled: true,
      reasonCode: "INCIDENT_TEST",
      incidentReference: "synthetic-incident",
      expectedRevision: null,
    });
    await expect(finalizeCurrentClientPlan(candidate.id)).rejects.toMatchObject({
      code: "TEMPORARILY_UNAVAILABLE",
    });
    const monitoring = await getAiCoachOperationalMonitoring(actor.id);
    const serialized = JSON.stringify(monitoring);
    expect(serialized).not.toMatch(/confirmedIntake|structuredAnswers|prompt|trace|clientId/);
    expect(monitoring.controls).toContainEqual(
      expect.objectContaining({ scope: "FINALIZATION", disabled: true })
    );
    expect(monitoring.providerOutcomes).toContainEqual(
      expect.objectContaining({ boundaryOutcome: "VALIDATED", failureCode: null })
    );
    expect(monitoring.providerMeasurements).toMatchObject({
      measuredCalls: expect.any(Number),
      attempts: expect.any(Number),
      totalLatencyMs: expect.any(Number),
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    });
    expect(monitoring.providerMeasurements.measuredCalls).toBeGreaterThanOrEqual(1);
    expect(monitoring.providerMeasurements.totalTokens).toBe(
      monitoring.providerMeasurements.inputTokens + monitoring.providerMeasurements.outputTokens
    );
  });

  it("publishes and revokes only through an accountable governance grant with immutable audit", async () => {
    const actorKey = randomUUID();
    const actor = await db.user.create({
      data: { clerkId: actorKey, email: `${actorKey}@example.test`, isCoach: true },
    });
    await db.aiCoachGovernanceGrant.create({
      data: {
        userId: actor.id,
        scopes: ["PUBLISH_ARTIFACTS", "REVOKE_ARTIFACTS"],
        grantRef: "synthetic-lifecycle-test",
      },
    });
    const set = buildSyntheticArtifactSet(`governance-${randomUUID()}`);
    await registerArtifactVersion(set.foodCatalog);
    await publishArtifactVersion({
      id: set.foodCatalog.id,
      effectiveAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      governance: {
        actorUserId: actor.id,
        reasonCode: "SYNTHETIC_REVIEW_COMPLETE",
      },
    });
    await revokeArtifactVersion(set.foodCatalog.id, "Synthetic incident exercise", {
      actorUserId: actor.id,
      reasonCode: "SYNTHETIC_INCIDENT",
      reviewRecordId: set.foodCatalog.reviewMetadata.reviewRecordId,
      incidentReference: "synthetic-incident-lifecycle",
    });
    const events = await db.aiCoachArtifactLifecycleEvent.findMany({
      where: { artifactVersionId: set.foodCatalog.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual(["PUBLISH", "REVOKE"]);
    await expect(
      db.aiCoachArtifactLifecycleEvent.update({
        where: { id: events[0].id },
        data: { reasonCode: "FORGED" },
      })
    ).rejects.toThrow();
    expect(
      await db.aiCoachOperationalControl.count({
        where: {
          scope: { in: ["GENERATION", "PROVIDER", "FINALIZATION", "ACCEPTANCE"] },
          disabled: true,
        },
      })
    ).toBe(4);
  });
});
