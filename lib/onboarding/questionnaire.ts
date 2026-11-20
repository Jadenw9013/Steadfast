import { db } from "@/lib/db";
import { isCurrentCoachInTransaction } from "@/lib/coach-client/write-access";
import { reportServerError } from "@/lib/observability/report";
import { onboardingQuestionSchema, submitOnboardingResponseSchema } from "@/lib/validations/onboarding-form";
import { z } from "zod";

type HumanProvider = { origin: string; resolutionRequired: boolean; coachId: string | null };

export async function getPendingClientQuestionnaire(clientId: string, provider: HumanProvider) {
  if (provider.origin !== "HUMAN" || provider.resolutionRequired || !provider.coachId) return null;
  const coachId = provider.coachId;
  return db.$transaction(async tx => {
    if (!await isCurrentCoachInTransaction(tx, coachId, clientId)) return null;
    const response = await tx.onboardingResponse.findUnique({ where: { clientId }, select: { id: true } });
    if (response) return null;
    return tx.onboardingForm.findFirst({
      where: { coachId, isActive: true },
      select: { id: true, questions: true, coach: { select: { firstName: true } } },
    });
  });
}

export function getCoachQuestionnaireResponse(coachId: string, clientId: string) {
  return db.onboardingResponse.findFirst({
    where: { clientId, coachId, form: { coachId } },
    include: { form: true },
  });
}

export async function saveClientQuestionnaire(clientId: string, input: unknown) {
  const parsed = submitOnboardingResponseSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, message: "Please check your answers." };
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${clientId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "OnboardingForm" WHERE "id" = ${parsed.data.formId} FOR SHARE`;
      const form = await tx.onboardingForm.findUnique({ where: { id: parsed.data.formId } });
      if (!form?.isActive || !await isCurrentCoachInTransaction(tx, form.coachId, clientId)) {
        return { success: false as const, message: "This questionnaire is no longer available from your current coach. Refresh to continue." };
      }
      const questions = z.array(onboardingQuestionSchema).max(50).safeParse(form.questions);
      if (!questions.success) return { success: false as const, message: "Your coach needs to update this questionnaire before you can submit it." };
      const answerMap = new Map(parsed.data.answers.map(answer => [answer.questionId, answer.answer]));
      if (answerMap.size !== parsed.data.answers.length || parsed.data.answers.some(answer => !questions.data.some(question => question.id === answer.questionId))) {
        return { success: false as const, message: "The questionnaire changed. Refresh and try again." };
      }
      for (const question of questions.data) {
        const answer = answerMap.get(question.id);
        const empty = answer === undefined || (typeof answer === "string" && !answer.trim());
        if (empty) {
          if (question.required) return { success: false as const, message: "Please answer every required question." };
          continue;
        }
        const valid = question.type === "number" ? typeof answer === "number" && Number.isFinite(answer)
          : question.type === "boolean" ? typeof answer === "boolean"
          : question.type === "multipleChoice" ? typeof answer === "string" && question.options?.includes(answer)
          : typeof answer === "string";
        if (!valid) return { success: false as const, message: "Please check the format of your answers." };
      }
      const existing = await tx.onboardingResponse.findUnique({ where: { clientId }, select: { id: true } });
      if (!existing) await tx.onboardingResponse.create({
        data: { clientId, coachId: form.coachId, formId: form.id, answers: parsed.data.answers },
      });
      return { success: true as const };
    });
  } catch (error) {
    reportServerError("sf.onboarding.submit_failed", error, { route: "/onboarding", method: "POST", ids: { clientId } });
    return { success: false as const, message: "We couldn't save your answers. Please try again." };
  }
}
