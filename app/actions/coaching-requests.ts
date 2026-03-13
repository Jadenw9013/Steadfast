"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { sendEmail } from "@/lib/email/sendEmail";
import {
    requestReceivedEmail,
    newRequestNotificationEmail,
    requestApprovedEmail,
    waitlistConfirmationEmail,
} from "@/lib/email/templates";

const coachingRequestSchema = z.object({
    coachProfileId: z.string().cuid(),
    prospectName: z.string().min(2, "Name must be at least 2 characters").max(100),
    prospectEmail: z.string().email("Invalid email address"),
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
    const normalizedEmail = validated.prospectEmail.toLowerCase();

    // Check if profile exists and is published
    const profile = await db.coachProfile.findUnique({
        where: { id: validated.coachProfileId },
        include: { user: { select: { firstName: true, email: true, emailCoachingRequests: true } } },
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
            prospectEmail: normalizedEmail,
            status: "PENDING",
        },
    });

    if (existingPending) {
        throw new Error("You already have a pending request with this coach. Please wait for them to respond.");
    }

    // Create Request
    const request = await db.coachingRequest.create({
        data: {
            coachProfileId: validated.coachProfileId,
            prospectName: validated.prospectName,
            prospectEmail: normalizedEmail,
            intakeAnswers: validated.intakeAnswers,
            status: "PENDING",
        },
    });

    console.info(JSON.stringify({
        event: "marketplace.request.submitted",
        requestId: request.id,
        coachProfileId: validated.coachProfileId,
        status: "PENDING",
        timestamp: new Date().toISOString(),
    }));

    // Send emails (fire-and-forget, never block the user flow)
    const coachName = profile.user.firstName || "Your coach";
    try {
        const receiptEmail = requestReceivedEmail(validated.prospectName, coachName);
        await sendEmail({ to: normalizedEmail, ...receiptEmail });
    } catch { /* email failure must not break request */ }

    // Coach notification email (preference-gated)
    if (profile.user.emailCoachingRequests) {
        try {
            const notifEmail = newRequestNotificationEmail(coachName, validated.prospectName, normalizedEmail);
            await sendEmail({ to: profile.user.email, ...notifEmail });
        } catch { /* email failure must not break request */ }
    }

    // Revalidate the coach's requests page so they see it
    revalidatePath("/coach/marketplace/requests");

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

    revalidatePath("/coach/marketplace/requests");
    return entry;
}

export async function approveCoachingRequest(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        include: { coachProfile: true },
    });

    if (!request || request.coachProfile.userId !== user.id) {
        throw new Error("Request not found");
    }

    if (request.status !== "PENDING") {
        throw new Error("This request is no longer pending.");
    }

    const updated = await db.coachingRequest.update({
        where: { id: requestId },
        data: { status: "APPROVED" },
    });

    console.info(JSON.stringify({
        event: "marketplace.request.approved",
        requestId: requestId,
        coachProfileId: request.coachProfile.id,
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
    const normalizedEmail = request.prospectEmail.toLowerCase();
    const existingUser = await db.user.findUnique({
        where: { email: normalizedEmail },
    });

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

    revalidatePath("/coach/marketplace/requests");
    revalidatePath("/coach/dashboard");
    return { ...updated, immediateLink };
}

export async function rejectCoachingRequest(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        include: { coachProfile: true },
    });

    if (!request || request.coachProfile.userId !== user.id) {
        throw new Error("Request not found");
    }

    if (request.status !== "PENDING" && request.status !== "WAITLISTED") {
        throw new Error("This request cannot be declined.");
    }

    const updated = await db.coachingRequest.update({
        where: { id: requestId },
        data: { status: "REJECTED" },
    });

    console.info(JSON.stringify({
        event: "marketplace.request.rejected",
        requestId: requestId,
        coachProfileId: request.coachProfile.id,
        status: "REJECTED",
        timestamp: new Date().toISOString(),
    }));

    revalidatePath("/coach/marketplace/requests");
    return updated;
}

export async function resendInvite(requestId: string) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: requestId },
        include: { coachProfile: true },
    });

    if (!request || request.coachProfile.userId !== user.id) {
        throw new Error("Request not found");
    }

    if (request.status !== "APPROVED") {
        return { success: false, message: "Only approved requests can receive invites." };
    }

    // Race condition guard: re-check if prospect signed up between page load and action
    if (request.prospectId) {
        return { success: false, message: "This person has already signed up and is connected." };
    }

    const normalizedEmail = request.prospectEmail.toLowerCase();
    const existingUser = await db.user.findUnique({
        where: { email: normalizedEmail },
    });

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

        revalidatePath("/coach/marketplace/requests");
        return { success: true, message: "Good news — they already signed up! They've been linked to your roster." };
    }

    // Send the invite email
    const coachName = user.firstName || "Your coach";
    const approvalEmail = requestApprovedEmail(request.prospectName, coachName);
    const emailResult = await sendEmail({ to: normalizedEmail, ...approvalEmail });

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
        coachProfileId: request.coachProfile.id,
        sendCount: (request.inviteSendCount || 0) + 1,
        timestamp: new Date().toISOString(),
    }));

    revalidatePath("/coach/marketplace/requests");
    return { success: true, message: "Invite resent successfully." };
}
