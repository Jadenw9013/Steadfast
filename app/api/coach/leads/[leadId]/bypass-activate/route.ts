import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { bypassPipelineAndActivate } from "@/app/actions/coaching-requests";

type Params = { params: Promise<{ leadId: string }> };

// ── POST — bypass pipeline and activate client directly ──────────────────────

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
      return NextResponse.json(
        { success: false, message: result.message ?? "Failed to activate." },
        { status: 422 }
      );
    }

    return NextResponse.json({ success: true, message: result.message });
  } catch (err) {
    console.error("[POST /api/coach/leads/[leadId]/bypass-activate]", err);
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}
