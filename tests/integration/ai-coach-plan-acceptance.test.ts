import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: mocks.authUserId }), currentUser: vi.fn() }));
const mocks = vi.hoisted(() => ({ authUserId: "" }));

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { acceptPlanVersionAtomic, declinePlanVersion } from "@/lib/ai-coach/plan-acceptance";
import { ACTIVE_POLICY_VERSION } from "@/lib/ai-coach/policy/policy-version";
import { POST as acceptRoute } from "@/app/api/client/ai-coach/plans/[id]/accept/route";
import { POST as declineRoute } from "@/app/api/client/ai-coach/plans/[id]/decline/route";
import type { Prisma } from "@/app/generated/prisma/client";
import {
  publishArtifactVersion,
  registerArtifactVersion,
} from "@/lib/ai-coach/artifacts/repository";
import {
  buildSyntheticArtifactSet,
  SYNTHETIC_ARTIFACT_ENGINE_VERSION,
} from "@/lib/ai-coach/artifacts/synthetic-fixtures";
import { contentHash } from "@/lib/ai-coach/canonical-json";
import { finalizeCurrentClientPlan } from "@/lib/ai-coach/finalization";
import { buildInitialFixturePlan } from "@/lib/ai-coach/initial-plan";
import { submitSafetyDisclosure } from "@/lib/ai-coach/safety";

suite("A10 — atomic proposal lifecycle and acceptance with real PostgreSQL constraints", () => {
  const originalPublicationFlag = process.env.FEATURE_AI_COACH_PUBLICATION;
  beforeEach(() => { vi.clearAllMocks(); process.env.FEATURE_AI_COACH_PUBLICATION = "true"; });
  afterEach(() => { process.env.FEATURE_AI_COACH_PUBLICATION = originalPublicationFlag; });
  afterAll(async () => { await db.$disconnect(); });

  async function makeEligibleClient() {
    const id = randomUUID();
    const client = await db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isCoach: false, isClient: true } });
    await db.clientCoachingContext.create({ data: { clientId: client.id, mode: "AI", revision: 0 } });
    await db.aiCoachEntitlement.create({ data: { clientId: client.id } });
    await db.aiCoachProfile.create({ data: { clientId: client.id } });
    return client;
  }

  async function makeCandidate(clientId: string, overrides: Partial<Prisma.AiPlanVersionUncheckedCreateInput> = {}) {
    const context = await db.clientCoachingContext.findUniqueOrThrow({ where: { clientId } });
    const profile = await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId } });
    const latest = await db.aiPlanVersion.findFirst({ where: { clientId }, orderBy: { version: "desc" } });
    return db.aiPlanVersion.create({
      data: {
        clientId,
        version: (latest?.version ?? 0) + 1,
        baseVersionId: profile.activePlanVersionId,
        status: "PROPOSED",
        changeClass: "INITIAL",
        payload: { schemaVersion: 1, nutrition: null, meals: null, strength: [], cardio: [] },
        payloadHash: "test-hash",
        contextRevision: context.revision,
        profileRevision: profile.profileRevision,
        observationRevision: profile.observationRevision,
        safetyRevision: profile.safetyRevision,
        policyVersion: ACTIVE_POLICY_VERSION,
        catalogVersions: {},
        ...overrides,
      },
    });
  }

  function acceptInputFor(candidate: { baseVersionId: string | null; contextRevision: number; profileRevision: number; observationRevision: number; safetyRevision: number }, requestKey: string = randomUUID()) {
    return {
      requestKey,
      expectedBaseVersionId: candidate.baseVersionId,
      expectedContextRevision: candidate.contextRevision,
      expectedProfileRevision: candidate.profileRevision,
      expectedObservationRevision: candidate.observationRevision,
      expectedSafetyRevision: candidate.safetyRevision,
    };
  }

  describe("acceptance gates", () => {
    it.each(["safety", "context", "entitlement", "deactivation"] as const)("rechecks a %s change committed while acceptance is waiting", async (change) => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      let release!: () => void;
      let ready!: (pid: number) => void;
      const canCommit = new Promise<void>(resolve => { release = resolve; });
      const writerReady = new Promise<number>(resolve => { ready = resolve; });
      const writer = db.$transaction(async tx => {
        if (change === "safety") await tx.aiCoachProfile.update({ where: { clientId: client.id }, data: { safetyRevision: { increment: 1 }, strengthPermission: "PAUSED" } });
        if (change === "context") await tx.clientCoachingContext.update({ where: { clientId: client.id }, data: { mode: "HUMAN", revision: { increment: 1 } } });
        if (change === "entitlement") await tx.aiCoachEntitlement.update({ where: { clientId: client.id }, data: { revokedAt: new Date() } });
        if (change === "deactivation") await tx.user.update({ where: { id: client.id }, data: { isDeactivated: true } });
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        ready(backend.pid);
        await canCommit;
      });
      const pid = await writerReady;
      const acceptance = acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      try {
        // Wait for an actual PostgreSQL lock dependency, not a guessed delay.
        await vi.waitFor(async () => {
          const [blocked] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
          expect(blocked.waiting).toBe(true);
        }, { timeout: 2000, interval: 10 });
      } finally {
        release();
        await writer;
      }
      expect(await acceptance).toMatchObject({ success: false, code: change === "safety" ? "REVISION_CONFLICT" : change === "deactivation" ? "FORBIDDEN" : "ENTITLEMENT_REQUIRED" });
      expect((await db.aiPlanVersion.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe("PROPOSED");
      expect(await db.aiPlanAcceptanceOutbox.count({ where: { clientId: client.id } })).toBe(0);
    });

    it.each(["expectedContextRevision", "expectedProfileRevision", "expectedObservationRevision", "expectedSafetyRevision"] as const)("rejects stale caller %s without side effects", async (field) => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      const input = acceptInputFor(candidate);
      input[field] += 1;
      expect(await acceptPlanVersionAtomic(client.id, candidate.id, input)).toMatchObject({ success: false, code: "REVISION_CONFLICT" });
      expect(await db.aiPlanAcceptanceOutbox.count({ where: { clientId: client.id } })).toBe(0);
    });

    it("rejects an inactive client at the service boundary", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      await db.user.update({ where: { id: client.id }, data: { isDeactivated: true } });
      expect(await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate))).toMatchObject({ success: false, code: "FORBIDDEN" });
    });
    it("accepts a fully eligible candidate and enqueues exactly one deduplicated outbox event", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: true, alreadyAccepted: false, activeVersionId: candidate.id });

      const updated = await db.aiPlanVersion.findUniqueOrThrow({ where: { id: candidate.id } });
      expect(updated.status).toBe("ACCEPTED");
      expect(updated.acceptedAt).not.toBeNull();
      expect((await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: client.id } })).activePlanVersionId).toBe(candidate.id);
      expect(await db.aiPlanAcceptanceOutbox.count({ where: { planVersionId: candidate.id } })).toBe(1);
    });

    it("rejects when the client has no valid AI coaching entitlement", async () => {
      const client = await makeEligibleClient();
      await db.aiCoachEntitlement.update({ where: { clientId: client.id }, data: { revokedAt: new Date() } });
      const candidate = await makeCandidate(client.id);

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "ENTITLEMENT_REQUIRED" });
    });

    it("rejects when AI is not the current unambiguous authority", async () => {
      const client = await makeEligibleClient();
      await db.clientCoachingContext.update({ where: { clientId: client.id }, data: { mode: "HUMAN" } });
      const candidate = await makeCandidate(client.id);

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "ENTITLEMENT_REQUIRED" });
    });

    it("rejects when publication is disabled", async () => {
      process.env.FEATURE_AI_COACH_PUBLICATION = "false";
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "TEMPORARILY_UNAVAILABLE" });
    });

    it("rejects on any frozen-revision mismatch against current state (V17: a safety revision bump invalidates)", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { safetyRevision: { increment: 1 } } });

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "REVISION_CONFLICT" });
    });

    it("rejects a candidate whose policy version is no longer usable", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id, { policyVersion: "policy-fixture-v0" });

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "POLICY_UNAVAILABLE" });
    });

    it("V17: rejects a candidate touching a domain currently under safety restriction", async () => {
      const client = await makeEligibleClient();
      await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { strengthPermission: "PAUSED" } });
      const candidate = await makeCandidate(client.id, {
        payload: { schemaVersion: 1, nutrition: null, meals: null, strength: [{ id: "s1" }], cardio: [] },
      });

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "SAFETY_RESTRICTED" });
    });

    it("does not block on a safety restriction in a domain the candidate does not touch", async () => {
      const client = await makeEligibleClient();
      await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { cardioPermission: "PAUSED" } });
      const candidate = await makeCandidate(client.id, {
        payload: { schemaVersion: 1, nutrition: null, meals: null, strength: [{ id: "s1" }], cardio: [] },
      });

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result.success).toBe(true);
    });

    it("V16: rejects acceptance after the activation window has closed", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id, { activationEndsAt: new Date(Date.now() - 1000) });

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "WINDOW_CLOSED" });
    });

    it("V16: rejects acceptance before the activation window has started", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id, { activationStartsAt: new Date(Date.now() + 60_000) });

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "WINDOW_CLOSED" });
    });

    it("V18: rejects a candidate pending reviewer approval, and one already rejected", async () => {
      const client = await makeEligibleClient();
      const pending = await makeCandidate(client.id, { reviewerStatus: "PENDING" });
      let result = await acceptPlanVersionAtomic(client.id, pending.id, acceptInputFor(pending));
      expect(result).toMatchObject({ success: false, code: "REVIEWER_APPROVAL_REQUIRED" });

      const rejected = await makeCandidate(client.id, { reviewerStatus: "REJECTED" });
      result = await acceptPlanVersionAtomic(client.id, rejected.id, acceptInputFor(rejected));
      expect(result).toMatchObject({ success: false, code: "REVIEWER_APPROVAL_REQUIRED" });
    });

    it("V18: accepts an APPROVED candidate only when the approval's hash and reviewer grant are both currently valid", async () => {
      const client = await makeEligibleClient();
      const reviewerClerkId = randomUUID();
      const reviewer = await db.user.create({ data: { clerkId: reviewerClerkId, email: `${reviewerClerkId}@example.test`, isCoach: true } });
      const grant = await db.aiCoachReviewerGrant.create({ data: { userId: reviewer.id, qualificationNote: "test fixture" } });

      const candidate = await makeCandidate(client.id, { reviewerStatus: "APPROVED", payloadHash: "matching-hash" });
      await db.aiPlanReviewerApproval.create({ data: { planVersionId: candidate.id, reviewerGrantId: grant.id, approvedHash: "matching-hash", approved: true, rationale: "looks fine" } });

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result.success).toBe(true);
    });

    it("V18: rejects an APPROVED candidate whose payload hash no longer matches the recorded approval", async () => {
      const client = await makeEligibleClient();
      const reviewerClerkId = randomUUID();
      const reviewer = await db.user.create({ data: { clerkId: reviewerClerkId, email: `${reviewerClerkId}@example.test`, isCoach: true } });
      const grant = await db.aiCoachReviewerGrant.create({ data: { userId: reviewer.id, qualificationNote: "test fixture" } });

      const candidate = await makeCandidate(client.id, { reviewerStatus: "APPROVED", payloadHash: "current-hash" });
      await db.aiPlanReviewerApproval.create({ data: { planVersionId: candidate.id, reviewerGrantId: grant.id, approvedHash: "stale-hash", approved: true, rationale: "approved a since-changed version" } });

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "REVIEWER_APPROVAL_REQUIRED" });
    });

    it("V18: rejects an APPROVED candidate whose reviewer's grant has since been revoked (ordinary isCoach is never sufficient)", async () => {
      const client = await makeEligibleClient();
      const reviewerClerkId = randomUUID();
      const reviewer = await db.user.create({ data: { clerkId: reviewerClerkId, email: `${reviewerClerkId}@example.test`, isCoach: true } });
      const grant = await db.aiCoachReviewerGrant.create({ data: { userId: reviewer.id, qualificationNote: "test fixture", revokedAt: new Date() } });

      const candidate = await makeCandidate(client.id, { reviewerStatus: "APPROVED", payloadHash: "matching-hash" });
      await db.aiPlanReviewerApproval.create({ data: { planVersionId: candidate.id, reviewerGrantId: grant.id, approvedHash: "matching-hash", approved: true, rationale: "revoked after approval" } });

      const result = await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      expect(result).toMatchObject({ success: false, code: "REVIEWER_APPROVAL_REQUIRED" });
    });

    it("rejects a candidate whose base version is no longer the current active plan (V14: stale base)", async () => {
      const client = await makeEligibleClient();
      const first = await makeCandidate(client.id);
      await acceptPlanVersionAtomic(client.id, first.id, acceptInputFor(first));

      // A second candidate computed against the ORIGINAL (now-superseded) base.
      const staleSecond = await makeCandidate(client.id, { baseVersionId: null, changeClass: "ROUTINE" });
      const result = await acceptPlanVersionAtomic(client.id, staleSecond.id, acceptInputFor(staleSecond));
      expect(result).toMatchObject({ success: false, code: "STALE_PROPOSAL" });
    });
  });

  describe("V13 — one routine adjustment slot per client per review window, permanently", () => {
    it("a second ROUTINE acceptance in the same window is rejected even after the first is superseded/re-enrolled", async () => {
      const client = await makeEligibleClient();
      const first = await makeCandidate(client.id, { changeClass: "ROUTINE" });
      const acceptedFirst = await acceptPlanVersionAtomic(client.id, first.id, acceptInputFor(first));
      expect(acceptedFirst.success).toBe(true);

      const second = await makeCandidate(client.id, { changeClass: "ROUTINE" });
      const result = await acceptPlanVersionAtomic(client.id, second.id, acceptInputFor(second));
      expect(result).toMatchObject({ success: false, code: "ADJUSTMENT_LIMIT_REACHED" });

      expect(await db.aiAdjustmentSlot.count({ where: { clientId: client.id } })).toBe(1);
    });
  });

  describe("V14 — idempotent replay never reactivates stale state", () => {
    it("only one of two DIFFERENT candidates against the same base can activate", async () => {
      const client = await makeEligibleClient();
      const first = await makeCandidate(client.id);
      const second = await makeCandidate(client.id);
      const results = await Promise.all([first, second].map(candidate => acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate))));
      expect(results.filter(result => result.success)).toHaveLength(1);
      expect(results.find(result => !result.success)).toMatchObject({ code: "STALE_PROPOSAL" });
      expect(await db.aiPlanVersion.count({ where: { clientId: client.id, status: "ACCEPTED" } })).toBe(1);
      expect(await db.aiPlanAcceptanceOutbox.count({ where: { clientId: client.id } })).toBe(1);
    });

    it("replays a superseded acceptance under a new key without reactivating it", async () => {
      const client = await makeEligibleClient();
      const first = await makeCandidate(client.id);
      await acceptPlanVersionAtomic(client.id, first.id, acceptInputFor(first));
      const second = await makeCandidate(client.id);
      await acceptPlanVersionAtomic(client.id, second.id, acceptInputFor(second));
      expect(await acceptPlanVersionAtomic(client.id, first.id, acceptInputFor(first))).toMatchObject({ success: true, alreadyAccepted: true, activeVersionId: second.id });
    });

    it("reports no current active plan when replaying after its pointer was cleared", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      const input = acceptInputFor(candidate);
      await acceptPlanVersionAtomic(client.id, candidate.id, input);
      await db.aiCoachProfile.update({ where: { clientId: client.id }, data: { activePlanVersionId: null } });
      expect(await acceptPlanVersionAtomic(client.id, candidate.id, input)).toMatchObject({ success: true, alreadyAccepted: true, activeVersionId: null });
      const newInput = acceptInputFor(candidate);
      expect(await acceptPlanVersionAtomic(client.id, candidate.id, newInput)).toMatchObject({ success: true, activeVersionId: null });
      expect((await db.aiPlanAcceptanceReceipt.findUniqueOrThrow({ where: { clientId_requestKey: { clientId: client.id, requestKey: newInput.requestKey } } })).activeVersionIdAtReceiptTime).toBeNull();
    });

    it("concurrent different inputs under one receipt key conflict", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));
      const input = acceptInputFor(candidate, "racing-key");
      const results = await Promise.all([
        acceptPlanVersionAtomic(client.id, candidate.id, input),
        acceptPlanVersionAtomic(client.id, candidate.id, { ...input, expectedSafetyRevision: 99 }),
      ]);
      expect(results.filter(result => result.success)).toHaveLength(1);
      expect(results.find(result => !result.success)).toMatchObject({ code: "REVISION_CONFLICT" });
    });
    it("only one of two concurrent acceptances of the same candidate succeeds; the other replays the same outcome", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);

      const [a, b] = await Promise.all([
        acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate, "key-a")),
        acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate, "key-b")),
      ]);
      expect(a.success && b.success).toBe(true);
      if (a.success && b.success) {
        expect(a.activeVersionId).toBe(candidate.id);
        expect(b.activeVersionId).toBe(candidate.id);
      }
      expect(await db.aiPlanAcceptanceOutbox.count({ where: { planVersionId: candidate.id } })).toBe(1);
    });

    it("replaying the exact same request key and payload returns the original receipt without changing state", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      const input = acceptInputFor(candidate, "stable-key");

      const first = await acceptPlanVersionAtomic(client.id, candidate.id, input);
      const second = await acceptPlanVersionAtomic(client.id, candidate.id, input);
      expect(first).toMatchObject({ success: true, alreadyAccepted: false });
      expect(second).toMatchObject({ success: true, activeVersionId: candidate.id });
    });

    it("reusing the same request key with a different payload is a conflict, never a silent re-execution", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      const requestKey = "reused-key";

      await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate, requestKey));
      const second = await makeCandidate(client.id, { changeClass: "ROUTINE" });
      const result = await acceptPlanVersionAtomic(client.id, second.id, acceptInputFor(second, requestKey));
      expect(result).toMatchObject({ success: false, code: "REVISION_CONFLICT" });
    });

    it("a stale historical acceptance replay reports the freshly resolved current active id, not the one accepted at that time", async () => {
      const client = await makeEligibleClient();
      const first = await makeCandidate(client.id);
      const firstInput = acceptInputFor(first, "first-key");
      await acceptPlanVersionAtomic(client.id, first.id, firstInput);

      const second = await makeCandidate(client.id, { baseVersionId: first.id, changeClass: "ROUTINE" });
      await acceptPlanVersionAtomic(client.id, second.id, acceptInputFor(second, "second-key"));

      // Replaying the FIRST acceptance's exact key later must report the
      // CURRENT active plan (now `second`), never reactivate `first`.
      const replay = await acceptPlanVersionAtomic(client.id, first.id, firstInput);
      expect(replay).toMatchObject({ success: true, alreadyAccepted: true, activeVersionId: second.id });
      expect((await db.aiPlanVersion.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("SUPERSEDED");
    });
  });

  describe("T-2000 — reviewer status is inert for a managed candidate", () => {
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
    const originalFixtureMode = process.env.AI_COACH_FIXTURE_MODE;
    beforeEach(() => {
      process.env.AI_COACH_FIXTURE_MODE = "true";
    });
    afterEach(() => {
      process.env.AI_COACH_FIXTURE_MODE = originalFixtureMode;
    });

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
      }
    }

    it("accepts a REJECTED-by-reviewer managed candidate that has a valid automatic approval and a fresh APPROVE_AUTOMATICALLY gate", async () => {
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
      mocks.authUserId = id;
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
          // A reviewer explicitly rejected this candidate. Per T-2000 that
          // status is inert for a managed row: only the gate/approval below
          // determine the outcome.
          reviewerStatus: "REJECTED",
          validationReport: { engine: "managed-v1", passed: true, inputHash: "a".repeat(64) },
          sourceRefs: [],
        },
      });
      await expect(finalizeCurrentClientPlan(candidate.id)).resolves.toMatchObject({
        outcome: "APPROVE_AUTOMATICALLY",
      });
      // finalizeCurrentClientPlan never writes reviewerStatus; confirm it is
      // still REJECTED going into acceptance.
      expect(
        (await db.aiPlanVersion.findUniqueOrThrow({ where: { id: candidate.id } })).reviewerStatus
      ).toBe("REJECTED");

      const acceptInput = acceptInputFor(candidate);
      const result = await acceptPlanVersionAtomic(user.id, candidate.id, acceptInput);
      expect(result).toMatchObject({ success: true, alreadyAccepted: false, activeVersionId: candidate.id });
      expect(
        (await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } }))
          .activePlanVersionId
      ).toBe(candidate.id);
    });
  });

  describe("decline", () => {
    it("declines an owned PROPOSED candidate with a bounded reason, idempotently", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);

      const first = await declinePlanVersion(client.id, candidate.id, "not ready this week");
      expect(first).toMatchObject({ success: true });
      expect((await db.aiPlanVersion.findUniqueOrThrow({ where: { id: candidate.id } })).declineReason).toBe("not ready this week");

      const replay = await declinePlanVersion(client.id, candidate.id, "not ready this week");
      expect(replay).toMatchObject({ success: true });
    });

    it("rejects declining a candidate that is not PROPOSED", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      await acceptPlanVersionAtomic(client.id, candidate.id, acceptInputFor(candidate));

      const result = await declinePlanVersion(client.id, candidate.id);
      expect(result).toMatchObject({ success: false });
    });

    it("rejects an unreasonably long decline reason", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      const result = await declinePlanVersion(client.id, candidate.id, "x".repeat(1000));
      expect(result).toMatchObject({ success: false });
    });
  });

  describe("REST routes", () => {
    it("the accept route enforces client-only access and returns the service's result", async () => {
      const client = await makeEligibleClient();
      const coachClerkId = randomUUID();
      await db.user.create({ data: { clerkId: coachClerkId, email: `${coachClerkId}@example.test`, isCoach: true, isClient: false } });
      const candidate = await makeCandidate(client.id);

      mocks.authUserId = coachClerkId;
      const forbidden = await acceptRoute(new NextRequest(`https://example.test/api/client/ai-coach/plans/${candidate.id}/accept`, { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify(acceptInputFor(candidate)) }), { params: Promise.resolve({ id: candidate.id }) });
      expect(forbidden.status).toBe(403);

      mocks.authUserId = client.clerkId;
      const ok = await acceptRoute(new NextRequest(`https://example.test/api/client/ai-coach/plans/${candidate.id}/accept`, { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify(acceptInputFor(candidate)) }), { params: Promise.resolve({ id: candidate.id }) });
      expect(ok.status).toBe(200);
    });

    it("the decline route works end to end", async () => {
      const client = await makeEligibleClient();
      const candidate = await makeCandidate(client.id);
      mocks.authUserId = client.clerkId;

      const response = await declineRoute(new NextRequest(`https://example.test/api/client/ai-coach/plans/${candidate.id}/decline`, { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ reason: "changing goals" }) }), { params: Promise.resolve({ id: candidate.id }) });
      expect(response.status).toBe(200);
      expect((await db.aiPlanVersion.findUniqueOrThrow({ where: { id: candidate.id } })).status).toBe("DECLINED");
    });
  });
});
