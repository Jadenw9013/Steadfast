"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

import { sendEmail } from "@/lib/email/sendEmail";
import { mergePacketSubmission } from "@/lib/intake/completion";
import { submitTokenIntake } from "@/lib/intake/token-submission";
import { IntakeTokenError, lockIntakePacket } from "@/lib/intake/token-access";
import { enqueueStorageCleanup } from "@/lib/storage/cleanup-outbox";
import { reportServerError } from "@/lib/observability/report";

/** Resolve the current coach's CoachProfile.id. */
async function getCoachProfileId(userId: string): Promise<string> {
    const profile = await db.coachProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new Error("Coach profile not found");
    return profile.id;
}

/**
 * Resolve the prospect's email by exact identity only, else null (fail closed:
 * the caller sends nothing and writes nothing).
 *
 * T-980: there is deliberately no phone tier. A phone-number substring match
 * is not proof of identity — it emailed the coach's intake packet to any
 * account whose number shared the last ten digits and backfilled that
 * stranger's address into the lead. CB01
 * (e654a4c) removed the same matcher from lib/activation.ts and
 * coaching-requests.ts for the same reason.
 */
async function resolveProspectEmail(request: {
    id: string;
    prospectEmailAddr: string | null;
    prospectId: string | null;
    prospectEmail: string;
}): Promise<string | null> {
    // 1. Direct field
    if (request.prospectEmailAddr) return request.prospectEmailAddr;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.prospectEmail)) return request.prospectEmail;

    let email: string | null = null;

    // 2. Linked User record (exact id)
    if (request.prospectId) {
        const user = await db.user.findUnique({ where: { id: request.prospectId }, select: { email: true } });
        if (user?.email) email = user.email;
    }

    // Backfill so future sends skip the lookup (exact-id tier only)
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
    const result = await submitTokenIntake(input);
    if (!result.success) return result;
    try {
        const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
        const { intakeSubmittedNotificationEmail } = await import("@/lib/email/templates");
        const reviewUrl = `${appUrl}/coach/leads/${result.notification.requestId}/review`;
        const emailContent = intakeSubmittedNotificationEmail(result.notification.prospectName, reviewUrl);
        await sendEmail({ to: result.notification.coachEmail, ...emailContent });
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
        select: { id: true, coachingRequestId: true, formAnswers: true },
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
    // Same merge as the client submit above, for the same reason: a wholesale
    // write dropped every flat answer the client saved from iOS and any
    // `_coachNotes`/`_savedAt` metadata. Callers differ in shape:
    // `intake-summary-panel` sends `{ sections }` only, but `review-session`
    // spreads the stored packet and replaces `sections`, so its payload also
    // carries stale flat keys. `mergePacketSubmission` resolves that with
    // nested-wins precedence (see `packetAnswerItems`), which is what makes the
    // coach's edit stick — a flat key outranks nested on read (`flattenPacketAnswers`).
    if (input.formAnswers !== undefined) {
        data.formAnswers = mergePacketSubmission(packet.formAnswers, input.formAnswers) as object;
    }
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

    if (typeof token !== "string" || !token || token.length > 128 || typeof intakePacketDocumentId !== "string" || !intakePacketDocumentId || intakePacketDocumentId.length > 128 || !(file instanceof File)) {
        return { success: false, message: "Missing required fields." };
    }

    // Validate file
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
        return { success: false, message: "Only PDF, JPG, and PNG files are accepted." };
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_SIZE || file.name.length > 200) {
        return { success: false, message: "File must be under 10MB." };
    }

    let storagePath: string | null = null;
    try {
      const preliminary = await db.$transaction(tx => lockIntakePacket(tx, token));
      const preliminaryDocument = preliminary.packet.documents.find(document => document.id === intakePacketDocumentId);
      if (!preliminaryDocument || preliminaryDocument.coachDocument.type !== "FILE" || preliminaryDocument.coachDocument.coachId !== preliminary.coach.id) throw new IntakeTokenError("Document not found.");
      const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
      storagePath = `signed-uploads/${preliminary.packet.id}/${crypto.randomUUID()}.${ext}`;
      const { uploadCoachDocument } = await import("@/lib/supabase/document-storage");
      await uploadCoachDocument(storagePath, Buffer.from(await file.arrayBuffer()), file.type);
      await db.$transaction(async tx => {
        const { packet, coach } = await lockIntakePacket(tx, token);
        const doc = packet.documents.find(document => document.id === intakePacketDocumentId);
        if (!doc || doc.coachDocument.type !== "FILE" || doc.coachDocument.coachId !== coach.id) throw new IntakeTokenError("Document not found.");
        if (doc.uploadedSignedFilePath) await tx.storageCleanupOutbox.upsert({
            where: { bucket_storagePath: { bucket: "coach-documents", storagePath: doc.uploadedSignedFilePath } },
            create: { bucket: "coach-documents", storagePath: doc.uploadedSignedFilePath, reason: "signed-upload-replaced" },
            update: {},
        });
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
    } catch (error) {
      if (storagePath) {
        try { await enqueueStorageCleanup([{ bucket: "coach-documents", storagePath, reason: "signed-upload-refused" }]); }
        catch (cleanupError) { reportServerError("sf.intake.upload_cleanup_failed", cleanupError, { route: "/onboarding/intake/[token]", method: "POST" }); }
      }
      if (error instanceof IntakeTokenError) return { success: false, message: error.message };
      reportServerError("sf.intake.upload_failed", error, { route: "/onboarding/intake/[token]", method: "POST" });
      return { success: false, message: "We couldn't save the signed file. Please try again." };
    }
}

export async function removeSignedUpload(input: { token: string; intakePacketDocumentId: string }) {
    try {
      if (typeof input?.token !== "string" || !input.token || input.token.length > 128 || typeof input.intakePacketDocumentId !== "string") return { success: false, message: "Invalid link." };
      await db.$transaction(async tx => {
        const { packet } = await lockIntakePacket(tx, input.token);
        const doc = packet.documents.find(document => document.id === input.intakePacketDocumentId);
        if (!doc?.uploadedSignedFilePath) throw new IntakeTokenError("No uploaded file found.");
        await tx.storageCleanupOutbox.upsert({
            where: { bucket_storagePath: { bucket: "coach-documents", storagePath: doc.uploadedSignedFilePath } },
            create: { bucket: "coach-documents", storagePath: doc.uploadedSignedFilePath, reason: "signed-upload-removed" },
            update: {},
        });
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
    } catch (error) {
      if (error instanceof IntakeTokenError) return { success: false, message: error.message };
      reportServerError("sf.intake.remove_upload_failed", error, { route: "/onboarding/intake/[token]", method: "POST" });
      return { success: false, message: "We couldn't remove the signed file. Please try again." };
    }
}
