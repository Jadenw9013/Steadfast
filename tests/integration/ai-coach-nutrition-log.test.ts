/**
 * S-23 — AiNutritionLog storage invariants.
 *
 * The table's whole point is that a day the client says they did not log is
 * DIFFERENT from a day with no row, and that neither can silently turn into the
 * other. Prisma cannot express a CHECK constraint, so the four constraints that
 * enforce it live in
 * `prisma/migrations/20260929000000_ai_nutrition_log/migration.sql` and are
 * invisible to `prisma migrate diff`. This file is what proves they were
 * actually applied: it runs against a database built by
 * `scripts/replay-prisma-migrations.sh`, which replays the migration SQL rather
 * than pushing the schema.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { requireLocalTestDb } from "../helpers/require-local-test-db";
import { lockGlobalAiCoachState } from "../helpers/global-ai-coach-state";

const enabled = process.env.SECURITY_INTEGRATION === "1";
if (enabled) requireLocalTestDb();
const suite = enabled ? describe : describe.skip;
// T-2014: an `ai-coach-*` file; it only ever touches its own clients' rows.
lockGlobalAiCoachState("shared");

async function client() {
  const id = randomUUID();
  return db.user.create({ data: { clerkId: id, email: `${id}@example.test` } });
}

function day(offset: number): Date {
  return new Date(Date.UTC(2026, 0, 1 + offset));
}

suite("S-23 — AiNutritionLog", () => {
  afterAll(() => db.$disconnect());

  it("stores a fully logged day, a partial day and a declared skipped day side by side", async () => {
    const user = await client();
    await db.aiNutritionLog.createMany({
      data: [
        {
          clientId: user.id,
          loggedOn: day(0),
          energyKcal: 2400,
          proteinG: 180,
          carbsG: 250,
          fatG: 80,
          source: "PLAN_AS_WRITTEN",
          completeness: "FULL",
        },
        {
          clientId: user.id,
          loggedOn: day(1),
          energyKcal: 900,
          source: "MANUAL",
          completeness: "PARTIAL",
        },
        {
          clientId: user.id,
          loggedOn: day(2),
          source: "SKIPPED",
          completeness: "NONE",
        },
        // Day 3 deliberately has no row at all.
      ],
    });

    const rows = await db.aiNutritionLog.findMany({
      where: { clientId: user.id, loggedOn: { gte: day(0), lte: day(3) } },
      orderBy: { loggedOn: "asc" },
      select: { loggedOn: true, energyKcal: true, source: true, completeness: true, revision: true },
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.completeness)).toEqual(["FULL", "PARTIAL", "NONE"]);
    expect(rows[2]).toMatchObject({ source: "SKIPPED", energyKcal: null, revision: 1 });
    // The declared-skipped day is a row; the unlogged day is not. A reader can
    // tell the two apart without inference.
    expect(rows.some((row) => row.loggedOn.getTime() === day(3).getTime())).toBe(false);
  });

  it("holds one row per client per day", async () => {
    const user = await client();
    const row = {
      clientId: user.id,
      loggedOn: day(10),
      energyKcal: 2000,
      source: "MANUAL" as const,
      completeness: "FULL" as const,
    };
    await db.aiNutritionLog.create({ data: row });
    await expect(db.aiNutritionLog.create({ data: row })).rejects.toMatchObject({ code: "P2002" });

    const other = await client();
    await expect(
      db.aiNutritionLog.create({ data: { ...row, clientId: other.id } })
    ).resolves.toBeTruthy();
  });

  it("refuses a declared no-coverage day that still carries numbers", async () => {
    const user = await client();
    await expect(
      db.aiNutritionLog.create({
        data: {
          clientId: user.id,
          loggedOn: day(20),
          energyKcal: 2400,
          source: "SKIPPED",
          completeness: "NONE",
        },
      })
    ).rejects.toThrow(/AiNutritionLog_none_has_no_macros/);
  });

  it("refuses a day that claims coverage with no energy value", async () => {
    const user = await client();
    await expect(
      db.aiNutritionLog.create({
        data: { clientId: user.id, loggedOn: day(21), source: "MANUAL", completeness: "FULL" },
      })
    ).rejects.toThrow(/AiNutritionLog_logged_has_energy/);
  });

  it("refuses a row whose source and completeness disagree about whether anything was logged", async () => {
    const user = await client();
    await expect(
      db.aiNutritionLog.create({
        data: {
          clientId: user.id,
          loggedOn: day(22),
          energyKcal: 2400,
          source: "SKIPPED",
          completeness: "FULL",
        },
      })
    ).rejects.toThrow(/AiNutritionLog_skipped_is_none/);
    await expect(
      db.aiNutritionLog.create({
        data: { clientId: user.id, loggedOn: day(23), source: "MANUAL", completeness: "NONE" },
      })
    ).rejects.toThrow(/AiNutritionLog_skipped_is_none/);
  });

  it("refuses negative energy or macro mass", async () => {
    const user = await client();
    await expect(
      db.aiNutritionLog.create({
        data: {
          clientId: user.id,
          loggedOn: day(24),
          energyKcal: 2400,
          proteinG: -1,
          source: "MANUAL",
          completeness: "FULL",
        },
      })
    ).rejects.toThrow(/AiNutritionLog_nonnegative/);
  });
});
