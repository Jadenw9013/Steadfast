"use server";

import { z } from "zod";
import { submitCheckIn } from "@/lib/check-ins/submit";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { verifyCoachAccessToCheckIn } from "@/lib/queries/check-ins";
import { revalidatePath } from "next/cache";

export async function createCheckIn(input: unknown) {
  const user = await getCurrentDbUser();

  if (user.activeRole !== "CLIENT") {
    throw new Error("Only clients can submit check-ins");
  }

  const result = await submitCheckIn(user, input);

  if ("error" in result || "conflict" in result) {
    return result;
  }

  revalidatePath("/client", "layout");
  revalidatePath("/coach", "layout");

  // Send SMS to assigned coach on a brand-new check-in (not an overwrite)
  if (!result.overwritten) {
    const coachAssignment = await db.coachClient.findFirst({ where: { clientId: user.id }, select: { coachId: true } });
    if (coachAssignment?.coachId) {
      const { notifyClientCheckInSubmitted } = await import("@/lib/sms/notify");
      notifyClientCheckInSubmitted(coachAssignment.coachId, user.firstName || "Your client").catch(console.error);

      // Background email + push to coach (preference-gated)
      try {
        const coach = await db.user.findUnique({ where: { id: coachAssignment.coachId }, select: { email: true, firstName: true, emailClientCheckIns: true, pushClientCheckIns: true } });
        if (coach?.email && coach.emailClientCheckIns) {
          const { sendEmail } = await import("@/lib/email/sendEmail");
          const { clientCheckinSubmittedEmail } = await import("@/lib/email/templates");
          const email = clientCheckinSubmittedEmail(coach.firstName || "Coach", user.firstName || "Your client");
          sendEmail({ to: coach.email, ...email }).catch(console.error);
        }
        if (coach?.pushClientCheckIns) {
          const { pushClientCheckinSubmitted } = await import("@/lib/notifications/push");
          pushClientCheckinSubmitted(coachAssignment.coachId, user.firstName || "Your client").catch(console.error);
        }
      } catch { /* notification failure must not break check-in */ }
    }
  }

  return { checkInId: result.checkInId, ...(result.overwritten && { overwritten: true as const }) };
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
    // Gate: smsCheckInFeedback is the user preference flag for "coach reviewed your check-in".
    // pushCheckInReminders covers cron-based due/overdue reminders — not this trigger.
    const client = await db.user.findUnique({ where: { id: checkIn.clientId }, select: { email: true, firstName: true, smsCheckInFeedback: true } });
    if (client?.email) {
      const { sendEmail } = await import("@/lib/email/sendEmail");
      const { checkinReviewedEmail } = await import("@/lib/email/templates");
      const email = checkinReviewedEmail(client.firstName || "there");
      sendEmail({ to: client.email, ...email }).catch(console.error);
    }
    if (client?.smsCheckInFeedback) {
      const { pushCheckinReviewed } = await import("@/lib/notifications/push");
      pushCheckinReviewed(checkIn.clientId).catch(console.error);
    }
  } catch { /* notification failure must not break review */ }

  // Background SMS: notify client
  try {
    const { notifyCheckInFeedback } = await import("@/lib/sms/notify");
    notifyCheckInFeedback(checkIn.clientId).catch(console.error);
  } catch { /* SMS failure must not break review */ }

  return { success: true };
}
