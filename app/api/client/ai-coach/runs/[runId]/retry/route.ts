import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { retryManagedRun } from "@/lib/ai-coach/retry-command";
import { runIdOf, scheduleRunDrain } from "@/lib/ai-coach/kick";

// T-2009 — see app/api/client/ai-coach/runs/route.ts for the 120s arithmetic.
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  let created: unknown = null;
  const response = await aiHttp(req, true, async (id, body) => {
    created = await retryManagedRun(id, runId, body);
    return created;
  });
  // The kick targets the NEW retry run's id from the result, never the path
  // `runId` — that one is the terminal FAILED original.
  scheduleRunDrain(runIdOf(created));
  return response;
}
