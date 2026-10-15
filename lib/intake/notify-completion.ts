import { db } from "@/lib/db";
import { getClientProvider } from "@/lib/queries/client-provider";

/**
 * T-2060 (decision 7) — the ClientIntake completion email goes to the client's
 * CURRENT human coach, resolved by `getClientProvider`, never to
 * `ClientIntake.coachId`. That column can point at a former coach (the client
 * moved, or a purge re-homed the row) or be NULL (a sole-coach purge kept the
 * client's COMPLETED intake). No human coach (NONE, AI, resolutionRequired):
 * no email.
 *
 * Call it after the intake write has committed, outside any transaction
 * (standing rule 5). Never throws: a notification failure must not change the
 * submit response.
 */
export async function notifyCurrentCoachOfIntakeCompletion(client: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}): Promise<void> {
  try {
    const provider = await getClientProvider(client.id);
    if (provider.origin !== "HUMAN" || provider.resolutionRequired || !provider.coachId) return;
    const coach = await db.user.findUnique({ where: { id: provider.coachId }, select: { email: true } });
    if (!coach) return;
    const clientName = `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim() || client.email;
    const { sendEmail } = await import("@/lib/email/sendEmail");
    sendEmail({
      to: coach.email,
      subject: `${clientName} completed their intake`,
      html: `<p><strong>${clientName}</strong> has submitted their intake questionnaire. <a href="${process.env.NEXT_PUBLIC_APP_URL}/coach/clients/${client.id}">Review it here</a>.</p>`,
      text: `${clientName} has submitted their intake questionnaire.`,
    }).catch(console.error);
  } catch {
    // Notification failure must not break the response.
  }
}
