import { db } from "@/lib/db";

/**
 * Get the intake form submission for a coaching request.
 */
export async function getIntakeSubmission(requestId: string) {
    return db.clientFormSubmission.findUnique({
        where: { coachingRequestId: requestId },
    });
}

/**
 * Get a coaching request for the intake session page.
 * Verifies request exists and belongs to the coach.
 */
export async function getCoachingRequestForIntake(requestId: string, coachUserId: string) {
    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: {
            id: true,
            prospectName: true,
            prospectEmailAddr: true,
            consultationStage: true,
            intakeAnswers: true,
            coachProfile: { select: { userId: true } },
            formSubmission: true,
        },
    });

    if (!request || request.coachProfile.userId !== coachUserId) return null;
    return request;
}

export async function getIntakePacketByToken(token: string) {
    const packet = await db.intakePacket.findUnique({
        where: { token },
        include: {
            coachingRequest: {
                select: {
                    id: true,
                    prospectName: true,
                    consultationStage: true,
                    coachProfile: {
                        select: {
                            user: { select: { id: true, firstName: true, lastName: true } },
                        },
                    },
                },
            },
            documents: {
                orderBy: { sortOrder: "asc" },
                include: {
                    coachDocument: { select: { id: true, title: true, type: true, content: true, filePath: true, fileName: true, fileType: true } },
                },
            },
        },
    });

    if (!packet) return null;

    // Load coach's intake form template
    const template = await db.intakeFormTemplate.findUnique({
        where: { coachId: packet.coachingRequest.coachProfile.user.id },
    });

    return { packet, template };
}

export async function getIntakePacketForReview(requestId: string, coachUserId: string) {
    const packet = await db.intakePacket.findFirst({
        where: {
            coachingRequestId: requestId,
            coachingRequest: { coachProfile: { userId: coachUserId } },
        },
        include: {
            coachingRequest: { select: { id: true, prospectName: true, consultationStage: true } },
            documents: {
                orderBy: { sortOrder: "asc" },
                include: {
                    coachDocument: { select: { id: true, title: true, type: true, content: true, fileName: true } },
                    signature: true,
                },
            },
        },
    });

    return packet;
}
