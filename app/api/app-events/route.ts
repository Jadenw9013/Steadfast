import { NextRequest, NextResponse } from "next/server";
import { ingestAppEvents } from "@/lib/app-events/ingest";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { readBoundedBody } from "@/lib/security/body";
import { consumeQuota } from "@/lib/security/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
// T-925: this emergency, off-by-default switch is documented in CLAUDE.md and
// deliberately omitted from .env.example because normal environments never set it.
const APP_EVENTS_INGEST_KILL_SWITCH = "APP_EVENTS_INGEST_DISABLED";

export async function POST(req: NextRequest) {
  if (process.env[APP_EVENTS_INGEST_KILL_SWITCH] === "true") {
    return new NextResponse(null, { status: 204, headers });
  }

  let user;
  try {
    user = await getCurrentDbUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    if (!req.headers.get("content-type")?.startsWith("application/json")) {
      throw new Error("JSON required");
    }
    if (!(await consumeQuota("app-events", user.id, 20, 60))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers });
    }
    const bytes = await readBoundedBody(req, 8192);
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return NextResponse.json(ingestAppEvents(user.id, raw), { status: 202, headers });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  }
}
