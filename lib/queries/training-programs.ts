import { db } from "@/lib/db";
import type { Prisma } from "@/app/generated/prisma/client";

const daySelect = {
  id: true,
  dayName: true,
  sortOrder: true,
  blocks: {
    orderBy: { sortOrder: "asc" as const },
    select: { id: true, type: true, title: true, content: true, sortOrder: true },
  },
} as const;

const programInclude = {
  days: {
    orderBy: { sortOrder: "asc" as const },
    select: daySelect,
  },
};

// Postgres `DESC` sorts NULLs FIRST, so a PUBLISHED row with a null
// `publishedAt` would otherwise outrank every real one — `nulls: "last"` is
// load-bearing here. `createdAt desc, id desc` is the tiebreak for rows that
// share a `publishedAt`; there is no `version` column on `TrainingProgram` to
// tiebreak on, and `id` is the primary key, so this is a total order.
export const PUBLISHED_TRAINING_ORDER_BY: Prisma.TrainingProgramOrderByWithRelationInput[] = [
  { publishedAt: { sort: "desc", nulls: "last" } },
  { createdAt: "desc" },
  { id: "desc" },
];

export const DRAFT_TRAINING_ORDER_BY: Prisma.TrainingProgramOrderByWithRelationInput[] = [
  { updatedAt: "desc" },
  { id: "desc" },
];

export async function getTrainingProgramForReview(clientId: string, weekOf: Date) {
  const draft = await db.trainingProgram.findFirst({
    where: { clientId, weekOf, status: "DRAFT" },
    orderBy: DRAFT_TRAINING_ORDER_BY,
    include: programInclude,
  });
  if (draft) return { source: "draft" as const, program: draft, carriedOverFrom: null };

  const published = await db.trainingProgram.findFirst({
    where: { clientId, weekOf, status: "PUBLISHED" },
    orderBy: PUBLISHED_TRAINING_ORDER_BY,
    include: programInclude,
  });
  if (published) return { source: "published" as const, program: published, carriedOverFrom: null };

  const carriedOver = await db.trainingProgram.findFirst({
    where: { clientId, status: "PUBLISHED", weekOf: { lt: weekOf } },
    orderBy: PUBLISHED_TRAINING_ORDER_BY,
    include: programInclude,
  });
  if (carriedOver) {
    return { source: "carried-over" as const, program: carriedOver, carriedOverFrom: carriedOver.weekOf };
  }

  return { source: "empty" as const, program: null, carriedOverFrom: null };
}

/** Latest published across all weeks, for the coach REST GET's no-weekOf branch. New function name on
 *  purpose: `getPublishedTrainingProgram` has a different signature on team/sprint-1 (see Reconciliation). */
export async function getLatestPublishedTrainingProgramForCoach(clientId: string) {
  return db.trainingProgram.findFirst({
    where: { clientId, status: "PUBLISHED" },
    orderBy: PUBLISHED_TRAINING_ORDER_BY,
    include: programInclude,
  });
}

export async function getPublishedTrainingProgram(clientId: string) {
  return db.trainingProgram.findFirst({
    where: { clientId, status: "PUBLISHED" },
    orderBy: PUBLISHED_TRAINING_ORDER_BY,
    include: programInclude,
  });
}
