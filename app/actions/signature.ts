"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

const sendEmail = async (opts: { to: string; subject: string; text: string }) => {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: process.env.EMAIL_FROM || "Steadfast <noreply@steadfast.app>", ...opts });
};

export async function submitSignature(input: {
    token: string;
    signatureType: "TYPED" | "DRAWN";
    signatureValue: string;
}) {
    // Validate token server-side (never trust client)
    const request = await db.coachingRequest.findUnique({
        where: { formsToken: input.token },
        include: {
            coachProfile: { include: { user: true } },
            formSubmission: true,
        },
    });

    if (!request) return { success: false, message: "Invalid token." };
    if (request.formsTokenExpiresAt && request.formsTokenExpiresAt < new Date()) {
        return { success: false, message: "This link has expired. Please contact your coach to request a new link." };
    }
    if (request.consultationStage === "FORMS_SIGNED") {
        return { success: false, message: "You have already signed these forms." };
    }
    if (request.consultationStage !== "FORMS_SENT") {
        return { success: false, message: "This link is no longer valid." };
    }
    if (!input.signatureValue.trim()) {
        return { success: false, message: "Signature is required." };
    }

    // Get IP and user agent from headers
    const hdrs = await headers();
    const ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? null;
    const userAgent = hdrs.get("user-agent") ?? null;

    const now = new Date();

    // Create signature record
    await db.clientFormSignature.create({
        data: {
            coachingRequestId: request.id,
            signatureType: input.signatureType,
            signatureValue: input.signatureValue,
            signedAt: now,
            ipAddress,
            userAgent,
        },
    });

    // Update coaching request
    await db.coachingRequest.update({
        where: { id: request.id },
        data: {
            formsSignedAt: now,
            consultationStage: "FORMS_SIGNED",
        },
    });

    // Update form submission
    if (request.formSubmission) {
        await db.clientFormSubmission.update({
            where: { id: request.formSubmission.id },
            data: { status: "SIGNED", completedAt: now },
        });
    }

    // Send email to coach
    try {
        const coachEmail = request.coachProfile.user.email;
        const coachName = request.coachProfile.user.firstName || "Coach";
        const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
        const { formsSignedNotificationEmail } = await import("@/lib/email/templates");
        const leadUrl = `${appUrl}/coach/leads/${request.id}`;
        const emailContent = formsSignedNotificationEmail(coachName, request.prospectName, leadUrl);
        await sendEmail({ to: coachEmail, ...emailContent });
    } catch { /* email failure must not block */ }

    revalidatePath("/coach/leads");

    // Check if prospect has an account
    const prospectHasAccount = !!request.prospectId;

    return { success: true, prospectHasAccount };
}
