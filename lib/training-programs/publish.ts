import { Prisma } from "@/app/generated/prisma/client";
import type { TrainingProgramStatus } from "@/app/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Single source of truth for every training-program publish transport: the
 * `publishTrainingProgram` server action, the iOS-facing
 * `/api/coach/clients/[clientId]/training/publish` route (CB05), and the OCR
 * import path `app/api/workout-import/import/route.ts`. This is the only place
 * in the codebase that sets `TrainingProgram.status = "PUBLISHED"`.
 *
 * Supersede is scoped to `clientId` alone. This deliberately differs from the
 * meal-plan service, whose partial unique index is scoped to client and week.
 * Production's training-program index permits one published program per client,
 * so `TrainingProgramPublishTarget` omits `weekOf` to make the wrong predicate
 * unavailable to callers.
 *
 * The supersede and DRAFT-to-PUBLISHED flip share one transaction. If the flip
 * loses a race, throwing inside the callback rolls the supersede back so the
 * client is never left with zero published programs.
 */

export const PUBLISHED_TRAINING_PROGRAM_INDEX =
  "TrainingProgram_one_published_per_client";

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

/** Reads the publish target before the caller performs its authorization check. */
export async function getTrainingProgramPublishTarget(
  programId: string
): Promise<TrainingProgramPublishTarget | null> {
  return db.trainingProgram.findUnique({
    where: { id: programId },
    select: { id: true, clientId: true, status: true },
  });
}

function targetMentionsIndex(target: unknown): boolean {
  if (typeof target === "string") {
    return target.includes(PUBLISHED_TRAINING_PROGRAM_INDEX);
  }
  if (Array.isArray(target)) {
    return target.some(
      (entry) =>
        typeof entry === "string" &&
        entry.includes(PUBLISHED_TRAINING_PROGRAM_INDEX)
    );
  }
  return false;
}

/** True only for a P2002 raised by the published-program partial unique index. */
export function isDuplicatePublishedProgramError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  let metaMentionsIndex = false;
  try {
    const meta = error.meta as Record<string, unknown> | undefined;
    const cause = (
      meta?.driverAdapterError as
        | { cause?: { originalMessage?: unknown } }
        | undefined
    )?.cause;
    metaMentionsIndex =
      String(cause?.originalMessage ?? "").includes(
        PUBLISHED_TRAINING_PROGRAM_INDEX
      ) || targetMentionsIndex(meta?.target);
  } catch {
    metaMentionsIndex = false;
  }

  return (
    metaMentionsIndex ||
    error.message.includes(PUBLISHED_TRAINING_PROGRAM_INDEX)
  );
}

class RaceLost extends Error {
  constructor() {
    super("training publish race lost");
    this.name = "RaceLost";
  }
}

/**
 * Publishes an authorized target. Callers must verify coach access to
 * `target.clientId` before calling this function.
 */
export async function publishTrainingProgramTarget(
  target: TrainingProgramPublishTarget,
  options?: { now?: Date }
): Promise<PublishTrainingProgramResult> {
  if (target.status !== "DRAFT") {
    return { ok: false, code: "NOT_DRAFT", status: target.status };
  }

  const publishedAt = options?.now ?? new Date();

  let supersededCount: number;
  try {
    supersededCount = await db.$transaction(async (transaction) => {
      const superseded = await transaction.trainingProgram.updateMany({
        where: {
          clientId: target.clientId,
          status: "PUBLISHED",
          id: { not: target.id },
        },
        data: { status: "SUPERSEDED" },
      });

      const flipped = await transaction.trainingProgram.updateMany({
        where: { id: target.id, status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt },
      });

      if (flipped.count === 0) throw new RaceLost();
      return superseded.count;
    });
  } catch (error) {
    if (error instanceof RaceLost) return { ok: false, code: "RACE_LOST" };
    if (isDuplicatePublishedProgramError(error)) {
      return { ok: false, code: "RACE_LOST" };
    }
    throw error;
  }

  return {
    ok: true,
    programId: target.id,
    clientId: target.clientId,
    publishedAt,
    supersededCount,
  };
}
