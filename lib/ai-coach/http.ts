import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { readBoundedBody } from "@/lib/security/body";
import { consumeQuota } from "@/lib/security/quota";
import { AiCoachError } from "./access";

/** Cookie mutations require a same-origin request. Native bearer calls must not
 * carry cookies or a foreign Origin; identity still comes from verified Clerk auth.
 */
export function requireSameOriginMutation(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin !== req.nextUrl.origin) throw new AiCoachError("FORBIDDEN", "Cross-origin requests are not allowed.", 403);
  } else if (req.headers.has("cookie") || !/^Bearer \S+$/i.test(req.headers.get("authorization") ?? "")) {
    throw new AiCoachError("FORBIDDEN", "A same-origin request or native bearer authentication is required.", 403);
  }
}
export async function aiHttp(req: NextRequest, mutation: boolean, action: (clientId: string, body: unknown) => Promise<unknown>, role: "client" | "reviewer" = "client") {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "private, no-store" };
  try {
    if (mutation) requireSameOriginMutation(req);
    let user;
    try { user = await getCurrentDbUser(); } catch { throw new AiCoachError("UNAUTHENTICATED", "Sign in to continue.", 401); }
    if (role === "client" && !user.isClient) throw new AiCoachError("FORBIDDEN", "A client account is required.", 403);
    if (!await consumeQuota(mutation ? "ai-mutation" : "ai-read", user.id, mutation ? 30 : 120, 60)) throw new AiCoachError("RATE_LIMITED", "Too many requests. Please try again shortly.", 429);
    let body: unknown = null;
    if (mutation) {
      if (!req.headers.get("content-type")?.startsWith("application/json")) throw new AiCoachError("VALIDATION_ERROR", "A JSON request is required.", 422);
      try { body = JSON.parse(new TextDecoder().decode(await readBoundedBody(req, 32768))); } catch { throw new AiCoachError("VALIDATION_ERROR", "The request is invalid or too large.", 422); }
    }
    return NextResponse.json({ data: await action(user.id, body), requestId }, { headers });
  } catch (error) {
    const safe = error instanceof AiCoachError ? error : new AiCoachError("TEMPORARILY_UNAVAILABLE", "This request could not finish. Please try again.", 503);
    return NextResponse.json({ error: { code: safe.code, message: safe.message, retryable: [429, 503].includes(safe.status) }, requestId }, { status: safe.status, headers });
  }
}
