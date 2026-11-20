"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { tokenSignatureSchema } from "@/lib/intake/token-submission";
import { IntakeTokenError } from "@/lib/intake/token-access";
import { reportServerError } from "@/lib/observability/report";
import { sendEmail } from "@/lib/email/sendEmail";

export async function submitSignature(input: {
    token: string;
    signatureType: "TYPED" | "DRAWN";
    signatureValue: string;
}) {
    const parsed = tokenSignatureSchema.and(z.object({ token: z.string().min(1).max(128) })).safeParse(input);
    if (!parsed.success) return { success: false, message: "Please check your signature." };
    const hdrs = await headers();
    const ipAddress = process.env.VERCEL === "1" ? hdrs.get("x-vercel-forwarded-for")?.slice(0, 64) ?? null : null;
    const userAgent = hdrs.get("user-agent")?.slice(0, 512) ?? null;
    const now = new Date();
    let request;
    try {
        request = await db.$transaction(async tx => {
            const reference = await tx.coachingRequest.findUnique({ where: { formsToken: parsed.data.token }, select: { id: true, coachProfile: { select: { userId: true } } } });
            if (!reference) throw new IntakeTokenError("Invalid token.");
            await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${reference.coachProfile.userId} FOR SHARE`;
            await tx.$queryRaw`SELECT "id" FROM "CoachingRequest" WHERE "id" = ${reference.id} FOR UPDATE`;
            const current = await tx.coachingRequest.findUnique({
                where: { formsToken: parsed.data.token },
                select: { id: true, prospectId: true, prospectName: true, consultationStage: true, formsTokenExpiresAt: true, formSubmission: { select: { id: true } }, coachProfile: { select: { user: { select: { email: true, firstName: true, isCoach: true, isDeactivated: true } } } } },
            });
            if (!current || !current.formsTokenExpiresAt || current.formsTokenExpiresAt <= now || current.consultationStage !== "FORMS_SENT" || !current.formSubmission || !current.coachProfile.user.isCoach || current.coachProfile.user.isDeactivated) {
                throw new IntakeTokenError("This link is no longer available. Ask your coach for a new link.");
            }
            await tx.clientFormSignature.create({ data: { coachingRequestId: current.id, signatureType: parsed.data.signatureType, signatureValue: parsed.data.signatureValue, signedAt: now, ipAddress, userAgent } });
            await tx.coachingRequest.update({ where: { id: current.id }, data: { formsSignedAt: now, consultationStage: "FORMS_SIGNED" }, select: { id: true } });
            await tx.clientFormSubmission.update({ where: { id: current.formSubmission.id }, data: { status: "SIGNED", completedAt: now } });
            return current;
        });
    } catch (error) {
        if (error instanceof IntakeTokenError) return { success: false, message: error.message };
        reportServerError("sf.intake.signature_failed", error, { route: "/onboarding/sign/[token]", method: "POST" });
        return { success: false, message: "We couldn't save your signature. Please try again." };
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
