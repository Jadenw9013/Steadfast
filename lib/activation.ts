import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sendEmail";
import type { ClientInvite, Prisma } from "@/app/generated/prisma/client";
import {
  establishRelationshipOrInvite,
  ensureInviteForRequest,
  getActivationMessage as getLeadActivationMessage,
  type LeadIdentity,
} from "@/lib/leads/activate-lead";
import { accountOwnsEmail, normalizeEmailForMatch, maskEmail } from "@/lib/auth/invite-email-match";

type DbClient = typeof db | Prisma.TransactionClient;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProspectInfo {
  prospectName: string;
  prospectEmail: string;
  prospectPhone: string | null;
  prospectEmailAddr: string | null;
  /** Optional so existing callers that construct this by hand keep
   *  compiling. Every real caller already selects and passes this field
   *  through (it is part of the CoachingRequest row); T-978's
   *  establishRelationshipOrInvite uses it as a candidate id alongside an
   *  exact email match. */
  prospectId?: string | null;
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

/** Clerk's email-address shape, structurally identical to the type
 *  lib/auth/invite-email-match.ts already declares. */
export type AccountEmailAddress = {
  id: string;
  emailAddress: string;
  verification?: { status: string } | null;
};

export type AcceptInviteResult =
  | { success: true; alreadyConnected: boolean; coachId: string; coachName: string | null }
  | {
      success: false;
      confirmationRequired: true;
      error: string;
      invitedEmailHint: string;
      signedInAs: string;
      coachName: string | null;
    }
  | { success: false; confirmationRequired?: false; error: string };

/** Pure. The sentence the REST route returns as `message`. */
export function inviteConfirmationMessage(input: {
  invitedEmailHint: string;
  signedInAs: string;
  coachName: string | null;
}): string {
  return `This invite was sent to ${input.invitedEmailHint}, not ${input.signedInAs}. Confirm it's you to join ${
    input.coachName ?? "your coach"
  }.`;
}

/**
 * Pure. Where `/invite/[token]`'s "acceptAnyway" confirm submission sends the
 * client next, given `redeemInvite`'s result.
 *
 * T-987 review round 1, MAJOR 1: the page used to discard this result and
 * redirect to the welcome dashboard unconditionally, so a refusal reached
 * after the confirm card rendered — the token already redeemed by someone
 * else, an expired invite, AI enrollment in another tab, another coach,
 * a deactivated account — read as success. Extracted so the branch is
 * unit-testable without rendering the page.
 */
export function acceptAnywayRedirectTarget(
  token: string,
  result: { success: true } | { success?: false; error: string }
): string {
  if (result.success) return "/client?welcomed=1";
  return `/invite/${token}?confirmError=${encodeURIComponent(result.error)}`;
}

// ── Core helper: issue an invitation ──────────────────────────────────────────

/**
 * Single source of truth for issuing (or reusing) an invite, or recognising
 * an already-accepted relationship, for a lead. This MUST be used by every
 * non-activating code path (approveCoachingRequest, resendInvite,
 * acceptClient). Coach-supplied contact details (email/phone typed into a
 * form by the coach) can never by themselves grant access to an existing
 * account (CB01) — they can only result in an invitation that the *intended
 * client's own signed-in session* must explicitly accept via
 * acceptClientInviteForUser/redeemInvite. This function never creates a
 * CoachClient row itself.
 *
 * T-978: rewritten to open its own transaction and take the same
 * CoachingRequest `FOR UPDATE` lock `establishRelationshipOrInvite`'s other
 * caller (`activateLead`) takes, so the two can no longer interleave into a
 * duplicate-invite race. The candidate-resolution and reissue rules live in
 * `lib/leads/activate-lead.ts` now — this function is a thin wrapper that
 * calls them and then sends the same email it always sent, after commit.
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
  coachNote: string = "Activated from coaching request."
): Promise<LinkResult> {
  void coachNote; // reserved — unused today, matching pre-existing behaviour.

  type Outcome =
    | { kind: "linked"; clientId: string; email: string }
    | { kind: "invite"; invite: ClientInvite; email: string }
    | { kind: "no_email" };

  const outcome: Outcome = await db.$transaction(async (tx) => {
    // Same lock order and same row as activateLead: serialises against a
    // concurrent activation or another non-activating invite writer, which
    // is what used to race into a P2002 on ClientInvite.requestId.
    await tx.$queryRaw`SELECT "id" FROM "CoachingRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const coachUser = await tx.user.findUniqueOrThrow({
      where: { id: coach.coachId },
      select: { email: true },
    });

    const lead: LeadIdentity = {
      id: requestId,
      prospectName: prospect.prospectName,
      prospectId: prospect.prospectId ?? null,
      prospectEmail: prospect.prospectEmail,
      prospectEmailAddr: prospect.prospectEmailAddr,
      prospectPhone: prospect.prospectPhone,
    };

    const established = await establishRelationshipOrInvite(tx, lead, {
      coachId: coach.coachId,
      coachEmail: coachUser.email,
    });

    if (established.kind === "roster") {
      const clientUser = await tx.user.findUniqueOrThrow({
        where: { id: established.clientId },
        select: { email: true },
      });
      await tx.coachingRequest.update({
        where: { id: requestId },
        data: { prospectId: established.clientId },
      });
      return { kind: "linked", clientId: established.clientId, email: clientUser.email };
    }
    if (established.kind === "no_email") {
      return { kind: "no_email" };
    }
    if (established.kind === "invite") {
      return { kind: "invite", invite: established.invite, email: established.invite.email };
    }
    // established.kind === "self_addressed" — T-973 is not fixed by this
    // ticket. activateLead treats this as a refusal because I1 needs a
    // REDEEMABLE invite; this non-activating caller has no such invariant to
    // protect, so it preserves today's behaviour and still issues the
    // invite (acceptClientInviteForUser refuses a self-addressed acceptance
    // permanently regardless).
    const { invite } = await ensureInviteForRequest(tx, {
      requestId,
      coachId: coach.coachId,
      email: established.email,
      prospectName: prospect.prospectName,
    });
    return { kind: "invite", invite, email: established.email };
  });

  if (outcome.kind === "linked") {
    return {
      linked: true,
      clientId: outcome.clientId,
      email: outcome.email,
      alreadyConnected: true,
    };
  }
  if (outcome.kind === "no_email") {
    return { linked: false, inviteToken: null, email: null, noEmailOnFile: true };
  }

  // outcome.kind === "invite" — send the email after commit, exactly as
  // before: its failure must never block the invite row that already
  // exists from mattering.
  try {
    const { clientActivatedInviteEmail } = await import("@/lib/email/templates");
    const coachName =
      [coach.coachFirstName, coach.coachLastName].filter(Boolean).join(" ") || "Your coach";
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
    const inviteUrl = `${appUrl}/invite/${outcome.invite.inviteToken}`;
    const emailContent = clientActivatedInviteEmail(prospect.prospectName, coachName, inviteUrl);
    await sendEmail({ to: outcome.email, ...emailContent });
  } catch {
    /* email failure must never block activation — the invite row is what matters */
  }

  return { linked: false, inviteToken: outcome.invite.inviteToken, email: outcome.email };
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
  options?: {
    /** Every address on the signed-in Clerk account, as written. Omit or pass
     *  null when no Clerk user is available (JIT, tests, Clerk unreachable);
     *  the service then compares the stored primary address only. */
    accountEmailAddresses?: readonly AccountEmailAddress[] | null;
    /** True only when the client has explicitly confirmed this exact invite. */
    confirmDifferentEmail?: boolean;
  }
): Promise<AcceptInviteResult> {
  const result: AcceptInviteResult = await db.$transaction(async (tx) => {
    // Shared serialization point with managed AI commands and deactivation.
    // Never authorize from the invite or user snapshots passed by a caller.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    // T-978 funnel-wide lock order: User → CoachingRequest → ClientInvite.
    // Activation locks CoachingRequest then writes ClientInvite; without
    // this line this function locks User then ClientInvite and only later
    // writes CoachingRequest — a genuine deadlock cycle. `invite.requestId`
    // is the caller's snapshot and is used ONLY to choose which row to lock;
    // authority still comes from the re-read below, and no code path ever
    // updates ClientInvite.requestId, so a stale snapshot cannot select the
    // wrong row.
    if (invite.requestId) {
      await tx.$queryRaw`SELECT "id" FROM "CoachingRequest" WHERE "id" = ${invite.requestId} FOR UPDATE`;
    }
    const owner = await tx.user.findUnique({
      where: { id: user.id },
      select: { email: true, isDeactivated: true, isClient: true },
    });
    if (!owner || owner.isDeactivated || !owner.isClient)
      return { success: false, error: "This client account is unavailable." };
    await tx.$queryRaw`SELECT "id" FROM "ClientInvite" WHERE "id" = ${invite.id} FOR UPDATE`;
    const current = await tx.clientInvite.findUnique({ where: { id: invite.id } });
    if (!current) return { success: false, error: "This invite is no longer available." };
    const coach = await tx.user.findUnique({
      where: { id: current.coachId },
      select: { firstName: true, lastName: true, isDeactivated: true, isCoach: true },
    });
    if (!coach || coach.isDeactivated || !coach.isCoach || current.coachId === user.id)
      return { success: false, error: "This coach is unavailable." };
    const coachName = [coach.firstName, coach.lastName].filter(Boolean).join(" ") || null;
    const existing = await tx.coachClient.findUnique({
      where: { coachId_clientId: { coachId: current.coachId, clientId: user.id } },
      select: { id: true },
    });
    if (current.status === "ACCEPTED") {
      if (existing) return { success: true, alreadyConnected: true, coachId: current.coachId, coachName };
      // T-987 fix: a third party replaying an already-accepted token has no
      // roster row of their own — that must never read as success (was
      // reachable only after this reorder; the old email-equality check at
      // the top of this function used to stop them before reaching here).
      return { success: false, error: "This invite has already been used." };
    }
    if (current.status === "PENDING" && current.expiresAt <= new Date())
      await tx.clientInvite.update({ where: { id: current.id }, data: { status: "EXPIRED" } });
    if (current.status !== "PENDING" || current.expiresAt <= new Date())
      return {
        success: false,
        error: "This invite has expired or is no longer available. Ask your coach for a new one.",
      };
    const context = await tx.clientCoachingContext.findUnique({ where: { clientId: user.id } });
    if (context?.mode === "AI" || context?.resolutionRequired)
      return {
        success: false,
        error: "Pause AI coaching or resolve your provider before accepting a human coach.",
      };
    const other = await tx.coachClient.findFirst({
      where: { clientId: user.id, coachId: { not: current.coachId } },
      select: { id: true },
    });
    if (other)
      return {
        success: false,
        error: "Leave your current coaching relationship before accepting another coach.",
      };

    // T-987. The invited address is a confirmation step, not the gate: the
    // invite token itself is the credential (random, single-use, 7-day
    // expiry, delivered to the invited inbox). Every VERIFIED address on the
    // signed-in Clerk account is accepted; a mismatch is recorded and asks
    // for one explicit confirmation instead of refusing outright.
    const owns = options?.accountEmailAddresses
      ? accountOwnsEmail(options.accountEmailAddresses, current.email)
      : normalizeEmailForMatch(owner.email) === normalizeEmailForMatch(current.email);

    if (!owns && !options?.confirmDifferentEmail) {
      await tx.$executeRaw`UPDATE "ClientInvite" SET "mismatchSeenAt" = now(), "mismatchEmail" = ${owner.email.toLowerCase()} WHERE "id" = ${current.id} AND "mismatchSeenAt" IS NULL`;
      return {
        success: false,
        confirmationRequired: true,
        error: "This invite was sent to a different email address. Confirm it's you to accept it.",
        invitedEmailHint: maskEmail(current.email),
        signedInAs: owner.email,
        coachName,
      };
    }

    if (!existing) {
      const coachNotes = owns
        ? "Joined via invite."
        : `Joined via invite (confirmed from ${owner.email}; invite was addressed to ${current.email}).`;
      await tx.coachClient.create({
        data: { coachId: current.coachId, clientId: user.id, coachNotes },
      });
    }
    await reconcileCoachingContextForClient(tx, user.id);
    if (!owns) {
      // A client may POST confirmDifferentEmail: true without ever having
      // rendered the confirm prompt (e.g. a REST caller). Set-once, so a
      // prior unfinished attempt is not overwritten.
      await tx.$executeRaw`UPDATE "ClientInvite" SET "mismatchSeenAt" = now(), "mismatchEmail" = ${owner.email.toLowerCase()} WHERE "id" = ${current.id} AND "mismatchSeenAt" IS NULL`;
    }
    await tx.clientInvite.update({
      where: { id: current.id },
      data: { status: "ACCEPTED", ...(owns ? {} : { acceptedWithMismatch: true }) },
    });
    // T-987 review round 1, MAJOR 2: only rebind the originating lead to
    // THIS user when they actually own the invited address. On the
    // confirmed-mismatch path the roster row (CoachClient, just created
    // above) is the whole relationship — the CoachingRequest keeps
    // belonging to whoever it always did (prospectName/prospectEmail/the
    // submitted IntakePacket are that person's, not the confirming user's).
    // Rebinding prospectId here would point getIntakePacketForClient
    // (lib/queries/intake.ts), lib/queries/signature.ts and
    // lib/queries/marketplace.ts — all of which key purely on prospectId —
    // at the confirming user, so the coach's client page would render a
    // stranger's submitted intake (bodyweight, health answers) under this
    // user's name. Leaving the lead alone is the smaller fix: it is still
    // whatever it was before this acceptance (T-979/T-988 own resolving an
    // invite that was answered by someone other than its addressee).
    if (current.requestId && owns)
      await tx.coachingRequest.updateMany({
        where: { id: current.requestId },
        data: { prospectId: user.id, status: "ACCEPTED" },
      });
    return { success: true, alreadyConnected: !!existing, coachId: current.coachId, coachName };
  });
  if (result.success && !result.alreadyConnected) {
    try {
      const { coachConnectedEmail } = await import("@/lib/email/templates");
      const content = coachConnectedEmail(user.email, result.coachName || "your coach");
      await sendEmail({ to: user.email, ...content });
    } catch {
      /* Email does not change committed authority. */
    }
  }
  return result;
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
export async function reconcileCoachingContextForClient(
  tx: DbClient,
  clientId: string
): Promise<void> {
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
      create: {
        clientId,
        mode: "HUMAN",
        activeCoachClientId: null,
        revision: 1,
        resolutionRequired: true,
      },
      update: { resolutionRequired: true },
    });
  }
}

export type EnrollInAiCoachingResult = { success: true } | { success: false; error: string };

/** @deprecated The pre-consent A01 helper is intentionally disabled. Public
 * enrollment uses client-commands ENROLL, with consent, revisions, entitlement,
 * safety, synthetic-runtime and reviewer capacity checked under one user lock. */
export async function enrollInAiCoaching(clientId: string): Promise<EnrollInAiCoachingResult> {
  void clientId;
  return { success: false, error: "Use the consent-bound AI Coach enrollment workflow." };
}

// ── Guard helpers (testable, pure functions) ─────────────────────────────────

/**
 * Determines the activation result type given the link outcome.
 * Used by callers to construct appropriate response messages.
 *
 * T-978: a `LinkResult -> ActivationOutcome/ActivationRefusal` adapter over
 * `lib/leads/activate-lead.ts#getActivationMessage`, so one sentence table
 * exists for both this function's three branches and activateLead's nine.
 */
export function getActivationMessage(prospectName: string, result: LinkResult): string {
  if (result.linked) {
    return getLeadActivationMessage(prospectName, "already_on_roster");
  }
  if ("noEmailOnFile" in result && result.noEmailOnFile) {
    return getLeadActivationMessage(prospectName, "no_email_on_file");
  }
  return getLeadActivationMessage(prospectName, "invite_emailed", { email: result.email });
}
