import { z } from "zod";
import { db } from "@/lib/db";
import { reportAnomaly, reportServerError } from "@/lib/observability/report";
import { IntakeTokenError, lockIntakePacket } from "./token-access";
import { DOCUMENTS_UNSIGNED_MESSAGE, INTAKE_INCOMPLETE_MESSAGE, flattenPacketAnswers, mergePacketSubmission, missingRequiredAnswers, resolveIntakeTemplate, unsignedDocumentIds } from "./completion";

export const tokenSignatureSchema = z.object({
  signatureType: z.enum(["TYPED", "DRAWN"]),
  signatureValue: z.string().trim().min(1).max(256000),
}).refine(signature => signature.signatureType === "TYPED"
  ? signature.signatureValue.length <= 300
  : /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature.signatureValue));

const submissionSchema = z.object({
  token: z.string().min(1).max(128),
  answers: z.record(z.string(), z.unknown()),
  documentSignatures: z.array(tokenSignatureSchema.and(z.object({
    intakePacketDocumentId: z.string().min(1).max(128),
    coachDocumentId: z.string().min(1).max(128),
  }))).max(50),
});

export async function submitTokenIntake(input: unknown) {
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, message: "Please check your answers and signatures." };
  const data = parsed.data;
  try {
    if (Buffer.byteLength(JSON.stringify(data)) > 512000) return { success: false as const, message: "Your submission is too large." };
  } catch {
    return { success: false as const, message: "Invalid form submission." };
  }
  try {
    return await db.$transaction(async tx => {
      const { packet, request, coach } = await lockIntakePacket(tx, data.token);
      if (packet.documents.some(document => document.coachDocument.coachId !== coach.id || (document.signature && document.signature.coachDocumentId !== document.coachDocumentId))) {
        reportAnomaly("sf.intake.document_scope_mismatch", { route: "/onboarding/intake/[token]", ids: { requestId: request.id } });
        throw new IntakeTokenError("A document needs your coach's attention before you can submit.");
      }
      const documentMap = new Map(packet.documents.map(document => [document.id, document]));
      const seen = new Set<string>();
      for (const signature of data.documentSignatures) {
        const document = documentMap.get(signature.intakePacketDocumentId);
        if (!document || seen.has(document.id) || signature.coachDocumentId !== document.coachDocumentId || document.coachDocument.coachId !== coach.id) {
          throw new IntakeTokenError("A document changed. Refresh the form and try again.");
        }
        if (document.coachDocument.type === "FILE" && (!document.uploadedSignedFilePath || !document.uploadedSignedAt || !document.signature)) {
          throw new IntakeTokenError("Upload the signed document before submitting.");
        }
        seen.add(document.id);
      }
      const signedIds = [...seen, ...packet.documents.filter(document => document.signature &&
        (document.coachDocument.type === "FILE"
          ? document.uploadedSignedFilePath && document.uploadedSignedAt
          : tokenSignatureSchema.safeParse(document.signature).success)
      ).map(document => document.id)];
      if (unsignedDocumentIds(packet.documents, signedIds).length) throw new IntakeTokenError(DOCUMENTS_UNSIGNED_MESSAGE);
      const template = await tx.intakeFormTemplate.findUnique({ where: { coachId: coach.id } });
      const answers = mergePacketSubmission(packet.formAnswers, data.answers);
      if (missingRequiredAnswers(resolveIntakeTemplate(template).sections, flattenPacketAnswers(answers)).length) {
        throw new IntakeTokenError(INTAKE_INCOMPLETE_MESSAGE);
      }
      await tx.intakePacket.update({
        where: { id: packet.id },
        data: { formAnswers: answers as object, submittedAt: new Date() },
      });
      for (const signature of data.documentSignatures) {
        const document = documentMap.get(signature.intakePacketDocumentId)!;
        if (document.coachDocument.type === "FILE") continue;
        await tx.documentSignature.upsert({
          where: { intakePacketDocumentId: document.id },
          create: signature,
          update: { signatureType: signature.signatureType, signatureValue: signature.signatureValue, signedAt: new Date() },
        });
      }
      await tx.coachingRequest.updateMany({
        where: { id: request.id, consultationStage: { notIn: ["ACTIVE", "DECLINED", "FORMS_SENT", "FORMS_SIGNED"] } },
        data: { consultationStage: "INTAKE_SUBMITTED" },
      });
      return { success: true as const, notification: { coachEmail: coach.email, prospectName: request.prospectName, requestId: request.id } };
    });
  } catch (error) {
    if (error instanceof IntakeTokenError) return { success: false as const, message: error.message };
    reportServerError("sf.intake.token_submit_failed", error, { route: "/onboarding/intake/[token]", method: "POST" });
    return { success: false as const, message: "We couldn't save your form. Please try again." };
  }
}
