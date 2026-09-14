import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sendEmail";
import type { ClientInvite, Prisma } from "@/app/generated/prisma/client";
import { isAiCoachEnrollmentEnabled } from "@/lib/flags/ai-coach";

type DbClient = typeof db | Prisma.TransactionClient;

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
    // The relationship write and the ClientCoachingContext reconciliation
    // (A01/CB06) commit atomically — a crash between them must never leave
    // context pointing at a relationship that doesn't exist, or vice versa.
    await db.$transaction(async (tx) => {
        if (!existingConn) {
            await tx.coachClient.create({
                data: { coachId: invite.coachId, clientId: user.id, coachNotes: "Joined via invite." },
            });
        }
        await reconcileCoachingContextForClient(tx, user.id);
        await tx.clientInvite.update({ where: { id: invite.id }, data: { status: "ACCEPTED" } });
        if (invite.requestId) {
            await tx.coachingRequest.update({
                where: { id: invite.requestId },
                data: { prospectId: user.id, status: "ACCEPTED" },
            }).catch(() => {});
        }
    });

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

// ── ClientCoachingContext — the sole current-provider authority (A01/CB06) ────

/**
 * Recomputes ClientCoachingContext from the client's actual current
 * CoachClient rows. Call this inside the SAME transaction as any write
 * that creates or deletes a CoachClient row — it is the only place that
 * decides mode/activeCoachClientId, so every relationship writer stays
 * consistent by construction instead of by convention.
 *
 * Never silently overwrites an already-ambiguous account
 * (resolutionRequired) or an AI-enrolled one — those transitions have
 * their own explicit, consent-bound paths and must not be clobbered by a
 * legacy human-relationship change happening elsewhere (e.g. an old,
 * no-longer-relevant CoachClient row being cleaned up after AI
 * enrollment).
 */
export async function reconcileCoachingContextForClient(tx: DbClient, clientId: string): Promise<void> {
    const existing = await tx.clientCoachingContext.findUnique({ where: { clientId } });
    if (existing?.resolutionRequired || existing?.mode === "AI") return;

    const relationships = await tx.coachClient.findMany({
        where: { clientId },
        select: { id: true },
        orderBy: { createdAt: "asc" },
    });

    if (relationships.length <= 1) {
        const mode = relationships.length === 1 ? "HUMAN" : "NONE";
        const activeCoachClientId = relationships[0]?.id ?? null;
        await tx.clientCoachingContext.upsert({
            where: { clientId },
            create: { clientId, mode, activeCoachClientId, revision: 1 },
            update: { mode, activeCoachClientId, revision: { increment: 1 }, resolutionRequired: false },
        });
    } else {
        // More than one CoachClient row for this client — not possible under
        // normal application flow (verified zero occurrences at the A01
        // migration), but never guess which one is "active" if it happens.
        await tx.clientCoachingContext.upsert({
            where: { clientId },
            create: { clientId, mode: "HUMAN", activeCoachClientId: null, revision: 1, resolutionRequired: true },
            update: { resolutionRequired: true },
        });
    }
}

export type EnrollInAiCoachingResult =
    | { success: true }
    | { success: false; error: string };

/**
 * The AI-enrollment transition (A01). Shares the same lock-order and
 * single-authority discipline as the human acceptance path: verified
 * entitlement, the enrollment flag checked server-side (never trusted from
 * the client), and a clean starting context (NONE, not ambiguous) — a
 * human-coached client must explicitly leave that relationship first
 * (docs/ai-coach/05 — "A human-coached applicant must explicitly complete
 * the provider transition before AI activation"), this function does not
 * itself sever one.
 */
export async function enrollInAiCoaching(clientId: string): Promise<EnrollInAiCoachingResult> {
    if (!isAiCoachEnrollmentEnabled()) {
        return { success: false, error: "AI coaching is not available yet." };
    }

    const entitlement = await db.aiCoachEntitlement.findUnique({ where: { clientId } });
    if (!entitlement || entitlement.revokedAt || (entitlement.expiresAt && entitlement.expiresAt < new Date())) {
        return { success: false, error: "This account is not invited to AI coaching." };
    }

    const context = await db.clientCoachingContext.findUnique({ where: { clientId } });
    if (context?.resolutionRequired) {
        return { success: false, error: "This account needs manual review before enrollment." };
    }
    if (context?.mode === "AI") {
        return { success: true }; // already enrolled — idempotent
    }
    if (context?.mode === "HUMAN") {
        return { success: false, error: "Transition away from your current coach before enrolling in AI coaching." };
    }

    await db.$transaction(async (tx) => {
        await tx.aiCoachProfile.upsert({
            where: { clientId },
            create: { clientId },
            update: {},
        });
        await tx.clientCoachingContext.upsert({
            where: { clientId },
            create: { clientId, mode: "AI", activeCoachClientId: null, revision: 1 },
            update: { mode: "AI", activeCoachClientId: null, revision: { increment: 1 } },
        });
    });

    return { success: true };
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
