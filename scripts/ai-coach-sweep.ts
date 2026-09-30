/**
 * S-27 — a local, non-production driver for the AI Coach executor sweep.
 *
 * `runExecutorSweep` has exactly one caller in the deployed app: the Vercel
 * Cron route (`app/api/cron/ai-coach-executor`), fired at 04:05 UTC. Vercel
 * Cron does not exist in `next dev`. Locally, the only thing that ever
 * advances a run is `scheduleRunDrain`'s single `after()`-time
 * `drainRunNow` call, which advances exactly one provider stage — it never
 * reconciles expired leases, never re-arms a `RETRY_WAIT` run once its
 * backoff elapses, and never claims a second time. So in local dev a run
 * that fails its first attempt sits in `RETRY_WAIT` forever, looking exactly
 * like a hung product (see board S-26/S-27 and
 * docs/ai-coach/14-Handoff-Status.md).
 *
 * This script calls the real `runExecutorSweep()` exactly once and prints
 * its summary. It does not change, wrap or special-case anything on the
 * production drain path — the cron route is untouched and stays the durable
 * driver in every deployed environment.
 *
 * USAGE
 *   pnpm ai-coach:sweep
 *
 * Run it repeatedly (e.g. in a second terminal, every few seconds) while
 * developing against a locally seeded AI Coach account to make a stuck
 * `RETRY_WAIT`/`QUEUED` run advance the same way the cron would in
 * production.
 */
import { runExecutorSweep } from "../lib/ai-coach/executor";

function refuseOutsideDevelopment() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
    throw new Error(
      "ai-coach:sweep is a local development tool. Refusing to run with " +
        `NODE_ENV=${process.env.NODE_ENV ?? "<unset>"} VERCEL_ENV=${process.env.VERCEL_ENV ?? "<unset>"}. ` +
        "The Vercel Cron route is the durable driver in every deployed environment; this script must never substitute for it there."
    );
  }
}

async function main() {
  refuseOutsideDevelopment();
  const summary = await runExecutorSweep();
  console.log(JSON.stringify(summary, null, 2));
}

void main();
