import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { declinePlanVersion } from "@/lib/ai-coach/plan-acceptance";

/** A10 — POST /api/client/ai-coach/plans/[id]/decline. Idempotent. */
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
  const body = await req.json().catch(() => ({}));
  const result = await declinePlanVersion(user.id, id, body?.reason);

  if (!result.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: result.error } }, { status: 422 });
  }
  return NextResponse.json({ data: { declined: true } });
}
