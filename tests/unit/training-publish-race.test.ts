import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * T-739 — `publishTrainingProgramTarget`'s own catch branch, in isolation.
 *
 * The predicate is covered by tests/unit/training-publish-error.test.ts and the
 * end state by tests/integration/training-publish-parity.test.ts, but neither
 * proves that the SERVICE maps a thrown published-index P2002 to
 * `{ ok: false, code: "RACE_LOST" }` rather than letting it escape as a 500.
 * The concurrent integration test cannot prove it either: two transactions
 * publishing different drafts for the same client may legitimately serialize
 * (both succeed), so the catch branch is only reached on a genuine overlap.
 * These tests pin the mapping deterministically: no database, no timing, just a
 * mocked `$transaction` that rejects with the exact shapes PostgreSQL +
 * @prisma/adapter-pg produce.
 */

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});
// `tx` is never reached because the transaction mock rejects (or resolves)
// before invoking the callback.
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));

import { Prisma } from "@/app/generated/prisma/client";
import {
  publishTrainingProgramTarget,
  PUBLISHED_TRAINING_PROGRAM_INDEX,
  type TrainingProgramPublishTarget,
} from "@/lib/training-programs/publish";

/**
 * The shape observed on the local test database (T-660, ported here): for a
 * raw-SQL partial index the name survives ONLY in
 * `meta.driverAdapterError.cause.originalMessage`.
 */
function adapterUniqueViolation(constraintName: string, fields: string[]) {
  return new Prisma.PrismaClientKnownRequestError(
    `Invalid \`prisma.trainingProgram.updateMany()\` invocation:\n\nUnique constraint failed on the fields: (${fields
      .map((f) => `\`"${f}"\``)
      .join(", ")})`,
    {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: {
        modelName: "TrainingProgram",
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

const target: TrainingProgramPublishTarget = {
  id: "program-under-test",
  clientId: "client-1",
  status: "DRAFT",
};

describe("publishTrainingProgramTarget — transaction failure mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns RACE_LOST (does not throw) when the transaction trips the published-program index", async () => {
    mocks.transaction.mockRejectedValue(
      adapterUniqueViolation(PUBLISHED_TRAINING_PROGRAM_INDEX, ["clientId"])
    );

    const result = await publishTrainingProgramTarget(target);

    // The catch branch was genuinely exercised — not short-circuited before the
    // transaction by the NOT_DRAFT guard.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, code: "RACE_LOST" });
  });

  it("rethrows a P2002 from any other constraint instead of swallowing it as RACE_LOST", async () => {
    const err = adapterUniqueViolation("TrainingProgram_pkey", ["id"]);
    mocks.transaction.mockRejectedValue(err);

    // Must surface as a 500 so it stays visible; reporting it as a lost race
    // would tell the coach to "refresh and try again" forever.
    await expect(publishTrainingProgramTarget(target)).rejects.toBe(err);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-Prisma transaction failure", async () => {
    const err = new Error("connection reset");
    mocks.transaction.mockRejectedValue(err);

    await expect(publishTrainingProgramTarget(target)).rejects.toBe(err);
  });

  it("returns NOT_DRAFT without opening a transaction when the target is already PUBLISHED", async () => {
    const result = await publishTrainingProgramTarget({ ...target, status: "PUBLISHED" });

    expect(result).toEqual({ ok: false, code: "NOT_DRAFT", status: "PUBLISHED" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
