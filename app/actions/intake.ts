"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

const sendEmail = async (opts: { to: string; subject: string; text: string }) => {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: process.env.EMAIL_FROM || "Steadfast <noreply@steadfast.app>", ...opts });
};

/** Resolve prospect email with 3-step fallback + backfill. */
async function resolveProspectEmail(request: {
    id: string;
    prospectEmailAddr: string | null;
    prospectId: string | null;
    prospectPhone: string | null;
    prospectEmail: string;
}): Promise<string | null> {
    // 1. Direct field
    if (request.prospectEmailAddr) return request.prospectEmailAddr;

    let email: string | null = null;

    // 2. Linked User record
    if (request.prospectId) {
        const user = await db.user.findUnique({ where: { id: request.prospectId }, select: { email: true } });
        if (user?.email) email = user.email;
    }

    // 3. Phone lookup fallback
    if (!email) {
        const phone = (request.prospectPhone ?? request.prospectEmail ?? "").replace(/\D/g, "");
        if (phone.length >= 10) {
            const user = await db.user.findFirst({
                where: { phoneNumber: { contains: phone.slice(-10) } },
                select: { email: true },
            });
            if (user?.email) email = user.email;
        }
    }

    // Backfill so future sends skip the lookup
    if (email) {
        await db.coachingRequest.update({ where: { id: request.id }, data: { prospectEmailAddr: email } });
    }

    return email;
}

export async function saveIntakeDraft(input: {
    requestId: string;
    answers: Record<string, unknown>;
}) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        include: { coachProfile: true },
    });
    if (!request || request.coachProfile.userId !== user.id) throw new Error("Request not found");

    const submission = await db.clientFormSubmission.upsert({
        where: { coachingRequestId: input.requestId },
        create: {
            coachingRequestId: input.requestId,
            answers: input.answers as Record<string, string>,
            status: "DRAFT",
        },
        update: {
            answers: input.answers as Record<string, string>,
        },
    });

    return { success: true, submissionId: submission.id };
}

export async function markIntakeReadyToSend(input: {
    requestId: string;
    coachNotes?: string;
}) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        include: { coachProfile: true, formSubmission: true },
    });
    if (!request || request.coachProfile.userId !== user.id) throw new Error("Request not found");
    if (!request.formSubmission) throw new Error("No intake form exists for this lead.");

    const answers = request.formSubmission.answers as Record<string, unknown>;

    // Dynamic validation — load coach's template to find required questions
    const template = await db.intakeFormTemplate.findUnique({ where: { coachId: user.id } });
    if (template) {
        const sections = template.sections as unknown as { questions: { id: string; label: string; required: boolean }[] }[];
        const missingFields: string[] = [];
        const storedAnswers = (answers as { sections?: { answers: { questionId: string; value: string }[] }[] })?.sections;
        const flatAnswers = new Map<string, string>();
        if (storedAnswers) {
            for (const sec of storedAnswers) {
                for (const a of sec.answers) flatAnswers.set(a.questionId, a.value);
            }
        }
        for (const sec of sections) {
            for (const q of sec.questions) {
                if (q.required && !flatAnswers.get(q.id)?.trim()) {
                    missingFields.push(q.label);
                }
            }
        }
        if (missingFields.length > 0) return { success: false, missingFields };
    }

    await db.clientFormSubmission.update({
        where: { coachingRequestId: input.requestId },
        data: {
            status: "READY_TO_SEND",
            completedAt: new Date(),
            answers: { ...answers, _coachNotes: input.coachNotes ?? "" },
        },
    });

    return { success: true };
}

export async function sendFormsForSignature(input: {
    requestId: string;
}) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        include: { coachProfile: true, formSubmission: true },
    });
    if (!request || request.coachProfile.userId !== user.id) throw new Error("Request not found");
    if (!request.formSubmission || request.formSubmission.status !== "READY_TO_SEND") {
        return { success: false, message: "Intake form is not ready to send. Complete all required fields first." };
    }

    const prospectEmail = await resolveProspectEmail(request);
    if (!prospectEmail) {
        return { success: false, message: "No email on file. Update the lead with the prospect's email before sending." };
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.coachingRequest.update({
        where: { id: input.requestId },
        data: {
            formsToken: token,
            formsTokenExpiresAt: expiresAt,
            formsSentAt: new Date(),
            consultationStage: "FORMS_SENT",
        },
    });

    await db.clientFormSubmission.update({
        where: { coachingRequestId: input.requestId },
        data: { status: "SENT" },
    });

    // Send email
    try {
        const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
        const { formsForSignatureEmail } = await import("@/lib/email/templates");
        const signLink = `${appUrl}/onboarding/sign/${token}`;
        const emailContent = formsForSignatureEmail(request.prospectName, user.firstName || "Your coach", signLink);
        await sendEmail({ to: prospectEmail, ...emailContent });
    } catch { /* email failure must not block */ }

    revalidatePath("/coach/leads");
    return { success: true, email: prospectEmail };
}

export async function sendIntakePacket(input: {
    requestId: string;
    documentIds: string[];
}) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        include: { coachProfile: true },
    });
    if (!request || request.coachProfile.userId !== user.id) throw new Error("Request not found");

    if (!["CONSULTATION_DONE", "CONSULTATION_SCHEDULED", "INTAKE_SENT"].includes(request.consultationStage)) {
        return { success: false, message: "Lead must be in Consultation Done, Consultation Scheduled, or Intake Sent stage." };
    }

    const prospectEmail = await resolveProspectEmail(request);
    if (!prospectEmail) {
        return { success: false, message: "No email on file. Update the lead with the prospect's email before sending." };
    }

    const token = crypto.randomUUID();
    const tokenExpiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    // Upsert: update existing packet if resending, otherwise create
    const existing = await db.intakePacket.findUnique({ where: { coachingRequestId: input.requestId } });
    if (existing) {
        await db.intakePacket.update({
            where: { id: existing.id },
            data: { token, tokenExpiresAt, sentAt: new Date() },
        });
    } else {
        await db.intakePacket.create({
            data: {
                coachingRequestId: input.requestId,
                token,
                tokenExpiresAt,
                documents: input.documentIds.length > 0 ? {
                    create: input.documentIds.map((docId, index) => ({
                        coachDocumentId: docId,
                        sortOrder: index,
                    })),
                } : undefined,
            },
        });
    }

    await db.coachingRequest.update({
        where: { id: input.requestId },
        data: { consultationStage: "INTAKE_SENT" },
    });

    try {
        const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
        const { intakePacketSentEmail } = await import("@/lib/email/templates");
        const intakeUrl = `${appUrl}/onboarding/intake/${token}`;
        const emailContent = intakePacketSentEmail(request.prospectName, user.firstName || "Your coach", intakeUrl, input.documentIds.length);
        await sendEmail({ to: prospectEmail, ...emailContent });
    } catch { /* email failure must not block */ }

    revalidatePath("/coach/leads");
    return { success: true };
}

export async function submitIntakePacket(input: {
    token: string;
    answers: Record<string, unknown>;
    documentSignatures: { intakePacketDocumentId: string; coachDocumentId: string; signatureType: "TYPED" | "DRAWN"; signatureValue: string }[];
}) {
    // Token-gated — no auth required
    const packet = await db.intakePacket.findUnique({
        where: { token: input.token },
        include: {
            coachingRequest: { include: { coachProfile: { include: { user: true } } } },
            documents: true,
        },
    });

    if (!packet) return { success: false, message: "Invalid link." };
    if (packet.tokenExpiresAt < new Date()) return { success: false, message: "This link has expired. Please contact your coach for a new one." };
    if (packet.submittedAt) return { success: false, message: "You have already submitted this form." };

    // Validate all docs have signatures
    if (packet.documents.length > 0) {
        const signedDocIds = new Set(input.documentSignatures.map(s => s.intakePacketDocumentId));
        const unsigned = packet.documents.filter(d => !signedDocIds.has(d.id));
        if (unsigned.length > 0) return { success: false, message: "Please sign all documents before submitting." };
    }

    // Store answers + signatures
    await db.$transaction(async (tx) => {
        await tx.intakePacket.update({
            where: { id: packet.id },
            data: {
                formAnswers: input.answers as object,
                submittedAt: new Date(),
            },
        });

        for (const sig of input.documentSignatures) {
            await tx.documentSignature.create({
                data: {
                    intakePacketDocumentId: sig.intakePacketDocumentId,
                    coachDocumentId: sig.coachDocumentId,
                    signatureType: sig.signatureType,
                    signatureValue: sig.signatureValue,
                },
            });
        }

        await tx.coachingRequest.update({
            where: { id: packet.coachingRequestId },
            data: { consultationStage: "INTAKE_SUBMITTED" },
        });
    });

    // Email coach
    try {
        const coachUser = packet.coachingRequest.coachProfile.user;
        const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
        const { intakeSubmittedNotificationEmail } = await import("@/lib/email/templates");
        const reviewUrl = `${appUrl}/coach/leads/${packet.coachingRequestId}/review`;
        const emailContent = intakeSubmittedNotificationEmail(packet.coachingRequest.prospectName, reviewUrl);
        await sendEmail({ to: coachUser.email, ...emailContent });
    } catch { /* email failure must not block */ }

    return { success: true };
}

export async function saveReviewEdits(input: {
    packetId: string;
    formAnswers?: Record<string, unknown>;
    coachNotes?: string;
}) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const packet = await db.intakePacket.findUnique({
        where: { id: input.packetId },
        include: { coachingRequest: { include: { coachProfile: true } } },
    });
    if (!packet || packet.coachingRequest.coachProfile.userId !== user.id) throw new Error("Not found");

    const data: Record<string, unknown> = {};
    if (input.formAnswers !== undefined) data.formAnswers = input.formAnswers as object;
    if (input.coachNotes !== undefined) data.coachNotes = input.coachNotes;

    await db.intakePacket.update({ where: { id: input.packetId }, data });
    return { success: true };
}

export async function resendFormsLink(input: { requestId: string }) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();
    if (!user.isCoach) throw new Error("Unauthorized");

    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        include: { coachProfile: true },
    });
    if (!request || request.coachProfile.userId !== user.id) throw new Error("Request not found");

    if (request.consultationStage !== "FORMS_SENT") {
        return { success: false, message: "Lead must be in Forms Sent stage." };
    }

    const prospectEmail = await resolveProspectEmail(request);
    if (!prospectEmail) {
        return { success: false, message: "No email on file." };
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.coachingRequest.update({
        where: { id: input.requestId },
        data: {
            formsToken: token,
            formsTokenExpiresAt: expiresAt,
            formsSentAt: new Date(),
        },
    });

    try {
        const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
        const { formsForSignatureEmail } = await import("@/lib/email/templates");
        const signLink = `${appUrl}/onboarding/sign/${token}`;
        const emailContent = formsForSignatureEmail(request.prospectName, user.firstName || "Your coach", signLink);
        await sendEmail({ to: prospectEmail, ...emailContent });
    } catch { /* email failure must not block */ }

    revalidatePath("/coach/leads");
    return { success: true };
}
