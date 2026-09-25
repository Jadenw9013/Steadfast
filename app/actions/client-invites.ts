"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { acceptClientInviteForUser } from "@/lib/activation";
import { sendEmail } from "@/lib/email/sendEmail";
import { currentUser } from "@clerk/nextjs/server";

const sendInviteSchema = z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
});

export async function sendClientInvite(input: unknown) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const parsed = sendInviteSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid name or email." };

    const { name, email } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    // Check for duplicate pending invite to same email by this coach
    const existing = await db.clientInvite.findFirst({
        where: { coachId: user.id, email: normalizedEmail, status: "PENDING" },
    });
    if (existing) return { error: "You already have a pending invite for this email." };

    // 7-day expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invite = await db.clientInvite.create({
        data: {
            coachId: user.id,
            email: normalizedEmail,
            name,
            expiresAt,
        },
    });

    // Send invite email
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";
    const inviteUrl = `${appUrl}/invite/${invite.inviteToken}`;
    const coachName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Your coach";

    try {
        await sendEmail({
            to: normalizedEmail,
            subject: `${coachName} invited you to Steadfast`,
            text: `Hi ${name},\n\n${coachName} has invited you to join them on Steadfast — a structured coaching platform for training and nutrition.\n\nAccept your invite and create your account here:\n${inviteUrl}\n\nThis link expires in 7 days.\n\n—\nSteadfast`,
        });
    } catch { /* email failure must not block — coach can resend */ }

    revalidatePath("/coach/clients");
    return { success: true, inviteToken: invite.inviteToken };
}

export async function redeemInvite(
    token: string,
    options: { confirmDifferentEmail?: boolean } = {},
): Promise<
    | { success: true; coachName: string | null }
    | {
          confirmationRequired: true;
          error: string;
          invitedEmailHint: string;
          signedInAs: string;
          coachName: string | null;
      }
    | { error: string }
> {
    const user = await getCurrentDbUser();

    const invite = await db.clientInvite.findUnique({ where: { inviteToken: token } });
    if (!invite) return { error: "Invite not found." };

    // Clerk's Backend API is network I/O; resolved here, outside
    // acceptClientInviteForUser's transaction, and passed in as data.
    const clerkUser = await currentUser();

    const result = await acceptClientInviteForUser(invite, user, {
        accountEmailAddresses: clerkUser?.emailAddresses ?? null,
        confirmDifferentEmail: options.confirmDifferentEmail,
    });

    if (!result.success) {
        if (result.confirmationRequired) {
            return {
                confirmationRequired: true,
                error: result.error,
                invitedEmailHint: result.invitedEmailHint,
                signedInAs: result.signedInAs,
                coachName: result.coachName,
            };
        }
        return { error: result.error };
    }
    return { success: true, coachName: result.coachName };
}

export async function getInviteDetails(token: string) {
    const invite = await db.clientInvite.findUnique({
        where: { inviteToken: token },
        select: {
            name: true,
            email: true,
            status: true,
            expiresAt: true,
            coach: { select: { firstName: true, lastName: true, coachProfile: { select: { headline: true, slug: true } } } },
        },
    });
    return invite;
}
