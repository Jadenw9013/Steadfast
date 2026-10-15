import { NextRequest } from "next/server";
import { aiHttp } from "@/lib/ai-coach/http";
import { requestAiRun } from "@/lib/ai-coach/run-command";
import { runIdOf, scheduleRunDrain } from "@/lib/ai-coach/kick";

// T-2009: `after()` shares this invocation's budget, which starts at request
// receipt. 15s request phase (auth, quota, bounded body, the requestAiRun
// transaction) + 45s provider ceiling (PROVIDER_TIMEOUT_MS) + 45s for the
// rest of processManagedRun = 105s -> 120s. Comfortably above the 90s lease
// (lib/ai-coach/runs.ts) so a drain that is going to finish finishes inside
// its own lease. `runtime = "nodejs"` is not decorative: aiHttp uses
// node:crypto and the whole path is Prisma.
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let created: unknown = null;
  // The kick is scheduled AFTER the awaited action (so the requestAiRun
  // transaction has committed and the row is durable) and BEFORE the handler
  // returns (so `after()` still sees the request scope). A thrown command
  // leaves `created` null and no kick is scheduled.
  const response = await aiHttp(req, true, async (clientId, body) => {
    created = await requestAiRun(clientId, body);
    return created;
  });
  scheduleRunDrain(runIdOf(created));
  return response;
}
