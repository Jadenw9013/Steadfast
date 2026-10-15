import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";
import { enqueueStorageCleanup } from "@/lib/storage/cleanup-outbox";
import { stopAccountBilling } from "./billing";
import { reconcileCoachingContextForClient } from "@/lib/activation";

/** External cleanup is retryable; all database deletes commit together. */
export async function purgeUserAccount(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  const request = await db.accountDeletionRequest.findUnique({ where: { userId } });
  if (
    !user ||
    !request ||
    !user.isDeactivated ||
    request.status !== "PURGING" ||
    request.scheduledPurgeAt > new Date()
  ) {
    throw new Error("Account is not eligible for purging");
  }
  await stopAccountBilling(userId, true);
  await db.accountDeletionRequest.update({
    where: { id: request.id },
    data: { stripeSubscriptionCancelledAt: new Date() },
  });
  await cleanupStorage(userId, user.profilePhotoPath);
  await db.accountDeletionRequest.update({
    where: { id: request.id },
    data: { storageCleanedAt: new Date(), clerkId: user.clerkId },
  });
  // Delete identity before the DB phase, so a DB failure retains all cleanup records.
  // A retry accepts an already-deleted identity, but no other Clerk error.
  if (!request.clerkDeletedAt) {
    const { clerkClient } = await import("@clerk/nextjs/server");
    try {
      await (await clerkClient()).users.deleteUser(user.clerkId);
    } catch (error) {
      if (
        !(typeof error === "object" && error !== null && "status" in error && error.status === 404)
      )
        throw error;
    }
    await db.accountDeletionRequest.update({
      where: { id: request.id },
      data: { clerkDeletedAt: new Date() },
    });
  }

  await db.$transaction(
    async (tx) => {
      const receipt = await tx.accountDeletionRequest.findUnique({ where: { id: request.id } });
      if (receipt?.status !== "PURGING") throw new Error("Deletion state changed");

      // Lead data includes identifiable intake answers and signatures, not just a User FK.
      const leads = await tx.coachingRequest.findMany({
        where: {
          OR: [
            { prospectId: userId },
            { coachProfile: { userId } },
            { prospectId: null, prospectEmail: { equals: user.email, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      const leadIds = leads.map((lead) => lead.id);
      await tx.documentSignature.deleteMany({
        where: { intakePacketDocument: { intakePacket: { coachingRequestId: { in: leadIds } } } },
      });
      await tx.intakePacketDocument.deleteMany({
        where: { intakePacket: { coachingRequestId: { in: leadIds } } },
      });
      await tx.intakePacket.deleteMany({ where: { coachingRequestId: { in: leadIds } } });
      await tx.coachingRequest.deleteMany({ where: { id: { in: leadIds } } });
      await tx.userBlock.deleteMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      });
      await tx.messageReport.deleteMany({
        where: { OR: [{ reporterId: userId }, { reportedId: userId }] },
      });
      await tx.coachSubscription.deleteMany({ where: { coachId: userId } });
      await tx.workoutImport.deleteMany({ where: { clientId: userId } });

      // --- Client-scoped data ---
      if (user.isClient) {
        // CheckInPhoto (cascades from CheckIn, but delete explicitly)
        await tx.$executeRaw`
      DELETE FROM "CheckInPhoto" WHERE "checkInId" IN (
        SELECT "id" FROM "CheckIn" WHERE "clientId" = ${userId}
      )
    `;
        await tx.$executeRaw`DELETE FROM "CheckIn" WHERE "clientId" = ${userId}`;

        // DailyMealCheckoff + ExerciseCheckoff → DailyAdherence
        await tx.$executeRaw`
      DELETE FROM "DailyMealCheckoff" WHERE "dailyAdherenceId" IN (
        SELECT "id" FROM "DailyAdherence" WHERE "clientId" = ${userId}
      )
    `;
        await tx.$executeRaw`
      DELETE FROM "ExerciseCheckoff" WHERE "dailyAdherenceId" IN (
        SELECT "id" FROM "DailyAdherence" WHERE "clientId" = ${userId}
      )
    `;
        await tx.$executeRaw`DELETE FROM "DailyAdherence" WHERE "clientId" = ${userId}`;
        await tx.$executeRaw`DELETE FROM "ExerciseResult" WHERE "clientId" = ${userId}`;

        // TrainingProgram chain (client-assigned programs)
        await tx.$executeRaw`
      DELETE FROM "TrainingExercise" WHERE "dayId" IN (
        SELECT td."id" FROM "TrainingDay" td
        JOIN "TrainingProgram" tp ON td."programId" = tp."id"
        WHERE tp."clientId" = ${userId}
      )
    `;
        await tx.$executeRaw`
      DELETE FROM "TrainingProgramBlock" WHERE "dayId" IN (
        SELECT td."id" FROM "TrainingDay" td
        JOIN "TrainingProgram" tp ON td."programId" = tp."id"
        WHERE tp."clientId" = ${userId}
      )
    `;
        await tx.$executeRaw`
      DELETE FROM "TrainingProgramCardio" WHERE "programId" IN (
        SELECT "id" FROM "TrainingProgram" WHERE "clientId" = ${userId}
      )
    `;
        await tx.$executeRaw`
      DELETE FROM "TrainingDay" WHERE "programId" IN (
        SELECT "id" FROM "TrainingProgram" WHERE "clientId" = ${userId}
      )
    `;
        await tx.$executeRaw`DELETE FROM "TrainingProgram" WHERE "clientId" = ${userId}`;

        // MealPlan chain (client's plans — coach-authored but assigned to client)
        await tx.$executeRaw`
      DELETE FROM "MealPlanItem" WHERE "mealPlanId" IN (
        SELECT "id" FROM "MealPlan" WHERE "clientId" = ${userId}
      )
    `;
        await tx.$executeRaw`
      DELETE FROM "MealMacroTarget" WHERE "mealPlanId" IN (
        SELECT "id" FROM "MealPlan" WHERE "clientId" = ${userId}
      )
    `;
        await tx.$executeRaw`DELETE FROM "MealPlan" WHERE "clientId" = ${userId}`;
        await tx.$executeRaw`DELETE FROM "MacroTarget" WHERE "clientId" = ${userId}`;

        // Onboarding + Intake
        await tx.$executeRaw`DELETE FROM "OnboardingResponse" WHERE "clientId" = ${userId}`;
        await tx.$executeRaw`DELETE FROM "ClientIntake" WHERE "clientId" = ${userId}`;

        // CoachingRequest (as prospect)
        await tx.$executeRaw`
      UPDATE "CoachingRequest" SET "prospectId" = NULL WHERE "prospectId" = ${userId}
    `;
      }

      // --- Coach-specific data ---
      if (user.isCoach) {
        // Training templates chain
        await tx.$executeRaw`
      DELETE FROM "TrainingTemplateExercise" WHERE "dayId" IN (
        SELECT td."id" FROM "TrainingTemplateDay" td
        JOIN "TrainingTemplate" tt ON td."templateId" = tt."id"
        WHERE tt."coachId" = ${userId}
      )
    `;
        await tx.$executeRaw`
      DELETE FROM "TrainingTemplateBlock" WHERE "dayId" IN (
        SELECT td."id" FROM "TrainingTemplateDay" td
        JOIN "TrainingTemplate" tt ON td."templateId" = tt."id"
        WHERE tt."coachId" = ${userId}
      )
    `;
        await tx.$executeRaw`
      DELETE FROM "TrainingTemplateCardio" WHERE "templateId" IN (
        SELECT "id" FROM "TrainingTemplate" WHERE "coachId" = ${userId}
      )
    `;
        await tx.$executeRaw`
      DELETE FROM "TrainingTemplateDay" WHERE "templateId" IN (
        SELECT "id" FROM "TrainingTemplate" WHERE "coachId" = ${userId}
      )
    `;
        // Nullify templateSourceId on programs before deleting templates
        await tx.$executeRaw`
      UPDATE "TrainingProgram" SET "templateSourceId" = NULL
      WHERE "templateSourceId" IN (
        SELECT "id" FROM "TrainingTemplate" WHERE "coachId" = ${userId}
      )
    `;
        await tx.$executeRaw`DELETE FROM "TrainingTemplate" WHERE "coachId" = ${userId}`;

        // Coach file-based models
        await tx.$executeRaw`DELETE FROM "MealPlanDraft" WHERE "uploadId" IN (SELECT id FROM "MealPlanUpload" WHERE "coachId" = ${userId})`;
        await tx.$executeRaw`DELETE FROM "MealPlanUpload" WHERE "coachId" = ${userId}`;
        await tx.$executeRaw`
      DELETE FROM "WorkoutImportDraft" WHERE "importId" IN (
        SELECT "id" FROM "WorkoutImport" WHERE "coachId" = ${userId}
      )
    `;
        await tx.$executeRaw`DELETE FROM "WorkoutImport" WHERE "coachId" = ${userId}`;
        await tx.$executeRaw`DELETE FROM "PlanSnippet" WHERE "coachId" = ${userId}`;
        await tx.$executeRaw`DELETE FROM "CheckInTemplate" WHERE "coachId" = ${userId}`;
        await tx.$executeRaw`DELETE FROM "FoodLibraryItem" WHERE "coachId" = ${userId}`;

        // Coach documents (before IntakePacketDocument references are gone)
        await tx.$executeRaw`DELETE FROM "CoachDocument" WHERE "coachId" = ${userId}`;

        await tx.$executeRaw`DELETE FROM "OnboardingForm" WHERE "coachId" = ${userId}`;
        await tx.$executeRaw`DELETE FROM "ClientInvite" WHERE "coachId" = ${userId}`;
        // ClientIntake rows this user sent as a coach are handled after the
        // CoachClient delete below (T-2056 / D6): they are the client's answers.
      }

      // --- Shared models (both roles) ---
      await tx.$executeRaw`DELETE FROM "Message" WHERE "senderId" = ${userId} OR "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "NotificationLog" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "Testimonial" WHERE "coachId" = ${userId} OR "clientId" = ${userId}`;
      // T-2056 (G3/D4): ClientCoachingContext.activeCoachClientId is ON DELETE
      // SET NULL, so deleting this coach's relationships alone strands each
      // client as HUMAN with no relationship, which getClientProvider reads as
      // resolutionRequired (409 on every client plan route). Collect the
      // clients first, then re-derive each context in this same transaction.
      // T-2060: relationship history (CoachClientEpisode) and plan authorship.
      // 1. Any of this coach's own rows still without an open episode (created
      //    by pre-T-2060 code before the reconcile ran) gets its BACKFILL
      //    episode first, so step 3 can close and anonymise it.
      await tx.$executeRaw`
    INSERT INTO "CoachClientEpisode" ("id","coachId","clientId","coachClientId","startedAt","source","createdAt")
    SELECT gen_random_uuid()::text, cc."coachId", cc."clientId", cc."id", cc."createdAt",
           'BACKFILL'::"CoachClientEpisodeSource", now()
    FROM "CoachClient" cc
    WHERE cc."coachId" = ${userId} AND cc."clientId" <> ${userId}
      AND NOT EXISTS (SELECT 1 FROM "CoachClientEpisode" e WHERE e."coachClientId" = cc."id" AND e."endedAt" IS NULL)
  `;
      // 2. This user's own client history goes with them.
      await tx.$executeRaw`DELETE FROM "CoachClientEpisode" WHERE "clientId" = ${userId}`;
      // 3. Close and anonymise the episodes this user coached. The client keeps
      //    the fact that another provider existed (coachId NULL still counts as
      //    "another provider" in lib/coach-client/plan-visibility.ts).
      await tx.$executeRaw`
    UPDATE "CoachClientEpisode"
       SET "endedAt" = COALESCE("endedAt", now()),
           "endReason" = COALESCE("endReason", 'COACH_ACCOUNT_DELETED'::"CoachClientEpisodeEndReason"),
           "coachId" = NULL
     WHERE "coachId" = ${userId}
  `;
      // 4. The plans stay (they are the client's); only the author is forgotten.
      await tx.$executeRaw`UPDATE "MealPlan" SET "publishedByCoachId" = NULL WHERE "publishedByCoachId" = ${userId}`;
      await tx.$executeRaw`UPDATE "TrainingProgram" SET "publishedByCoachId" = NULL WHERE "publishedByCoachId" = ${userId}`;
      const coachedClients = await tx.coachClient.findMany({
        where: { coachId: userId, clientId: { not: userId } },
        select: { clientId: true },
      });
      await tx.$executeRaw`DELETE FROM "CoachClient" WHERE "coachId" = ${userId} OR "clientId" = ${userId}`;
      for (const { clientId } of coachedClients) {
        await reconcileCoachingContextForClient(tx, clientId);
      }
      // T-2056 (D6): an intake this user sent as a coach holds the client's own
      // answers. If the client has another coach, re-home the row to that coach
      // (the reconciled active one first, else the most recent) instead of
      // deleting it. Reads key on clientId; coachId only addresses the
      // completion email, which resendClientIntake already re-points the same
      // way. With no other coach the row still goes: coachId is a required FK to
      // this user (keeping it needs a migration, follow-up).
      await tx.$executeRaw`
    UPDATE "ClientIntake" ci SET "coachId" = next_coach."coachId", "updatedAt" = now()
    FROM (
      SELECT DISTINCT ON (cc."clientId") cc."clientId", cc."coachId"
      FROM "CoachClient" cc
      LEFT JOIN "ClientCoachingContext" ctx ON ctx."activeCoachClientId" = cc."id"
      WHERE cc."clientId" IN (SELECT "clientId" FROM "ClientIntake" WHERE "coachId" = ${userId})
      ORDER BY cc."clientId", (ctx."id" IS NOT NULL) DESC, cc."createdAt" DESC
    ) next_coach
    WHERE ci."coachId" = ${userId} AND ci."clientId" = next_coach."clientId"
  `;
      await tx.$executeRaw`DELETE FROM "ClientIntake" WHERE "coachId" = ${userId}`;
      // T-987: mismatchEmail is a *second* user's address stored on a *coach's*
      // ClientInvite row (the coach-side delete above already removes the whole
      // row when the coach leaves); scrub the departing client's address here.
      await tx.$executeRaw`UPDATE "ClientInvite" SET "mismatchEmail" = NULL WHERE lower("mismatchEmail") = lower(${user.email})`;
      await tx.$executeRaw`DELETE FROM "MealPlanUpload" WHERE "clientId" = ${userId}`;

      // Coach marketplace (cascade: PortfolioItem, SavedCoach)
      if (user.isCoach) {
        await tx.$executeRaw`
      DELETE FROM "PortfolioItem" WHERE "coachProfileId" IN (
        SELECT "id" FROM "CoachProfile" WHERE "userId" = ${userId}
      )
    `;
        await tx.$executeRaw`
      DELETE FROM "SavedCoach" WHERE "coachProfileId" IN (
        SELECT "id" FROM "CoachProfile" WHERE "userId" = ${userId}
      )
    `;
        await tx.$executeRaw`DELETE FROM "CoachProfile" WHERE "userId" = ${userId}`;
      }
      // SavedCoach (as the user who saved)
      await tx.$executeRaw`DELETE FROM "SavedCoach" WHERE "userId" = ${userId}`;

      // CoachSettings, IntakeFormTemplate (have onDelete: Cascade, but be explicit)
      await tx.$executeRaw`DELETE FROM "CoachSettings" WHERE "coachId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "IntakeFormTemplate" WHERE "coachId" = ${userId}`;

      // AI Coach (A02) — synthetic-fixture data today, but purged for both
      // roles: this user may be a client with a profile/plans, and/or (A11,
      // not yet built) hold a reviewer grant that approved plans belonging to
      // other clients. Approvals must go before the rows they reference.
      await tx.$executeRaw`
    DELETE FROM "AiPlanReviewerApproval" WHERE "reviewerGrantId" IN (
      SELECT "id" FROM "AiCoachReviewerGrant" WHERE "userId" = ${userId}
    )
  `;
      await tx.$executeRaw`
    DELETE FROM "AiPlanReviewerApproval" WHERE "planVersionId" IN (
      SELECT "id" FROM "AiPlanVersion" WHERE "clientId" = ${userId}
    )
  `;
      await tx.$executeRaw`DELETE FROM "AiWorkoutSession" WHERE "clientId" = ${userId}`;
      // T-509 — A08a check-in observations and the A06d idempotency ledger.
      // Both relations are onDelete: Cascade (schema.prisma:1077, :1091), so
      // tx.user.delete() below already removes them; these two statements
      // duplicate that cascade deliberately, exactly as CoachSettings and
      // IntakeFormTemplate do at :241-243, so that a later relation change
      // cannot silently leave a purged client's health observations behind.
      // No "deletedAt IS NULL" filter, by design: rows tombstoned by
      // lib/ai-coach/delete-evidence.ts:21 still hold a clientId, a
      // clientEventId and an inputDigest and must be purged, not skipped.
      await tx.$executeRaw`DELETE FROM "AiCheckInObservation" WHERE "clientId" = ${userId}`;
      // S-23 — AiNutritionLog is onDelete: Cascade like the two rows above, and
      // is purged explicitly for the same reason: a client's daily food record
      // is health information, and a later relation change must not be able to
      // leave it behind. No completeness/source filter: a SKIPPED/NONE day is a
      // stored declaration by the client and is purged like any other row.
      await tx.$executeRaw`DELETE FROM "AiNutritionLog" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiOperationReceipt" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiAdjustmentSlot" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiCoachRun" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiPlanActivationAttempt" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiAutomaticPlanApproval" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiProviderBoundaryAudit" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiAutonomyGateDecision" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiNutritionSafetyDecision" WHERE "clientId" = ${userId}`;
      // A10 — must precede AiPlanVersion (outbox FKs to it); receipt only FKs to User.
      await tx.$executeRaw`DELETE FROM "AiPlanAcceptanceOutbox" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiPlanAcceptanceReceipt" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiPlanVersion" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiCoachProviderTransitionReceipt" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiCoachProfile" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiCoachEntitlement" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`UPDATE "AiCoachReviewerGrant" SET "clientIds" = array_remove("clientIds", ${userId}) WHERE ${userId} = ANY("clientIds")`;
      await tx.$executeRaw`DELETE FROM "AiCoachReviewerGrant" WHERE "userId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiCoachOperationalEvent" WHERE "actorUserId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiCoachArtifactLifecycleEvent" WHERE "actorUserId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiCoachLiveLaunchLifecycleEvent" WHERE "actorUserId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiCoachLiveActivationEvent" WHERE "actorUserId" = ${userId}`;
      // The append-only guard on this table (prisma/migrations/20260925000000_ai_coach_access_grant_events)
      // only permits a `clientIds`-only UPDATE while this session flag is set — see the migration comment.
      await tx.$executeRaw`SELECT set_config('steadfast.ai_coach_access_grant_purge', 'true', true)`;
      await tx.$executeRaw`UPDATE "AiCoachAccessGrantEvent" SET "clientIds" = array_remove("clientIds", ${userId}) WHERE ${userId} = ANY("clientIds")`;
      await tx.$executeRaw`DELETE FROM "AiCoachAccessGrantEvent" WHERE "actorUserId" = ${userId} OR "subjectUserId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiCoachGovernanceGrant" WHERE "userId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiSafetyDisclosureEvent" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "AiIntakeDraft" WHERE "clientId" = ${userId}`;
      await tx.$executeRaw`DELETE FROM "ClientCoachingContext" WHERE "clientId" = ${userId}`;

      // Team: just unlink, don't delete the team
      await tx.$executeRaw`UPDATE "User" SET "team_id" = NULL, "team_role" = NULL WHERE "id" = ${userId}`;

      await tx.user.delete({ where: { id: userId } });
      // The migrated SET NULL relation preserves this receipt, with no runtime DDL.
      await tx.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          status: "COMPLETED",
          purgeCompletedAt: new Date(),
          clerkId: null,
          deletionReason: null,
        },
      });
    },
    { timeout: 60000 }
  );
}

async function cleanupStorage(userId: string, profilePhotoPath: string | null) {
  const supabase = createServiceClient();
  const objects = new Map<string, Set<string>>();
  const add = (bucket: string, path: string | null | undefined) => {
    if (!path) return;
    const paths = objects.get(bucket) ?? new Set<string>();
    paths.add(path);
    objects.set(bucket, paths);
  };
  add("profile-photos", profilePhotoPath);
  const profile = await db.coachProfile.findUnique({
    where: { userId },
    select: { bannerPhotoPath: true },
  });
  add("profile-photos", profile?.bannerPhotoPath);
  const photos = await db.checkInPhoto.findMany({
    where: { checkIn: { clientId: userId } },
    select: { storagePath: true },
  });
  for (const photo of photos) add("check-in-photos", photo.storagePath);
  const uploads = await db.mealPlanUpload.findMany({
    where: { OR: [{ coachId: userId }, { clientId: userId }] },
    select: { storageBucket: true, storagePath: true },
  });
  const workouts = await db.workoutImport.findMany({
    where: { OR: [{ coachId: userId }, { clientId: userId }] },
    select: { storageBucket: true, storagePath: true },
  });
  for (const upload of [...uploads, ...workouts]) add(upload.storageBucket, upload.storagePath);
  const portfolio = await db.portfolioItem.findMany({
    where: { coachProfile: { userId } },
    select: { mediaPath: true },
  });
  for (const item of portfolio) add("portfolio-media", item.mediaPath);
  const testimonials = await db.testimonial.findMany({
    where: { OR: [{ coachId: userId }, { clientId: userId }] },
    select: { images: true },
  });
  for (const item of testimonials) for (const path of item.images) add("testimonial-images", path);
  const docs = await db.coachDocument.findMany({
    where: { coachId: userId },
    select: { filePath: true },
  });
  for (const doc of docs) add("coach-documents", doc.filePath);
  const signedDocs = await db.intakePacketDocument.findMany({
    where: {
      intakePacket: {
        coachingRequest: { OR: [{ prospectId: userId }, { coachProfile: { userId } }] },
      },
    },
    select: { uploadedSignedFilePath: true },
  });
  for (const doc of signedDocs) add("coach-documents", doc.uploadedSignedFilePath);
  // CB09: enqueue every path durably before attempting deletion. If the
  // immediate attempt below fails partway, the outbox sweep can finish the
  // job later instead of the reference existing nowhere but this
  // in-memory Map.
  await enqueueStorageCleanup(
    [...objects.entries()].flatMap(([bucket, paths]) =>
      [...paths].map((storagePath) => ({ bucket, storagePath, reason: "account-deletion-purge" }))
    )
  );

  for (const [bucket, paths] of objects) {
    const all = [...paths];
    for (let i = 0; i < all.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(all.slice(i, i + 100));
      if (error) throw new Error(`Storage cleanup failed for ${bucket}: ${error.message}`);
    }
  }
}
