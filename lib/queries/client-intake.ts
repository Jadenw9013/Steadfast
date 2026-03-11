import { db } from "@/lib/db";

/**
 * Get the intake record for a specific client.
 * Used by coach pages to display status and completed answers.
 */
export async function getClientIntake(clientId: string) {
  return db.clientIntake.findUnique({
    where: { clientId },
  });
}

/**
 * Get the intake record for the currently authenticated client.
 * Used by client-facing pages.
 */
export async function getMyIntake(userId: string) {
  return db.clientIntake.findUnique({
    where: { clientId: userId },
  });
}
