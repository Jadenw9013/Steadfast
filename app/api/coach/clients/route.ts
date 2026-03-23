import { NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getCoachClientsWithWeekStatus } from "@/lib/queries/check-ins";

// ── GET — list all clients with cadence status ────────────────────────────────

export async function GET() {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.isCoach) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const clients = await getCoachClientsWithWeekStatus(user.id);
    return NextResponse.json({ clients });
  } catch (err) {
    console.error("[GET /api/coach/clients]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
