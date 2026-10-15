import { db } from "@/lib/db";
import { Prisma } from "@/app/generated/prisma/client";

/**
 * Allocates the next MealPlan.version for (clientId, weekOf) and creates the
 * row, retrying on a unique-constraint race. The
 * @@unique([clientId, weekOf, version]) constraint (added after auditing the
 * live database for zero pre-existing duplicates — CB04) means a concurrent
 * caller that already claimed the version we read fails the insert with
 * P2002 instead of silently producing a duplicate-numbered draft; we just
 * re-read the new max and retry rather than surfacing that as an error.
 */
export async function createMealPlanWithNextVersion(
  clientId: string,
  weekOf: Date,
  buildData: (version: number) => Parameters<typeof db.mealPlan.create>[0]["data"]
): Promise<{ id: string }> {
  const MAX_ATTEMPTS = 8;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const latestVersion = await db.mealPlan.findFirst({
      where: { clientId, weekOf },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latestVersion?.version ?? 0) + 1;
    try {
      return await db.mealPlan.create({
        data: buildData(nextVersion),
        select: { id: true },
      });
    } catch (err) {
      const isUniqueRace =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempt < MAX_ATTEMPTS;
      if (!isUniqueRace) throw err;
      // Another request claimed this version number first — retry with a
      // freshly-read max rather than treating it as a failure.
    }
  }
  throw new Error("Could not allocate a meal plan version — too many concurrent attempts.");
}
