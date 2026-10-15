import { db } from "@/lib/db";

/**
 * Pending coach invitations addressed to this exact verified email — the
 * client must explicitly accept one before any CoachClient relationship is
 * created (CB01). See lib/activation.ts for the single acceptance service.
 */
export async function getMyPendingCoachInvites(email: string) {
    return db.clientInvite.findMany({
        where: {
            email: email.toLowerCase(),
            status: "PENDING",
            expiresAt: { gt: new Date() },
        },
        select: {
            id: true,
            inviteToken: true,
            createdAt: true,
            coach: {
                select: {
                    firstName: true,
                    lastName: true,
                    coachProfile: { select: { headline: true, slug: true } },
                },
            },
        },
        orderBy: { createdAt: "desc" },
    });
}
