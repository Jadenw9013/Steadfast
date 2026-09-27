import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/roles", () => ({ getCurrentDbUser: vi.fn() }));
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: activates/deactivates the sole ACTIVE live release; runs alone.
lockGlobalAiCoachState("exclusive");
const authMock = vi.mocked(getCurrentDbUser);

import type { Prisma } from "@/app/generated/prisma/client";
import {
  loadRunBoundArtifactSet,
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import { SYNTHETIC_ARTIFACT_ENGINE_VERSION } from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { finalizeCurrentClientPlan } from "@/lib/ai-coach/finalization";
import {
  acceptPlanVersionAtomic,
  type AcceptPlanVersionInput,
} from "@/lib/ai-coach/plan-acceptance";
import { planPayloadSchema } from "@/lib/ai-coach/plan-contract";
import { requestAiRun, runSnapshotSchema } from "@/lib/ai-coach/run-command";
import { claimQueuedRun } from "@/lib/ai-coach/runs";
import { processManagedRun } from "@/lib/ai-coach/managed-executor";
import { SyntheticFixtureProvider } from "@/lib/ai-coach/provider/synthetic-provider";
import { submitSafetyDisclosure } from "@/lib/ai-coach/safety";
import { getAiWorkspace } from "@/lib/queries/ai-coach";
import {
  activateTestLiveRelease,
  artifactReferenceOf,
  buildLiveTrainingArtifacts,
  bumpVersion,
  createTestGovernanceActor,
  deactivateTestLiveRelease,
  ensureLiveTrainingExerciseCatalogPublished,
  publishSyntheticArtifactSetForTest,
  stubApprovedLiveProviderTransport,
  TEST_RUNTIME_CONFIGURATION,
} from "../helpers/ai-live-launch";

const intake = {
  goal: "GENERAL_FITNESS" as const,
  experienceLevel: "NEW" as const,
  trainingDaysPerWeek: 3,
  equipmentAccess: ["NONE" as const],
  dietaryRestrictions: [],
  allergies: [],
  foodBudgetLevel: "LOW" as const,
  trackingPreference: "NUMBERS_VISIBLE" as const,
  unitsPreference: "METRIC" as const,
  heightCm: 175,
  weightKg: 80,
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

/**
 * T-2041 — the run snapshot carries the runtime artifact set it was resolved
 * against, and that set is the authority for the executor and for
 * finalization. Before this ticket the executor resolved a *fresh* set at
 * execution time while the payload's binding came from the snapshot, which is
 * the two-writers-one-value shape CLAUDE.md rule 10 exists for.
 *
 * Everything live in this file exists only inside the isolated test database
 * and is built from SYNTHETIC-labelled fixture content with `synthetic`
 * flipped (see `buildLiveTrainingArtifacts`' own note). No real artifact, no
 * real account, no `ai-coach:activate`.
 */
suite("T-2041 — the run's runtime artifact binding is frozen at request time", () => {
  const sharedArtifacts = buildLiveTrainingArtifacts();
  let actorId: string;

  beforeAll(() => ensureLiveTrainingExerciseCatalogPublished(sharedArtifacts));

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("FEATURE_AI_COACH_GENERATION", "true");
    vi.stubEnv("FEATURE_AI_COACH_ENROLLMENT", "true");
    vi.stubEnv("FEATURE_AI_COACH_PUBLICATION", "true");
    vi.stubEnv("AI_COACH_FIXTURE_MODE", "true");
    stubApprovedLiveProviderTransport();
    await db.aiPlanReviewerApproval.deleteMany();
    await db.aiCoachReviewerGrant.deleteMany();
    expect(await db.aiCoachReviewerGrant.count()).toBe(0);
    const actor = await createTestGovernanceActor(
      ["APPROVE_LIVE_LAUNCH", "ACTIVATE_LIVE_LAUNCH", "DEACTIVATE_LIVE_LAUNCH"],
      "T-2041-binding"
    );
    actorId = actor.id;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    // T-2014: read the invariant, ALWAYS tear the release down, then assert.
    const reviewerGrants = await db.aiCoachReviewerGrant.count();
    await deactivateTestLiveRelease(actorId);
    expect(reviewerGrants).toBe(0);
  });
  afterAll(() => db.$disconnect());

  /** One `now` per test, shared by every activation in it: a rotated release
   * re-publishes artifacts whose window must not outlive their dependencies'
   * (`publishArtifactVersion`'s dependency-window check). */
  async function activateSharedRelease(now: Date) {
    return activateTestLiveRelease({
      namespace: "live-binding-shared",
      actorUserId: actorId,
      artifacts: sharedArtifacts,
      packetSuffix: `live-binding-${randomUUID()}`,
      now,
    });
  }

  async function liveClientFixture(now = new Date()) {
    await activateSharedRelease(now);
    const id = randomUUID();
    const user = await db.user.create({
      data: { clerkId: id, email: `${id}@example.test`, isClient: true },
    });
    await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI" } });
    await db.aiCoachEntitlement.create({ data: { clientId: user.id } });
    await db.aiCoachProfile.create({
      data: {
        clientId: user.id,
        isSynthetic: false,
        confirmedIntake: intake,
        consentedAt: new Date(),
        reviewTimezone: "America/Los_Angeles",
      },
    });
    await submitSafetyDisclosure(user.id, clearSafety);
    const context = await db.clientCoachingContext.findUniqueOrThrow({
      where: { clientId: user.id },
    });
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
    authMock.mockResolvedValue(user);
    return { user, context, profile };
  }

  async function requestRun(
    user: { id: string },
    context: { revision: number },
    profile: { profileRevision: number }
  ) {
    const { runId } = await requestAiRun(user.id, {
      requestKey: randomUUID(),
      kind: "INITIAL",
      representation: "MACROS",
      expectedContextRevision: context.revision,
      expectedProfileRevision: profile.profileRevision,
    });
    const run = await db.aiCoachRun.findUniqueOrThrow({ where: { id: runId } });
    const snapshot = runSnapshotSchema.parse(run.inputSnapshot);
    return { runId, run, snapshot };
  }

  /**
   * A training-only (nutrition: null, meals: null) candidate whose binding is
   * read **from the stored snapshot**, never hand-written. Its clinical
   * content (sets/reps/rest) is seeded exactly as T-2000's
   * `seedTrainingOnlyCandidate` does, because generation still refuses to
   * compose live content — **T-2039** is the ticket that removes this seam;
   * this test proves the binding chain, not the composition.
   */
  async function seedCandidateFromSnapshot(
    user: { id: string },
    context: { revision: number },
    profile: {
      profileRevision: number;
      observationRevision: number;
      safetyRevision: number;
      activePlanVersionId: string | null;
    },
    snapshot: ReturnType<typeof runSnapshotSchema.parse>,
    runId: string
  ) {
    const binding = snapshot.runtimeBinding!;
    const payload = planPayloadSchema.parse({
      schemaVersion: 1,
      contentKind: "SYNTHETIC_FIXTURE",
      nutrition: null,
      meals: null,
      strength: [
        {
          sessionId: `session-${randomUUID()}`,
          templateId: `template-${randomUUID()}`,
          day: 1,
          exercises: [
            {
              exerciseId: "goblet-squat",
              catalogVersion: binding.catalogVersions.exercise,
              sets: 3,
              reps: 8,
              restSeconds: 90,
              effort: "RPE 7 — two reps in reserve",
            },
          ],
        },
      ],
      cardio: [],
      policyVersion: binding.policyVersion,
      catalogVersions: binding.catalogVersions,
    });
    const candidate = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "PROPOSED",
        changeClass: "INITIAL",
        payload,
        payloadHash: contentHash(payload),
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        baseVersionId: profile.activePlanVersionId,
        policyVersion: payload.policyVersion,
        catalogVersions: payload.catalogVersions,
        reviewerStatus: "PENDING",
        sourceRefs: [],
        validationReport: {
          engine: "managed-v1",
          passed: true,
          inputHash: contentHash(snapshot),
        },
      },
    });
    await db.aiCoachRun.update({
      where: { id: runId },
      data: { status: "COMPLETED", resultPlanVersionId: candidate.id, leaseExpiresAt: null },
    });
    return candidate;
  }

  function acceptInputFor(candidate: {
    baseVersionId: string | null;
    contextRevision: number;
    profileRevision: number;
    observationRevision: number;
    safetyRevision: number;
  }): AcceptPlanVersionInput {
    return {
      requestKey: randomUUID(),
      expectedBaseVersionId: candidate.baseVersionId,
      expectedContextRevision: candidate.contextRevision,
      expectedProfileRevision: candidate.profileRevision,
      expectedObservationRevision: candidate.observationRevision,
      expectedSafetyRevision: candidate.safetyRevision,
    };
  }

  it("requestAiRun freezes the LIVE artifact set into the run snapshot", async () => {
    const { user, context, profile } = await liveClientFixture();
    const { snapshot } = await requestRun(user, context, profile);

    const binding = snapshot.runtimeBinding;
    expect(binding).toBeDefined();
    expect(binding).toMatchObject({
      mode: "LIVE",
      synthetic: false,
      contentKind: "REVIEWED_LIVE_V1",
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
      // Copied out of the ACTIVE packet's reviewed runtime configuration,
      // never chosen by this codebase.
      modelConfiguration: `${TEST_RUNTIME_CONFIGURATION.provider.configurationId}:v${TEST_RUNTIME_CONFIGURATION.provider.version}`,
    });
    expect(binding!.policyVersion).toBe(sharedArtifacts.policy.artifactKey);
    expect(binding!.catalogVersions).toEqual({
      food: sharedArtifacts.leaves.find((leaf) => leaf.kind === "FOOD_CATALOG")!.artifactKey,
      exercise: sharedArtifacts.leaves.find((leaf) => leaf.kind === "EXERCISE_CATALOG")!
        .artifactKey,
    });

    // Five exact references whose digests are the published artifacts' own.
    expect(binding!.artifactRefs).toHaveLength(5);
    const expected = [artifactReferenceOf(sharedArtifacts.policy), ...sharedArtifacts.references]
      .filter((ref, index, all) => all.findIndex((other) => other.id === ref.id) === index)
      .sort((a, b) => a.kind.localeCompare(b.kind));
    expect(binding!.artifactRefs).toEqual(expected);
    for (const ref of binding!.artifactRefs) {
      const row = await db.aiCoachArtifactVersion.findUniqueOrThrow({ where: { id: ref.id } });
      expect(row.contentDigest).toBe(ref.digest);
      expect(row.synthetic).toBe(false);
    }

    // The four top-level values are the binding's, not the fixture constants.
    expect(snapshot.synthetic).toBe(false);
    expect(snapshot.policyVersion).toBe(binding!.policyVersion);
    expect(snapshot.catalogVersions).toEqual(binding!.catalogVersions);
    expect(snapshot.modelConfiguration).toBe(binding!.modelConfiguration);
  });

  it("the binding chain end to end: request -> candidate stamped from the frozen set -> finalize -> workspace -> accept, with zero reviewer grants", async () => {
    const { user, context, profile } = await liveClientFixture();
    const { snapshot, runId } = await requestRun(user, context, profile);
    const candidate = await seedCandidateFromSnapshot(user, context, profile, snapshot, runId);

    const finalizeResult = await finalizeCurrentClientPlan(candidate.id);
    expect(finalizeResult).toMatchObject({ outcome: "APPROVE_AUTOMATICALLY" });

    const approvals = await db.aiAutomaticPlanApproval.findMany({
      where: { planVersionId: candidate.id },
    });
    expect(approvals).toHaveLength(1);
    expect(
      (approvals[0].artifactRequest as { policyArtifactKey: string }).policyArtifactKey
    ).toBe(snapshot.runtimeBinding!.policyVersion);

    const gate = await db.aiAutonomyGateDecision.findFirst({
      where: { evaluatedPlanVersionId: candidate.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(gate?.outcome).toBe("APPROVE_AUTOMATICALLY");

    const workspace = await getAiWorkspace(user.id);
    const proposal = workspace.proposals.find((p) => p.id === candidate.id);
    expect(proposal).toMatchObject({ status: "READY" });
    expect(proposal?.payload).not.toBeNull();

    await expect(
      acceptPlanVersionAtomic(user.id, candidate.id, acceptInputFor(candidate))
    ).resolves.toMatchObject({ success: true, activeVersionId: candidate.id });
    expect(
      (await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } }))
        .activePlanVersionId
    ).toBe(candidate.id);
    expect(
      await db.aiPlanActivationAttempt.findFirst({ where: { planVersionId: candidate.id } })
    ).toMatchObject({ outcome: "ACCEPTED", reasonCode: "AUTOMATIC_GATE_APPROVED" });
    expect(await db.aiCoachReviewerGrant.count()).toBe(0);
  });

  it("a release rotated after the snapshot fails the proposal closed at finalize, and the workspace still renders it", async () => {
    const now = new Date();
    const { user, context, profile } = await liveClientFixture(now);
    const { snapshot, runId } = await requestRun(user, context, profile);
    const candidate = await seedCandidateFromSnapshot(user, context, profile, snapshot, runId);

    // Rotate the reviewed content under the pending proposal: the same policy
    // *key* (so the existing `candidate.policyVersion` 422 a few lines above
    // the new check cannot fire and mask it), a new policy *version* and
    // therefore a new digest — exactly what a re-signed bundle looks like.
    await deactivateTestLiveRelease(actorId);
    const actor = await createTestGovernanceActor(
      ["APPROVE_LIVE_LAUNCH", "ACTIVATE_LIVE_LAUNCH", "DEACTIVATE_LIVE_LAUNCH"],
      "T-2041-binding-rotation"
    );
    actorId = actor.id;
    const rotatedPolicy = bumpVersion(sharedArtifacts.policy, 2);
    const rotated = {
      leaves: sharedArtifacts.leaves,
      policy: rotatedPolicy,
      references: [artifactReferenceOf(rotatedPolicy), ...rotatedPolicy.dependencies],
    };
    // The dependency leaves were published by whichever test in this file ran
    // first, so the rotated policy's own publication window must be clamped to
    // theirs (`publishArtifactVersion`'s dependency-window check). Publishing
    // it here means `activateTestLiveRelease`'s `ensurePublished` skips it.
    const leafRows = await db.aiCoachArtifactVersion.findMany({
      where: { id: { in: rotatedPolicy.dependencies.map((dependency) => dependency.id) } },
      select: { expiresAt: true },
    });
    const earliestLeafExpiry = leafRows
      .map((row) => row.expiresAt!)
      .reduce((a, b) => (a < b ? a : b));
    await registerArtifactVersion(rotatedPolicy);
    await publishArtifactVersion({
      id: rotatedPolicy.id,
      effectiveAt: new Date(now.getTime() - 60_000),
      expiresAt: earliestLeafExpiry,
      engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
    });
    await activateTestLiveRelease({
      namespace: "live-binding-rotated",
      actorUserId: actorId,
      artifacts: rotated,
      packetSuffix: `live-binding-rotated-${randomUUID()}`,
      now,
    });

    await expect(finalizeCurrentClientPlan(candidate.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "The proposal was prepared against different reviewed content.",
    });
    expect(await db.aiAutomaticPlanApproval.count({ where: { planVersionId: candidate.id } })).toBe(
      0
    );

    // Degrade, not blank: the workspace still returns the proposal row.
    const workspace = await getAiWorkspace(user.id);
    expect(workspace.proposals.some((p) => p.id === candidate.id)).toBe(true);
  });

  it("the executor re-loads the frozen set and fails the run closed under a named reason when it no longer resolves", async () => {
    await liveClientFixture();
    // A *synthetic* account: `processManagedRun` refuses a non-synthetic
    // account before the snapshot is even parsed (T-2000 finding 2), so the
    // re-load this ticket adds is only reachable on the fixture path today.
    async function syntheticClient() {
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
      const context = await db.clientCoachingContext.findUniqueOrThrow({
        where: { clientId: user.id },
      });
      const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } });
      return { user, context, profile };
    }

    // Control (the red proof's green half): this run, executed against the
    // binding it was actually frozen to, completes and writes a candidate.
    const a = await syntheticClient();
    const control = await requestRun(a.user, a.context, a.profile);
    expect(control.snapshot.runtimeBinding?.mode).toBe("FIXTURE");
    expect(control.snapshot.runtimeBinding?.policyVersion).toBe("policy-fixture-v1");
    const controlClaim = await claimQueuedRun(control.runId);
    if (!controlClaim.claimed) throw new Error("Fixture claim failed");
    await expect(processManagedRun(controlClaim, new SyntheticFixtureProvider())).resolves.toBe(
      "completed"
    );
    expect(await db.aiPlanVersion.count({ where: { clientId: a.user.id } })).toBe(1);

    // A second account, same fixture set, but the run's frozen POLICY_BUNDLE
    // reference no longer matches the persisted artifact's content — what a
    // re-signed or tampered artifact looks like from the run's point of view.
    // Before this ticket the executor re-resolved the set at execution time
    // and would have composed happily against it.
    const b = await syntheticClient();
    const broken = await requestRun(b.user, b.context, b.profile);
    const brokenBinding = broken.snapshot.runtimeBinding;
    expect(brokenBinding).toBeDefined();
    await db.aiCoachRun.update({
      where: { id: broken.runId },
      data: {
        inputSnapshot: {
          ...(broken.run.inputSnapshot as Record<string, unknown>),
          runtimeBinding: {
            ...brokenBinding!,
            artifactRefs: brokenBinding!.artifactRefs.map((ref) =>
              ref.kind === "POLICY_BUNDLE" ? { ...ref, digest: "f".repeat(64) } : ref
            ),
          },
        } as Prisma.InputJsonValue,
      },
    });
    const brokenClaim = await claimQueuedRun(broken.runId);
    if (!brokenClaim.claimed) throw new Error("Fixture claim failed");
    await expect(processManagedRun(brokenClaim, new SyntheticFixtureProvider())).resolves.toBe(
      "failed"
    );
    expect(await db.aiPlanVersion.count({ where: { clientId: b.user.id } })).toBe(0);
    const failed = await db.aiCoachRun.findUniqueOrThrow({ where: { id: broken.runId } });
    expect(failed.lastError).toBe("TEMPORARILY_UNAVAILABLE");
  });

  it("loadRunBoundArtifactSet refuses a mixed set in both directions", async () => {
    const { user } = await liveClientFixture();
    const liveRefs = [
      artifactReferenceOf(sharedArtifacts.policy),
      ...sharedArtifacts.policy.dependencies,
    ];

    // A synthetic account can never execute against live-classified content.
    const syntheticId = randomUUID();
    const syntheticUser = await db.user.create({
      data: { clerkId: syntheticId, email: `${syntheticId}@example.test`, isClient: true },
    });
    await db.aiCoachProfile.create({ data: { clientId: syntheticUser.id, isSynthetic: true } });
    await expect(
      db.$transaction((tx) =>
        loadRunBoundArtifactSet(tx, syntheticUser.id, {
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
          references: liveRefs,
        })
      )
    ).rejects.toMatchObject({ code: "ARTIFACT_INCOMPATIBLE" });

    // ...and a real account can never execute against a synthetic artifact.
    const syntheticRefs = await publishSyntheticArtifactSetForTest(`t2041-mixed-${randomUUID()}`);
    await expect(
      db.$transaction((tx) =>
        loadRunBoundArtifactSet(tx, user.id, {
          engineVersion: SYNTHETIC_ARTIFACT_ENGINE_VERSION,
          references: syntheticRefs,
        })
      )
    ).rejects.toMatchObject({ code: "SYNTHETIC_ARTIFACT_FORBIDDEN" });
  });
});
