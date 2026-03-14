"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { sendEmail } from "@/lib/email/sendEmail";

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

export async function redeemInvite(token: string) {
    const user = await getCurrentDbUser();

    const invite = await db.clientInvite.findUnique({
        where: { inviteToken: token },
        include: { coach: { select: { id: true, firstName: true } } },
    });

    if (!invite) return { error: "Invite not found." };
    if (invite.status !== "PENDING") return { error: "This invite has already been used." };
    if (invite.expiresAt < new Date()) {
        await db.clientInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
        return { error: "This invite link has expired. Ask your coach to send a new one." };
    }

    // Verify the invited email matches the signed-in user
    if (invite.email !== user.email.toLowerCase()) {
        return { error: "This invite was sent to a different email address." };
    }

    // Check for existing coach relationship
    const existingConn = await db.coachClient.findUnique({
        where: { coachId_clientId: { coachId: invite.coachId, clientId: user.id } },
    });

    if (!existingConn) {
        await db.coachClient.create({
            data: { coachId: invite.coachId, clientId: user.id, coachNotes: "Joined via direct invite." },
        });
    }

    await db.clientInvite.update({ where: { id: invite.id }, data: { status: "ACCEPTED" } });

    return { success: true, coachName: invite.coach.firstName };
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
