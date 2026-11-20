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
    // Use raw SQL to safely read CoachingRequest with Json columns (adapter-pg safe)
    const rows = await db.$queryRawUnsafe<Array<{
        id: string; prospectName: string; prospectEmailAddr: string | null;
        consultationStage: string; intakeAnswers: Record<string, string>;
        coachProfileId: string;
    }>>(
        `SELECT "id","prospectName","prospectEmailAddr","consultationStage","intakeAnswers","coachProfileId"
         FROM "CoachingRequest" WHERE "id" = $1 LIMIT 1`, requestId
    );
    const request = rows[0] ?? null;
    if (!request) return null;

    // Verify ownership
    const profile = await db.coachProfile.findUnique({ where: { id: request.coachProfileId }, select: { userId: true } });
    if (!profile || profile.userId !== coachUserId) return null;

    // Fetch related formSubmission separately (safe — no Json on CoachingRequest)
    const formSubmission = await db.clientFormSubmission.findUnique({
        where: { coachingRequestId: requestId },
    });

    return {
        ...request,
        coachProfile: { userId: profile.userId },
        formSubmission,
    };
}

export async function getIntakePacketByToken(token: string) {
    const packet = await db.intakePacket.findUnique({
        where: { token, coachingRequest: { consultationStage: { not: "DECLINED" }, coachProfile: { user: { isCoach: true, isDeactivated: false } } } },
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
            coachingRequest: { select: { id: true, prospectName: true, consultationStage: true, prospectEmailAddr: true } },
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

/**
 * Fetch the submitted IntakePacket for a client by matching
 * CoachingRequest.prospectId = clientId in the coach's profile.
 */
export async function getIntakePacketForClient(coachUserId: string, clientId: string) {
    const request = await db.coachingRequest.findFirst({
        where: {
            prospectId: clientId,
            coachProfile: { userId: coachUserId },
            intakePacket: { submittedAt: { not: null } },
        },
        select: {
            id: true,
            intakePacket: {
                select: {
                    id: true,
                    formAnswers: true,
                    submittedAt: true,
                    coachNotes: true,
                },
            },
        },
    });
    return request?.intakePacket ?? null;
}

export async function getSignedUploadUrl(filePath: string): Promise<string> {
    const { getDocumentUrl } = await import("@/lib/supabase/document-storage");
    return getDocumentUrl(filePath);
}
