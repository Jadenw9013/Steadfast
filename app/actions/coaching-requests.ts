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

    // Send approval email to prospect
    const coachName = user.firstName || "Your coach";
    let emailSent = false;
    try {
        const approvalEmail = requestApprovedEmail(request.prospectName, coachName);
        const result = await sendEmail({ to: request.prospectEmail, ...approvalEmail });
        emailSent = result.success;
    } catch { /* email failure must not break approval */ }

    // Try to convert immediately if they already have an account
    const email = request.prospectEmailAddr ?? null;
    const phone = (request.prospectPhone ?? request.prospectEmail ?? "").replace(/\D/g, "");
    let existingUser = email
        ? await db.user.findUnique({ where: { email: email.toLowerCase() } })
        : null;
    if (!existingUser && phone.length >= 7) {
        existingUser = await db.user.findFirst({
            where: { phoneNumber: { contains: phone.slice(-10) } },
        });
    }

    let immediateLink = false;

    if (existingUser) {
        const existingConnection = await db.coachClient.findUnique({
            where: { coachId_clientId: { coachId: user.id, clientId: existingUser.id } },
        });
        if (!existingConnection) {
            await db.coachClient.create({
                data: {
                    coachId: user.id,
                    clientId: existingUser.id,
                    coachNotes: `Converted from marketplace request.`,
                },
            });
        }

        // Mark the request logic complete
        await db.coachingRequest.update({
            where: { id: requestId },
            data: { prospectId: existingUser.id },
        });

        immediateLink = true;

        // Background email: notify existing user they're connected
        try {
            const { coachConnectedEmail } = await import("@/lib/email/templates");
            if (existingUser.email) {
                const email = coachConnectedEmail(request.prospectName, coachName);
                sendEmail({ to: existingUser.email, ...email }).catch(console.error);
            }
        } catch { /* email failure must not break approval */ }
    } else if (emailSent) {
        // Track invite metadata for non-existing users only
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
    return { ...updated, immediateLink };
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

    const email = request.prospectEmailAddr ?? null;
    const phone = (request.prospectPhone ?? request.prospectEmail ?? "").replace(/\D/g, "");
    let existingUser = email
        ? await db.user.findUnique({ where: { email: email.toLowerCase() } })
        : null;
    if (!existingUser && phone.length >= 7) {
        existingUser = await db.user.findFirst({
            where: { phoneNumber: { contains: phone.slice(-10) } },
        });
    }

    if (existingUser) {
        // Prospect signed up since last page load — auto-link and inform coach
        const existingConnection = await db.coachClient.findUnique({
            where: { coachId_clientId: { coachId: user.id, clientId: existingUser.id } },
        });
        if (!existingConnection) {
            await db.coachClient.create({
                data: {
                    coachId: user.id,
                    clientId: existingUser.id,
                    coachNotes: `Converted from marketplace request.`,
                },
            });
        }
        await db.coachingRequest.update({
            where: { id: requestId },
            data: { prospectId: existingUser.id },
        });

        revalidatePath("/coach/leads");
        return { success: true, message: "Good news — they already signed up! They've been linked to your roster." };
    }

    // Send the invite email
    const coachName = user.firstName || "Your coach";
    const approvalEmail = requestApprovedEmail(request.prospectName, coachName);
    const emailResult = await sendEmail({ to: (email ?? request.prospectEmail), ...approvalEmail });

    if (!emailResult.success) {
        console.error(JSON.stringify({
            event: "marketplace.invite.resend_failed",
            requestId,
            error: emailResult.error,
            timestamp: new Date().toISOString(),
        }));
        return { success: false, message: "Unable to send the invite email right now. Please try again shortly." };
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
        sendCount: 1,
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

    // Create CoachClient if prospect has an account
    const email = request.prospectEmailAddr ?? null;
    const phone = (request.prospectPhone ?? request.prospectEmail ?? "").replace(/\D/g, "");
    let existingUser = email
        ? await db.user.findUnique({ where: { email: email.toLowerCase() } })
        : null;
    if (!existingUser && phone.length >= 7) {
        existingUser = await db.user.findFirst({
            where: { phoneNumber: { contains: phone.slice(-10) } },
        });
    }

    if (existingUser) {
        const existingConn = await db.coachClient.findUnique({
            where: { coachId_clientId: { coachId: user.id, clientId: existingUser.id } },
        });
        if (!existingConn) {
            await db.coachClient.create({
                data: { coachId: user.id, clientId: existingUser.id, coachNotes: "Accepted from lead." },
            });
        }
        await db.coachingRequest.update({
            where: { id: requestId },
            data: { status: "ACCEPTED", prospectId: existingUser.id },
        });
    } else {
        // No account yet — send sign-up invite email
        await db.coachingRequest.update({
            where: { id: requestId },
            data: { status: "ACCEPTED", inviteLastSentAt: new Date(), inviteSendCount: { increment: 1 } },
        });
        const coachName = user.firstName || "Your coach";
        try {
            const email = requestApprovedEmail(request.prospectName, coachName);
            await sendEmail({ to: request.prospectEmail, ...email });
        } catch { /* email failure must not block */ }
    }

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

const VALID_STAGE_TRANSITIONS: Record<string, string[]> = {
    PENDING: ["CONSULTATION_SCHEDULED"],
    CONSULTATION_SCHEDULED: ["CONSULTATION_DONE", "INTAKE_SENT"],
    CONSULTATION_DONE: ["FORMS_SENT", "INTAKE_SENT"],
    INTAKE_SENT: ["INTAKE_SUBMITTED"],
    INTAKE_SUBMITTED: ["FORMS_SENT"],
    FORMS_SENT: ["FORMS_SIGNED"],
    FORMS_SIGNED: ["ACTIVE"],
};

export async function updateConsultationStage(input: {
    requestId: string;
    stage: string;
    consultationDate?: string;
}) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

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

export async function bypassPipelineAndActivate(input: { requestId: string }) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    // 1. Verify ownership via raw SQL (avoids adapter-pg Json issues)
    const leads = await db.$queryRaw<Array<{
        id: string; consultationStage: string; prospectName: string;
        prospectEmail: string; prospectPhone: string | null; prospectEmailAddr: string | null;
    }>>`
        SELECT cr."id", cr."consultationStage", cr."prospectName",
               cr."prospectEmail", cr."prospectPhone", cr."prospectEmailAddr"
        FROM "CoachingRequest" cr
        JOIN "CoachProfile" cp ON cp."id" = cr."coachProfileId"
        WHERE cr."id" = ${input.requestId} AND cp."userId" = ${user.id}
        LIMIT 1
    `;
    if (leads.length === 0) return { success: false, message: "Lead not found." };
    const lead = leads[0];

    if (lead.consultationStage === "ACTIVE") {
        return { success: false, message: "Already active." };
    }

    // 2. Mark lead as ACTIVE — this always succeeds
    await db.$executeRaw`
        UPDATE "CoachingRequest"
        SET "consultationStage" = 'ACTIVE'::"ConsultationStage",
            "status" = 'ACCEPTED'::"RequestStatus",
            "updatedAt" = NOW()
        WHERE "id" = ${input.requestId}
    `;

    // 3. Best-effort: link prospect account if it exists
    let linked = false;
    try {
        const email = lead.prospectEmailAddr ?? null;
        const phone = (lead.prospectPhone ?? lead.prospectEmail ?? "").replace(/\D/g, "");

        let users: Array<{ id: string; email: string; firstName: string | null }> = [];
        if (email) {
            users = await db.$queryRaw<typeof users>`
                SELECT "id", "email", "firstName" FROM "User"
                WHERE LOWER("email") = ${email.toLowerCase()} LIMIT 1
            `;
        }
        if (users.length === 0 && phone.length >= 7) {
            users = await db.$queryRaw<typeof users>`
                SELECT "id", "email", "firstName" FROM "User"
                WHERE "phoneNumber" LIKE ${"%" + phone.slice(-10)} LIMIT 1
            `;
        }

        if (users.length > 0) {
            const prospect = users[0];
            await db.$executeRaw`
                UPDATE "CoachingRequest" SET "prospectId" = ${prospect.id}, "updatedAt" = NOW()
                WHERE "id" = ${input.requestId}
            `;
            await db.$executeRaw`
                INSERT INTO "CoachClient" ("id", "coachId", "clientId", "coachNotes", "createdAt")
                VALUES (gen_random_uuid()::text, ${user.id}, ${prospect.id}, 'Activated via pipeline bypass.', NOW())
                ON CONFLICT ("coachId", "clientId") DO NOTHING
            `;
            linked = true;

            try {
                const { coachConnectedEmail } = await import("@/lib/email/templates");
                const content = coachConnectedEmail(prospect.firstName || lead.prospectName, user.firstName || "Your coach");
                await sendEmail({ to: prospect.email, ...content });
            } catch { /* email never blocks */ }
        }
    } catch (err) {
        console.error("[bypassPipelineAndActivate] link failed (non-fatal):", err);
    }

    revalidatePath("/coach/leads");
    const message = linked
        ? `${lead.prospectName} has been activated and added to your roster.`
        : `${lead.prospectName} has been activated. They'll appear on your roster once they create their account.`;
    return { success: true, message };
}

export async function activateClient(input: { requestId: string }) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        select: { id: true, coachProfileId: true, status: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    if (request.consultationStage === "ACTIVE") {
        return { success: true, path: "already_active" as const };
    }
    if (request.consultationStage !== "FORMS_SIGNED" && request.consultationStage !== "INTAKE_SUBMITTED") {
        return { success: false, message: "This lead must complete intake before activating." };
    }

    const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
    const coachName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Your coach";

    // Prospect account lookup
    const email = request.prospectEmailAddr ?? null;
    const phone = (request.prospectPhone ?? request.prospectEmail ?? "").replace(/\D/g, "");
    let prospectUser = email
        ? await db.user.findUnique({ where: { email: email.toLowerCase() } })
        : null;
    if (!prospectUser && phone.length >= 7) {
        prospectUser = await db.user.findFirst({
            where: { phoneNumber: { contains: phone.slice(-10) } },
        });
    }

    if (prospectUser) {
        // Path A — prospect HAS a Steadfast account
        const existingConn = await db.coachClient.findUnique({
            where: { coachId_clientId: { coachId: user.id, clientId: prospectUser.id } },
        });
        if (!existingConn) {
            await db.coachClient.create({
                data: { coachId: user.id, clientId: prospectUser.id, coachNotes: "Activated from intake pipeline." },
            });
        }

        await db.coachingRequest.update({
            where: { id: input.requestId },
            data: {
                consultationStage: "ACTIVE",
                status: "ACCEPTED",
                prospectId: prospectUser.id,
            },
        });

        try {
            const { clientActivatedWelcomeEmail } = await import("@/lib/email/templates");
            const emailContent = clientActivatedWelcomeEmail(
                prospectUser.firstName || request.prospectName,
                coachName,
                `${appUrl}/client/dashboard`
            );
            await sendEmail({ to: prospectUser.email, ...emailContent });
        } catch { /* email failure must not block */ }

        revalidatePath("/coach/leads");
        revalidatePath("/coach/dashboard");
        return { success: true, path: "existing_account" as const, email: prospectUser.email, clientId: prospectUser.id };
    } else {
        // Path B — prospect does NOT have a Steadfast account
        const prospectEmail = email ?? request.prospectEmail;

        // Create ClientInvite (mirrors client-invites.ts pattern)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const invite = await db.clientInvite.create({
            data: {
                coachId: user.id,
                email: prospectEmail.toLowerCase(),
                name: request.prospectName,
                expiresAt,
            },
        });

        await db.coachingRequest.update({
            where: { id: input.requestId },
            data: {
                consultationStage: "ACTIVE",
                status: "ACCEPTED",
            },
        });

        try {
            const { clientActivatedInviteEmail } = await import("@/lib/email/templates");
            const inviteUrl = `${appUrl}/invite/${invite.inviteToken}`;
            const emailContent = clientActivatedInviteEmail(request.prospectName, coachName, inviteUrl);
            await sendEmail({ to: prospectEmail, ...emailContent });
        } catch { /* email failure must not block */ }

        revalidatePath("/coach/leads");
        revalidatePath("/coach/dashboard");
        return { success: true, path: "invite_sent" as const, email: prospectEmail };
    }
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
