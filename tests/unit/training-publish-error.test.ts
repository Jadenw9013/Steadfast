import { describe, it, expect, vi } from "vitest";

/**
 * T-739 — the training publish race predicate must match on the partial unique
 * index NAME, never on a bare `code === "P2002"`, and must never claim the
 * meal-plan twin's index (or have its own claimed by it). The two services are
 * deliberately scoped differently (`TrainingProgram(clientId)` vs
 * `MealPlan(clientId, weekOf)`), so a cross-domain match would map an unrelated
 * constraint violation to a lost race.
 */

// Must set DATABASE_URL before db.ts would be imported — mirrors the hoisted
// style in tests/unit/meal-plan-publish-error.test.ts. `@/lib/db` is mocked
// anyway so no PrismaClient is ever constructed; the real generated Prisma
// namespace is used so `instanceof` semantics are the real ones.
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});
vi.mock("@/lib/db", () => ({ db: {} }));

import { Prisma } from "@/app/generated/prisma/client";
import {
  isDuplicatePublishedProgramError,
  PUBLISHED_TRAINING_PROGRAM_INDEX,
} from "@/lib/training-programs/publish";
import {
  isDuplicatePublishedPlanError,
  PUBLISHED_MEAL_PLAN_INDEX,
} from "@/lib/meal-plans/publish";

function knownError(
  message: string,
  code: string,
  meta?: Record<string, unknown>
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: "7.0.0",
    meta,
  });
}

/**
 * The shape PostgreSQL + @prisma/adapter-pg produce for a raw-SQL partial
 * index: the name survives only in
 * `meta.driverAdapterError.cause.originalMessage`.
 */
function adapterViolation(constraintName: string, fields: string[]) {
  return knownError(
    `Invalid \`prisma.trainingProgram.updateMany()\` invocation:\n\nUnique constraint failed on the fields: (${fields
      .map((f) => `\`"${f}"\``)
      .join(", ")})`,
    "P2002",
    {
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
    }
  );
}

describe("isDuplicatePublishedProgramError", () => {
  it("matches a P2002 whose meta.target is the published-program index name", () => {
    const err = knownError("Unique constraint failed", "P2002", {
      target: PUBLISHED_TRAINING_PROGRAM_INDEX,
    });
    expect(isDuplicatePublishedProgramError(err)).toBe(true);
  });

  it("matches the shape PostgreSQL + @prisma/adapter-pg actually produces for this index", () => {
    // The index name only appears in meta.driverAdapterError.cause.originalMessage —
    // `meta.target` does not exist and `message` says only "the fields: (clientId)".
    // The explicit not-toContain keeps this case from rotting into a message match.
    const err = adapterViolation(PUBLISHED_TRAINING_PROGRAM_INDEX, ["clientId"]);
    expect(err.message).not.toContain(PUBLISHED_TRAINING_PROGRAM_INDEX);
    expect(isDuplicatePublishedProgramError(err)).toBe(true);
  });

  it("does NOT match a different TrainingProgram constraint in that same real shape", () => {
    const err = adapterViolation("TrainingProgram_pkey", ["id"]);
    expect(isDuplicatePublishedProgramError(err)).toBe(false);
  });

  it("matches a P2002 whose message contains the index name even with no meta", () => {
    const err = knownError(
      `Unique constraint failed on the fields: (\`${PUBLISHED_TRAINING_PROGRAM_INDEX}\`)`,
      "P2002"
    );
    expect(err.meta).toBeUndefined();
    expect(isDuplicatePublishedProgramError(err)).toBe(true);
  });

  // ── Cross-domain isolation, both directions ────────────────────────────────
  // The two publish services are deliberately scoped differently. Neither
  // predicate may ever claim the other's index, or a meal race would be
  // reported as a training race (and vice versa).

  it("does NOT match the meal-plan published index", () => {
    expect(
      isDuplicatePublishedProgramError(
        adapterViolation(PUBLISHED_MEAL_PLAN_INDEX, ["clientId", "weekOf"])
      )
    ).toBe(false);
    expect(
      isDuplicatePublishedProgramError(
        knownError("Unique constraint failed", "P2002", { target: PUBLISHED_MEAL_PLAN_INDEX })
      )
    ).toBe(false);
    expect(
      isDuplicatePublishedProgramError(
        knownError(
          `Unique constraint failed on the fields: (\`${PUBLISHED_MEAL_PLAN_INDEX}\`)`,
          "P2002"
        )
      )
    ).toBe(false);
  });

  it("the meal-plan predicate does NOT match the training published index", () => {
    expect(
      isDuplicatePublishedPlanError(
        adapterViolation(PUBLISHED_TRAINING_PROGRAM_INDEX, ["clientId"])
      )
    ).toBe(false);
    expect(
      isDuplicatePublishedPlanError(
        knownError("Unique constraint failed", "P2002", {
          target: PUBLISHED_TRAINING_PROGRAM_INDEX,
        })
      )
    ).toBe(false);
    expect(
      isDuplicatePublishedPlanError(
        knownError(
          `Unique constraint failed on the fields: (\`${PUBLISHED_TRAINING_PROGRAM_INDEX}\`)`,
          "P2002"
        )
      )
    ).toBe(false);
  });

  it("does not match a non-P2002 Prisma error", () => {
    const err = knownError(
      `Record not found for ${PUBLISHED_TRAINING_PROGRAM_INDEX}`,
      "P2025"
    );
    expect(isDuplicatePublishedProgramError(err)).toBe(false);
  });

  it("does not match a plain Error mentioning the index name", () => {
    expect(isDuplicatePublishedProgramError(new Error(PUBLISHED_TRAINING_PROGRAM_INDEX))).toBe(
      false
    );
  });

  // The predicate runs inside publishTrainingProgramTarget's catch block. If it
  // ever throws, a real lost race escapes as an unrelated 500 instead of a 409,
  // so a hostile `meta` must degrade to a clean boolean.
  it("still matches when meta is self-referential (would throw on JSON.stringify)", () => {
    const meta: Record<string, unknown> = {
      modelName: "TrainingProgram",
      driverAdapterError: {
        cause: {
          originalMessage: `duplicate key value violates unique constraint "${PUBLISHED_TRAINING_PROGRAM_INDEX}"`,
        },
      },
    };
    meta.self = meta; // circular
    const err = knownError("Unique constraint failed", "P2002", meta);
    expect(() => JSON.stringify(err.meta)).toThrow();
    expect(isDuplicatePublishedProgramError(err)).toBe(true);
  });

  it("returns false (never throws) for a circular meta that does not mention the index", () => {
    const meta: Record<string, unknown> = { target: ["clientId", "weekOf"] };
    meta.self = meta;
    const err = knownError("Unique constraint failed", "P2002", meta);
    expect(isDuplicatePublishedProgramError(err)).toBe(false);
  });

  it("returns false (never throws) for meta containing a BigInt", () => {
    const err = knownError("Unique constraint failed", "P2002", {
      // JSON.stringify throws TypeError on BigInt.
      rowId: BigInt("9007199254740993"),
    } as unknown as Record<string, unknown>);
    expect(() => JSON.stringify(err.meta)).toThrow();
    expect(isDuplicatePublishedProgramError(err)).toBe(false);
  });

  it("returns a clean boolean when reading meta throws", () => {
    const meta = {
      get driverAdapterError(): never {
        throw new Error("meta getter exploded");
      },
    } as unknown as Record<string, unknown>;
    const err = knownError("Unique constraint failed", "P2002", meta);
    expect(isDuplicatePublishedProgramError(err)).toBe(false);

    // …and the message fallback still wins over a broken meta.
    const withMessage = knownError(
      `Unique constraint failed on the fields: (\`${PUBLISHED_TRAINING_PROGRAM_INDEX}\`)`,
      "P2002",
      meta
    );
    expect(isDuplicatePublishedProgramError(withMessage)).toBe(true);
  });

  it("does not match null, undefined or a string", () => {
    expect(isDuplicatePublishedProgramError(null)).toBe(false);
    expect(isDuplicatePublishedProgramError(undefined)).toBe(false);
    expect(isDuplicatePublishedProgramError(PUBLISHED_TRAINING_PROGRAM_INDEX)).toBe(false);
  });
});
