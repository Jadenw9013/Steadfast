import { after } from "next/server";
import { drainRunNow } from "./executor";
import { reportAnomaly } from "@/lib/observability/report";
import { AICOACH_RUN_KICK } from "@/lib/observability/events";

/**
 * T-2009 — the post-response wrapper around `drainRunNow`.
 *
 * This is the ONLY file in `lib/ai-coach/` allowed to import from
 * `next/server`: keeping `after` out of `executor.ts` is what lets the cron
 * sweep and every test import the executor without a request scope.
 *
 * `after()` runs the callback after the response is closed but still inside
 * the same serverless invocation, bounded by the route's `maxDuration`. That
 * has two consequences this file is built around:
 *  - a callback that rejects is caught inside Next's `AfterContext` and
 *    reported there, never surfaced to the response — so a drain can never
 *    turn a 201 into a 500;
 *  - `after()` itself throws *synchronously at the call site* when there is
 *    no request scope (E468) or no `waitUntil` in the environment (E91).
 *    That includes vitest, where route handlers are imported and called
 *    directly. Hence the try/catch: a runtime without `waitUntil` degrades to
 *    exactly today's behaviour (the cron sweep drains the run) instead of
 *    breaking run creation.
 */

/** Narrows an `aiHttp` action result to a run id without trusting its type.
 * Both run commands can return a replayed idempotency receipt typed as a
 * Prisma JSON value, so this must be a check and never a cast. */
export function runIdOf(result: unknown): string | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return null;
  const runId = (result as Record<string, unknown>).runId;
  return typeof runId === "string" && runId.length > 0 ? runId : null;
}

/**
 * Schedules `drainRunNow(runId)` to run after the response is sent.
 * Synchronous and never throws. Emits exactly one `sf.aicoach.run_kick`
 * beacon per scheduling attempt (none at all when there is no run id).
 */
export function scheduleRunDrain(runId: string | null): void {
  if (!runId) return;
  const beacon = (outcome: string) =>
    reportAnomaly(AICOACH_RUN_KICK.evt, {
      context: { outcome },
      allow: AICOACH_RUN_KICK.allow,
    });
  try {
    after(async () => {
      beacon(await drainRunNow(runId));
    });
  } catch {
    // No request scope / no waitUntil. The hourly-floor cron sweep is still
    // the durable drain path; nothing is lost, the run is simply not fast.
    beacon("schedule_unavailable");
  }
}
