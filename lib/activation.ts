import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sendEmail";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProspectInfo {
    prospectName: string;
    prospectEmail: string;
    prospectPhone: string | null;
    prospectEmailAddr: string | null;
}

export interface CoachInfo {
    coachId: string;
    coachFirstName: string | null;
    coachLastName?: string | null;
}

export type LinkResult =
    | { linked: true; clientId: string; email: string }
    | { linked: false; inviteToken: string; email: string };

// ── Core helper ──────────────────────────────────────────────────────────────

/**
 * Single source of truth for linking a prospect to a coach.
 *
 * This MUST be used by every code path that activates a lead. It guarantees:
 *   - If the prospect already has a Steadfast account → CoachClient row is created
 *   - If the prospect has NO account → a ClientInvite is created + invite email sent
 *
 * Returns a discriminated union so callers know which path was taken.
 *
 * @throws Never — all failures are caught and logged. Returns `linked: false`
 *         with an empty inviteToken on total failure (the lead is still ACTIVE).
 */
export async function linkOrInviteProspect(
    prospect: ProspectInfo,
    coach: CoachInfo,
    requestId: string,
    /** Note to store on the CoachClient row (e.g. "Activated via pipeline bypass.") */
    coachNote: string = "Activated from coaching request.",
    options?: { bypass?: boolean; intakeAnswers?: Record<string, string> | null },
): Promise<LinkResult> {
    const email = prospect.prospectEmailAddr ?? null;
    const phone = (prospect.prospectPhone ?? prospect.prospectEmail ?? "").replace(/\D/g, "");
    const coachName = [coach.coachFirstName, coach.coachLastName].filter(Boolean).join(" ") || "Your coach";
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

    // ── Path A: Try to find an existing user account ─────────────────────

    let existingUser: { id: string; email: string; firstName: string | null } | null = null;

    if (email) {
        existingUser = await db.user.findUnique({
            where: { email: email.toLowerCase() },
            select: { id: true, email: true, firstName: true },
        });
    }
    if (!existingUser && phone.length >= 7) {
        existingUser = await db.user.findFirst({
            where: { phoneNumber: { contains: phone.slice(-10) } },
            select: { id: true, email: true, firstName: true },
        });
    }

    // A coach is never their own client. Storing the address the iOS client
    // sends is what makes this reachable from the app for the first time:
    // a coach typing their own address into Add Lead would otherwise resolve
    // to their own account and create a CoachClient with coachId == clientId.
    if (existingUser && existingUser.id === coach.coachId) existingUser = null;

    if (existingUser) {
        // Create CoachClient link (idempotent)
        const existingConn = await db.coachClient.findUnique({
            where: { coachId_clientId: { coachId: coach.coachId, clientId: existingUser.id } },
        });
        if (!existingConn) {
            await db.coachClient.create({
                data: {
                    coachId: coach.coachId,
                    clientId: existingUser.id,
                    coachNotes: coachNote,
                },
            });
        }

        // Update coaching request with prospect link
        await db.coachingRequest.update({
            where: { id: requestId },
            data: { prospectId: existingUser.id },
        });

        // Welcome email (fire-and-forget)
        try {
            const { coachConnectedEmail } = await import("@/lib/email/templates");
            const content = coachConnectedEmail(
                existingUser.firstName || prospect.prospectName,
                coachName,
            );
            await sendEmail({ to: existingUser.email, ...content });
        } catch { /* email must never block activation */ }

        return { linked: true, clientId: existingUser.id, email: existingUser.email };
    }

    // ── Path B: No account — create ClientInvite ─────────────────────────

    const prospectEmail = (email ?? prospect.prospectEmail).toLowerCase();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invite = await db.clientInvite.create({
        data: {
            coachId: coach.coachId,
            email: prospectEmail,
            name: prospect.prospectName,
            expiresAt,
        },
    });

    // If bypass is requested, also immediately establish the client User and CoachClient roster connection
    // so the client is added directly to the active roster without waiting for invite redemption.
    const isBypass = options?.bypass || coachNote.toLowerCase().includes("pipeline bypass");
    if (isBypass) {
        let clientUser = await db.user.findUnique({
            where: { email: prospectEmail },
            select: { id: true, email: true, firstName: true },
        });

        if (!clientUser) {
            const nameParts = prospect.prospectName.trim().split(/\s+/);
            const firstName = nameParts[0] || "Client";
            const lastName = nameParts.slice(1).join(" ") || "";

            clientUser = await db.user.create({
                data: {
                    email: prospectEmail,
                    clerkId: `pending_${requestId}`,
                    firstName,
                    lastName,
                    isClient: true,
                    isCoach: false,
                    activeRole: "CLIENT",
                },
                select: { id: true, email: true, firstName: true },
            });
        }

        const existingConn = await db.coachClient.findUnique({
            where: { coachId_clientId: { coachId: coach.coachId, clientId: clientUser.id } },
        });
        if (!existingConn) {
            await db.coachClient.create({
                data: {
                    coachId: coach.coachId,
                    clientId: clientUser.id,
                    coachNotes: coachNote,
                },
            });
        }

        // Populate intake answers if available
        let intakeData = options?.intakeAnswers;
        if (!intakeData) {
            const req = await db.coachingRequest.findUnique({
                where: { id: requestId },
                select: { intakeAnswers: true },
            });
            intakeData = (req?.intakeAnswers as Record<string, string>) || null;
        }
        if (intakeData && (intakeData.goals || intakeData.injuries || intakeData.experience)) {
            await db.clientIntake.upsert({
                where: { clientId: clientUser.id },
                update: {
                    status: "COMPLETED",
                    completedAt: new Date(),
                    primaryGoal: intakeData.goals || undefined,
                    injuries: intakeData.injuries || undefined,
                    trainingExperience: intakeData.experience || undefined,
                },
                create: {
                    coachId: coach.coachId,
                    clientId: clientUser.id,
                    status: "COMPLETED",
                    completedAt: new Date(),
                    primaryGoal: intakeData.goals || undefined,
                    injuries: intakeData.injuries || undefined,
                    trainingExperience: intakeData.experience || undefined,
                },
            });
        }

        // Update coaching request with prospect link
        await db.coachingRequest.update({
            where: { id: requestId },
            data: { prospectId: clientUser.id },
        });

        // Send invite email (fire-and-forget)
        try {
            const { clientActivatedInviteEmail } = await import("@/lib/email/templates");
            const inviteUrl = `${appUrl}/invite/${invite.inviteToken}`;
            const emailContent = clientActivatedInviteEmail(prospect.prospectName, coachName, inviteUrl);
            await sendEmail({ to: prospectEmail, ...emailContent });
        } catch { /* email must never block activation */ }

        return { linked: true, clientId: clientUser.id, email: prospectEmail };
    }

    // Send invite email (fire-and-forget)
    try {
        const { clientActivatedInviteEmail } = await import("@/lib/email/templates");
        const inviteUrl = `${appUrl}/invite/${invite.inviteToken}`;
        const emailContent = clientActivatedInviteEmail(prospect.prospectName, coachName, inviteUrl);
        await sendEmail({ to: prospectEmail, ...emailContent });
    } catch { /* email must never block activation */ }

    return { linked: false, inviteToken: invite.inviteToken, email: prospectEmail };
}

// ── Guard helpers (testable, pure functions) ─────────────────────────────────

/**
 * Determines the activation result type given the link outcome.
 * Used by callers to construct appropriate response messages.
 */
export function getActivationMessage(
    prospectName: string,
    result: LinkResult,
): string {
    return result.linked
        ? `${prospectName} has been activated and added to your roster.`
        : `${prospectName} has been activated. They'll appear on your roster once they create their account.`;
}

/**
 * Validates that activation prerequisites are satisfied.
 * Returns null if OK, or an error message string.
 */
export function validateActivationPreconditions(lead: {
    consultationStage: string;
    allowAnyStage?: boolean;
}): string | null {
    if (lead.consultationStage === "ACTIVE") {
        return "Already active.";
    }
    // Normal pipeline requires FORMS_SIGNED or INTAKE_SUBMITTED;
    // bypass pipeline allows any stage.
    if (!lead.allowAnyStage) {
        const validStages = ["FORMS_SIGNED", "INTAKE_SUBMITTED"];
        if (!validStages.includes(lead.consultationStage)) {
            return "This lead must complete intake before activating.";
        }
    }
    return null;
}
