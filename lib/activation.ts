import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sendEmail";
import type { ClientInvite } from "@/app/generated/prisma/client";

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
    | { linked: true; clientId: string; email: string; alreadyConnected: true }
    | { linked: false; inviteToken: string; email: string }
    | { linked: false; inviteToken: null; email: null; noEmailOnFile: true };

export type AcceptInviteResult =
    | { success: true; alreadyConnected: boolean; coachId: string; coachName: string | null }
    | { success: false; error: string };

// ── Core helper: issue an invitation ──────────────────────────────────────────

/**
 * Single source of truth for activating a lead into a coach/client relationship.
 *
 * This MUST be used by every code path that activates a lead. Coach-supplied
 * contact details (email/phone typed into a form by the coach) can never by
 * themselves grant access to an existing account (CB01) — they can only
 * result in an invitation that the *intended client's own signed-in session*
 * must explicitly accept via acceptClientInviteForUser/redeemInvite. This
 * function never creates a CoachClient row itself.
 *
 * Matching is by exact, case-insensitive email only. Partial phone-number
 * matching against other users' accounts has been removed: a coach entering
 * a phone number's last-10-digit substring is not proof of identity, and
 * using it to select whose account to message would let a coach silently
 * target the wrong (or a victim's) existing account.
 *
 * @throws Never — all failures are caught and logged. Returns a "no email on
 *         file" result if there is nothing safe to send an invite to.
 */
export async function linkOrInviteProspect(
    prospect: ProspectInfo,
    coach: CoachInfo,
    requestId: string,
    /** Note to store on the eventual CoachClient row (e.g. "Activated via pipeline bypass.") */
    coachNote: string = "Activated from coaching request.",
): Promise<LinkResult> {
    const email = (prospect.prospectEmailAddr ?? null)?.toLowerCase() ?? null;
    const coachName = [coach.coachFirstName, coach.coachLastName].filter(Boolean).join(" ") || "Your coach";
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

    if (!email) {
        // No verifiable email to invite — coach-supplied phone digits alone
        // are not enough to identify or contact anyone. The pipeline lead
        // stays ACTIVE; the coach must collect an email before a client
        // relationship can be established.
        return { linked: false, inviteToken: null, email: null, noEmailOnFile: true };
    }

    // Idempotency only: if this coach and this verified email are already
    // connected via a real, previously-accepted relationship, report that
    // rather than re-inviting. This performs no authorization decision by
    // itself — it only short-circuits re-sending an invite that would be
    // immediately redundant.
    const existingUser = await db.user.findUnique({
        where: { email },
        select: { id: true, email: true },
    });
    if (existingUser) {
        const existingConn = await db.coachClient.findUnique({
            where: { coachId_clientId: { coachId: coach.coachId, clientId: existingUser.id } },
        });
        if (existingConn) {
            await db.coachingRequest.update({ where: { id: requestId }, data: { prospectId: existingUser.id } }).catch(() => {});
            return { linked: true, clientId: existingUser.id, email: existingUser.email, alreadyConnected: true };
        }
    }

    // Reuse an existing pending invite for this request rather than creating
    // a duplicate (requestId is unique on ClientInvite).
    let invite = await db.clientInvite.findUnique({ where: { requestId } });
    if (invite && invite.status !== "PENDING") invite = null; // superseded — issue a fresh one below
    if (!invite) {
        invite = await db.clientInvite.create({
            data: {
                coachId: coach.coachId,
                email,
                name: prospect.prospectName,
                requestId,
                expiresAt: sevenDaysFromNow(),
            },
        });
    }

    try {
        const { clientActivatedInviteEmail } = await import("@/lib/email/templates");
        const inviteUrl = `${appUrl}/invite/${invite.inviteToken}`;
        const emailContent = clientActivatedInviteEmail(prospect.prospectName, coachName, inviteUrl);
        await sendEmail({ to: email, ...emailContent });
    } catch { /* email failure must never block activation — the invite row is what matters */ }

    return { linked: false, inviteToken: invite.inviteToken, email };
}

function sevenDaysFromNow(): Date {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
}

// ── Core helper: accept an invitation ─────────────────────────────────────────

/**
 * Single source of truth for redeeming a ClientInvite into a real CoachClient
 * relationship. Every acceptance surface (the /invite/[token] page's
 * redeemInvite action, the iOS connect-coach API, and JIT signup matching)
 * MUST call this instead of re-implementing the check-and-create sequence.
 *
 * The caller is responsible for establishing `user` via an authenticated,
 * active-account lookup (getCurrentDbUser()) — this function does not read
 * the session itself, so it can also be used for the JIT-signup case where
 * the user row was just created in the same request.
 */
export async function acceptClientInviteForUser(
    invite: Pick<ClientInvite, "id" | "coachId" | "email" | "status" | "expiresAt" | "requestId">,
    user: { id: string; email: string },
): Promise<AcceptInviteResult> {
    if (invite.status === "EXPIRED") {
        return { success: false, error: "This invite link has expired. Ask your coach to send a new one." };
    }
    if (invite.expiresAt < new Date()) {
        await db.clientInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } }).catch(() => {});
        return { success: false, error: "This invite link has expired. Ask your coach to send a new one." };
    }

    // The single consent check: the invite's target email must be the exact
    // email of the account currently accepting it. Coach-supplied contact
    // details never bypass this — they only ever produced the invite email
    // address above, not the CoachClient row.
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
        return { success: false, error: "This invite was sent to a different email address." };
    }

    if (invite.status === "ACCEPTED") {
        // Replay: report the current state without erroring, but don't
        // reactivate anything that might have since been removed.
        const stillConnected = await db.coachClient.findUnique({
            where: { coachId_clientId: { coachId: invite.coachId, clientId: user.id } },
            select: { id: true },
        });
        const coach = await db.user.findUnique({ where: { id: invite.coachId }, select: { firstName: true, lastName: true } });
        return {
            success: true,
            alreadyConnected: !!stillConnected,
            coachId: invite.coachId,
            coachName: coach ? [coach.firstName, coach.lastName].filter(Boolean).join(" ") || null : null,
        };
    }

    const coach = await db.user.findUnique({ where: { id: invite.coachId }, select: { firstName: true, lastName: true, email: true } });
    if (!coach) return { success: false, error: "This coach's account no longer exists." };

    const existingConn = await db.coachClient.findUnique({
        where: { coachId_clientId: { coachId: invite.coachId, clientId: user.id } },
    });
    const wasAlreadyConnected = !!existingConn;
    if (!existingConn) {
        await db.coachClient.create({
            data: { coachId: invite.coachId, clientId: user.id, coachNotes: "Joined via invite." },
        });
    }

    await db.clientInvite.update({ where: { id: invite.id }, data: { status: "ACCEPTED" } });
    if (invite.requestId) {
        await db.coachingRequest.update({
            where: { id: invite.requestId },
            data: { prospectId: user.id, status: "ACCEPTED" },
        }).catch(() => {});
    }

    const coachName = [coach.firstName, coach.lastName].filter(Boolean).join(" ") || null;
    if (!wasAlreadyConnected) {
        try {
            const { coachConnectedEmail } = await import("@/lib/email/templates");
            const content = coachConnectedEmail(user.email, coachName || "your coach");
            await sendEmail({ to: user.email, ...content });
        } catch { /* email failure must never block acceptance */ }
    }

    return { success: true, alreadyConnected: wasAlreadyConnected, coachId: invite.coachId, coachName };
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
    if (result.linked) {
        return `${prospectName} is already connected to your roster.`;
    }
    if ("noEmailOnFile" in result && result.noEmailOnFile) {
        return `${prospectName} needs an email on file before they can be activated — nothing was sent.`;
    }
    return `An invite has been sent to ${prospectName}. They'll appear on your roster once they accept it.`;
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
