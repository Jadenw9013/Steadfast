import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  deleteIdentity: vi.fn(),
  billing: vi.fn(),
  authUserId: "",
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    storage: {
      from: (bucket: string) => ({ remove: (paths: string[]) => mocks.remove(bucket, paths) }),
    },
  }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: mocks.authUserId }),
  currentUser: vi.fn(),
  clerkClient: async () => ({ users: { deleteUser: mocks.deleteIdentity } }),
}));
vi.mock("@/lib/account-deletion/billing", () => ({ stopAccountBilling: mocks.billing }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/email/sendEmail", () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));
import { NextRequest } from "next/server";
import { sendMessage } from "@/app/actions/messages";
import { createCheckIn } from "@/app/actions/check-in";
import { POST as postMessage } from "@/app/api/messages/route";
import { POST as requestDeletion } from "@/app/api/actions/account-deletion/route";
import { POST as cancelDeletion } from "@/app/api/actions/account-deletion/cancel/route";
import { db } from "@/lib/db";
import { consumeQuota } from "@/lib/security/quota";
import { purgeUserAccount } from "@/lib/account-deletion/purge";
import { confirmIntake } from "@/lib/ai-coach/intake";

import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";
const enabled = process.env.SECURITY_INTEGRATION === "1";
// Fail closed: these tests never run against a production database.
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: shares the database-wide AI Coach state. See tests/helpers/global-ai-coach-state.ts.
lockGlobalAiCoachState("shared");
suite("account deletion with real PostgreSQL constraints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.remove.mockResolvedValue({ error: null });
    mocks.deleteIdentity.mockResolvedValue({});
    mocks.billing.mockResolvedValue(undefined);
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  async function fixture(coach = false) {
    const id = randomUUID();
    const user = await db.user.create({
      data: {
        clerkId: id,
        email: `${id}@example.test`,
        isCoach: coach,
        isClient: true,
        isDeactivated: true,
      },
    });
    const otherId = randomUUID();
    const other = await db.user.create({
      data: { clerkId: otherId, email: `${otherId}@example.test`, isCoach: true },
    });
    const receipt = await db.accountDeletionRequest.create({
      data: {
        userId: user.id,
        roleAtRequest: coach ? "BOTH" : "CLIENT",
        status: "PURGING",
        purgeStartedAt: new Date(),
        scheduledPurgeAt: new Date(0),
      },
    });
    await db.message.create({
      data: {
        clientId: user.id,
        senderId: other.id,
        body: "Coach-authored message",
        weekOf: new Date(),
      },
    });
    await db.userBlock.create({ data: { blockerId: other.id, blockedId: user.id } });
    await db.messageReport.create({
      data: { reporterId: user.id, reportedId: other.id, reason: "test" },
    });
    const checkIn = await db.checkIn.create({
      data: {
        clientId: user.id,
        weekOf: new Date(),
        weight: 160,
        photos: {
          create: [
            { storagePath: `${id}/web-batch/photo.jpg` },
            { storagePath: "ios-checkin/photo.jpg" },
          ],
        },
      },
    });
    if (coach) {
      await db.coachProfile.create({ data: { userId: user.id, slug: id } });
      await db.mealPlanUpload.create({
        data: {
          coachId: user.id,
          clientId: other.id,
          storagePath: `${id}/plan.pdf`,
          draft: { create: { parsedJson: {} } },
        },
      });
    }
    return { user, other, receipt, checkIn };
  }
  it("enforces blocks in both the web action and mobile REST route", async () => {
    const { user, other } = await fixture();
    await db.user.update({ where: { id: other.id }, data: { activeRole: "COACH" } });
    await db.coachClient.create({ data: { coachId: other.id, clientId: user.id } });
    mocks.authUserId = other.clerkId;
    await expect(
      sendMessage({ clientId: user.id, weekStartDate: "2026-09-07", body: "blocked" })
    ).rejects.toThrow("can't message");
    const response = await postMessage(
      new NextRequest("https://example.test/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: user.id, content: "blocked" }),
      })
    );
    expect(response.status).toBe(403);
    expect(await db.message.count({ where: { clientId: user.id, body: "blocked" } })).toBe(0);
  });
  it("rejects attaching another account's photo through the web action", async () => {
    const { user, other } = await fixture();
    await db.user.update({ where: { id: user.id }, data: { isDeactivated: false } });
    await db.coachClient.create({ data: { coachId: other.id, clientId: user.id } });
    mocks.authUserId = user.clerkId;
    const result = await createCheckIn({
      weight: 160,
      photoPaths: [`${other.clerkId}/batch/private.jpg`],
    });
    expect(result).toMatchObject({ error: { photoPaths: expect.any(Array) } });
  });
  it("supports deletion and cancellation through the mobile REST contract", async () => {
    const id = randomUUID();
    const user = await db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
    mocks.authUserId = id;
    const response = await requestDeletion(
      new NextRequest("https://example.test/api/actions/account-deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText: "DELETE MY ACCOUNT" }),
      })
    );
    expect(response.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isDeactivated).toBe(true);
    const cancelled = await cancelDeletion(
      new NextRequest("https://example.test/api/actions/account-deletion/cancel", {
        method: "POST",
      })
    );
    expect(cancelled.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).isDeactivated).toBe(false);
  });
  it("enforces one quota across concurrent callers", async () => {
    const quotaId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => consumeQuota("test", quotaId, 5, 60))
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });
  it.each([false, true])(
    "purges messages/blocks/reports and preserves the receipt (coach=%s)",
    async (coach) => {
      const { user, other, receipt } = await fixture(coach);
      await purgeUserAccount(user.id);
      expect(await db.user.findUnique({ where: { id: user.id } })).toBeNull();
      expect(await db.user.findUnique({ where: { id: other.id } })).not.toBeNull();
      expect(
        await db.accountDeletionRequest.findUnique({ where: { id: receipt.id } })
      ).toMatchObject({ status: "COMPLETED", userId: null });
      expect(mocks.remove).toHaveBeenCalledWith(
        "check-in-photos",
        expect.arrayContaining([`${user.clerkId}/web-batch/photo.jpg`, "ios-checkin/photo.jpg"])
      );
    }
  );
  it("T-987: purge scrubs a departing client's address out of another coach's ClientInvite.mismatchEmail, leaving the row otherwise intact", async () => {
    const { user, other } = await fixture();
    // `other` is a coach unrelated to `user`'s own coach relationships; the
    // invite below is addressed to a third prospect but was accepted from a
    // different address that happens to belong to the departing `user`. The
    // coach-side delete only fires for invites the departing user SENT (as
    // a coach) — this row is a second person's address stored on someone
    // else's row, and must be scrubbed, not deleted wholesale.
    const invite = await db.clientInvite.create({
      data: {
        coachId: other.id,
        email: "prospect@example.test",
        name: "Prospect",
        expiresAt: new Date(Date.now() + 86_400_000),
        status: "ACCEPTED",
        acceptedWithMismatch: true,
        mismatchSeenAt: new Date(),
        mismatchEmail: user.email.toLowerCase(),
      },
    });
    await purgeUserAccount(user.id);
    const after = await db.clientInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(after.mismatchEmail).toBeNull();
    // Everything else on the row is untouched — this is a scrub, not a delete.
    expect(after.acceptedWithMismatch).toBe(true);
    expect(after.status).toBe("ACCEPTED");
    expect(after.coachId).toBe(other.id);
  });
  it("T-2060: purge backfills, deletes, closes and anonymises CoachClientEpisode rows and forgets plan authorship (one case per line)", async () => {
    const { user, other } = await fixture(true);
    const mkClient = async () => {
      const id = randomUUID();
      return db.user.create({ data: { clerkId: id, email: `${id}@example.test`, isClient: true } });
    };
    const noEpisode = await mkClient();
    const openEpisode = await mkClient();
    const closedEpisode = await mkClient();
    // Line 1: a row the old code created, with no episode at all.
    const noEpisodeRow = await db.coachClient.create({ data: { coachId: user.id, clientId: noEpisode.id } });
    // Line 3 (open): a live row with its open LIVE episode.
    const openRow = await db.coachClient.create({ data: { coachId: user.id, clientId: openEpisode.id } });
    await db.coachClientEpisode.create({
      data: { coachId: user.id, clientId: openEpisode.id, coachClientId: openRow.id, startedAt: openRow.createdAt },
    });
    // Line 3 (closed): an earlier relationship already ended; its end is kept.
    const endedAt = new Date("2026-03-01T00:00:00Z");
    await db.coachClientEpisode.create({
      data: {
        coachId: user.id, clientId: closedEpisode.id, coachClientId: randomUUID(),
        startedAt: new Date("2026-01-01T00:00:00Z"), endedAt, endReason: "COACH_REMOVED",
      },
    });
    // Line 2: the purged user's own client history (with `other` as coach).
    const ownRow = await db.coachClient.create({ data: { coachId: other.id, clientId: user.id } });
    await db.coachClientEpisode.create({
      data: { coachId: other.id, clientId: user.id, coachClientId: ownRow.id, startedAt: ownRow.createdAt },
    });
    // Lines 4/5: plans this user published for a client, plus a control by another coach.
    const week = new Date("2026-05-04T00:00:00Z");
    const meal = await db.mealPlan.create({
      data: { clientId: noEpisode.id, weekOf: week, status: "PUBLISHED", publishedAt: new Date(), publishedByCoachId: user.id },
    });
    const program = await db.trainingProgram.create({
      data: { clientId: noEpisode.id, weekOf: week, status: "PUBLISHED", publishedAt: new Date(), publishedByCoachId: user.id },
    });
    const control = await db.mealPlan.create({
      data: { clientId: openEpisode.id, weekOf: week, status: "PUBLISHED", publishedAt: new Date(), publishedByCoachId: other.id },
    });

    await purgeUserAccount(user.id);

    const backfilled = await db.coachClientEpisode.findMany({ where: { clientId: noEpisode.id } });
    expect(backfilled).toHaveLength(1);
    expect(backfilled[0]).toMatchObject({
      coachId: null, coachClientId: noEpisodeRow.id, source: "BACKFILL", endReason: "COACH_ACCOUNT_DELETED",
    });
    expect(backfilled[0].startedAt.getTime()).toBe(noEpisodeRow.createdAt.getTime());
    expect(backfilled[0].endedAt).toBeInstanceOf(Date);
    expect(await db.coachClientEpisode.count({ where: { clientId: user.id } })).toBe(0);
    expect(await db.coachClientEpisode.findMany({ where: { clientId: openEpisode.id } })).toMatchObject([
      { coachId: null, source: "LIVE", endReason: "COACH_ACCOUNT_DELETED" },
    ]);
    const closed = await db.coachClientEpisode.findMany({ where: { clientId: closedEpisode.id } });
    expect(closed).toMatchObject([{ coachId: null, endReason: "COACH_REMOVED" }]);
    expect(closed[0].endedAt?.getTime()).toBe(endedAt.getTime());
    expect(await db.mealPlan.findUniqueOrThrow({ where: { id: meal.id } })).toMatchObject({ status: "PUBLISHED", publishedByCoachId: null });
    expect(await db.trainingProgram.findUniqueOrThrow({ where: { id: program.id } })).toMatchObject({ status: "PUBLISHED", publishedByCoachId: null });
    expect(await db.mealPlan.findUniqueOrThrow({ where: { id: control.id } })).toMatchObject({ publishedByCoachId: other.id });
  });

  it("purges AI Coach records (A02/A03) on account deletion", async () => {
    const { user, other } = await fixture();
    await db.clientCoachingContext.create({ data: { clientId: user.id, mode: "AI", revision: 1 } });
    await db.aiCoachEntitlement.create({ data: { clientId: user.id } });
    await db.aiIntakeDraft.create({ data: { clientId: user.id, answers: { goal: "STRENGTH" } } });
    await db.aiCoachReviewerGrant.create({
      data: { userId: user.id, qualificationNote: "test fixture" },
    });
    const profile = await db.aiCoachProfile.create({ data: { clientId: user.id } });
    await db.aiSafetyDisclosureEvent.create({
      data: {
        clientId: user.id,
        structuredAnswers: {},
        dispositionAfter: "CLEAR",
        nutritionPermissionAfter: "ALLOW",
        strengthPermissionAfter: "ALLOW",
        cardioPermissionAfter: "ALLOW",
        safetyRevisionAfter: 1,
      },
    });
    const plan = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 1,
        status: "ACCEPTED",
        acceptedAt: new Date(),
        payload: {},
        payloadHash: "hash",
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
        policyVersion: "p1",
        catalogVersions: {},
      },
    });
    await db.aiCoachProfile.update({
      where: { id: profile.id },
      data: { activePlanVersionId: plan.id },
    });
    await db.aiAdjustmentSlot.create({
      data: { clientId: user.id, reviewWindowKey: "2026-W01", acceptedPlanVersionId: plan.id },
    });
    await db.aiPlanAcceptanceOutbox.create({ data: { clientId: user.id, planVersionId: plan.id } });
    await db.aiPlanAcceptanceReceipt.create({
      data: {
        clientId: user.id,
        requestKey: "test-key",
        inputDigest: "digest",
        planVersionId: plan.id,
        alreadyAccepted: false,
        activeVersionIdAtReceiptTime: plan.id,
      },
    });
    await db.aiWorkoutSession.create({
      data: {
        clientId: user.id,
        clientEventId: "evt-1",
        planVersionId: plan.id,
        exerciseId: "ex-1",
        occurredAt: new Date(),
        timezone: "UTC",
        setIndex: 0,
        loadKind: "BODYWEIGHT",
      },
    });
    // T-509 — AiCheckInObservation and AiOperationReceipt are onDelete:
    // Cascade, so the purge already removes them via tx.user.delete(); the
    // explicit purge.ts statements duplicate that cascade for defence in
    // depth. `liveObservation` and `tombstonedObservation` prove both a live
    // and a tombstoned (deletedAt set) row are purged with no
    // "deletedAt IS NULL" filter; `otherObservation`/`otherReceipt` are the
    // scoping control for a different, non-purged user.
    const liveObservation = await db.aiCheckInObservation.create({
      data: {
        clientId: user.id,
        clientEventId: "obs-live",
        occurredAt: new Date(),
        payload: { synthetic: true },
        inputDigest: "d".repeat(64),
        submitted: true,
      },
    });
    const tombstonedObservation = await db.aiCheckInObservation.create({
      data: {
        clientId: user.id,
        clientEventId: "obs-deleted",
        occurredAt: new Date(),
        payload: { deleted: true },
        revision: 2,
        deletedAt: new Date(),
        inputDigest: "d".repeat(64),
      },
    });
    const operationReceipt = await db.aiOperationReceipt.create({
      data: {
        clientId: user.id,
        operation: "DELETE_EVIDENCE",
        requestKey: randomUUID(),
        inputDigest: "e".repeat(64),
        result: { deleted: true },
      },
    });
    const otherObservation = await db.aiCheckInObservation.create({
      data: {
        clientId: other.id,
        clientEventId: "obs-other",
        occurredAt: new Date(),
        payload: { synthetic: true },
        inputDigest: "d".repeat(64),
        submitted: true,
      },
    });
    const otherReceipt = await db.aiOperationReceipt.create({
      data: {
        clientId: other.id,
        operation: "DELETE_EVIDENCE",
        requestKey: randomUUID(),
        inputDigest: "e".repeat(64),
        result: { deleted: true },
      },
    });
    const run = await db.aiCoachRun.create({
      data: {
        clientId: user.id,
        kind: "WEEKLY_REVIEW",
        businessKey: randomUUID(),
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
      },
    });
    const safetyDecision = await db.aiNutritionSafetyDecision.create({
      data: {
        clientId: user.id,
        evaluationKey: "a".repeat(64),
        policyArtifactId: "synthetic-purge-policy:v1",
        policyArtifactVersion: 1,
        policyArtifactDigest: "b".repeat(64),
        outcome: "HOLD",
        reasonCodes: ["SYNTHETIC_PURGE_REASON"],
        ruleIds: ["SYNTHETIC_PURGE_RULE"],
        escalationTemplateIds: [],
        inputSnapshot: { synthetic: true },
        inputDigest: "c".repeat(64),
        sourcePlanVersionIds: [plan.id],
      },
    });
    const autonomyDecision = await db.aiAutonomyGateDecision.create({
      data: {
        clientId: user.id,
        evaluationKey: "d".repeat(64),
        outcome: "HOLD",
        orderedReasonCodes: ["GATE_CANDIDATE_INVALID"],
        ruleIds: [],
        nextActionTemplateId: "synthetic-purge-template",
        artifactRefs: [],
        sourceRefs: [],
        inputSnapshot: { synthetic: true },
        inputDigest: "e".repeat(64),
        validationReport: { schemaVersion: 1, checks: [] },
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
        nutritionSafetyDecisionId: safetyDecision.id,
        evaluatedPlanVersionId: plan.id,
      },
    });
    const providerAudit = await db.aiProviderBoundaryAudit.create({
      data: {
        clientId: user.id,
        operationId: randomUUID(),
        promptContractVersion: "t1007-synthetic-v1",
        providerConfiguration: "SYNTHETIC_CONSTRAINED_PROVIDER_ONLY",
        boundaryOutcome: "FAIL_CLOSED",
        resultOutcome: "HOLD",
        failureCode: "PROVIDER_OUTPUT_INVALID",
        attempts: 1,
        preGateDecisionId: autonomyDecision.id,
        inputSnapshot: { synthetic: true },
        inputDigest: "f".repeat(64),
      },
    });
    const activationAttempt = await db.aiPlanActivationAttempt.create({
      data: {
        clientId: user.id,
        planVersionId: plan.id,
        requestKeyDigest: "1".repeat(64),
        outcome: "REJECTED",
        reasonCode: "SYNTHETIC_PURGE_REJECTION",
      },
    });
    const governanceGrant = await db.aiCoachGovernanceGrant.create({
      data: {
        userId: user.id,
        scopes: ["VIEW_AGGREGATE_MONITORING"],
        grantRef: "synthetic-purge-grant",
      },
    });
    const operationalEvent = await db.aiCoachOperationalEvent.create({
      data: {
        actorUserId: user.id,
        scope: "FINALIZATION",
        disabled: true,
        reasonCode: "SYNTHETIC_PURGE_EVENT",
        revision: 0,
      },
    });
    const lifecycleEvent = await db.aiCoachArtifactLifecycleEvent.create({
      data: {
        actorUserId: user.id,
        governanceGrantId: governanceGrant.id,
        artifactVersionId: "synthetic-purge-artifact",
        action: "REVOKE",
        reasonCode: "SYNTHETIC_PURGE_EVENT",
        reviewRecordId: "synthetic-purge-review",
      },
    });
    // T-995 — AiCoachAccessGrantEvent purge coverage: one row where the
    // departing user is the actor, one where they are the subject (both must
    // be deleted), and one belonging to a different user whose `clientIds`
    // names the departing user (must survive, scrubbed).
    const grantEventAsActor = await db.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: user.id,
        subjectUserId: other.id,
        governanceGrantId: governanceGrant.id,
        grantType: "GOVERNANCE",
        action: "GRANT",
        grantRecordId: "synthetic-purge-grant-record-actor",
        scopes: ["PUBLISH_ARTIFACTS"],
        actorRef: "Synthetic Purge Actor",
        reasonCode: "SYNTHETIC_PURGE_EVENT",
      },
    });
    const grantEventAsSubject = await db.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: other.id,
        subjectUserId: user.id,
        governanceGrantId: governanceGrant.id,
        grantType: "ENTITLEMENT",
        action: "GRANT",
        grantRecordId: "synthetic-purge-grant-record-subject",
        actorRef: "Synthetic Purge Actor",
        reasonCode: "SYNTHETIC_PURGE_EVENT",
      },
    });
    const grantEventWithClientId = await db.aiCoachAccessGrantEvent.create({
      data: {
        actorUserId: other.id,
        subjectUserId: other.id,
        governanceGrantId: governanceGrant.id,
        grantType: "REVIEWER",
        action: "GRANT",
        grantRecordId: "synthetic-purge-grant-record-clientids",
        domains: ["NUTRITION"],
        clientIds: [user.id, other.id],
        actorRef: "Synthetic Purge Actor",
        reasonCode: "SYNTHETIC_PURGE_EVENT",
      },
    });

    // T-989 review MAJOR 4 — four purge lines (purge.ts:259,267,274,275) had
    // no coverage. All four are `ON DELETE RESTRICT` to User: a dropped or
    // reordered line wedges the account in PURGING after the Clerk identity
    // is already gone.
    //
    // AiAutomaticPlanApproval has a DB-trigger insert guard
    // ("validate_ai_automatic_plan_approval_insert") requiring an exact,
    // matching PROPOSED plan / APPROVE_AUTOMATICALLY gate / VALIDATED
    // provider audit trio, so it needs its own fixtures rather than reusing
    // this test's HOLD-outcome ones above.
    const autoApprovedPlan = await db.aiPlanVersion.create({
      data: {
        clientId: user.id,
        version: 2,
        status: "PROPOSED",
        payload: {},
        payloadHash: "1".repeat(64),
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
        policyVersion: "p1",
        catalogVersions: {},
      },
    });
    const autoApproveGateDecision = await db.aiAutonomyGateDecision.create({
      data: {
        clientId: user.id,
        evaluationKey: "2".repeat(64),
        outcome: "APPROVE_AUTOMATICALLY",
        orderedReasonCodes: ["SYNTHETIC_PURGE_AUTO_APPROVE"],
        ruleIds: [],
        nextActionTemplateId: "synthetic-purge-auto-template",
        artifactRefs: [],
        sourceRefs: [],
        inputSnapshot: { synthetic: true },
        inputDigest: "3".repeat(64),
        validationReport: { schemaVersion: 1, checks: [] },
        contextRevision: 1,
        profileRevision: 1,
        observationRevision: 1,
        safetyRevision: 1,
        evaluatedPlanVersionId: autoApprovedPlan.id,
        approvedPlanVersionId: autoApprovedPlan.id,
        candidatePayloadHash: autoApprovedPlan.payloadHash,
      },
    });
    // T-2030 — this row and `automaticApproval` below also carry validated
    // bounded-prose content (`explanationValidation`,
    // `providerSelection.explanation.text`), so the existing "zero rows
    // remain" assertions on these two ids (below) double as the purge
    // regression for T-2006's prose feature: a client with validated prose
    // leaves zero AiProviderBoundaryAudit and zero AiAutomaticPlanApproval
    // rows, same as any other client.
    const validatedProviderAudit = await db.aiProviderBoundaryAudit.create({
      data: {
        clientId: user.id,
        operationId: randomUUID(),
        promptContractVersion: "t1007-synthetic-v1",
        providerConfiguration: "SYNTHETIC_CONSTRAINED_PROVIDER_ONLY",
        boundaryOutcome: "VALIDATED",
        resultOutcome: "APPROVE_AUTOMATICALLY",
        attempts: 1,
        preGateDecisionId: autoApproveGateDecision.id,
        finalGateDecisionId: autoApproveGateDecision.id,
        inputSnapshot: { synthetic: true },
        inputDigest: "4".repeat(64),
        explanationValidation: {
          schemaVersion: 1,
          contractVersion: "t2006-prose-v1",
          explanation: { outcome: "ACCEPTED", reasonCodes: [], characters: 64 },
          clarification: { outcome: "ABSENT", reasonCodes: [], characters: 0 },
        },
      },
    });
    const automaticApproval = await db.aiAutomaticPlanApproval.create({
      data: {
        clientId: user.id,
        planVersionId: autoApprovedPlan.id,
        gateDecisionId: autoApproveGateDecision.id,
        providerBoundaryAuditId: validatedProviderAudit.id,
        evaluationKey: autoApproveGateDecision.evaluationKey,
        candidatePayloadHash: autoApprovedPlan.payloadHash,
        artifactRequest: {},
        artifactRefs: [],
        sourceRefs: [],
        gateInput: {},
        providerSelection: {
          preferenceIds: [],
          rankedOptionIds: [],
          explanation: {
            templateId: "synthetic-purge-auto-template",
            locale: "en-US",
            reasonCodes: [],
            nextStepText: "SYNTHETIC PURGE FIXTURE.",
            numericFields: [],
            limitations: [],
            text: "SYNTHETIC PURGE FIXTURE: validated explanation text that must not survive purge.",
          },
        },
        stateDigest: "5".repeat(64),
      },
    });
    const providerTransitionReceipt = await db.aiCoachProviderTransitionReceipt.create({
      data: {
        clientId: user.id,
        fromMode: "HUMAN",
        fromContextRevision: 1,
        toMode: "AI",
        toContextRevision: 2,
        releaseId: `synthetic-purge-release-${user.id}`,
        runtimeConfigurationDigest: "6".repeat(64),
        discoveryConfigurationId: "synthetic-purge-discovery-v1",
        discoveryConfigurationVersion: 1,
        privacyNoticeVersion: "v1",
        consentTextDigest: "7".repeat(64),
      },
    });
    // AiCoachLiveLaunchPacket rows are DB-trigger append-only — never
    // deletable, even by this test — so this is a plain metadata-free DRAFT
    // insert (the one shape the packet lifecycle guard permits directly) and
    // is left on the test database afterward, same as other suites' packet
    // fixtures (e.g. tests/integration/ai-coach-live-launch-readiness.test.ts).
    const purgeTestPacket = await db.aiCoachLiveLaunchPacket.create({
      data: {
        id: `synthetic-purge-packet-${user.id}`,
        packetKey: `synthetic-purge-packet-key-${user.id}`,
        version: 1,
        schemaVersion: 1,
        releaseId: `synthetic-purge-packet-release-${user.id}`,
        engineVersion: "ai-coach-artifact-engine-v1",
        jurisdictions: ["US"],
        packet: { synthetic: true },
        contentDigest: "8".repeat(64),
        testOnly: true,
      },
    });
    const liveLaunchLifecycleEvent = await db.aiCoachLiveLaunchLifecycleEvent.create({
      data: {
        actorUserId: user.id,
        governanceGrantId: governanceGrant.id,
        packetId: purgeTestPacket.id,
        action: "APPROVE",
        reasonCode: "SYNTHETIC_PURGE_EVENT",
        packetDigest: purgeTestPacket.contentDigest,
        signedApprovalIndexRef: "synthetic-purge-signed-approval-index",
      },
    });
    const liveActivationEvent = await db.aiCoachLiveActivationEvent.create({
      data: {
        actorUserId: user.id,
        governanceGrantId: governanceGrant.id,
        activationId: `synthetic-purge-activation-${user.id}`,
        packetId: purgeTestPacket.id,
        action: "ACTIVATE",
        packetDigest: purgeTestPacket.contentDigest,
        runtimeConfigurationDigest: "9".repeat(64),
        signedActivationRef: "synthetic-purge-signed-activation",
        reasonCode: "SYNTHETIC_PURGE_EVENT",
      },
    });

    // MINOR 5 — AiCoachOperationalControl.updatedByGrantId has no FK and no
    // purge line by design (it is one global kill-switch row per scope, not
    // per-user data; see the schema comment). Purge must not touch it, and
    // must not throw when the grant it references belongs to the user being
    // deleted.
    //
    // T-989 review round 2 MINOR 5: this is a global singleton keyed by a
    // fixed enum value, and other files in this suite
    // (ai-coach-release-drills.test.ts, ai-coach-live-launch-readiness.test.ts)
    // write the same table. Capture whatever was here before this test ran
    // and restore it in `finally`, regardless of how this test exits, so a
    // failure here can never leave a real kill switch disabled for every
    // later run against this database.
    const priorControl = await db.aiCoachOperationalControl.findUnique({
      where: { scope: "ARTIFACT_PUBLICATION" },
    });
    await db.aiCoachOperationalControl.upsert({
      where: { scope: "ARTIFACT_PUBLICATION" },
      create: {
        scope: "ARTIFACT_PUBLICATION",
        disabled: true,
        reasonCode: "SYNTHETIC_PURGE_CONTROL",
        updatedByGrantId: governanceGrant.id,
      },
      update: { updatedByGrantId: governanceGrant.id, reasonCode: "SYNTHETIC_PURGE_CONTROL" },
    });

    try {
      await purgeUserAccount(user.id);

      expect(await db.clientCoachingContext.findUnique({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiCoachEntitlement.findUnique({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiIntakeDraft.findUnique({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiCoachReviewerGrant.findUnique({ where: { userId: user.id } })).toBeNull();
    expect(await db.aiSafetyDisclosureEvent.findFirst({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiCoachProfile.findUnique({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiPlanVersion.findUnique({ where: { id: plan.id } })).toBeNull();
    expect(await db.aiAdjustmentSlot.findFirst({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiWorkoutSession.findFirst({ where: { clientId: user.id } })).toBeNull();
    // T-509 — live and tombstoned observations, and the operation receipt,
    // are gone; the same rows for a different, non-purged user survive.
    expect(
      await db.aiCheckInObservation.findUnique({ where: { id: liveObservation.id } })
    ).toBeNull();
    expect(
      await db.aiCheckInObservation.findUnique({ where: { id: tombstonedObservation.id } })
    ).toBeNull();
    expect(
      await db.aiOperationReceipt.findUnique({ where: { id: operationReceipt.id } })
    ).toBeNull();
    expect(await db.aiCheckInObservation.count({ where: { clientId: user.id } })).toBe(0);
    expect(await db.aiOperationReceipt.count({ where: { clientId: user.id } })).toBe(0);
    expect(
      await db.aiCheckInObservation.findUnique({ where: { id: otherObservation.id } })
    ).not.toBeNull();
    expect(
      await db.aiOperationReceipt.findUnique({ where: { id: otherReceipt.id } })
    ).not.toBeNull();
    expect(await db.aiCoachRun.findUnique({ where: { id: run.id } })).toBeNull();
    expect(
      await db.aiProviderBoundaryAudit.findUnique({ where: { id: providerAudit.id } })
    ).toBeNull();
    expect(
      await db.aiAutonomyGateDecision.findUnique({ where: { id: autonomyDecision.id } })
    ).toBeNull();
    expect(
      await db.aiNutritionSafetyDecision.findUnique({ where: { id: safetyDecision.id } })
    ).toBeNull();
    expect(
      await db.aiPlanActivationAttempt.findUnique({ where: { id: activationAttempt.id } })
    ).toBeNull();
    expect(
      await db.aiCoachGovernanceGrant.findUnique({ where: { id: governanceGrant.id } })
    ).toBeNull();
    expect(
      await db.aiCoachOperationalEvent.findUnique({ where: { id: operationalEvent.id } })
    ).toBeNull();
    expect(
      await db.aiCoachArtifactLifecycleEvent.findUnique({ where: { id: lifecycleEvent.id } })
    ).toBeNull();
    // T-995 — the departing user's own AiCoachAccessGrantEvent rows are
    // gone (whether they were the actor or the subject), while a different
    // user's row survives with only the departing user's id scrubbed out of
    // `clientIds`.
    expect(
      await db.aiCoachAccessGrantEvent.findUnique({ where: { id: grantEventAsActor.id } })
    ).toBeNull();
    expect(
      await db.aiCoachAccessGrantEvent.findUnique({ where: { id: grantEventAsSubject.id } })
    ).toBeNull();
    const survivingGrantEvent = await db.aiCoachAccessGrantEvent.findUnique({
      where: { id: grantEventWithClientId.id },
    });
    expect(survivingGrantEvent).not.toBeNull();
    expect(survivingGrantEvent?.clientIds).toEqual([other.id]);
    expect(await db.aiPlanAcceptanceOutbox.findFirst({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiPlanAcceptanceReceipt.findFirst({ where: { clientId: user.id } })).toBeNull();

    expect(
      await db.aiAutomaticPlanApproval.findUnique({ where: { id: automaticApproval.id } })
    ).toBeNull();
    expect(
      await db.aiCoachProviderTransitionReceipt.findUnique({
        where: { id: providerTransitionReceipt.id },
      })
    ).toBeNull();
    expect(
      await db.aiCoachLiveLaunchLifecycleEvent.findUnique({
        where: { id: liveLaunchLifecycleEvent.id },
      })
    ).toBeNull();
    expect(
      await db.aiCoachLiveActivationEvent.findUnique({ where: { id: liveActivationEvent.id } })
    ).toBeNull();

    // The packet itself is not user data — it must survive (append-only,
    // globally shared release evidence).
    expect(
      await db.aiCoachLiveLaunchPacket.findUnique({ where: { id: purgeTestPacket.id } })
    ).not.toBeNull();

    // MINOR 5 — the kill-switch row is global control state, not user data:
    // it must survive purge, unmodified, even though the grant it points at
    // (`updatedByGrantId`) has just been deleted along with its user. This is
    // the documented historical-pointer behaviour, not a bug.
    const survivingControl = await db.aiCoachOperationalControl.findUnique({
      where: { scope: "ARTIFACT_PUBLICATION" },
    });
    expect(survivingControl).not.toBeNull();
    expect(survivingControl?.updatedByGrantId).toBe(governanceGrant.id);
    } finally {
      // Restore whatever this test found, so a failure above (or a
      // concurrent writer) never leaves a real kill switch stuck disabled
      // for every subsequent run against this database.
      if (priorControl) {
        await db.aiCoachOperationalControl.update({
          where: { scope: "ARTIFACT_PUBLICATION" },
          data: {
            disabled: priorControl.disabled,
            reasonCode: priorControl.reasonCode,
            incidentReference: priorControl.incidentReference,
            updatedByGrantId: priorControl.updatedByGrantId,
            revision: priorControl.revision,
          },
        });
      } else {
        await db.aiCoachOperationalControl.deleteMany({
          where: { scope: "ARTIFACT_PUBLICATION" },
        });
      }
    }
  });
  it("S-23: purges every AiNutritionLog row, including declared SKIPPED/NONE days, scoped to the departing client", async () => {
    const { user, other } = await fixture();
    const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset));
    await db.aiNutritionLog.createMany({
      data: [
        {
          clientId: user.id,
          loggedOn: day(0),
          energyKcal: 2400,
          proteinG: 180,
          carbsG: 250,
          fatG: 80,
          source: "PLAN_AS_WRITTEN",
          completeness: "FULL",
        },
        // A day the client declared they did not log is still their health
        // record and must be purged, not skipped for having no numbers.
        { clientId: user.id, loggedOn: day(1), source: "SKIPPED", completeness: "NONE" },
        { clientId: other.id, loggedOn: day(0), energyKcal: 2100, source: "MANUAL", completeness: "FULL" },
      ],
    });
    expect(await db.aiNutritionLog.count({ where: { clientId: user.id } })).toBe(2);

    await purgeUserAccount(user.id);

    expect(await db.aiNutritionLog.count({ where: { clientId: user.id } })).toBe(0);
    expect(await db.aiNutritionLog.count({ where: { clientId: other.id } })).toBe(1);
  });

  it("T-2024: purges a v2-confirmed intake (AiCoachProfile + AiIntakeDraft) same as v1", async () => {
    const { user } = await fixture();
    await db.aiIntakeDraft.create({
      data: { clientId: user.id, answers: { goal: "STRENGTH", intakeVersion: 2 } },
    });
    const confirmed = await confirmIntake(user.id, {
      intakeVersion: 2,
      goal: "GENERAL_FITNESS",
      experienceLevel: "NEW",
      trainingDaysPerWeek: 3,
      equipmentAccess: ["NONE"],
      foodBudgetLevel: "LOW",
      trackingPreference: "NUMBERS_VISIBLE",
      unitsPreference: "METRIC",
      ageStatus: "UNKNOWN",
      energyMethodPopulationCategoryStatus: "UNKNOWN",
      physicalActivityCategoryStatus: "UNKNOWN",
      bodyMeasurementStatus: "UNKNOWN",
      goalStatus: "UNKNOWN",
      trainingContextStatus: "UNKNOWN",
      cookingAccessStatus: "UNKNOWN",
      dislikes: [],
      cuisinePreferences: [],
      allergenDeclarations: { status: "UNKNOWN", noKnownAllergens: false, items: [] },
      dietaryPattern: {
        pattern: "NONE_DECLARED",
        otherLabel: null,
        mandatory: false,
        reason: "NOT_STATED",
        status: "UNKNOWN",
      },
    });
    expect(confirmed.success).toBe(true);
    expect(
      (await db.aiCoachProfile.findUniqueOrThrow({ where: { clientId: user.id } })).confirmedIntake
    ).toMatchObject({ intakeVersion: 2 });
    // Confirming clears the draft, so re-create one to prove purge also
    // handles a v2-shaped draft row, not just a v2-confirmed profile.
    await db.aiIntakeDraft.create({
      data: { clientId: user.id, answers: { goal: "STRENGTH", intakeVersion: 2 } },
    });

    await purgeUserAccount(user.id);

    expect(await db.aiCoachProfile.findUnique({ where: { clientId: user.id } })).toBeNull();
    expect(await db.aiIntakeDraft.findUnique({ where: { clientId: user.id } })).toBeNull();
  });
  it("keeps all DB records and identity when storage cleanup fails", async () => {
    const { user, receipt, checkIn } = await fixture();
    mocks.remove.mockResolvedValue({ error: { message: "storage unavailable" } });
    await expect(purgeUserAccount(user.id)).rejects.toThrow("Storage cleanup failed");
    expect(mocks.deleteIdentity).not.toHaveBeenCalled();
    expect(await db.checkIn.findUnique({ where: { id: checkIn.id } })).not.toBeNull();
    expect(
      (await db.accountDeletionRequest.findUniqueOrThrow({ where: { id: receipt.id } })).status
    ).toBe("PURGING");
  });
  it("keeps DB records when identity deletion fails", async () => {
    const { user, checkIn } = await fixture();
    mocks.deleteIdentity.mockRejectedValue(new Error("Clerk unavailable"));
    await expect(purgeUserAccount(user.id)).rejects.toThrow("Clerk unavailable");
    expect(await db.checkIn.findUnique({ where: { id: checkIn.id } })).not.toBeNull();
  });
  it("rolls back earlier deletes on a database failure and succeeds on retry", async () => {
    const { user, checkIn } = await fixture();
    await db.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS "PurgeTestGuard" ("userId" text REFERENCES "User"(id) ON DELETE RESTRICT)'
    );
    await db.$executeRaw`INSERT INTO "PurgeTestGuard" ("userId") VALUES (${user.id})`;
    await expect(purgeUserAccount(user.id)).rejects.toThrow();
    expect(await db.checkIn.findUnique({ where: { id: checkIn.id } })).not.toBeNull();
    await db.$executeRaw`DELETE FROM "PurgeTestGuard" WHERE "userId" = ${user.id}`;
    await purgeUserAccount(user.id);
    expect(await db.user.findUnique({ where: { id: user.id } })).toBeNull();
  });
});
