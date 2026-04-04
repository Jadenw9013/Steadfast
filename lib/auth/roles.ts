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

export async function getCurrentDbUser() {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  // Raw SQL: User model has cadenceConfig Json? which crashes adapter-pg
  // Must alias @map columns: role→activeRole, team_id→teamId, team_role→teamRole
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT *, "role" AS "activeRole", "team_id" AS "teamId", "team_role" AS "teamRole"
     FROM "User" WHERE "clerkId" = $1 LIMIT 1`, userId
  );
  const existing = rows[0] ?? null;

  if (existing) {
    // Parse cadenceConfig from JSON string if needed
    if (typeof existing.cadenceConfig === "string") {
      try { existing.cadenceConfig = JSON.parse(existing.cadenceConfig); } catch { existing.cadenceConfig = null; }
    }
    return existing as ReturnType_getCurrentDbUser;
  }

  // JIT fallback: create the user if webhook hasn't fired yet
  const clerkUser = await currentUser();
  if (!clerkUser) throw new Error("Not authenticated");

  const email = clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("No email found on Clerk user");

  const isCoach =
    (clerkUser.publicMetadata?.role as string)?.toUpperCase() === "COACH";
  const activeRole = isCoach ? "COACH" : "CLIENT" as const;

  // Use raw SQL for upsert to avoid adapter-pg crash
  await db.$executeRawUnsafe(
    `INSERT INTO "User" ("id", "clerkId", "email", "firstName", "lastName", "role", "isCoach", "isClient", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT ("clerkId") DO UPDATE SET
       "email" = $2, "firstName" = $3, "lastName" = $4, "role" = $5, "isCoach" = $6, "isClient" = $7, "updatedAt" = NOW()`,
    userId, email, clerkUser.firstName, clerkUser.lastName, activeRole, isCoach, !isCoach
  );

  // Re-fetch the user via raw SQL
  const newRows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "User" WHERE "clerkId" = $1 LIMIT 1`, userId
  );
  const newUser = newRows[0] as ReturnType_getCurrentDbUser;
  if (!newUser) throw new Error("Failed to create user");

  // Parse cadenceConfig from JSON string if needed
  if (typeof newUser.cadenceConfig === "string") {
    try { (newUser as Record<string, unknown>).cadenceConfig = JSON.parse(newUser.cadenceConfig as unknown as string); } catch { (newUser as Record<string, unknown>).cadenceConfig = null; }
  }

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
        const coachProfile = await db.coachProfile.findUnique({
          where: { id: req.coachProfileId },
          select: { userId: true },
        });
        if (!coachProfile) continue;

        const existingConnection = await db.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "CoachClient" WHERE "coachId" = $1 AND "clientId" = $2 LIMIT 1`,
          coachProfile.userId, newUser.id
        );

        if (!existingConnection.length) {
          await db.$executeRawUnsafe(
            `INSERT INTO "CoachClient" ("id", "coachId", "clientId", "coachNotes", "createdAt")
             VALUES (gen_random_uuid()::text, $1, $2, 'Converted from marketplace request.', NOW())`,
            coachProfile.userId, newUser.id
          );
        }

        await db.$executeRawUnsafe(
          `UPDATE "CoachingRequest" SET "prospectId" = $1 WHERE "id" = $2`,
          newUser.id, req.id
        );
      }
    } catch (err) {
      console.error("[getCurrentDbUser] Failed to process pending requests:", err);
    }
  }

  return newUser;
}

// Return type for getCurrentDbUser (matches User model minus Prisma type wrapper)
type ReturnType_getCurrentDbUser = {
  id: string;
  clerkId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePhotoPath: string | null;
  clientBio: string | null;
  fitnessGoal: string | null;
  activeRole: string;
  isCoach: boolean;
  isClient: boolean;
  phoneNumber: string | null;
  apnsToken: string | null;
  smsOptIn: boolean;
  smsMealPlanUpdates: boolean;
  smsDailyCheckInReminder: boolean;
  smsCoachMessages: boolean;
  smsCheckInFeedback: boolean;
  smsCheckInReminderTime: string;
  smsClientCheckIns: boolean;
  smsMissedCheckInAlerts: boolean;
  smsClientMessages: boolean;
  smsNewClientSignups: boolean;
  smsMissedCheckInAlertTime: string;
  emailCheckInReminders: boolean;
  emailMealPlanUpdates: boolean;
  emailCoachMessages: boolean;
  emailClientCheckIns: boolean;
  emailClientMessages: boolean;
  emailCoachingRequests: boolean;
  pushMealPlanUpdates: boolean;
  pushCheckInReminders: boolean;
  pushCoachMessages: boolean;
  pushClientCheckIns: boolean;
  pushClientMessages: boolean;
  pushCoachingRequests: boolean;
  defaultNotifyOnPublish: boolean;
  checkInDaysOfWeek: number[];
  cadenceConfig: unknown;
  timezone: string;
  teamId: string | null;
  teamRole: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * @deprecated Coach codes have been replaced by the invite + request system.
 * This function is a no-op stub kept for backward compatibility during rollout.
 */
export async function ensureCoachCode(_userId: string): Promise<string> {
  return "";
}
