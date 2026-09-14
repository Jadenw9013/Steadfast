import { NextRequest, NextResponse } from "next/server";
import { getCurrentDbUser } from "@/lib/auth/roles";
import { consumeQuota } from "@/lib/security/quota";
import { exportAiData } from "@/lib/ai-coach/data-export";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  let user;
  try { user = await getCurrentDbUser(); } catch { return NextResponse.json({ error: "Sign in to export your data." }, { status: 401, headers }); }
  if (!user.isClient || user.isDeactivated) return NextResponse.json({ error: "A current client account is required." }, { status: 403, headers });
  if (!await consumeQuota("ai-export", user.id, 2, 3600)) return NextResponse.json({ error: "Please wait before requesting another export." }, { status: 429, headers });
  const iterator = exportAiData(user.id, req.signal); const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(encoder.encode(JSON.stringify(next.value) + "\n")); }
      catch { controller.error(new Error("Export interrupted. Please request a new download.")); }
    },
    async cancel() { await iterator.return(); },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": 'attachment; filename="steadfast-ai-data.ndjson"' } });
}
