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

  // Try to find the user in the DB
  const existing = await db.user.findUnique({ where: { clerkId: userId } });
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
  if (newUser.isClient) {
    const unhandledRequests = await db.coachingRequest.findMany({
      where: {
        prospectEmail: email.toLowerCase(),
        status: "APPROVED",
        prospectId: null,
      },
      include: {
        coachProfile: true,
      },
    });

    for (const req of unhandledRequests) {
      const existingConnection = await db.coachClient.findUnique({
        where: {
          coachId_clientId: { coachId: req.coachProfile.userId, clientId: newUser.id },
        },
      });

      if (!existingConnection) {
        await db.coachClient.create({
          data: {
            coachId: req.coachProfile.userId,
            clientId: newUser.id,
            coachNotes: `Converted from marketplace request.`,
          },
        });
      }

      await db.coachingRequest.update({
        where: { id: req.id },
        data: { prospectId: newUser.id },
      });
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
