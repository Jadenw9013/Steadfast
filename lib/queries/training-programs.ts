import { db } from "@/lib/db";

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

export async function getTrainingProgramForReview(clientId: string, weekOf: Date) {
  const draft = await db.trainingProgram.findFirst({
    where: { clientId, weekOf, status: "DRAFT" },
    include: programInclude,
  });
  if (draft) return { source: "draft" as const, program: draft };

  const published = await db.trainingProgram.findFirst({
    where: { clientId, weekOf, status: "PUBLISHED" },
    include: programInclude,
  });
  if (published) return { source: "published" as const, program: published };

  return { source: "empty" as const, program: null };
}

export async function getPublishedTrainingProgram(clientId: string, publishedAfter: Date | null) {
  // `== null` (not `===`): fails closed on `undefined` too, so an untyped or
  // `as any` caller cannot reintroduce the pre-T-665 unfiltered read — Prisma
  // treats `gte: undefined` as no filter.
  if (publishedAfter == null) return null;
  return db.trainingProgram.findFirst({
    where: { clientId, status: "PUBLISHED", publishedAt: { gte: publishedAfter } },
    // T-744: the ordering rule here is still publishedAt desc; aligning it with
    // ACTIVE_MEAL_PLAN_ORDER_BY is T-744's scope, not this ticket's.
    orderBy: { publishedAt: "desc" },
    include: programInclude,
  });
}
