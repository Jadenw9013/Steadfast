import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  checkPlanPublishable: vi.fn(),
}));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    mealPlan: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/meal-plans/publish-guard", () => ({
  checkPlanPublishable: mocks.checkPlanPublishable,
}));

import { Prisma } from "@/app/generated/prisma/client";
import {
  PUBLISHED_MEAL_PLAN_INDEX,
  publishMealPlanTarget,
  type MealPlanPublishTarget,
} from "@/lib/meal-plans/publish";

const target: MealPlanPublishTarget = {
  id: "plan-under-test",
  clientId: "client-under-test",
  weekOf: new Date("2026-10-05T00:00:00.000Z"),
  status: "DRAFT",
};

describe("publishMealPlanTarget race handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.checkPlanPublishable.mockResolvedValue({ ok: true });
  });

  it("throws out of the transaction callback when the DRAFT flip loses, rolling back the supersede", async () => {
    let callbackThrew = false;
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const transaction = { mealPlan: { updateMany } };

    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        try {
          return await callback(transaction);
        } catch (error) {
          callbackThrew = true;
          throw error;
        }
      }
    );

    await expect(publishMealPlanTarget(target)).resolves.toEqual({
      ok: false,
      code: "RACE_LOST",
    });
    expect(callbackThrew).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("maps the published-plan P2002 to RACE_LOST", async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (clientId, weekOf)",
      {
        code: "P2002",
        clientVersion: "7.5.0",
        meta: {
          driverAdapterError: {
            cause: {
              originalMessage: `duplicate key value violates unique constraint "${PUBLISHED_MEAL_PLAN_INDEX}"`,
            },
          },
        },
      }
    );
    mocks.transaction.mockRejectedValue(error);

    await expect(publishMealPlanTarget(target)).resolves.toEqual({
      ok: false,
      code: "RACE_LOST",
    });
  });

  it("keeps the deployed empty-plan guard ahead of every supersede write", async () => {
    mocks.checkPlanPublishable.mockResolvedValue({
      ok: false,
      code: "EMPTY_PLAN",
      planMode: "MEAL_PLAN",
      message: "Add at least one food before publishing.",
    });

    await expect(publishMealPlanTarget(target)).resolves.toEqual({
      ok: false,
      code: "EMPTY_PLAN",
      message: "Add at least one food before publishing.",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
