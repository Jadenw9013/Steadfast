"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { acceptClientInviteForUser } from "@/lib/activation";
import { sendEmail } from "@/lib/email/sendEmail";
import { currentUser } from "@clerk/nextjs/server";
import { randomUUID } from "node:crypto";
import { consumeQuota } from "@/lib/security/quota";
import { reportAnomaly, reportServerError } from "@/lib/observability/report";

const sendInviteSchema = z.object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(254),
});

export async function sendClientInvite(input: unknown) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const parsed = sendInviteSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid name or email." };

    const { name, email } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    let invite;
    try {
        if (!await consumeQuota("coach-invite-total", user.id, 20, 3600) || !await consumeQuota("coach-invite-recipient", `${user.id}:${normalizedEmail}`, 3, 3600)) {
            return { error: "Too many invitation attempts. Please try again later." };
        }
        invite = await db.$transaction(async tx => {
            await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
            const coach = await tx.user.findUnique({ where: { id: user.id }, select: { isCoach: true, isDeactivated: true } });
            if (!coach?.isCoach || coach.isDeactivated) return { error: "This coach account is unavailable." };
            const existing = await tx.clientInvite.findFirst({ where: { coachId: user.id, email: normalizedEmail, status: "PENDING" }, orderBy: { createdAt: "desc" } });
            if (existing) {
                const inviteToken = existing.expiresAt <= new Date() ? randomUUID() : existing.inviteToken;
                const updated = await tx.clientInvite.updateMany({ where: { id: existing.id, status: "PENDING" }, data: { name, expiresAt, inviteToken } });
                if (!updated.count) return { error: "The invite changed. Refresh your client list before sending again." };
                return { inviteToken };
            }
            return tx.clientInvite.create({ data: { coachId: user.id, email: normalizedEmail, name, expiresAt }, select: { inviteToken: true } });
        });
    } catch (error) {
        reportServerError("sf.invite.create_failed", error, { route: "/coach/clients/invite", method: "POST", ids: { coachId: user.id } });
        return { error: "We couldn't prepare the invite. Please try again." };
    }
    if ("error" in invite) return invite;

    // Send invite email
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";
    const inviteUrl = `${appUrl}/invite/${invite.inviteToken}`;
    const coachName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Your coach";

    let emailSent = false;
    try {
        const delivery = await sendEmail({
            to: normalizedEmail,
            subject: `${coachName} invited you to Steadfast`,
            text: `Hi ${name},\n\n${coachName} has invited you to join them on Steadfast — a structured coaching platform for training and nutrition.\n\nAccept your invite and create your account here:\n${inviteUrl}\n\nThis link expires in 7 days.\n\n—\nSteadfast`,
        });
        emailSent = delivery.success;
    } catch { emailSent = false; }
    if (!emailSent) reportAnomaly("sf.invite.email_not_sent", { route: "/coach/clients/invite", ids: { coachId: user.id } });

    revalidatePath("/coach/clients");
    return { success: true, emailSent, inviteToken: invite.inviteToken };
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
