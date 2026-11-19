import { isIP } from "node:net";
import { z } from "zod";
import { consumeQuota } from "@/lib/security/quota";
import { reportAnomaly, reportServerError } from "@/lib/observability/report";

export const phoneNumberSchema = z.string().trim().max(30)
  .regex(/^\+?[\d\s().-]+$/, "Please enter a valid phone number.")
  .transform((value) => value.replace(/[^\d+]/g, ""))
  .refine((value) => /^\+?[1-9]\d{6,14}$/.test(value), "Please enter a valid phone number.")
  .transform((value) => value.startsWith("+") ? value : `+${value.length === 10 ? "1" : ""}${value}`);

export function submissionSource(headers: Pick<Headers, "get">): string {
  if (process.env.VERCEL !== "1") return "untrusted-source";
  const address = headers.get("x-vercel-forwarded-for")?.trim();
  if (!address || !isIP(address)) return "unknown-source";
  return isIP(address) === 6 ? new URL(`http://[${address}]`).hostname : address;
}

export async function checkPublicSubmission(
  headers: Pick<Headers, "get">,
  coachProfileId: string,
  contact: string
) {
  try {
    const allowed = await consumeQuota("public-lead-source", submissionSource(headers), 5, 3600)
      && await consumeQuota("public-lead-coach", coachProfileId, 30, 3600)
      && await consumeQuota("public-lead-contact", `${coachProfileId}:${contact}`, 1, 900);
    if (!allowed) {
      reportAnomaly("sf.public-submission.throttled", {});
      return { error: { code: "RATE_LIMITED", message: "Too many requests. Please wait before trying again." }, status: 429 };
    }
    return null;
  } catch (error) {
    reportServerError("sf.public-submission.quota-failed", error, { statusCode: 503 });
    return { error: { code: "UNAVAILABLE", message: "Requests are temporarily unavailable. Please try again later." }, status: 503 };
  }
}
