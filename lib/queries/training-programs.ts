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

export async function getPublishedTrainingProgram(clientId: string, publishedAfter?: Date) {
  return db.trainingProgram.findFirst({
    where: { clientId, status: "PUBLISHED", ...(publishedAfter ? { publishedAt: { gte: publishedAfter } } : {}) },
    orderBy: { publishedAt: "desc" },
    include: programInclude,
  });
}
