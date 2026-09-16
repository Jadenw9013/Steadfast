import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * T-660 — `publishMealPlanTarget`'s own catch branch, in isolation.
 *
 * The predicate is covered by tests/unit/meal-plan-publish-error.test.ts and the
 * real Prisma error shapes by tests/integration/meal-plan-publish-parity.test.ts,
 * but neither proves that the SERVICE actually maps a thrown published-index
 * P2002 to `{ ok: false, code: "RACE_LOST" }` rather than letting it escape as a
 * 500. The concurrent integration test cannot prove it either: two transactions
 * publishing different drafts of the same week may legitimately serialize (both
 * succeed), so the catch branch is only reached on a genuine overlap — roughly
 * 1 run in 40 when probed. These two tests pin acceptance criterion 2 (the
 * loser gets a 409, never a 500) deterministically: no database, no timing, just
 * a mocked `$transaction` that rejects with the exact shapes PostgreSQL +
 * @prisma/adapter-pg produce.
 */

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});
// Only `$transaction` is needed: publishMealPlanTarget touches nothing else on
// `db`, and `tx` is never reached because the mock rejects before invoking the
// callback.
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));

import { Prisma } from "@/app/generated/prisma/client";
import {
  publishMealPlanTarget,
  PUBLISHED_MEAL_PLAN_INDEX,
  type MealPlanPublishTarget,
} from "@/lib/meal-plans/publish";

/**
 * The shape observed on the local test database (T-660): for this raw-SQL
 * partial index the name survives ONLY in
 * `meta.driverAdapterError.cause.originalMessage`. Kept byte-identical to the
 * probe recorded in tests/unit/meal-plan-publish-error.test.ts.
 */
function adapterUniqueViolation(constraintName: string, fields: string[]) {
  return new Prisma.PrismaClientKnownRequestError(
    `Invalid \`prisma.mealPlan.updateMany()\` invocation:\n\nUnique constraint failed on the fields: (${fields
      .map((f) => `\`"${f}"\``)
      .join(", ")})`,
    {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: {
        modelName: "MealPlan",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage: `duplicate key value violates unique constraint "${constraintName}"`,
            kind: "UniqueConstraintViolation",
            constraint: { fields: fields.map((f) => `"${f}"`) },
          },
        },
      },
    }
  );
}

const target: MealPlanPublishTarget = {
  id: "plan-under-test",
  clientId: "client-1",
  weekOf: new Date("2026-02-02T00:00:00.000Z"),
  status: "DRAFT",
};

describe("publishMealPlanTarget — transaction failure mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns RACE_LOST (does not throw) when the transaction trips the published-plan index", async () => {
    mocks.transaction.mockRejectedValue(
      adapterUniqueViolation(PUBLISHED_MEAL_PLAN_INDEX, ["clientId", "weekOf"])
    );

    const result = await publishMealPlanTarget(target);

    // The catch branch was genuinely exercised — not short-circuited before the
    // transaction by the NOT_DRAFT guard.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, code: "RACE_LOST" });
  });

  it("rethrows a version-allocation P2002 instead of swallowing it as RACE_LOST", async () => {
    const err = adapterUniqueViolation("MealPlan_clientId_weekOf_version_key", [
      "clientId",
      "weekOf",
      "version",
    ]);
    mocks.transaction.mockRejectedValue(err);

    // Must surface as a 500 so it stays visible; reporting it as a lost race
    // would tell the coach to "refresh and try again" forever.
    await expect(publishMealPlanTarget(target)).rejects.toBe(err);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-Prisma transaction failure", async () => {
    const err = new Error("connection reset");
    mocks.transaction.mockRejectedValue(err);

    await expect(publishMealPlanTarget(target)).rejects.toBe(err);
  });
});
