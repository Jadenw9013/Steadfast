import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import type { Roles } from "@/types/globals.d";

export async function checkRole(role: Roles): Promise<boolean> {
  const { sessionClaims } = await auth();
  return sessionClaims?.metadata?.role === role;
}

/**
 * Generates a cryptographically secure 6-character coach code.
 */
export function generateCoachCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const randomValues = new Uint32Array(6);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (v) => chars[v % chars.length]).join("");
}

// ── Safe user select — excludes Json columns that crash adapter-pg ───────────
const SAFE_USER_SELECT = {
  id: true,
  clerkId: true,
  email: true,
  firstName: true,
  lastName: true,
  profilePhotoPath: true,
  clientBio: true,
  fitnessGoal: true,
  activeRole: true,
  isCoach: true,
  isClient: true,
  phoneNumber: true,
  apnsToken: true,
  smsOptIn: true,
  smsMealPlanUpdates: true,
  smsDailyCheckInReminder: true,
  smsCoachMessages: true,
  smsCheckInFeedback: true,
  smsCheckInReminderTime: true,
  smsClientCheckIns: true,
  smsMissedCheckInAlerts: true,
  smsClientMessages: true,
  smsNewClientSignups: true,
  smsMissedCheckInAlertTime: true,
  emailCheckInReminders: true,
  emailMealPlanUpdates: true,
  emailCoachMessages: true,
  emailClientCheckIns: true,
  emailClientMessages: true,
  emailCoachingRequests: true,
  pushMealPlanUpdates: true,
  pushCheckInReminders: true,
  pushCoachMessages: true,
  pushClientCheckIns: true,
  pushClientMessages: true,
  pushCoachingRequests: true,
  defaultNotifyOnPublish: true,
  checkInDaysOfWeek: true,
  // cadenceConfig: EXCLUDED — Json column crashes adapter-pg
  timezone: true,
  teamId: true,
  teamRole: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function getCurrentDbUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Try to find the user in the DB — use select to avoid Json columns (adapter-pg safe)
  const existing = await db.user.findUnique({
    where: { clerkId: userId },
    select: SAFE_USER_SELECT,
  });
  if (existing) return existing;

  // JIT fallback: create the user if webhook hasn't fired yet
  const clerkUser = await currentUser();
  if (!clerkUser) throw new Error("Not authenticated");

  const email = clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("No email found on Clerk user");

  const isCoach =
    (clerkUser.publicMetadata?.role as string)?.toUpperCase() === "COACH";
  const activeRole = isCoach ? "COACH" : "CLIENT" as const;

  const newUser = await db.user.upsert({
    where: { clerkId: userId },
    update: {
      email,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      activeRole,
      isCoach,
      isClient: !isCoach,
    },
    create: {
      clerkId: userId,
      email,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      activeRole,
      isCoach,
      isClient: !isCoach,
    },
    select: SAFE_USER_SELECT,
  });

  // Welcome email for new clients (fire-and-forget)
  if (newUser.isClient) {
    try {
      const { sendEmail } = await import("@/lib/email/sendEmail");
      const { welcomeEmail } = await import("@/lib/email/templates");
      const welcomeMsg = welcomeEmail(newUser.firstName || "there");
      sendEmail({ to: email, ...welcomeMsg }).catch(console.error);
    } catch { /* email failure must not break auth flow */ }
  }

  // Process any approved marketplace requests pending for this email
  // Use raw SQL to avoid adapter-pg crash (CoachingRequest has intakeAnswers Json)
  if (newUser.isClient) {
    try {
      const unhandledRequests = await db.$queryRawUnsafe<Array<{
        id: string; coachProfileId: string;
      }>>(
        `SELECT cr."id", cr."coachProfileId"
         FROM "CoachingRequest" cr
         WHERE cr."prospectEmail" = $1
           AND cr."status" IN ('APPROVED','ACCEPTED')
           AND cr."prospectId" IS NULL`, email.toLowerCase()
      );

      for (const req of unhandledRequests) {
        // Look up the coach's userId from their coachProfile
        const coachProfile = await db.coachProfile.findUnique({
          where: { id: req.coachProfileId },
          select: { userId: true },
        });
        if (!coachProfile) continue;

        const existingConnection = await db.coachClient.findUnique({
          where: {
            coachId_clientId: { coachId: coachProfile.userId, clientId: newUser.id },
          },
        });

        if (!existingConnection) {
          await db.coachClient.create({
            data: {
              coachId: coachProfile.userId,
              clientId: newUser.id,
              coachNotes: `Converted from marketplace request.`,
            },
          });
        }

        await db.$executeRawUnsafe(
          `UPDATE "CoachingRequest" SET "prospectId" = $1 WHERE "id" = $2`,
          newUser.id, req.id
        );
      }
    } catch (err) {
      console.error("[getCurrentDbUser] Failed to process pending requests:", err);
      // Don't block auth flow
    }
  }

  return newUser;
}

/**
 * @deprecated Coach codes have been replaced by the invite + request system.
 * This function is a no-op stub kept for backward compatibility during rollout.
 */
export async function ensureCoachCode(_userId: string): Promise<string> {
  return "";
}
