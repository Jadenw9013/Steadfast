import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    trainingProgram: { findUnique: vi.fn() },
  },
}));

import { Prisma } from "@/app/generated/prisma/client";
import {
  PUBLISHED_TRAINING_PROGRAM_INDEX,
  publishTrainingProgramTarget,
  type TrainingProgramPublishTarget,
} from "@/lib/training-programs/publish";

const target: TrainingProgramPublishTarget = {
  id: "program-under-test",
  clientId: "client-under-test",
  status: "DRAFT",
};

describe("publishTrainingProgramTarget race handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws inside the transaction when the DRAFT flip loses so supersede rolls back", async () => {
    let callbackThrew = false;
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    mocks.transaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) => {
        try {
          return await callback({ trainingProgram: { updateMany } });
        } catch (error) {
          callbackThrew = true;
          throw error;
        }
      }
    );

    await expect(publishTrainingProgramTarget(target)).resolves.toEqual({
      ok: false,
      code: "RACE_LOST",
    });
    expect(callbackThrew).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        clientId: target.clientId,
        status: "PUBLISHED",
        id: { not: target.id },
      },
      data: { status: "SUPERSEDED" },
    });
  });

  it("maps only the published-program P2002 to RACE_LOST", async () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (clientId)",
      {
        code: "P2002",
        clientVersion: "7.5.0",
        meta: {
          driverAdapterError: {
            cause: {
              originalMessage: `duplicate key value violates unique constraint "${PUBLISHED_TRAINING_PROGRAM_INDEX}"`,
            },
          },
        },
      }
    );
    mocks.transaction.mockRejectedValue(error);

    await expect(publishTrainingProgramTarget(target)).resolves.toEqual({
      ok: false,
      code: "RACE_LOST",
    });
  });
});
