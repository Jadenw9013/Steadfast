/**
 * One-off script to immediately purge a user by email.
 * Usage: node --env-file=.env.local scripts/purge-now.mjs jadenwong777@gmail.com
 */
import pg from "pg";
const { Pool } = pg;

const email = process.argv[2];
if (!email) {
  console.error("Usage: node --env-file=.env.local scripts/purge-now.mjs <email>");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const { rows } = await pool.query(
    `SELECT id, "clerkId", "isCoach", "isClient", "isDeactivated" FROM "User" WHERE email = $1`,
    [email]
  );

  if (rows.length === 0) {
    console.log(`No user found with email ${email}`);
    process.exit(0);
  }

  const user = rows[0];
  const userId = user.id;
  console.log(`Found user: ${userId} (coach=${user.isCoach}, client=${user.isClient}, deactivated=${user.isDeactivated})`);

  if (user.isCoach) {
    await pool.query(`DELETE FROM "DocumentSignature" ds USING "IntakePacketDocument" ipd, "IntakePacket" ip, "CoachingRequest" cr, "CoachProfile" cp WHERE ds."intakePacketDocumentId" = ipd."id" AND ipd."intakePacketId" = ip."id" AND ip."coachingRequestId" = cr."id" AND cr."coachProfileId" = cp."id" AND cp."userId" = $1`, [userId]);
    await pool.query(`DELETE FROM "IntakePacketDocument" ipd USING "IntakePacket" ip, "CoachingRequest" cr, "CoachProfile" cp WHERE ipd."intakePacketId" = ip."id" AND ip."coachingRequestId" = cr."id" AND cr."coachProfileId" = cp."id" AND cp."userId" = $1`, [userId]);
    await pool.query(`DELETE FROM "IntakePacket" ip USING "CoachingRequest" cr, "CoachProfile" cp WHERE ip."coachingRequestId" = cr."id" AND cr."coachProfileId" = cp."id" AND cp."userId" = $1`, [userId]);
    await pool.query(`DELETE FROM "ClientFormSignature" cfs USING "ClientFormSubmission" sub, "CoachingRequest" cr, "CoachProfile" cp WHERE cfs."coachingRequestId" = cr."id" AND cr."coachProfileId" = cp."id" AND cp."userId" = $1`, [userId]);
    await pool.query(`DELETE FROM "ClientFormSubmission" sub USING "CoachingRequest" cr, "CoachProfile" cp WHERE sub."coachingRequestId" = cr."id" AND cr."coachProfileId" = cp."id" AND cp."userId" = $1`, [userId]);
    await pool.query(`DELETE FROM "ConsultationMeeting" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "CoachingRequest" cr USING "CoachProfile" cp WHERE cr."coachProfileId" = cp."id" AND cp."userId" = $1`, [userId]);
  }

  if (user.isClient) {
    await pool.query(`DELETE FROM "CheckInPhoto" WHERE "checkInId" IN (SELECT "id" FROM "CheckIn" WHERE "clientId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "CheckIn" WHERE "clientId" = $1`, [userId]);
    await pool.query(`DELETE FROM "DailyMealCheckoff" WHERE "dailyAdherenceId" IN (SELECT "id" FROM "DailyAdherence" WHERE "clientId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "ExerciseCheckoff" WHERE "dailyAdherenceId" IN (SELECT "id" FROM "DailyAdherence" WHERE "clientId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "DailyAdherence" WHERE "clientId" = $1`, [userId]);
    await pool.query(`DELETE FROM "ExerciseResult" WHERE "clientId" = $1`, [userId]);
    await pool.query(`DELETE FROM "TrainingExercise" WHERE "dayId" IN (SELECT td."id" FROM "TrainingDay" td JOIN "TrainingProgram" tp ON td."programId" = tp."id" WHERE tp."clientId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "TrainingProgramBlock" WHERE "dayId" IN (SELECT td."id" FROM "TrainingDay" td JOIN "TrainingProgram" tp ON td."programId" = tp."id" WHERE tp."clientId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "TrainingProgramCardio" WHERE "programId" IN (SELECT "id" FROM "TrainingProgram" WHERE "clientId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "TrainingDay" WHERE "programId" IN (SELECT "id" FROM "TrainingProgram" WHERE "clientId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "TrainingProgram" WHERE "clientId" = $1`, [userId]);
    await pool.query(`DELETE FROM "MealPlanItem" WHERE "mealPlanId" IN (SELECT "id" FROM "MealPlan" WHERE "clientId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "MealPlan" WHERE "clientId" = $1`, [userId]);
    await pool.query(`DELETE FROM "MacroTarget" WHERE "clientId" = $1`, [userId]);
    await pool.query(`DELETE FROM "OnboardingResponse" WHERE "clientId" = $1`, [userId]);
    await pool.query(`DELETE FROM "ClientIntake" WHERE "clientId" = $1`, [userId]);
    await pool.query(`UPDATE "CoachingRequest" SET "prospectId" = NULL WHERE "prospectId" = $1`, [userId]);
  }

  if (user.isCoach) {
    await pool.query(`DELETE FROM "TrainingTemplateExercise" WHERE "dayId" IN (SELECT td."id" FROM "TrainingTemplateDay" td JOIN "TrainingTemplate" tt ON td."templateId" = tt."id" WHERE tt."coachId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "TrainingTemplateBlock" WHERE "dayId" IN (SELECT td."id" FROM "TrainingTemplateDay" td JOIN "TrainingTemplate" tt ON td."templateId" = tt."id" WHERE tt."coachId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "TrainingTemplateCardio" WHERE "templateId" IN (SELECT "id" FROM "TrainingTemplate" WHERE "coachId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "TrainingTemplateDay" WHERE "templateId" IN (SELECT "id" FROM "TrainingTemplate" WHERE "coachId" = $1)`, [userId]);
    await pool.query(`UPDATE "TrainingProgram" SET "templateSourceId" = NULL WHERE "templateSourceId" IN (SELECT "id" FROM "TrainingTemplate" WHERE "coachId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "TrainingTemplate" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "MealPlanDraft" WHERE "uploadId" IN (SELECT "id" FROM "MealPlanUpload" WHERE "coachId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "MealPlanUpload" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "WorkoutImportDraft" WHERE "importId" IN (SELECT "id" FROM "WorkoutImport" WHERE "coachId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "WorkoutImport" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "PlanSnippet" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "CheckInTemplate" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "FoodLibraryItem" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "CoachDocument" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "OnboardingForm" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "ClientInvite" WHERE "coachId" = $1`, [userId]);
    await pool.query(`DELETE FROM "ClientIntake" WHERE "coachId" = $1`, [userId]);
  }

  await pool.query(`DELETE FROM "Message" WHERE "senderId" = $1`, [userId]);
  await pool.query(`DELETE FROM "NotificationLog" WHERE "clientId" = $1`, [userId]);
  await pool.query(`DELETE FROM "Testimonial" WHERE "coachId" = $1 OR "clientId" = $1`, [userId]);
  await pool.query(`DELETE FROM "CoachClient" WHERE "coachId" = $1 OR "clientId" = $1`, [userId]);
  await pool.query(`DELETE FROM "MealPlanUpload" WHERE "clientId" = $1`, [userId]);

  if (user.isCoach) {
    await pool.query(`DELETE FROM "PortfolioItem" WHERE "coachProfileId" IN (SELECT "id" FROM "CoachProfile" WHERE "userId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "SavedCoach" WHERE "coachProfileId" IN (SELECT "id" FROM "CoachProfile" WHERE "userId" = $1)`, [userId]);
    await pool.query(`DELETE FROM "CoachProfile" WHERE "userId" = $1`, [userId]);
  }
  await pool.query(`DELETE FROM "SavedCoach" WHERE "userId" = $1`, [userId]);
  await pool.query(`DELETE FROM "CoachSettings" WHERE "coachId" = $1`, [userId]);
  await pool.query(`DELETE FROM "IntakeFormTemplate" WHERE "coachId" = $1`, [userId]);
  await pool.query(`UPDATE "User" SET "team_id" = NULL, "team_role" = NULL WHERE "id" = $1`, [userId]);

  await pool.query(`ALTER TABLE "AccountDeletionRequest" DROP CONSTRAINT IF EXISTS "AccountDeletionRequest_userId_fkey"`);
  await pool.query(`DELETE FROM "AccountDeletionRequest" WHERE "userId" = $1`, [userId]);
  await pool.query(`DELETE FROM "User" WHERE "id" = $1`, [userId]);
  await pool.query(`ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID`).catch(() => {});

  console.log(`\n✅ Purged ${email} (${userId})`);
} catch (err) {
  console.error("❌ Purge failed:", err);
  process.exit(1);
} finally {
  await pool.end();
}
