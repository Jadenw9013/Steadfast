import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { acceptPlanVersionAtomic } from "@/lib/ai-coach/plan-acceptance";

/** A10 — POST /api/client/ai-coach/plans/[id]/accept. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } }, { status: 401 });
  }
  if (!user.isClient) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Forbidden" } }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await acceptPlanVersionAtomic(user.id, id, body);

  if (!result.success) {
    // Status codes per docs/ai-coach/05's closed error-code table.
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "VALIDATION_ERROR" ? 422
      : result.code === "TEMPORARILY_UNAVAILABLE" ? 503
      : result.code === "ENTITLEMENT_REQUIRED" ? 403
      : 409; // STALE_PROPOSAL, REVISION_CONFLICT, WINDOW_CLOSED, ADJUSTMENT_LIMIT_REACHED, SAFETY_RESTRICTED, POLICY_UNAVAILABLE, REVIEWER_APPROVAL_REQUIRED
    return NextResponse.json({ error: { code: result.code, message: result.error } }, { status });
  }

  return NextResponse.json({ data: { alreadyAccepted: result.alreadyAccepted, activeVersionId: result.activeVersionId } });
}
