"use server";

import { z } from "zod";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { parseWeekStartDate } from "@/lib/utils/date";
import { revalidatePath } from "next/cache";

const sendMessageSchema = z.object({
  clientId: z.string().min(1),
  weekStartDate: z.string().min(1),
  body: z.string().min(1).max(5000),
});

export async function sendMessage(input: unknown) {
  const user = await getCurrentDbUser();

  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid input");
  }

  const { clientId, weekStartDate, body } = parsed.data;
  const weekOf = parseWeekStartDate(weekStartDate);

  // Authorization: client can only send on their own thread
  if (user.activeRole === "CLIENT") {
    if (user.id !== clientId) {
      throw new Error("Not authorized");
    }
    // Require an assigned coach
    const hasCoach = await db.coachClient.findFirst({
      where: { clientId: user.id },
      select: { id: true },
    });
    if (!hasCoach) {
      throw new Error("Connect to a coach before sending messages");
    }
  }

  // Authorization: coach must be assigned to this client
  if (user.activeRole === "COACH") {
    const assignment = await db.coachClient.findUnique({
      where: {
        coachId_clientId: { coachId: user.id, clientId },
      },
    });
    if (!assignment) throw new Error("Not assigned to this client");
  }

  const message = await db.message.create({
    data: {
      clientId,
      weekOf,
      senderId: user.id,
      body,
    },
  });

  revalidatePath("/coach", "layout");
  revalidatePath("/client", "layout");

  try {
    const senderName = user.firstName || (user.activeRole === "COACH" ? "Your coach" : "Your client");
    if (user.activeRole === "COACH") {
      const { notifyCoachMessage } = await import("@/lib/sms/notify");
      notifyCoachMessage(clientId).catch(console.error);

      // Background email to client (preference-gated)
      const client = await db.user.findUnique({ where: { id: clientId }, select: { email: true, firstName: true, emailCoachMessages: true } });
      if (client?.email && client.emailCoachMessages) {
        const { sendEmail } = await import("@/lib/email/sendEmail");
        const { newMessageEmail } = await import("@/lib/email/templates");
        const email = newMessageEmail(client.firstName || "there", senderName, "/client/messages");
        sendEmail({ to: client.email, ...email }).catch(console.error);
      }
    } else {
      const { notifyClientMessage } = await import("@/lib/sms/notify");
      const assignment = await db.coachClient.findFirst({ where: { clientId: user.id } });
      if (assignment?.coachId) {
        notifyClientMessage(assignment.coachId, senderName).catch(console.error);

        // Background email to coach (preference-gated)
        const coach = await db.user.findUnique({ where: { id: assignment.coachId }, select: { email: true, firstName: true, emailClientMessages: true } });
        if (coach?.email && coach.emailClientMessages) {
          const { sendEmail } = await import("@/lib/email/sendEmail");
          const { newMessageEmail } = await import("@/lib/email/templates");
          const email = newMessageEmail(coach.firstName || "Coach", senderName, "/coach");
          sendEmail({ to: coach.email, ...email }).catch(console.error);
        }
      }
    }
  } catch (err) {
    console.error("Failed to trigger message notification", err);
  }

  return { messageId: message.id };
}
