import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { consumeQuota } from "@/lib/security/quota";
import { reportAnomaly, reportServerError } from "@/lib/observability/report";

const schema = z.object({ accessCode: z.string().trim().min(1).max(256) });

export async function checkCoachRegistration(userId: string, input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, status: 422, error: "Please enter a valid access code." };
  try {
    if (!(await consumeQuota("coach-registration", userId, 3, 900))) {
      reportAnomaly("sf.coach-registration.throttled", { ids: { userId } });
      return { ok: false as const, status: 429, error: "Too many attempts. Please try again in 15 minutes." };
    }
  } catch (error) {
    reportServerError("sf.coach-registration.quota-failed", error, { ids: { userId }, statusCode: 503 });
    return { ok: false as const, status: 503, error: "Coach registration is temporarily unavailable. Please try again later." };
  }
  const expected = process.env.STEADFAST_COACH_ACCESS_CODE?.trim();
  if (!expected) return { ok: false as const, status: 403, error: "Coach registration is not available at this time." };
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(parsed.data.accessCode), digest(expected))) {
    return { ok: false as const, status: 403, error: "Invalid access code. Please check with your administrator." };
  }
  return { ok: true as const };
}
