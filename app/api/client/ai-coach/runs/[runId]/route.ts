import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { getRunStatusForClient } from "@/lib/ai-coach/run-status";

/** A05 — safe run-status API. A client may only ever read their own run. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  let user: Awaited<ReturnType<typeof getCurrentDbUser>>;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  const result = await getRunStatusForClient(user.id, runId);

  if (!result.success) {
    const status = result.error === "NOT_FOUND" ? 404 : 403;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.run);
}
