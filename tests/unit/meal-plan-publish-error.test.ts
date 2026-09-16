import { describe, it, expect, vi } from "vitest";

/**
 * T-660 — the publish race predicate must match on the partial unique index
 * NAME, never on a bare `code === "P2002"`. The version-allocation race that
 * `lib/meal-plans/version.ts` already retries on
 * (`@@unique([clientId, weekOf, version])`) is also a P2002 and must never be
 * mistaken for a lost publish race.
 */

// Must set DATABASE_URL before db.ts would be imported — mirrors the hoisted
// style in tests/unit/prisma-error.test.ts. `@/lib/db` is mocked anyway so no
// PrismaClient is ever constructed; the real generated Prisma namespace is
// used so `instanceof` semantics are the real ones.
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://test:test@localhost/test";
});
vi.mock("@/lib/db", () => ({ db: {} }));

import { Prisma } from "@/app/generated/prisma/client";
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

describe("isDuplicatePublishedPlanError", () => {
  it("matches a P2002 whose meta.target is the published-plan index name", () => {
    const err = knownError("Unique constraint failed", "P2002", {
      target: PUBLISHED_MEAL_PLAN_INDEX,
    });
    expect(isDuplicatePublishedPlanError(err)).toBe(true);
  });

  it("matches the shape PostgreSQL + @prisma/adapter-pg actually produces for this index", () => {
    // Observed against the local test database (T-660): the index name only
    // appears in meta.driverAdapterError.cause.originalMessage — `meta.target`
    // does not exist and `message` says only "the fields: (clientId, weekOf)".
    // This case is what keeps the predicate honest if the meta shape changes.
    const err = knownError(
      'Invalid `prisma.mealPlan.updateMany()` invocation:\n\nUnique constraint failed on the fields: (`"clientId"`, `"weekOf"`)',
      "P2002",
      {
        modelName: "MealPlan",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage: `duplicate key value violates unique constraint "${PUBLISHED_MEAL_PLAN_INDEX}"`,
            kind: "UniqueConstraintViolation",
            constraint: { fields: ['"clientId"', '"weekOf"'] },
          },
        },
      }
    );
    expect(err.message).not.toContain(PUBLISHED_MEAL_PLAN_INDEX);
    expect(isDuplicatePublishedPlanError(err)).toBe(true);
  });

  it("does NOT match the version-allocation unique constraint in that same real shape", () => {
    const err = knownError(
      'Unique constraint failed on the fields: (`"clientId"`, `"weekOf"`, `"version"`)',
      "P2002",
      {
        modelName: "MealPlan",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage:
              'duplicate key value violates unique constraint "MealPlan_clientId_weekOf_version_key"',
            kind: "UniqueConstraintViolation",
            constraint: { fields: ['"clientId"', '"weekOf"', '"version"'] },
          },
        },
      }
    );
    expect(isDuplicatePublishedPlanError(err)).toBe(false);
  });

  it("matches a P2002 whose message contains the index name even with no meta", () => {
    const err = knownError(
      `Unique constraint failed on the fields: (\`${PUBLISHED_MEAL_PLAN_INDEX}\`)`,
      "P2002"
    );
    expect(err.meta).toBeUndefined();
    expect(isDuplicatePublishedPlanError(err)).toBe(true);
  });

  it("does NOT match the (clientId, weekOf, version) allocation race", () => {
    const err = knownError("Unique constraint failed", "P2002", {
      target: ["clientId", "weekOf", "version"],
    });
    expect(isDuplicatePublishedPlanError(err)).toBe(false);
  });

  it("does not match a non-P2002 Prisma error", () => {
    const err = knownError(
      `Record not found for ${PUBLISHED_MEAL_PLAN_INDEX}`,
      "P2025"
    );
    expect(isDuplicatePublishedPlanError(err)).toBe(false);
  });

  it("does not match a plain Error mentioning the index name", () => {
    expect(isDuplicatePublishedPlanError(new Error(PUBLISHED_MEAL_PLAN_INDEX))).toBe(false);
  });

  // The predicate runs inside publishMealPlanTarget's catch block. If it ever
  // throws, a real lost race escapes as an unrelated 500 instead of a 409, so
  // a hostile `meta` must degrade to a clean boolean.
  it("still matches when meta is self-referential (would throw on JSON.stringify)", () => {
    const meta: Record<string, unknown> = {
      modelName: "MealPlan",
      driverAdapterError: {
        cause: {
          originalMessage: `duplicate key value violates unique constraint "${PUBLISHED_MEAL_PLAN_INDEX}"`,
        },
      },
    };
    meta.self = meta; // circular
    const err = knownError("Unique constraint failed", "P2002", meta);
    expect(() => JSON.stringify(err.meta)).toThrow();
    expect(isDuplicatePublishedPlanError(err)).toBe(true);
  });

  it("returns false (never throws) for a circular meta that does not mention the index", () => {
    const meta: Record<string, unknown> = { target: ["clientId", "weekOf", "version"] };
    meta.self = meta;
    const err = knownError("Unique constraint failed", "P2002", meta);
    expect(isDuplicatePublishedPlanError(err)).toBe(false);
  });

  it("returns false (never throws) for meta containing a BigInt", () => {
    const err = knownError("Unique constraint failed", "P2002", {
      // JSON.stringify throws TypeError on BigInt.
      rowId: BigInt("9007199254740993"),
    } as unknown as Record<string, unknown>);
    expect(() => JSON.stringify(err.meta)).toThrow();
    expect(isDuplicatePublishedPlanError(err)).toBe(false);
  });

  it("returns a clean boolean when reading meta throws", () => {
    const meta = {
      get driverAdapterError(): never {
        throw new Error("meta getter exploded");
      },
    } as unknown as Record<string, unknown>;
    const err = knownError("Unique constraint failed", "P2002", meta);
    expect(isDuplicatePublishedPlanError(err)).toBe(false);

    // …and the message fallback still wins over a broken meta.
    const withMessage = knownError(
      `Unique constraint failed on the fields: (\`${PUBLISHED_MEAL_PLAN_INDEX}\`)`,
      "P2002",
      meta
    );
    expect(isDuplicatePublishedPlanError(withMessage)).toBe(true);
  });

  it("does not match null, undefined or a string", () => {
    expect(isDuplicatePublishedPlanError(null)).toBe(false);
    expect(isDuplicatePublishedPlanError(undefined)).toBe(false);
    expect(isDuplicatePublishedPlanError(PUBLISHED_MEAL_PLAN_INDEX)).toBe(false);
  });
});
