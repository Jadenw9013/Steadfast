-- Resolve pre-existing duplicate-PUBLISHED groups (docs/ai-coach/03-Codebase-Audit.md
-- CB04/CB05's explicit "audit duplicate historical versions before adding a
-- constraint" requirement). This is not a guess about which version is
-- "correct": every existing read query in this codebase already selects
-- "the" current published plan/program via `orderBy: publishedAt desc`,
-- silently ignoring any other simultaneously-PUBLISHED rows. This backfill
-- makes the schema honestly reflect that same, already-relied-upon
-- tie-break rule. No row is deleted or modified in content — only status.

-- MealPlan: keep the most-recently-published row PUBLISHED per (clientId,
-- weekOf); demote every other PUBLISHED row in that group to SUPERSEDED.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "clientId", "weekOf"
           ORDER BY "publishedAt" DESC NULLS LAST, "createdAt" DESC
         ) AS rn
  FROM "MealPlan"
  WHERE status = 'PUBLISHED'
)
UPDATE "MealPlan" m
SET status = 'SUPERSEDED'
FROM ranked
WHERE m.id = ranked.id AND ranked.rn > 1;

-- TrainingProgram: same rule, keyed by clientId only (matches
-- getPublishedTrainingProgram's actual query shape — one current program
-- per client, not per week).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY "clientId"
           ORDER BY "publishedAt" DESC NULLS LAST, "createdAt" DESC
         ) AS rn
  FROM "TrainingProgram"
  WHERE status = 'PUBLISHED'
)
UPDATE "TrainingProgram" t
SET status = 'SUPERSEDED'
FROM ranked
WHERE t.id = ranked.id AND ranked.rn > 1;

-- Now that at most one PUBLISHED row exists per group, enforce it going
-- forward with partial unique indexes (not expressible in schema.prisma
-- without preview features, so applied here as raw SQL and not mirrored
-- as an `@@unique` in the Prisma schema).
CREATE UNIQUE INDEX "MealPlan_one_published_per_client_week"
  ON "MealPlan"("clientId", "weekOf") WHERE (status = 'PUBLISHED');

CREATE UNIQUE INDEX "TrainingProgram_one_published_per_client"
  ON "TrainingProgram"("clientId") WHERE (status = 'PUBLISHED');
