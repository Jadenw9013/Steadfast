import { db } from "@/lib/db";
import { Prisma } from "@/app/generated/prisma/client";
import type { TrainingProgramStatus } from "@/app/generated/prisma/client";

/**
 * Single source of truth for every training-program publish transport: the
 * `publishTrainingProgram` server action, the iOS-facing
 * `/api/coach/clients/[clientId]/training/publish` route (CB05), and the OCR
 * import path `app/api/workout-import/import/route.ts`. This is the only place
 * in the codebase that sets `TrainingProgram.status = "PUBLISHED"`.
 * Every transport MUST call it instead of re-implementing the supersede
 * transaction: the import route used to do a bare `create` with
 * `status: "PUBLISHED"` and no supersede at all, which left two PUBLISHED rows
 * for one client (and, once the partial unique index ships, turns every
 * import-and-publish for an already-served client into a generic 409/500).
 *
 * Supersede is scoped to `clientId` ALONE, with no `weekOf` filter. This is
 * deliberately different from the meal-plan twin (`lib/meal-plans/publish.ts`),
 * whose index is `MealPlan(clientId, weekOf) WHERE status='PUBLISHED'` — one
 * current plan per week. The training index is
 * `TrainingProgram(clientId) WHERE status='PUBLISHED'`
 * (`prisma/migrations/20260913220000_plan_supersede_backfill/migration.sql`,
 * last stanza) — one current program per client, matching
 * `getPublishedTrainingProgram`'s query shape in
 * `lib/queries/training-programs.ts`, which reads the client's single live
 * program with no `weekOf` filter. Adding `weekOf` to the supersede filter here
 * would silently leave two PUBLISHED programs and trip the index. Do not
 * "harmonize" the two services; `TrainingProgramPublishTarget` has no `weekOf`
 * field on purpose, so the wrong filter is unwritable rather than merely
 * discouraged.
 *
 * The transaction is atomic with respect to its OWN outcome: when the target
 * row is no longer a DRAFT (or has been deleted) by the time the flip runs, the
 * callback throws the private `RaceLost` sentinel so the supersede half rolls
 * back with it. Returning `RACE_LOST` after a committed transaction instead
 * would demote the client's live PUBLISHED program while publishing nothing,
 * leaving the client with ZERO published programs — reachable whenever the
 * publish target vanishes between the caller's read and the transaction (e.g.
 * the workout-import route's existing-DRAFT delete). Do not move the zero-count
 * check back outside the callback.
 *
 * P2002 → RACE_LOST: the transaction alone does not eliminate unique-index
 * violations under concurrency. Two transactions publishing two *different*
 * drafts for the same client each run their supersede `updateMany` against a
 * pre-commit snapshot, neither sees the other's uncommitted PUBLISHED row, and
 * the second commit trips the partial unique index. That is a lost race, not a
 * server fault, so it maps to the same result as the `count === 0` path and
 * surfaces as a 409 rather than a 500. The match is on the index *name*, never
 * on a bare `code === "P2002"`, so an unrelated constraint violation can never
 * be misread as a lost publish race.
 *
 * Notifications deliberately stay in the entry points; this module must not
 * import from `lib/sms`, `lib/email`, `lib/notifications` or `next/cache`, and
 * performs no network I/O inside the transaction.
 */

/** Name of the partial unique index created by 20260913220000_plan_supersede_backfill. */
export const PUBLISHED_TRAINING_PROGRAM_INDEX = "TrainingProgram_one_published_per_client";

export type TrainingProgramPublishTarget = {
  id: string;
  clientId: string;
  status: TrainingProgramStatus;
};

export type PublishTrainingProgramResult =
  | {
      ok: true;
      programId: string;
      clientId: string;
      publishedAt: Date;
      supersededCount: number;
    }
  | { ok: false; code: "NOT_DRAFT"; status: TrainingProgramStatus }
  | { ok: false; code: "RACE_LOST" };

/**
 * Reads the row every surface needs before its own authorization check.
 * Returns null when the program does not exist. Performs no authorization.
 */
export async function getTrainingProgramPublishTarget(
  programId: string
): Promise<TrainingProgramPublishTarget | null> {
  return db.trainingProgram.findUnique({
    where: { id: programId },
    select: { id: true, clientId: true, status: true },
  });
}

/** `meta.target` is a string for some errors and a string[] for others. */
function targetMentionsIndex(target: unknown): boolean {
  if (typeof target === "string") return target.includes(PUBLISHED_TRAINING_PROGRAM_INDEX);
  if (Array.isArray(target)) {
    return target.some(
      (t) => typeof t === "string" && t.includes(PUBLISHED_TRAINING_PROGRAM_INDEX)
    );
  }
  return false;
}

/** True only for a P2002 raised by PUBLISHED_TRAINING_PROGRAM_INDEX. Exported for unit test. */
export function isDuplicatePublishedProgramError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;
  // Prisma's `meta` shape for an index it doesn't know about isn't guaranteed,
  // so check the structured meta as well as the raw message. Read the known
  // paths directly rather than round-tripping the whole object through
  // JSON.stringify: a circular reference, a BigInt or a throwing getter in a
  // future Prisma/adapter version would make stringify throw out of the
  // caller's catch block and mask a real lost race as an unrelated 500. The
  // probe is wrapped for the same reason — a hostile `meta` degrades to the
  // message check instead of throwing.
  let metaMentionsIndex = false;
  try {
    const meta = err.meta as Record<string, unknown> | undefined;
    // @prisma/adapter-pg (confirmed empirically against the local test DB,
    // T-660): for this raw-SQL index the name survives ONLY here — `meta.target`
    // is absent and `err.message` says just "the fields: (clientId)".
    const cause = (meta?.driverAdapterError as { cause?: { originalMessage?: unknown } } | undefined)
      ?.cause;
    metaMentionsIndex =
      String(cause?.originalMessage ?? "").includes(PUBLISHED_TRAINING_PROGRAM_INDEX) ||
      targetMentionsIndex(meta?.target);
  } catch {
    metaMentionsIndex = false;
  }
  return metaMentionsIndex || err.message.includes(PUBLISHED_TRAINING_PROGRAM_INDEX);
}

/**
 * Thrown inside the publish transaction when the flip matches zero rows, so the
 * supersede rolls back with it. Private on purpose: it never escapes
 * `publishTrainingProgramTarget`, which maps it to `RACE_LOST`.
 */
class RaceLost extends Error {
  constructor() {
    super("training publish race lost");
    this.name = "RaceLost";
  }
}

/**
 * CB05 — the only place `TrainingProgram.status` becomes `"PUBLISHED"`. Callers
 * MUST have authorized coach access to target.clientId first.
 */
export async function publishTrainingProgramTarget(
  target: TrainingProgramPublishTarget,
  opts?: { now?: Date }
): Promise<PublishTrainingProgramResult> {
  if (target.status !== "DRAFT") {
    return { ok: false, code: "NOT_DRAFT", status: target.status };
  }

  const publishedAt = opts?.now ?? new Date();

  let supersededCount: number;
  try {
    supersededCount = await db.$transaction(async (tx) => {
      // Exclude the target itself: a losing racer in a concurrent
      // double-publish must never demote the row the winner just published.
      // There is deliberately NO `weekOf` filter here (see the file header) and
      // the `id: { not }` exclusion is load-bearing — do not "simplify" either.
      const superseded = await tx.trainingProgram.updateMany({
        where: {
          clientId: target.clientId,
          status: "PUBLISHED",
          id: { not: target.id },
        },
        data: { status: "SUPERSEDED" },
      });
      // Only flip if it's still DRAFT — the count tells us whether we won the
      // concurrent double-publish race. Losing it must undo the supersede
      // above, so throw rather than returning the count (see the file header).
      const flipped = await tx.trainingProgram.updateMany({
        where: { id: target.id, status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt },
      });
      if (flipped.count === 0) throw new RaceLost();
      return superseded.count;
    });
  } catch (err) {
    if (err instanceof RaceLost) return { ok: false, code: "RACE_LOST" };
    if (isDuplicatePublishedProgramError(err)) return { ok: false, code: "RACE_LOST" };
    // Any other failure — including a P2002 from a different constraint — must
    // still surface as a 500 so it stays visible, never silently swallowed.
    throw err;
  }

  return {
    ok: true,
    programId: target.id,
    clientId: target.clientId,
    publishedAt,
    supersededCount,
  };
}
