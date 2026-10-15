import { db } from "@/lib/db";
import { sendPushToUser } from "./push";

/**
 * T-502 — the ONLY function in the codebase that turns an accepted AI plan
 * into a push. Owns recipient eligibility (account state + notification
 * preference) and the send. Owns nothing about the outbox — the drain
 * (`lib/ai-coach/acceptance-notifications.ts`) claims/finalizes rows and
 * calls this seam once per delivery attempt. Any future surface (email,
 * SMS, in-app banner) extends this file rather than adding a second send
 * site for the same event — a duplicate send path is an automatic review
 * CHANGES.
 *
 * T-2037 — `sendPushToUser` returns `{ sent: true, result }` whenever the
 * APNs HTTP/2 request merely *resolves*, including every non-200 Apple
 * response (`lib/notifications/apns.ts` resolves `{ success: false,
 * status, error }` for 4xx/5xx instead of rejecting). Trusting `sent`
 * alone would mark a 410-Unregistered token `DELIVERED` forever. This
 * file narrows `result` itself and maps the actual APNs status — do not
 * "simplify" this back to trusting `sent`. T-2037 makes `sendPushToUser`
 * honest for its other callers; this file does not change `push.ts`.
 */

export type AiPlanNotificationOutcome =
  | "DELIVERED"
  | "SUPPRESSED_PREFERENCE"
  | "SUPPRESSED_NO_DEVICE"
  | "SUPPRESSED_ACCOUNT_CLOSED";

export type AiPlanNotificationErrorCode =
  | "APNS_REJECTED" // permanent 4xx from Apple other than 410 — terminal
  | "APNS_UNAVAILABLE" // 429/5xx or a thrown transport error — retryable
  | "PUSH_CONFIG_MISSING" // APNs env vars absent — retryable, budget NOT consumed
  | "UNKNOWN";

export type AiPlanNotificationResult =
  | { status: "RESOLVED"; outcome: AiPlanNotificationOutcome }
  | { status: "FAILED"; errorCode: AiPlanNotificationErrorCode; budgetConsumed: boolean };

/** Frozen G03 copy (T-590 "DECIDED"). Exported so a unit test can assert it
 * and counsel can change it in one line. No number, no body metric, no plan
 * detail, no monitoring/supervision claim — doc 09 §2. */
export const AI_PLAN_ACCEPTANCE_PUSH = {
  title: "Plan updated",
  body: "Your coach updated your plan. Open Steadfast to see it.",
  type: "MEAL_PLAN_UPDATED",
} as const;

export async function deliverAiPlanAcceptanceNotification(
  clientId: string
): Promise<AiPlanNotificationResult> {
  const user = await db.user.findUnique({
    where: { id: clientId },
    select: {
      isDeactivated: true,
      isClient: true,
      pushMealPlanUpdates: true,
      apnsToken: true,
      deletionRequest: { select: { status: true } },
    },
  });

  if (
    !user ||
    user.isDeactivated ||
    !user.isClient ||
    user.deletionRequest?.status === "PENDING" ||
    user.deletionRequest?.status === "PURGING"
  ) {
    return { status: "RESOLVED", outcome: "SUPPRESSED_ACCOUNT_CLOSED" };
  }

  if (user.pushMealPlanUpdates === false) {
    return { status: "RESOLVED", outcome: "SUPPRESSED_PREFERENCE" };
  }

  if (!user.apnsToken) {
    return { status: "RESOLVED", outcome: "SUPPRESSED_NO_DEVICE" };
  }

  const sendResult = await sendPushToUser(clientId, AI_PLAN_ACCEPTANCE_PUSH);

  if (sendResult.sent === false) {
    if ("reason" in sendResult) {
      return { status: "RESOLVED", outcome: "SUPPRESSED_NO_DEVICE" };
    }
    // Never log the transport error message itself — status only.
    return { status: "FAILED", errorCode: "APNS_UNAVAILABLE", budgetConsumed: true };
  }

  const result = sendResult.result as { success?: boolean; status?: number; error?: string } | undefined;

  if (result?.success === true) {
    return { status: "RESOLVED", outcome: "DELIVERED" };
  }

  if (result?.status === 410) {
    // Apple has unregistered the token; retrying it forever is the
    // abandoned-row failure mode this drain must avoid.
    return { status: "RESOLVED", outcome: "SUPPRESSED_NO_DEVICE" };
  }

  if (
    result?.status === 400 ||
    result?.status === 403 ||
    result?.status === 404 ||
    result?.status === 413
  ) {
    return { status: "FAILED", errorCode: "APNS_REJECTED", budgetConsumed: true };
  }

  if (result?.error === "Missing config") {
    // A deployment with no APNs env vars must back off, not abandon a
    // cohort's notifications — see the drain's budgetConsumed handling.
    return { status: "FAILED", errorCode: "PUSH_CONFIG_MISSING", budgetConsumed: false };
  }

  return { status: "FAILED", errorCode: "APNS_UNAVAILABLE", budgetConsumed: true };
}
