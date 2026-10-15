import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { bypassPipelineAndActivate } from "@/app/actions/coaching-requests";

type Params = { params: Promise<{ leadId: string }> };

// ── POST — bypass pipeline and activate lead directly ────────────────────────
// T-978: the twin of activate/route.ts. The duplicated ownership query, raw
// stage write, swallowed try/catch and fabricated { inviteToken: "", email: "" }
// that used to live here are gone — they now live once, inside
// lib/leads/activate-lead.ts#activateLead.

export async function POST(_req: NextRequest, { params }: Params) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }
  if (!user.isCoach) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });

  try {
    const { leadId } = await params;

    const result = await bypassPipelineAndActivate({ requestId: leadId });

    if (!result.success) {
      // Status is keyed off the service's own discriminant (`refusal`), not
      // the coach-facing sentence — T-960 owns that wording and a reword
      // must never silently change which status code a refusal answers
      // with (T-978 review round 1, CR-3 / parity gap 5). Same three
      // status codes this route always returned: 409 for "already active",
      // 404 for "not found", 422 for every other refusal.
      const status = result.refusal === "already_active" ? 409 : result.refusal === "not_found" ? 404 : 422;
      return NextResponse.json(
        { success: false, error: result.message, message: result.message },
        { status }
      );
    }

    const { success: _s, ...rest } = result;
    return NextResponse.json({ success: true, ...rest });
  } catch (err: unknown) {
    console.error("[bypass-activate]", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
