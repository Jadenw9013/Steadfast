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
  findUnique: vi.fn(),
}));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});
// `$transaction` plus the T-102b content read that now runs just before it.
// `tx` is never reached because the transaction mock rejects before invoking
// the callback.
vi.mock("@/lib/db", () => ({
  db: { $transaction: mocks.transaction, mealPlan: { findUnique: mocks.findUnique } },
}));

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
    // resetAllMocks, not clearAllMocks: the zero-row-flip case below installs a
    // callback-invoking `$transaction` implementation, and clearAllMocks would
    // leave it in place for whatever case is appended next.
    vi.resetAllMocks();
    // T-102b — a non-empty MEAL_PLAN plan, so the empty-plan guard passes and
    // every case below still reaches the transaction. This suite is about the
    // catch branch; the guard itself is covered by
    // tests/unit/meal-plan-publish-empty.test.ts and the integration suite.
    mocks.findUnique.mockResolvedValue({
      planMode: "MEAL_PLAN",
      _count: { items: 2, macroTargets: 0 },
    });
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

  /**
   * T-745 — the DB-free half of the lost-race rollback. The three cases above
   * mock `$transaction` as *rejecting*, so the callback is never invoked and
   * none of them can see how the zero-row flip is reported. This one runs the
   * real callback against a `tx` stub: the supersede matches a row, the flip
   * matches none, and the callback MUST abort rather than return a count, so
   * PostgreSQL rolls the supersede back with it. Returning `RACE_LOST` after a
   * committed transaction would leave the client with zero published plans for
   * the week. The end-to-end proof is
   * tests/integration/meal-plan-publish-parity.test.ts; this is the fast loop.
   */
  it("the zero-row flip throws out of the transaction callback so the supersede rolls back", async () => {
    let callbackThrew = false;
    const updateMany = vi
      .fn()
      // 1. supersede — the week's previous PUBLISHED plan is demoted
      .mockResolvedValueOnce({ count: 1 })
      // 2. flip — the target is no longer DRAFT, so we lost the race
      .mockResolvedValueOnce({ count: 0 });
    const tx = { mealPlan: { updateMany } };

    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      try {
        return await callback(tx);
      } catch (err) {
        callbackThrew = true;
        // The real client rolls the transaction back and rethrows the
        // callback's error unwrapped, which is what the service's catch relies
        // on to recognise its own sentinel.
        throw err;
      }
    });

    const result = await publishMealPlanTarget(target);

    expect(result).toEqual({ ok: false, code: "RACE_LOST" });
    // The load-bearing assertion: a callback that returned normally here would
    // have committed the supersede (this is exactly the pre-T-745 bug).
    expect(callbackThrew).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
