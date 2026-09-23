"use server";

import crypto from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { ConsultationStage } from "@/app/generated/prisma/enums";
import { sendEmail } from "@/lib/email/sendEmail";
import {
    requestReceivedEmail,
    newRequestNotificationEmail,
    requestApprovedEmail,
    waitlistConfirmationEmail,
} from "@/lib/email/templates";
import { linkOrInviteProspect } from "@/lib/activation";
import {
    activateLead,
    getActivationMessage,
    COACH_SETTABLE_STAGES,
    type ActivateLeadResult,
    type ActivationOutcome,
    type ActivationRefusal,
    type CoachSettableStage,
} from "@/lib/leads/activate-lead";

/** The exact string activateClient throws for a not-found/wrong-owner lead
 *  (pre-existing behaviour, preserved by T-978). Exported so
 *  activate/route.ts matches it by reference rather than duplicating the
 *  literal — a rename here is then a compile-visible change on both sides,
 *  not two independent strings that happen to agree (T-978 review round 1,
 *  CR-3). */
export const ACTIVATE_NOT_FOUND_ERROR = "Request not found";

type ActivateActionResult =
    | {
          success: true;
          outcome: ActivationOutcome;
          message: string;
          onRoster: boolean;
          clientId: string | null;
          email: string | null;
          inviteExpiresAt: string | null;
      }
    // "already_active" is not an ActivationRefusal — it is a synthetic
    // marker bypassPipelineAndActivate adds itself, below, because bypass
    // (unlike pipeline) has always treated an already-active lead as a
    // refusal rather than an idempotent success.
    | { success: false; refusal: ActivationRefusal | "already_active"; message: string };

/** Shared by activateClient and bypassPipelineAndActivate — the only two
 *  callers of activateLead in this file. Never duplicate this mapping.
 *  Carries `refusal` through so a caller (a REST route) can key an HTTP
 *  status off the discriminant the service produced, instead of
 *  string-matching the coach-facing sentence T-960 owns (T-978 review
 *  round 1, CR-3 / parity gap 5). */
function toActivateActionResult(result: ActivateLeadResult): ActivateActionResult {
    if (!result.ok) {
        return { success: false, refusal: result.refusal, message: result.message };
    }
    return {
        success: true,
        outcome: result.outcome,
        message: getActivationMessage(result.prospectName, result.outcome, { email: result.inviteEmail }),
        onRoster: result.onRoster,
        clientId: result.clientId,
        email: result.inviteEmail,
        inviteExpiresAt: result.inviteExpiresAt ? result.inviteExpiresAt.toISOString() : null,
    };
}

/** Resolve the current coach's CoachProfile.id (cached per request via Prisma). */
async function getCoachProfileId(userId: string): Promise<string> {
    const profile = await db.coachProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new Error("Coach profile not found");
    return profile.id;
}

const coachingRequestSchema = z.object({
    coachProfileId: z.string().cuid(),
    prospectName: z.string().min(2, "Name must be at least 2 characters").max(100),
    prospectEmail: z.string().min(7, "Please enter a valid phone number").max(30),
    prospectEmailAddr: z.string().email().optional(),
    prospectPhone: z.string().max(30).optional(),
    intakeAnswers: z.object({
        goals: z.string().min(5, "Please elaborate on your goals").max(1000),
        experience: z.string().max(1000).optional(),
        injuries: z.string().max(1000).optional(),
    }),
});

export type CoachingRequestData = z.infer<typeof coachingRequestSchema>;

const waitlistSchema = z.object({
    coachProfileId: z.string().cuid(),
    prospectName: z.string().min(2, "Name must be at least 2 characters").max(100),
    prospectEmail: z.string().email("Invalid email address"),
    note: z.string().max(500).optional(),
});

export type WaitlistData = z.infer<typeof waitlistSchema>;

export async function submitCoachingRequest(data: CoachingRequestData) {
    // Unauthenticated public route.
    // Validate schema strictly to prevent loose payload injection.
    const validated = coachingRequestSchema.parse(data);
    const normalizedPhone = validated.prospectEmail.trim();

    // Check if profile exists and is published
    const profile = await db.coachProfile.findUnique({
        where: { id: validated.coachProfileId },
        select: {
            id: true,
            isPublished: true,
            acceptingClients: true,
            user: { select: { id: true, firstName: true, email: true, emailCoachingRequests: true, pushCoachingRequests: true } },
        },
    });

    if (!profile || !profile.isPublished) {
        throw new Error("Coach profile is unavailable");
    }

    if (!profile.acceptingClients) {
        throw new Error("This coach is not currently accepting new clients.");
    }

    // Rate limit: prevent multiple pending requests from the same email to the same coach
    const existingPending = await db.coachingRequest.findFirst({
        where: {
            coachProfileId: validated.coachProfileId,
            prospectEmail: normalizedPhone,
            status: "PENDING",
        },
        select: { id: true },
    });

    if (existingPending) {
        throw new Error("You already have a pending request with this coach. Please wait for them to respond.");
    }

    // If the submitter is authenticated, link their account immediately
    let prospectId: string | undefined;
    try {
        const { auth } = await import("@clerk/nextjs/server");
        const { userId: clerkId } = await auth();
        if (clerkId) {
            const existingUser = await db.user.findUnique({ where: { clerkId } });
            if (existingUser) prospectId = existingUser.id;
        }
    } catch { /* unauthenticated — continue without linking */ }

    // Create Request
    // NOTE: adapter-pg@7.5.0 + query-plan-executor@7.2.0 version mismatch causes
    // "column (not available) does not exist" on create(). Use raw SQL to bypass.
    const requestId = "c" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const cleanAnswers = JSON.parse(JSON.stringify(validated.intakeAnswers));

    await db.$executeRawUnsafe(
        `INSERT INTO "CoachingRequest" (
            "id", "coachProfileId", "prospectName", "prospectEmail",
            "prospectEmailAddr", "prospectPhone", "intakeAnswers",
            "status", "consultationStage", "prospectId", "inviteSendCount",
            "createdAt", "updatedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text::"RequestStatus",$9::text::"ConsultationStage",$10,$11,$12,$13)`,
        requestId,
        validated.coachProfileId,
        validated.prospectName,
        normalizedPhone,
        validated.prospectEmailAddr?.toLowerCase() ?? null,
        validated.prospectPhone ?? null,
        JSON.stringify(cleanAnswers),
        "PENDING",
        "PENDING",
        prospectId ?? null,
        0,
        new Date(),
        new Date(),
    );

    const request = { id: requestId };

    console.info(JSON.stringify({
        event: "marketplace.request.submitted",
        requestId: request.id,
        coachProfileId: validated.coachProfileId,
        status: "PENDING",
        timestamp: new Date().toISOString(),
    }));

    // Coach notification email (preference-gated)
    const coachName = profile.user.firstName || "Your coach";
    if (profile.user.emailCoachingRequests) {
        try {
            const notifEmail = newRequestNotificationEmail(coachName, validated.prospectName, `Phone: ${normalizedPhone}`);
            await sendEmail({ to: profile.user.email, ...notifEmail });
        } catch { /* email failure must not break request */ }
    }

    // Coach push notification (preference-gated, fire-and-forget)
    if (profile.user.pushCoachingRequests) {
        try {
            const { pushNewCoachingRequest } = await import("@/lib/notifications/push");
            pushNewCoachingRequest(profile.user.id, validated.prospectName).catch(console.error);
        } catch { /* push failure must not break request */ }
    }

    // Revalidate the coach's leads page so they see it
    revalidatePath("/coach/leads");

    return request;
}

export async function submitWaitlistEntry(data: WaitlistData) {
    const validated = waitlistSchema.parse(data);
    const normalizedEmail = validated.prospectEmail.toLowerCase();

    // Check profile exists and is published
    const profile = await db.coachProfile.findUnique({
        where: { id: validated.coachProfileId },
        include: { user: { select: { firstName: true } } },
    });

    if (!profile || !profile.isPublished) {
        throw new Error("Coach profile is unavailable");
    }

    // Rate limit: prevent duplicate waitlist from same email
    const existing = await db.coachingRequest.findFirst({
        where: {
            coachProfileId: validated.coachProfileId,
            prospectEmail: normalizedEmail,
            status: { in: ["PENDING", "WAITLISTED"] },
        },
    });

    if (existing) {
        throw new Error("You're already on the waitlist or have a pending request with this coach.");
    }

    const entry = await db.coachingRequest.create({
        data: {
            coachProfileId: validated.coachProfileId,
            prospectName: validated.prospectName,
            prospectEmail: normalizedEmail,
            intakeAnswers: { note: validated.note || "" },
            status: "WAITLISTED",
        },
    });

    console.info(JSON.stringify({
        event: "marketplace.waitlist.submitted",
        requestId: entry.id,
        coachProfileId: validated.coachProfileId,
        status: "WAITLISTED",
        timestamp: new Date().toISOString(),
    }));

    // Send confirmation email
    const coachName = profile.user.firstName || "this coach";
    try {
        const confirmEmail = waitlistConfirmationEmail(validated.prospectName, coachName);
        await sendEmail({ to: normalizedEmail, ...confirmEmail });
    } catch { /* email failure must not break waitlist */ }

    revalidatePath("/coach/leads");
    return entry;
}

export async function approveCoachingRequest(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });

    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) {
        throw new Error("Request not found");
    }

    if (request.status !== "PENDING") {
        throw new Error("This request is no longer pending.");
    }

    const updated = await db.coachingRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED" },
        select: { id: true, status: true },
    });

    console.info(JSON.stringify({
        event: "marketplace.request.approved",
        requestId: requestId,
        coachProfileId: request.coachProfileId,
        status: "APPROVED",
        timestamp: new Date().toISOString(),
    }));

    // Send approval email to prospect (generic sign-up nudge; the tokenized
    // invite email below is what actually links the account on acceptance)
    const coachName = user.firstName || "Your coach";
    try {
        const approvalEmail = requestApprovedEmail(request.prospectName, coachName);
        await sendEmail({ to: request.prospectEmail, ...approvalEmail });
    } catch { /* email failure must not break approval */ }

    // Issue a consent-required invite (never an immediate link — CB01: coach
    // approval alone must not grant access to an existing account).
    const linkResult = await linkOrInviteProspect(
        request,
        { coachId: user.id, coachFirstName: user.firstName, coachLastName: user.lastName },
        requestId,
        "Converted from marketplace request.",
    );

    if (!linkResult.linked) {
        await db.coachingRequest.update({
            where: { id: requestId },
            data: {
                inviteLastSentAt: new Date(),
                inviteSendCount: 1,
            },
        });
    }

    revalidatePath("/coach/leads");
    revalidatePath("/coach/dashboard");
    return { ...updated, immediateLink: linkResult.linked && linkResult.alreadyConnected };
}

export async function rejectCoachingRequest(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });

    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) {
        throw new Error("Request not found");
    }

    if (request.status !== "PENDING" && request.status !== "WAITLISTED") {
        throw new Error("This request cannot be declined.");
    }

    const updated = await db.coachingRequest.update({
        where: { id: requestId },
        data: { status: "REJECTED" },
        select: { id: true, status: true },
    });

    console.info(JSON.stringify({
        event: "marketplace.request.rejected",
        requestId: requestId,
        coachProfileId: request.coachProfileId,
        status: "REJECTED",
        timestamp: new Date().toISOString(),
    }));

    // Send rejection email to prospect (fire-and-forget)
    const coachName = user.firstName || "this coach";
    try {
        const { requestDeclinedEmail } = await import("@/lib/email/templates");
        const email = requestDeclinedEmail(request.prospectName, coachName);
        sendEmail({ to: request.prospectEmail, ...email }).catch(console.error);
    } catch { /* email failure must not break rejection */ }

    revalidatePath("/coach/leads");
    revalidatePath("/client");
    return updated;
}

export async function cancelCoachingRequest(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });

    if (!request) throw new Error("Request not found");

    // Verify ownership: must be the prospect (by ID or email)
    const isOwner =
        (request.prospectId && request.prospectId === user.id) ||
        request.prospectEmail.toLowerCase() === user.email.toLowerCase();

    if (!isOwner) throw new Error("Unauthorized");

    if (request.status !== "PENDING") {
        throw new Error("Only pending requests can be canceled.");
    }

    const updated = await db.coachingRequest.update({
        where: { id: requestId },
        data: { status: "REJECTED" }, // reuse REJECTED enum (no CANCELED enum exists)
        select: { id: true, status: true },
    });

    console.info(JSON.stringify({
        event: "marketplace.request.canceled",
        requestId: requestId,
        coachProfileId: request.coachProfileId,
        timestamp: new Date().toISOString(),
    }));

    revalidatePath("/client");
    revalidatePath("/coach/leads");
    return updated;
}

export async function resendInvite(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });

    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) {
        throw new Error("Request not found");
    }

    if (request.status !== "APPROVED") {
        return { success: false, message: "Only approved requests can receive invites." };
    }

    // Race condition guard: re-check if prospect signed up between page load and action
    if (request.prospectId) {
        return { success: false, message: "This person has already signed up and is connected." };
    }

    // Issue (or re-send) a consent-required invite. Even if the prospect has
    // since created an account, this never auto-links them (CB01) — it only
    // (re)sends the invite they must accept themselves.
    const linkResult = await linkOrInviteProspect(
        request,
        { coachId: user.id, coachFirstName: user.firstName, coachLastName: user.lastName },
        requestId,
        "Converted from marketplace request.",
    );

    if (linkResult.linked) {
        revalidatePath("/coach/leads");
        return { success: true, message: "Good news — they're already connected to your roster." };
    }
    if ("noEmailOnFile" in linkResult) {
        return { success: false, message: "This lead has no email on file to invite." };
    }

    // Update invite tracking metadata
    await db.coachingRequest.update({
        where: { id: requestId },
        data: {
            inviteLastSentAt: new Date(),
            inviteSendCount: { increment: 1 },
        },
    });

    console.info(JSON.stringify({
        event: "marketplace.invite.resent",
        requestId,
        coachProfileId: request.coachProfileId,
        timestamp: new Date().toISOString(),
    }));

    revalidatePath("/coach/leads");
    return { success: true, message: "Invite resent successfully." };
}

// ── New Lead Pipeline Actions ────────────────────────────────────────────────

export async function markContacted(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    await db.coachingRequest.update({
        where: { id: requestId },
        data: { status: "CONTACTED", consultationStage: "CONSULTATION_SCHEDULED" },
        select: { id: true, status: true },
    });
    revalidatePath("/coach/leads");
    return { success: true };
}

const scheduleConsultationSchema = z.object({
    requestId: z.string().cuid(),
    meetingLink: z.string().url().optional().or(z.literal("")),
    scheduledTime: z.string().datetime().optional(),
    notes: z.string().max(1000).optional(),
});

export async function scheduleConsultation(input: unknown) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const parsed = scheduleConsultationSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const { requestId, meetingLink, scheduledTime, notes } = parsed.data;

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    await db.consultationMeeting.upsert({
        where: { requestId },
        create: {
            coachId: user.id,
            requestId,
            meetingLink: meetingLink || null,
            scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
            notes: notes || null,
        },
        update: {
            meetingLink: meetingLink || null,
            scheduledTime: scheduledTime ? new Date(scheduledTime) : null,
            notes: notes || null,
        },
    });

    await db.coachingRequest.update({
        where: { id: requestId },
        data: { status: "CALL_SCHEDULED" },
    });

    revalidatePath("/coach/leads");
    revalidatePath(`/coach/leads/${requestId}`);
    return { success: true };
}

export async function acceptClient(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    if (request.status === "ACCEPTED" || request.status === "APPROVED") {
        throw new Error("Client already accepted.");
    }

    // Issue a consent-required invite — accepting a lead never itself grants
    // account access (CB01); the intended client must accept the invite.
    const linkResult = await linkOrInviteProspect(
        request,
        { coachId: user.id, coachFirstName: user.firstName, coachLastName: user.lastName },
        requestId,
        "Accepted from lead.",
    );

    await db.coachingRequest.update({
        where: { id: requestId },
        data: linkResult.linked
            ? { status: "ACCEPTED", prospectId: linkResult.clientId }
            : { status: "ACCEPTED", inviteLastSentAt: new Date(), inviteSendCount: { increment: 1 } },
    });

    revalidatePath("/coach/leads");
    revalidatePath("/coach/dashboard");
    return { success: true };
}

export async function declineRequest(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    await db.coachingRequest.update({
        where: { id: requestId },
        data: { status: "DECLINED" },
    });

    const coachName = user.firstName || "this coach";
    try {
        const { requestDeclinedEmail } = await import("@/lib/email/templates");
        const email = requestDeclinedEmail(request.prospectName, coachName);
        sendEmail({ to: request.prospectEmail, ...email }).catch(console.error);
    } catch { /* email failure must not block */ }

    revalidatePath("/coach/leads");
    return { success: true };
}

// ACTIVE is deliberately absent — activation is not a stage edit (T-978 I1).
// It is a transaction that also establishes the relationship or the invite,
// and the only door to it is `activateLead` via activateClient /
// bypassPipelineAndActivate below.
const VALID_STAGE_TRANSITIONS: Record<string, string[]> = {
    PENDING: ["CONSULTATION_SCHEDULED"],
    CONSULTATION_SCHEDULED: ["CONSULTATION_DONE", "INTAKE_SENT"],
    CONSULTATION_DONE: ["FORMS_SENT", "INTAKE_SENT"],
    INTAKE_SENT: ["INTAKE_SUBMITTED"],
    INTAKE_SUBMITTED: ["FORMS_SENT"],
    FORMS_SENT: ["FORMS_SIGNED"],
    FORMS_SIGNED: [],
};

export async function updateConsultationStage(input: {
    requestId: string;
    /** Typed CoachSettableStage (T-978) — ACTIVE is not a member, so a
     *  TS-checked caller cannot even construct this call with it. A raw
     *  Server Action POST bypasses that, so the runtime check below is what
     *  actually protects the invariant. */
    stage: CoachSettableStage | string;
    consultationDate?: string;
}) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    // ACTIVE can never be set through a stage edit — this is checked before
    // the transition map so re-adding a map entry cannot re-open the hole
    // that let a stage edit strand a lead with no relationship and no
    // invite (T-978).
    if (!COACH_SETTABLE_STAGES.includes(input.stage as CoachSettableStage)) {
        throw new Error("Activation is not a stage edit — use Activate on this lead.");
    }

    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, consultationDate: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    const allowed = VALID_STAGE_TRANSITIONS[request.consultationStage];
    if (!allowed || !allowed.includes(input.stage)) {
        throw new Error(`Cannot move from ${request.consultationStage} to ${input.stage}`);
    }

    const data: Record<string, unknown> = { consultationStage: input.stage };
    if (input.consultationDate) {
        data.consultationDate = new Date(input.consultationDate);
    } else if (input.stage === "CONSULTATION_SCHEDULED" && !request.consultationDate) {
        // Fall back to consultationMeeting.scheduledTime if available
        const meeting = await db.consultationMeeting.findUnique({ where: { requestId: input.requestId }, select: { scheduledTime: true } });
        if (meeting?.scheduledTime) data.consultationDate = meeting.scheduledTime;
    }

    await db.coachingRequest.update({
        where: { id: input.requestId },
        data,
    });

    revalidatePath("/coach/leads");
    return { success: true };
}

/**
 * Bypass the intake pipeline and activate directly. Signature unchanged
 * (T-978): the ownership check, the raw-SQL stage write and the swallowed
 * "non-fatal" catch that used to live here are gone — they now live once,
 * inside `activateLead`.
 */
export async function bypassPipelineAndActivate(input: { requestId: string }): Promise<ActivateActionResult> {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const result = await activateLead({ requestId: input.requestId, coachUserId: user.id, mode: "BYPASS" });

    revalidatePath("/coach/leads");
    revalidatePath("/coach/dashboard");

    if (result.ok && result.outcome === "already_active") {
        // Bypass has always refused an already-active lead (409 on the REST
        // twin), unlike the pipeline Activate button below, which treats it
        // as an idempotent success. Preserved byte for byte.
        return { success: false, refusal: "already_active", message: "Already active." };
    }

    return toActivateActionResult(result);
}

/**
 * Activate a lead from the normal pipeline (FORMS_SIGNED or
 * INTAKE_SUBMITTED only). Signature unchanged (T-978): the ownership check,
 * the stage guard and the direct `consultationStage` write that used to
 * live here are gone — they now live once, inside `activateLead`.
 * Keeps throwing "Request not found" on `not_found`, exactly as before —
 * `activate/route.ts` turns that into a 404.
 */
export async function activateClient(input: { requestId: string }): Promise<ActivateActionResult> {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const result = await activateLead({ requestId: input.requestId, coachUserId: user.id, mode: "PIPELINE" });

    if (!result.ok && result.refusal === "not_found") {
        throw new Error(ACTIVATE_NOT_FOUND_ERROR);
    }

    revalidatePath("/coach/leads");
    revalidatePath("/coach/dashboard");

    return toActivateActionResult(result);
}

const addLeadSchema = z.object({
    prospectName: z.string().min(2).max(100),
    prospectEmailAddr: z.string().email(),
    prospectPhone: z.string().min(7),
    goals: z.string().optional(),
    source: z.enum(["REFERRAL", "SOCIAL_MEDIA", "IN_PERSON", "OTHER"]),
});

const PREVIOUS_STAGE: Record<string, string> = {
    CONSULTATION_SCHEDULED: "PENDING",
    CONSULTATION_DONE: "CONSULTATION_SCHEDULED",
    INTAKE_SENT: "CONSULTATION_DONE",
    INTAKE_SUBMITTED: "INTAKE_SENT",
    FORMS_SENT: "INTAKE_SUBMITTED",
    FORMS_SIGNED: "FORMS_SENT",
};

export async function goBackStage(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    const prev = PREVIOUS_STAGE[request.consultationStage];
    if (!prev) {
        throw new Error(`Cannot go back from ${request.consultationStage}`);
    }

    await db.coachingRequest.update({
        where: { id: requestId },
        data: { consultationStage: prev as ConsultationStage },
    });

    revalidatePath("/coach/leads");
    revalidatePath(`/coach/leads/${requestId}`);
    return { success: true, stage: prev };
}

export async function addLeadManually(input: z.input<typeof addLeadSchema>) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const parsed = addLeadSchema.safeParse(input);
    if (!parsed.success) {
        return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
    }
    const { prospectName, prospectEmailAddr, prospectPhone, goals, source } = parsed.data;

    const profile = await db.coachProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
    });
    if (!profile) throw new Error("No coaching profile found.");

    // Duplicate check
    const existing = await db.coachingRequest.findFirst({
        where: { coachProfileId: profile.id, prospectEmailAddr },
    });
    if (existing) {
        return { success: false, message: "A lead with this email already exists in your pipeline." };
    }

    const sourceLabels: Record<string, string> = {
        REFERRAL: "Referral",
        SOCIAL_MEDIA: "Social Media",
        IN_PERSON: "In Person",
        OTHER: "Other",
    };

    await db.coachingRequest.create({
        data: {
            coachProfileId: profile.id,
            prospectName,
            prospectEmail: prospectPhone, // backwards compat field
            prospectEmailAddr,
            prospectPhone,
            intakeAnswers: { goals: goals ?? "" },
            status: "PENDING",
            consultationStage: "PENDING",
            source: "EXTERNAL",
            sourceDetail: sourceLabels[source] ?? source,
        },
    });

    revalidatePath("/coach/leads");
    return { success: true };
}
