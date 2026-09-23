import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { activateClient } from "@/app/actions/coaching-requests";
import { ACTIVATE_NOT_FOUND_ERROR } from "@/lib/leads/activate-lead";

type Params = { params: Promise<{ leadId: string }> };

// ── POST — activate a lead as a client ───────────────────────────────────────

export async function POST(_req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.isCoach) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { leadId } = await params;

    const result = await activateClient({ requestId: leadId });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.message, message: result.message },
        { status: 422 }
      );
    }

    const { success: _s, ...rest } = result;
    return NextResponse.json({ success: true, ...rest });
  } catch (err) {
    // activateClient keeps throwing ACTIVATE_NOT_FOUND_ERROR on not_found
    // (T-978) — turn that into a 404 instead of letting it fall through to
    // a 500. Matched against the exported constant, not a duplicated
    // literal (T-978 review round 1, CR-3).
    if (err instanceof Error && err.message === ACTIVATE_NOT_FOUND_ERROR) {
      return NextResponse.json(
        { success: false, error: "Lead not found", message: "Lead not found" },
        { status: 404 }
      );
    }
    console.error("[POST /api/coach/leads/[leadId]/activate]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
