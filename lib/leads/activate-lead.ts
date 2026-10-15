import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sendEmail";
import type { ClientInvite, Prisma } from "@/app/generated/prisma/client";
import { resolveEmailCandidate } from "@/lib/leads/resolve-invite-recipient";
import { reportAnomaly } from "@/lib/observability/report";
import { LEAD_INVITE_EMAIL_FAILED } from "@/lib/observability/events";

/**
 * T-978 — the single activation service.
 *
 * Invariant I1 (see docs/onboarding-funnel.md in this repo for the full
 * picture): every committed transaction that writes
 * `CoachingRequest.consultationStage = 'ACTIVE'` leaves, in that SAME
 * transaction, either (a) a `CoachClient` row for this coach and prospect, or
 * (b) a `ClientInvite` row that is live, unexpired, and addressed to someone
 * other than the coach themselves (i.e. actually redeemable — a
 * self-addressed invite is refused permanently by
 * `acceptClientInviteForUser`, so it would satisfy the letter of the
 * invariant while guaranteeing a stranded lead). If neither can be
 * established, no stage is written at all.
 *
 * Lock order (funnel-wide, closes a real deadlock cycle with
 * `acceptClientInviteForUser`): User → CoachingRequest → ClientInvite.
 * This file only ever needs the CoachingRequest → ClientInvite half; the
 * User step lives in `lib/activation.ts#acceptClientInviteForUser`.
 *
 * CB01: nothing in this file may resolve or match an account by a phone
 * digit-string field. A static guard in tests/unit/activation.test.ts
 * enforces that this file's source never contains the User model's phone
 * column name (camelCase, "phone" immediately followed by "Number").
 */

// ── Stages a coach may set directly — ACTIVE is deliberately absent ─────────

/** Stages a coach may set directly. ACTIVE is deliberately absent: activation
 *  is not a stage edit, it is a transaction that also establishes the
 *  relationship or the invite (T-978 I1). Every stage-editing surface in the
 *  repo imports this instead of declaring its own list. */
export const COACH_SETTABLE_STAGES = [
  "PENDING",
  "CONSULTATION_SCHEDULED",
  "CONSULTATION_DONE",
  "INTAKE_SENT",
  "INTAKE_SUBMITTED",
  "FORMS_SENT",
  "FORMS_SIGNED",
  "DECLINED",
] as const;
export type CoachSettableStage = (typeof COACH_SETTABLE_STAGES)[number];

/** Stages the pipeline Activate button may be pressed from. Bypass allows any
 *  non-ACTIVE, non-DECLINED stage. Mirrors the old
 *  `validateActivationPreconditions`. */
export const PIPELINE_ACTIVATION_STAGES = ["FORMS_SIGNED", "INTAKE_SUBMITTED"] as const;

export type ActivationMode = "PIPELINE" | "BYPASS";

/** The four end states in which the stage was committed. Names are T-960's,
 *  unchanged, so its copy table and its outcome enum survive this ticket. */
export type ActivationOutcome =
  | "already_active" // the lead was ACTIVE before this call; nothing was written
  | "already_on_roster" // I1(a): a CoachClient row exists for this coach and prospect
  | "invite_emailed" // I1(b): live invite committed AND the email left the building
  | "invite_created_email_failed"; // I1(b): live invite committed, the send threw after commit

/** The five end states in which NOTHING was written. The stage is unchanged. */
export type ActivationRefusal =
  | "not_found" // not this coach's lead, or no such lead
  | "wrong_stage" // PIPELINE from a stage that is not in PIPELINE_ACTIVATION_STAGES, or DECLINED
  | "no_email_on_file" // I1 cannot be satisfied: no roster row and no address to invite
  | "self_addressed" // the resolved address is the coach's own; the invite could never be redeemed
  | "failed"; // the transaction rolled back (DB error, deadlock loser)

/** The exact string activateClient throws for a not-found/wrong-owner lead
 *  (pre-existing behaviour, preserved by T-978). Exported so
 *  activate/route.ts matches it by reference rather than duplicating the
 *  literal — a rename here is then a compile-visible change on both sides,
 *  not two independent strings that happen to agree (T-978 review round 1,
 *  CR-3).
 *
 *  Lives here rather than in app/actions/coaching-requests.ts (T-978 QA
 *  fix): that file carries `"use server"`, and Next.js/Turbopack only
 *  permits async-function exports from a `"use server"` module — a plain
 *  `export const` there fails the production build with the whole module
 *  reading as having no exports at all. This file has no such directive,
 *  so it's the correct home for a non-function constant both a Server
 *  Action and a route need. */
export const ACTIVATE_NOT_FOUND_ERROR = "Request not found";

export interface ActivateLeadInput {
  requestId: string;
  /** The signed-in coach's User.id. Authority. Never taken from a request body. */
  coachUserId: string;
  mode: ActivationMode;
  /** Stored on the eventual CoachClient row if the client accepts. Currently
   *  unused by any write in this service — CoachClient.coachNotes is only
   *  ever set at acceptance (lib/activation.ts) — kept on the input because
   *  the contract reserves it for a caller that wants to record why a lead
   *  was activated. */
  coachNote?: string;
}

export interface ActivateLeadSuccess {
  ok: true;
  outcome: ActivationOutcome;
  /** True only when this call is what moved the lead to ACTIVE. */
  stageChanged: boolean;
  /** I1(a) held. The ONLY field any surface may read as "on the roster". */
  onRoster: boolean;
  /** User.id of the CoachClient row. Non-null iff onRoster. */
  clientId: string | null;
  /** The address the invite was actually addressed to. Non-null iff I1(b). */
  inviteEmail: string | null;
  /** Non-null iff I1(b). */
  inviteExpiresAt: Date | null;
  /** null when no send was attempted (already_active, already_on_roster). */
  emailSent: boolean | null;
  prospectName: string;
}

export interface ActivateLeadFailure {
  ok: false;
  refusal: ActivationRefusal;
  /** Coach-facing, safe to render, never claims anything happened. */
  message: string;
}

export type ActivateLeadResult = ActivateLeadSuccess | ActivateLeadFailure;

export interface LeadIdentity {
  id: string;
  prospectName: string;
  prospectId: string | null;
  prospectEmail: string; // legacy contact column, usually a phone
  prospectEmailAddr: string | null;
  prospectPhone: string | null;
}

export type EstablishResult =
  | { kind: "roster"; clientId: string }
  | { kind: "invite"; invite: ClientInvite; created: boolean; tokenRotated: boolean }
  | { kind: "no_email" }
  | { kind: "self_addressed"; email: string };

const inviteEmailFormat = z.string().trim().toLowerCase().email().max(100);

/**
 * Recipient resolution is a named seam this ticket does not own. This
 * reproduces the sprint-branch H1 behaviour verbatim (a dedicated address is
 * preferred; a valid-looking address found only in the legacy contact
 * column may still receive an invite, but — see the separate, dedicated-only
 * lookup below — never identifies an account). T-980 replaces this body with
 * T-961's `resolveProspectEmail`. T-978 changes no resolution rule.
 *
 * Delegates to `lib/leads/resolve-invite-recipient.ts#resolveEmailCandidate`
 * — the one implementation of this rule, also imported by the web bypass
 * confirm dialog, which chooses its warning copy from the same answer this
 * function commits inside the transaction (T-978 review round 1, gap 1;
 * round 2, A1 — the dialog does not gate the control on this, only the
 * server does, since a client component cannot evaluate the roster half of
 * the rule).
 */
async function resolveInviteRecipient(
  _tx: Prisma.TransactionClient,
  lead: Pick<LeadIdentity, "prospectEmailAddr" | "prospectEmail">
): Promise<string | null> {
  return resolveEmailCandidate(lead.prospectEmailAddr, lead.prospectEmail);
}

/** cuid-shaped, matching app/actions/coaching-requests.ts:101. @default(cuid()) only fires on insert. */
function newInviteToken(): string {
  return "c" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export function sevenDaysFromNow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}

/** T-969's reissue block, verbatim, parameterised on tx. One ClientInvite row
 *  per requestId, forever: requestId is @unique, so a superseded invite is
 *  UPDATED IN PLACE. Never null-out-and-create — that was a guaranteed P2002. */
export async function ensureInviteForRequest(
  tx: Prisma.TransactionClient,
  args: { requestId: string; coachId: string; email: string; prospectName: string }
): Promise<{ invite: ClientInvite; created: boolean; tokenRotated: boolean }> {
  const { requestId, coachId, email, prospectName } = args;
  const existing = await tx.clientInvite.findUnique({ where: { requestId } });
  const reusable =
    existing !== null &&
    existing.status === "PENDING" &&
    existing.expiresAt > new Date() && // T-963's expiry rule, folded in here
    existing.email === email; // both sides already lowercased

  let invite: ClientInvite;
  let created = false;
  let tokenRotated = false;
  if (reusable) {
    invite = existing!;
  } else if (existing) {
    tokenRotated = existing.email !== email;
    invite = await tx.clientInvite.update({
      where: { id: existing.id },
      data: {
        coachId,
        email,
        name: prospectName,
        status: "PENDING",
        expiresAt: sevenDaysFromNow(),
        // Rotate only when the recipient changed, so a client holding the
        // first email keeps a working link across a plain reissue, and the
        // previous recipient never sees the new prospect's details via
        // getInviteDetails.
        ...(tokenRotated ? { inviteToken: newInviteToken() } : {}),
        // T-987 review round 2 (parity MINOR 4, code review finding A): a
        // reissued row is a DIFFERENT redemption attempt on a row that gets
        // reused forever (requestId is @unique). Without this reset, a
        // mismatch recorded against the PREVIOUS recipient (set-once at
        // lib/activation.ts, WHERE "mismatchSeenAt" IS NULL) survives onto
        // the reissued invite — the next holder's confirmation is never
        // recorded (the guard sees a non-null mismatchSeenAt and no-ops),
        // and T-962/T-988's getLeadRelationships would report "accepted
        // from a different address" for an acceptance that matched, or
        // show a stranger's address for the wrong invite entirely.
        mismatchSeenAt: null,
        mismatchEmail: null,
        acceptedWithMismatch: false,
      },
    });
  } else {
    created = true;
    invite = await tx.clientInvite.create({
      data: { coachId, email, name: prospectName, requestId, expiresAt: sevenDaysFromNow() },
    });
  }
  return { invite, created, tokenRotated };
}

/**
 * Establishes one half of I1 for a lead, inside the caller's transaction.
 * Performs no network I/O and writes no stage. The single implementation
 * shared by `activateLead` and `lib/activation.ts#linkOrInviteProspect`.
 *
 * CB01 / Decision H1: only the dedicated address column (`prospectEmailAddr`)
 * is ever an identity signal for selecting or linking an existing account —
 * never the legacy contact column, never a phone number. The legacy column
 * may still receive an invite (see `resolveInviteRecipient`), but it never
 * decides whose account this lead's person already is.
 */
export async function establishRelationshipOrInvite(
  tx: Prisma.TransactionClient,
  lead: LeadIdentity,
  coach: { coachId: string; coachEmail: string }
): Promise<EstablishResult> {
  const identityEmail = inviteEmailFormat.safeParse(lead.prospectEmailAddr);
  const candidateIds = new Set<string>();
  if (lead.prospectId) candidateIds.add(lead.prospectId);
  if (identityEmail.success) {
    const existingUser = await tx.user.findUnique({
      where: { email: identityEmail.data },
      select: { id: true },
    });
    if (existingUser) candidateIds.add(existingUser.id);
  }

  if (candidateIds.size > 0) {
    const existingConn = await tx.coachClient.findFirst({
      where: { coachId: coach.coachId, clientId: { in: [...candidateIds] } },
      select: { clientId: true },
    });
    if (existingConn) return { kind: "roster", clientId: existingConn.clientId };
  }

  const recipientEmail = await resolveInviteRecipient(tx, lead);
  if (!recipientEmail) return { kind: "no_email" };
  if (recipientEmail === coach.coachEmail.trim().toLowerCase()) {
    return { kind: "self_addressed", email: recipientEmail };
  }

  const { invite, created, tokenRotated } = await ensureInviteForRequest(tx, {
    requestId: lead.id,
    coachId: coach.coachId,
    email: recipientEmail,
    prospectName: lead.prospectName,
  });
  return { kind: "invite", invite, created, tokenRotated };
}

// ── The message table — one sentence per outcome/refusal ────────────────────

/** One sentence table for every outcome and refusal. T-960 owns the exact
 *  wording of the four surviving outcome sentences (reproduced here
 *  verbatim from its frozen table) and will later replace this function's
 *  body with its richer `LinkResult -> outcome` adapter; nothing else on the
 *  coach's screen changes in this ticket. */
export function getActivationMessage(
  prospectName: string,
  state: ActivationOutcome | ActivationRefusal,
  ctx?: { email?: string | null }
): string {
  const name = prospectName || "This lead";
  const email = ctx?.email ?? null;
  switch (state) {
    case "already_active":
      return `${name} is already activated.`;
    case "already_on_roster":
      return `${name} is already connected to your roster.`;
    case "invite_emailed":
      return email
        ? `Invite sent to ${email}. ${name} joins your Clients tab only when they accept it.`
        : `An invite has been sent to ${name}. They'll appear on your roster once they accept it.`;
    case "invite_created_email_failed":
      return email
        ? `${name}'s invite was created, but the email to ${email} could not be sent. Resend it from this lead.`
        : `${name}'s invite was created, but the email could not be sent. Resend it from this lead.`;
    case "not_found":
      // No trailing period — byte-for-byte the frozen REST 404 body both
      // /activate and /bypass-activate share.
      return "Lead not found";
    case "wrong_stage":
      return `${name} must complete intake before activating.`;
    case "no_email_on_file":
      return `No email address on file for ${name}. Add one on this lead, then activate — nothing has been changed.`;
    case "self_addressed":
      return `${name}'s only address on file is your own, so no invite could be sent. Update the address on this lead, then activate.`;
    case "failed":
      return `Couldn't activate ${name} just now. Nothing was changed — try again.`;
  }
}

// ── The service ───────────────────────────────────────────────────────────

type TxOutcome =
  | { kind: "refusal"; refusal: ActivationRefusal; prospectName: string }
  // I1(a) IS evaluated here (T-978 review round 1, CR-5 / parity gap 8) —
  // `onRoster`/`clientId` reflect the real roster state, not a hard-coded
  // "unknown". The outcome name stays already_active (nothing was WRITTEN
  // this call) even when the prospect happens to already be on the roster.
  | { kind: "already_active"; prospectName: string; onRoster: boolean; clientId: string | null }
  | { kind: "roster"; clientId: string; prospectName: string }
  | { kind: "invite"; invite: ClientInvite; prospectName: string; coachName: string };

/**
 * THE ONLY WRITER OF consultationStage = 'ACTIVE' IN THIS REPOSITORY.
 *
 * Invariant I1: the stage write and the relationship-or-invite write commit
 * in one transaction, or neither happens. No network I/O inside the
 * boundary (standing rule 5). The invite email is sent AFTER commit; its
 * failure downgrades `outcome` to `invite_created_email_failed` and never
 * rolls back and never reports success it did not get.
 *
 * @throws Never. Every failure, including a deadlock loser, returns
 *         `ok: false`.
 */
export async function activateLead(input: ActivateLeadInput): Promise<ActivateLeadResult> {
  const { requestId, coachUserId, mode } = input;

  let tx: TxOutcome;
  try {
    tx = await db.$transaction(async (trx) => {
      // Ownership check and the serialisation point in one statement.
      const owned = await trx.$queryRaw<Array<{ id: string }>>`
        SELECT cr."id" FROM "CoachingRequest" cr
        JOIN "CoachProfile" cp ON cp."id" = cr."coachProfileId"
        WHERE cr."id" = ${requestId} AND cp."userId" = ${coachUserId}
        FOR UPDATE OF cr
      `;
      if (owned.length === 0) {
        return { kind: "refusal", refusal: "not_found", prospectName: "" };
      }

      // Authoritative re-read of the lead under the lock. Nothing read
      // before the lock may decide anything.
      const lead = await trx.coachingRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: {
          id: true,
          prospectName: true,
          prospectId: true,
          prospectEmail: true,
          prospectEmailAddr: true,
          prospectPhone: true,
          consultationStage: true,
        },
      });

      if (lead.consultationStage === "ACTIVE") {
        // I1(a) is evaluated here rather than assumed false — a lead can be
        // ACTIVE via an accepted invite with no further write from this
        // call. T-987: prospectId is set on acceptance only when the
        // accepting account owns the invited address; a confirmed-mismatch
        // acceptance (lib/activation.ts) leaves prospectId null even though
        // the invite is consumed and a CoachClient row exists for whoever
        // confirmed. `roster` below is therefore null in that case too —
        // this lead reads as "not on roster" even though someone did join
        // from this invite, just not as this lead's prospect. Known gap,
        // owned by T-979/T-988 (see board/tickets/T-987.md).
        const roster = lead.prospectId
          ? await trx.coachClient.findFirst({
              where: { coachId: coachUserId, clientId: lead.prospectId },
              select: { clientId: true },
            })
          : null;
        return {
          kind: "already_active",
          prospectName: lead.prospectName,
          onRoster: roster !== null,
          clientId: roster?.clientId ?? null,
        };
      }

      const wrongStage =
        mode === "BYPASS"
          ? lead.consultationStage === "DECLINED"
          : !(PIPELINE_ACTIVATION_STAGES as readonly string[]).includes(lead.consultationStage);
      if (wrongStage) {
        return { kind: "refusal", refusal: "wrong_stage", prospectName: lead.prospectName };
      }

      const coachUser = await trx.user.findUniqueOrThrow({
        where: { id: coachUserId },
        select: { email: true, firstName: true, lastName: true },
      });

      const established = await establishRelationshipOrInvite(trx, lead, {
        coachId: coachUserId,
        coachEmail: coachUser.email,
      });

      if (established.kind === "no_email") {
        return { kind: "refusal", refusal: "no_email_on_file", prospectName: lead.prospectName };
      }
      if (established.kind === "self_addressed") {
        return { kind: "refusal", refusal: "self_addressed", prospectName: lead.prospectName };
      }
      if (established.kind === "roster") {
        await trx.coachingRequest.update({
          where: { id: requestId },
          data: {
            consultationStage: "ACTIVE",
            status: "ACCEPTED",
            prospectId: established.clientId,
          },
        });
        return { kind: "roster", clientId: established.clientId, prospectName: lead.prospectName };
      }

      // established.kind === "invite"
      await trx.coachingRequest.update({
        where: { id: requestId },
        data: {
          consultationStage: "ACTIVE",
          status: "ACCEPTED",
          // "invite issued at", not "email delivered at" — T-963's rate
          // limiter wants issue time; delivery is reported through
          // `emailSent` below, after commit.
          inviteLastSentAt: new Date(),
          inviteSendCount: { increment: 1 },
        },
      });
      const coachName =
        [coachUser.firstName, coachUser.lastName].filter(Boolean).join(" ") || "Your coach";
      return { kind: "invite", invite: established.invite, prospectName: lead.prospectName, coachName };
    });
  } catch {
    // A thrown error (a deadlock loser, a constraint violation, any DB
    // error) aborts the whole transaction. Nothing committed. I1 still
    // holds because no stage was written.
    return { ok: false, refusal: "failed", message: getActivationMessage("This lead", "failed") };
  }

  if (tx.kind === "refusal") {
    return { ok: false, refusal: tx.refusal, message: getActivationMessage(tx.prospectName, tx.refusal) };
  }

  if (tx.kind === "already_active") {
    return {
      ok: true,
      outcome: "already_active",
      stageChanged: false,
      onRoster: tx.onRoster,
      clientId: tx.clientId,
      inviteEmail: null,
      inviteExpiresAt: null,
      emailSent: null,
      prospectName: tx.prospectName,
    };
  }

  if (tx.kind === "roster") {
    return {
      ok: true,
      outcome: "already_on_roster",
      stageChanged: true,
      onRoster: true,
      clientId: tx.clientId,
      inviteEmail: null,
      inviteExpiresAt: null,
      emailSent: null,
      prospectName: tx.prospectName,
    };
  }

  // tx.kind === "invite" — the only branch with network I/O, and only now,
  // after commit. A send failure never rolls back the committed authority
  // and never reports success it did not get.
  let emailSent = true;
  try {
    const { clientActivatedInviteEmail } = await import("@/lib/email/templates");
    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
    const inviteUrl = `${appUrl}/invite/${tx.invite.inviteToken}`;
    const emailContent = clientActivatedInviteEmail(tx.prospectName, tx.coachName, inviteUrl);
    await sendEmail({ to: tx.invite.email, ...emailContent });
  } catch (err) {
    emailSent = false;
    // lib/observability shipped in T-920/T-924 — this branch is a
    // knowingly-degrading path (CLAUDE.md's constraint), so it reports
    // through reportAnomaly rather than console.error (T-978 review round
    // 1, CR-8). No email, prospect name or invite token — only the ids
    // needed to find the row and a class name for the error.
    const errorKind = err instanceof Error ? err.constructor.name || "Error" : typeof err;
    reportAnomaly(LEAD_INVITE_EMAIL_FAILED.evt, {
      ids: { requestId, coachId: coachUserId },
      context: { errorKind },
      allow: LEAD_INVITE_EMAIL_FAILED.allow,
    });
  }

  return {
    ok: true,
    outcome: emailSent ? "invite_emailed" : "invite_created_email_failed",
    stageChanged: true,
    onRoster: false,
    clientId: null,
    inviteEmail: tx.invite.email,
    inviteExpiresAt: tx.invite.expiresAt,
    emailSent,
    prospectName: tx.prospectName,
  };
}
