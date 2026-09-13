import { db } from "@/lib/db";
import { createServiceClient } from "@/lib/supabase/server";
import { stopAccountBilling } from "./billing";

/** External cleanup is retryable; all database deletes commit together. */
export async function purgeUserAccount(userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } });
  const request = await db.accountDeletionRequest.findUnique({ where: { userId } });
  if (!user || !request || !user.isDeactivated || request.status !== "PURGING" || request.scheduledPurgeAt > new Date()) {
    throw new Error("Account is not eligible for purging");
  }
  await stopAccountBilling(userId, true);
  await db.accountDeletionRequest.update({ where: { id: request.id }, data: { stripeSubscriptionCancelledAt: new Date() } });
  await cleanupStorage(userId, user.profilePhotoPath);
  await db.accountDeletionRequest.update({ where: { id: request.id }, data: { storageCleanedAt: new Date(), clerkId: user.clerkId } });
  // Delete identity before the DB phase, so a DB failure retains all cleanup records.
  // A retry accepts an already-deleted identity, but no other Clerk error.
  if (!request.clerkDeletedAt) {
    const { clerkClient } = await import("@clerk/nextjs/server");
    try { await (await clerkClient()).users.deleteUser(user.clerkId); }
    catch (error) {
      if (!(typeof error === "object" && error !== null && "status" in error && error.status === 404)) throw error;
    }
    await db.accountDeletionRequest.update({ where: { id: request.id }, data: { clerkDeletedAt: new Date() } });
  }

  await db.$transaction(async tx => {
    const receipt = await tx.accountDeletionRequest.findUnique({ where: { id: request.id } });
    if (receipt?.status !== "PURGING") throw new Error("Deletion state changed");

    // Lead data includes identifiable intake answers and signatures, not just a User FK.
    const leads = await tx.coachingRequest.findMany({
      where: { OR: [{ prospectId: userId }, { coachProfile: { userId } },
        { prospectId: null, prospectEmail: { equals: user.email, mode: "insensitive" } }] }, select: { id: true },
    });
    const leadIds = leads.map(lead => lead.id);
    await tx.documentSignature.deleteMany({ where: { intakePacketDocument: { intakePacket: { coachingRequestId: { in: leadIds } } } } });
    await tx.intakePacketDocument.deleteMany({ where: { intakePacket: { coachingRequestId: { in: leadIds } } } });
    await tx.intakePacket.deleteMany({ where: { coachingRequestId: { in: leadIds } } });
    await tx.coachingRequest.deleteMany({ where: { id: { in: leadIds } } });
    await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    await tx.messageReport.deleteMany({ where: { OR: [{ reporterId: userId }, { reportedId: userId }] } });
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
    await tx.$executeRaw`DELETE FROM "ClientIntake" WHERE "coachId" = ${userId}`;
  }

  // --- Shared models (both roles) ---
  await tx.$executeRaw`DELETE FROM "Message" WHERE "senderId" = ${userId} OR "clientId" = ${userId}`;
  await tx.$executeRaw`DELETE FROM "NotificationLog" WHERE "clientId" = ${userId}`;
  await tx.$executeRaw`DELETE FROM "Testimonial" WHERE "coachId" = ${userId} OR "clientId" = ${userId}`;
  await tx.$executeRaw`DELETE FROM "CoachClient" WHERE "coachId" = ${userId} OR "clientId" = ${userId}`;
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

  // Team: just unlink, don't delete the team
  await tx.$executeRaw`UPDATE "User" SET "team_id" = NULL, "team_role" = NULL WHERE "id" = ${userId}`;


    await tx.user.delete({ where: { id: userId } });
    // The migrated SET NULL relation preserves this receipt, with no runtime DDL.
    await tx.accountDeletionRequest.update({ where: { id: request.id }, data: {
      status: "COMPLETED", purgeCompletedAt: new Date(), clerkId: null, deletionReason: null,
    } });
  }, { timeout: 60000 });
}

async function cleanupStorage(userId: string, profilePhotoPath: string | null) {
  const supabase = createServiceClient();
  const objects = new Map<string, Set<string>>();
  const add = (bucket: string, path: string | null | undefined) => {
    if (!path) return;
    const paths = objects.get(bucket) ?? new Set<string>();
    paths.add(path); objects.set(bucket, paths);
  };
  add("profile-photos", profilePhotoPath);
  const profile = await db.coachProfile.findUnique({ where: { userId }, select: { bannerPhotoPath: true } });
  add("profile-photos", profile?.bannerPhotoPath);
  const photos = await db.checkInPhoto.findMany({ where: { checkIn: { clientId: userId } }, select: { storagePath: true } });
  for (const photo of photos) add("check-in-photos", photo.storagePath);
  const uploads = await db.mealPlanUpload.findMany({ where: { OR: [{ coachId: userId }, { clientId: userId }] }, select: { storageBucket: true, storagePath: true } });
  const workouts = await db.workoutImport.findMany({ where: { OR: [{ coachId: userId }, { clientId: userId }] }, select: { storageBucket: true, storagePath: true } });
  for (const upload of [...uploads, ...workouts]) add(upload.storageBucket, upload.storagePath);
  const portfolio = await db.portfolioItem.findMany({ where: { coachProfile: { userId } }, select: { mediaPath: true } });
  for (const item of portfolio) add("portfolio-media", item.mediaPath);
  const testimonials = await db.testimonial.findMany({ where: { OR: [{ coachId: userId }, { clientId: userId }] }, select: { images: true } });
  for (const item of testimonials) for (const path of item.images) add("testimonial-images", path);
  const docs = await db.coachDocument.findMany({ where: { coachId: userId }, select: { filePath: true } });
  for (const doc of docs) add("coach-documents", doc.filePath);
  const signedDocs = await db.intakePacketDocument.findMany({
    where: { intakePacket: { coachingRequest: { OR: [{ prospectId: userId }, { coachProfile: { userId } }] } } },
    select: { uploadedSignedFilePath: true },
  });
  for (const doc of signedDocs) add("coach-documents", doc.uploadedSignedFilePath);
  for (const [bucket, paths] of objects) {
    const all = [...paths];
    for (let i = 0; i < all.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(all.slice(i, i + 100));
      if (error) throw new Error(`Storage cleanup failed for ${bucket}: ${error.message}`);
    }
  }
}
