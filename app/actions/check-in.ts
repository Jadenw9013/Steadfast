"use server";

import { z } from "zod";
import { createCheckInSchema } from "@/lib/validations/check-in";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { normalizeToMonday, getLocalDate } from "@/lib/utils/date";
import { verifyCoachAccessToCheckIn } from "@/lib/queries/check-ins";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@/app/generated/prisma/client";

/** Serialize Zod-validated data to Prisma-compatible JSON. */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function createCheckIn(input: unknown) {
  const user = await getCurrentDbUser();

  if (user.activeRole !== "CLIENT") {
    throw new Error("Only clients can submit check-ins");
  }

  // Require an assigned coach
  const coachAssignment = await db.coachClient.findFirst({
    where: { clientId: user.id },
  });
  if (!coachAssignment) {
    return {
      error: {
        weekOf: [
          "You need to connect to a coach before submitting check-ins. Go to your dashboard to enter a coach code.",
        ],
      },
    };
  }

  const parsed = createCheckInSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const { weight, dietCompliance, energyLevel, notes, photoPaths, overwriteToday, templateId, customResponses } = parsed.data;

  const now = new Date();
  const weekDate = normalizeToMonday(now);
  const tz = user.timezone || "America/Los_Angeles";
  const localDate = getLocalDate(now, tz);

  // Resolve template snapshot if a templateId is provided
  let templateSnapshot: unknown = undefined;
  if (templateId) {
    const template = await db.checkInTemplate.findUnique({
      where: { id: templateId },
      select: { questions: true, version: true, name: true },
    });
    if (template) {
      templateSnapshot = {
        version: template.version,
        name: template.name,
        questions: template.questions,
      };
    }
  }

  const checkInFields = {
    weight,
    dietCompliance: typeof dietCompliance === "number" ? dietCompliance : null,
    energyLevel: typeof energyLevel === "number" ? energyLevel : null,
    notes: notes || null,
    ...(templateId && { templateId }),
    ...(templateSnapshot !== undefined && {
      templateSnapshot: toJsonValue(templateSnapshot),
    }),
    ...(customResponses && {
      customResponses: toJsonValue(customResponses),
    }),
  };

  // Check for existing check-in today (same localDate)
  const existingToday = await db.checkIn.findFirst({
    where: { clientId: user.id, localDate, deletedAt: null },
    orderBy: { submittedAt: "desc" },
    select: { id: true, submittedAt: true },
  });

  // If a check-in already exists today and caller hasn't chosen what to do
  if (existingToday && overwriteToday === undefined) {
    return {
      conflict: {
        code: "CHECKIN_EXISTS_TODAY" as const,
        existing: {
          id: existingToday.id,
          submittedAt: existingToday.submittedAt.toISOString(),
        },
      },
    };
  }

  // Overwrite: update the latest check-in for today
  if (existingToday && overwriteToday === true) {
    const [, updated] = await db.$transaction([
      db.checkInPhoto.deleteMany({ where: { checkInId: existingToday.id } }),
      db.checkIn.update({
        where: { id: existingToday.id },
        data: {
          ...checkInFields,
          weekOf: weekDate,
          submittedAt: now,
          localDate,
          timezone: tz,
          status: "SUBMITTED",
          photos: {
            create: photoPaths.map((path, i) => ({
              storagePath: path,
              sortOrder: i,
            })),
          },
        },
      }),
    ]);

    revalidatePath("/client", "layout");
    revalidatePath("/coach", "layout");
    return { checkInId: updated.id, overwritten: true };
  }

  // Add as new (overwriteToday === false) or no existing today
  const checkIn = await db.checkIn.create({
    data: {
      clientId: user.id,
      weekOf: weekDate,
      isPrimary: true,
      submittedAt: now,
      localDate,
      timezone: tz,
      ...checkInFields,
      photos: {
        create: photoPaths.map((path, i) => ({
          storagePath: path,
          sortOrder: i,
        })),
      },
    },
  });

  revalidatePath("/client", "layout");
  revalidatePath("/coach", "layout");

  // Send SMS to assigned coach if it's not an overwrite
  if (coachAssignment?.coachId) {
    const { notifyClientCheckInSubmitted } = await import("@/lib/sms/notify");
    // Background execution
    notifyClientCheckInSubmitted(coachAssignment.coachId, user.firstName || "Your client").catch(console.error);

    // Background email to coach (preference-gated)
    try {
      const coach = await db.user.findUnique({ where: { id: coachAssignment.coachId }, select: { email: true, firstName: true, emailClientCheckIns: true } });
      if (coach?.email && coach.emailClientCheckIns) {
        const { sendEmail } = await import("@/lib/email/sendEmail");
        const { clientCheckinSubmittedEmail } = await import("@/lib/email/templates");
        const email = clientCheckinSubmittedEmail(coach.firstName || "Coach", user.firstName || "Your client");
        sendEmail({ to: coach.email, ...email }).catch(console.error);
      }
    } catch { /* email failure must not break check-in */ }
  }

  return { checkInId: checkIn.id };
}

const deleteCheckInSchema = z.object({
  checkInId: z.string().min(1),
});

export async function deleteCheckIn(input: unknown) {
  const user = await getCurrentDbUser();
  if (user.activeRole !== "CLIENT") {
    throw new Error("Only clients can delete check-ins");
  }

  const parsed = deleteCheckInSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const checkIn = await db.checkIn.findUnique({
    where: { id: parsed.data.checkInId },
    select: { clientId: true, deletedAt: true },
  });
  if (!checkIn) throw new Error("Check-in not found");
  if (checkIn.clientId !== user.id) throw new Error("Not your check-in");
  if (checkIn.deletedAt) throw new Error("Already deleted");

  await db.checkIn.update({
    where: { id: parsed.data.checkInId },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/client", "layout");
  revalidatePath("/coach", "layout");
  return { success: true };
}

const markReviewedSchema = z.object({
  checkInId: z.string().min(1),
});

export async function markCheckInReviewed(input: unknown) {
  const parsed = markReviewedSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid input");
  }

  await verifyCoachAccessToCheckIn(parsed.data.checkInId);

  const checkIn = await db.checkIn.update({
    where: { id: parsed.data.checkInId },
    data: { status: "REVIEWED" },
    select: { clientId: true },
  });

  revalidatePath("/coach", "layout");

  // Background email: notify client their check-in was reviewed (transactional — always sent)
  try {
    const client = await db.user.findUnique({ where: { id: checkIn.clientId }, select: { email: true, firstName: true } });
    if (client?.email) {
      const { sendEmail } = await import("@/lib/email/sendEmail");
      const { checkinReviewedEmail } = await import("@/lib/email/templates");
      const email = checkinReviewedEmail(client.firstName || "there");
      sendEmail({ to: client.email, ...email }).catch(console.error);
    }
  } catch { /* email failure must not break review */ }


  // Background SMS: notify client
  try {
    const { notifyCheckInFeedback } = await import("@/lib/sms/notify");
    notifyCheckInFeedback(checkIn.clientId).catch(console.error);
  } catch { /* SMS failure must not break review */ }

  return { success: true };
}
