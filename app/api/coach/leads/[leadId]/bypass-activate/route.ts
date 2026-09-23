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
      // Kept byte-for-byte: "Already active." is 409, "Lead not found" is
      // 404, everything else is 422 — the same three status codes this
      // route always returned, now derived from one shared service instead
      // of a second, divergent implementation of activation.
      if (result.message === "Already active.") {
        return NextResponse.json(
          { success: false, error: result.message, message: result.message },
          { status: 409 }
        );
      }
      if (result.message === "Lead not found") {
        return NextResponse.json(
          { success: false, error: result.message, message: result.message },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { success: false, error: result.message, message: result.message },
        { status: 422 }
      );
    }

    const { success: _s, ...rest } = result;
    return NextResponse.json({ success: true, ...rest });
  } catch (err: unknown) {
    console.error("[bypass-activate]", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
