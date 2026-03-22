import { db } from "@/lib/db";

/**
 * Look up a coaching request by its forms token.
 * Used by the public signature page — no auth required.
 */
export async function getCoachingRequestByToken(token: string) {
    return db.coachingRequest.findUnique({
        where: { formsToken: token },
        select: {
            id: true,
            prospectName: true,
            prospectEmailAddr: true,
            prospectId: true,
            consultationStage: true,
            formsTokenExpiresAt: true,
            formsSignedAt: true,
            formSubmission: {
                select: { id: true, answers: true, status: true },
            },
            coachProfile: {
                select: {
                    userId: true,
                    user: { select: { id: true, firstName: true, lastName: true, email: true } },
                },
            },
        },
    });
}
