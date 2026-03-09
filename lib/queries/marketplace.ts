import { db } from "@/lib/db";
import { getCurrentDbUser } from "@/lib/auth/roles";

export async function getPublishedCoaches() {
    return db.coachProfile.findMany({
        where: { isPublished: true },
        include: {
            user: {
                select: { firstName: true, lastName: true, profilePhotoPath: true },
            },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function getCoachProfileBySlug(slug: string) {
    return db.coachProfile.findUnique({
        where: { slug, isPublished: true },
        include: {
            user: {
                select: { firstName: true, lastName: true, profilePhotoPath: true },
            },
            portfolioItems: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function getMyCoachProfile() {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    return db.coachProfile.findUnique({
        where: { userId: user.id },
        include: {
            portfolioItems: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });
}

export async function getMyCoachingRequests(coachProfileId: string) {
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    // Additional check to verify ownership of the profile
    const profile = await db.coachProfile.findUnique({
        where: { id: coachProfileId }
    });

    if (!profile || profile.userId !== user.id) {
        throw new Error("Unauthorized");
    }

    return db.coachingRequest.findMany({
        where: { coachProfileId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            prospectName: true,
            prospectEmail: true,
            status: true,
            intakeAnswers: true,
            createdAt: true,
            prospectId: true,
            inviteLastSentAt: true,
            inviteSendCount: true,
        },
    });
}
