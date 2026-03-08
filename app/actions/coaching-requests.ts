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
        include: { user: { select: { firstName: true, email: true } } },
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

    try {
        const notifEmail = newRequestNotificationEmail(coachName, validated.prospectName, normalizedEmail);
        await sendEmail({ to: profile.user.email, ...notifEmail });
    } catch { /* email failure must not break request */ }

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
    try {
        const approvalEmail = requestApprovedEmail(request.prospectName, coachName);
        await sendEmail({ to: request.prospectEmail, ...approvalEmail });
    } catch { /* email failure must not break approval */ }

    // Try to convert immediately if they already have an account
    const normalizedEmail = request.prospectEmail.toLowerCase();
    const existingUser = await db.user.findUnique({
        where: { email: normalizedEmail },
    });

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
    }

    revalidatePath("/coach/marketplace/requests");
    revalidatePath("/coach/dashboard");
    return updated;
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
