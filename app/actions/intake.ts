"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

import { sendEmail } from "@/lib/email/sendEmail";

/** Resolve the current coach's CoachProfile.id. */
async function getCoachProfileId(userId: string): Promise<string> {
    const profile = await db.coachProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new Error("Coach profile not found");
    return profile.id;
}

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
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.prospectEmail)) return request.prospectEmail;

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

    // adapter-pg safe: select only non-Json fields for auth check
    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        select: { id: true, coachProfileId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

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

/**
 * Client-side: let the prospect/client save their intake answers
 * to the same shared workspace (ClientFormSubmission).
 */
export async function saveClientIntakeDraft(input: {
    requestId: string;
    answers: Record<string, unknown>;
}) {
    const { getCurrentDbUser } = await import("@/lib/auth/roles");
    const user = await getCurrentDbUser();

    // Verify the user owns this coaching request (as prospect)
    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        select: { id: true, prospectId: true, prospectEmail: true },
    });
    if (!request) throw new Error("Request not found");
    const isOwner = request.prospectId === user.id || request.prospectEmail?.toLowerCase() === user.email?.toLowerCase();
    if (!isOwner) throw new Error("Unauthorized");

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

    // adapter-pg safe: separate queries
    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        select: { id: true, coachProfileId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    const formSubmission = await db.clientFormSubmission.findUnique({
        where: { coachingRequestId: input.requestId },
    });
    if (!formSubmission) throw new Error("No intake form exists for this lead.");

    const answers = formSubmission.answers as Record<string, unknown>;

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

    // adapter-pg safe: separate queries
    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        select: { id: true, coachProfileId: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    const formSubmission = await db.clientFormSubmission.findUnique({
        where: { coachingRequestId: input.requestId },
        select: { id: true, status: true },
    });
    if (!formSubmission || formSubmission.status !== "READY_TO_SEND") {
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

    // adapter-pg safe: select only
    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        select: { id: true, coachProfileId: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

    if (!["CONSULTATION_DONE", "CONSULTATION_SCHEDULED", "INTAKE_SENT", "PENDING"].includes(request.consultationStage)) {
        return { success: false, message: "Lead must be in a valid stage to send the intake." };
    }

    const prospectEmail = await resolveProspectEmail(request);
    if (!prospectEmail) {
        return { success: false, message: "No email on file. Update the lead with the prospect's email before sending." };
    }

    const uniqueDocumentIds = [...new Set(input.documentIds)];
    if (uniqueDocumentIds.length > 20) return { success: false, message: "Too many documents." };
    const ownedDocuments = await db.coachDocument.count({ where: { id: { in: uniqueDocumentIds }, coachId: user.id } });
    if (ownedDocuments !== uniqueDocumentIds.length) throw new Error("Invalid documents");

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
        const delivery = await sendEmail({ to: prospectEmail, ...emailContent });
        if (!delivery.success) return { success: false, message: "The intake was saved, but the email could not be sent. Please try sending again." };
    } catch {
        return { success: false, message: "The intake was saved, but the email could not be sent. Please try sending again." };
    }

    revalidatePath("/coach/leads");
    return { success: true };
}

export async function submitIntakePacket(input: {
    token: string;
    answers: Record<string, unknown>;
    documentSignatures: { intakePacketDocumentId: string; coachDocumentId: string; signatureType: "TYPED" | "DRAWN"; signatureValue: string }[];
}) {
    // Token-gated — no auth required
    // IntakePacket doesn't have Json columns at top level, but its related
    // coachingRequest does. Split the queries to avoid adapter-pg crash.
    const packet = await db.intakePacket.findUnique({
        where: { token: input.token },
        include: { documents: true },
    });

    if (!packet) return { success: false, message: "Invalid link." };
    if (packet.tokenExpiresAt < new Date()) return { success: false, message: "This link has expired. Please contact your coach for a new one." };
    if (packet.submittedAt) return { success: false, message: "You have already submitted this form." };

    // Fetch coaching request + coach info separately
    const requestRow = await db.coachingRequest.findUnique({
        where: { id: packet.coachingRequestId },
        select: { id: true, prospectName: true, coachProfileId: true },
    });
    const coachProfile = requestRow ? await db.coachProfile.findUnique({
        where: { id: requestRow.coachProfileId },
        select: { userId: true, user: { select: { email: true, firstName: true } } },
    }) : null;

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
        if (coachProfile?.user && requestRow) {
            const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
            const { intakeSubmittedNotificationEmail } = await import("@/lib/email/templates");
            const reviewUrl = `${appUrl}/coach/leads/${packet.coachingRequestId}/review`;
            const emailContent = intakeSubmittedNotificationEmail(requestRow.prospectName, reviewUrl);
            await sendEmail({ to: coachProfile.user.email, ...emailContent });
        }
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

    // adapter-pg safe: separate queries
    const packet = await db.intakePacket.findUnique({
        where: { id: input.packetId },
        select: { id: true, coachingRequestId: true },
    });
    if (!packet) throw new Error("Not found");

    const request = await db.coachingRequest.findUnique({
        where: { id: packet.coachingRequestId },
        select: { coachProfileId: true },
    });
    if (!request) throw new Error("Not found");

    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Not found");

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

    // adapter-pg safe: select only
    const request = await db.coachingRequest.findUnique({
        where: { id: input.requestId },
        select: { id: true, coachProfileId: true, consultationStage: true, prospectName: true, prospectEmail: true, prospectPhone: true, prospectEmailAddr: true, prospectId: true },
    });
    if (!request) throw new Error("Request not found");
    const profileId = await getCoachProfileId(user.id);
    if (request.coachProfileId !== profileId) throw new Error("Request not found");

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

const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

export async function uploadSignedDocument(formData: FormData) {
    const token = formData.get("token") as string;
    const intakePacketDocumentId = formData.get("intakePacketDocumentId") as string;
    const file = formData.get("file") as File | null;

    if (!token || !intakePacketDocumentId || !file) {
        return { success: false, message: "Missing required fields." };
    }

    // Token-gated — no auth required
    // IntakePacket.documents doesn't touch CoachingRequest Json — adapter-pg safe
    const packet = await db.intakePacket.findUnique({
        where: { token },
        include: { documents: { include: { coachDocument: true } } },
    });

    if (!packet) return { success: false, message: "Invalid link." };
    if (packet.tokenExpiresAt < new Date()) return { success: false, message: "This link has expired." };
    if (packet.submittedAt) return { success: false, message: "This form has already been submitted." };

    const doc = packet.documents.find(d => d.id === intakePacketDocumentId);
    if (!doc) return { success: false, message: "Document not found." };
    if (doc.coachDocument.type !== "FILE") return { success: false, message: "This document does not accept file uploads." };

    // Validate file
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
        return { success: false, message: "Only PDF, JPG, and PNG files are accepted." };
    }
    if (file.size > MAX_UPLOAD_SIZE) {
        return { success: false, message: "File must be under 10MB." };
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
    const storagePath = `signed-uploads/${packet.id}/${intakePacketDocumentId}.${ext}`;

    const { uploadCoachDocument } = await import("@/lib/supabase/document-storage");
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadCoachDocument(storagePath, buffer, file.type);

    // Update DB
    await db.$transaction(async (tx) => {
        await tx.intakePacketDocument.update({
            where: { id: intakePacketDocumentId },
            data: {
                uploadedSignedFilePath: storagePath,
                uploadedSignedFileName: file.name,
                uploadedSignedAt: new Date(),
            },
        });

        // Create or update DocumentSignature to mark as signed
        await tx.documentSignature.upsert({
            where: { intakePacketDocumentId },
            create: {
                intakePacketDocumentId,
                coachDocumentId: doc.coachDocumentId,
                signatureType: "TYPED",
                signatureValue: `FILE_UPLOADED:${file.name}`,
            },
            update: {
                signatureValue: `FILE_UPLOADED:${file.name}`,
                signedAt: new Date(),
            },
        });
    });

    return { success: true, filePath: storagePath, fileName: file.name };
}

export async function removeSignedUpload(input: { token: string; intakePacketDocumentId: string }) {
    const packet = await db.intakePacket.findUnique({
        where: { token: input.token },
        include: { documents: true },
    });

    if (!packet) return { success: false, message: "Invalid link." };
    if (packet.tokenExpiresAt < new Date()) return { success: false, message: "This link has expired." };
    if (packet.submittedAt) return { success: false, message: "This form has already been submitted." };

    const doc = packet.documents.find(d => d.id === input.intakePacketDocumentId);
    if (!doc || !doc.uploadedSignedFilePath) return { success: false, message: "No uploaded file found." };

    // Delete from Supabase
    try {
        const { deleteCoachDocumentFile } = await import("@/lib/supabase/document-storage");
        await deleteCoachDocumentFile(doc.uploadedSignedFilePath);
    } catch { /* deletion failure must not block */ }

    // Clear DB fields + remove signature
    await db.$transaction(async (tx) => {
        await tx.intakePacketDocument.update({
            where: { id: input.intakePacketDocumentId },
            data: {
                uploadedSignedFilePath: null,
                uploadedSignedFileName: null,
                uploadedSignedAt: null,
            },
        });
        await tx.documentSignature.deleteMany({
            where: { intakePacketDocumentId: input.intakePacketDocumentId },
        });
    });

    return { success: true };
}
