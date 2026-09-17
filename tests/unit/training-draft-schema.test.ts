import { describe, expect, it } from "vitest";

import { BlockType } from "@/app/generated/prisma/enums";
import {
  TRAINING_BLOCK_TYPES,
  clientNotesSchema,
  normalizeTrainingDays,
  trainingBlockSchema,
  trainingDaySchema,
  trainingDaysSchema,
  weeklyFrequencySchema,
  type TrainingDayInput,
} from "@/lib/training-programs/drafts";

/**
 * T-622 — `lib/training-programs/drafts.ts` is the one place the block-type
 * enum, the day/block limits and the null/empty normalization live. Both the
 * `saveTrainingProgram` Server Action and PUT/POST
 * `/api/coach/clients/[clientId]/training` parse with these exact schemas, so
 * anything asserted here is asserted for both surfaces at once.
 *
 * The two things this file is really guarding:
 *   - `"TEXT"` is gone. It was never a member of Prisma's `enum BlockType`, so
 *     the route's old `z.enum(["TEXT", "EXERCISE"])` could only ever produce a
 *     500 at the DB while rejecting the four legitimate non-exercise types.
 *   - `dayName` / `title` / `content` are ALWAYS strings after parsing. All
 *     three are NOT NULL columns; `null` or "absent" reaching Prisma is a 500.
 */

const parseDay = (input: unknown) => trainingDaySchema.parse(input);

describe("training draft schemas — block types", () => {
  it("accepts all six real BlockType values and nothing else", () => {
    expect(TRAINING_BLOCK_TYPES).toEqual([
      "EXERCISE",
      "ACTIVATION",
      "INSTRUCTION",
      "SUPERSET",
      "CARDIO",
      "OPTIONAL",
    ]);

    for (const type of TRAINING_BLOCK_TYPES) {
      expect(trainingBlockSchema.parse({ type }).type).toBe(type);
    }
  });

  it("covers Prisma's enum BlockType exactly — no hand-maintained drift", () => {
    // The assertion above compares the list against the same six literals, so
    // it can only agree with itself. This one compares it against the generated
    // enum, the actual source of truth. `drafts.ts` also carries a compile-time
    // exhaustiveness guard, so a seventh value fails `tsc` before it gets here.
    expect([...TRAINING_BLOCK_TYPES].sort()).toEqual(
      Object.values(BlockType).sort()
    );
  });

  it('rejects "TEXT" — it is not a member of enum BlockType and only ever 500ed', () => {
    expect(trainingBlockSchema.safeParse({ type: "TEXT" }).success).toBe(false);
  });

  it("rejects an unknown block type", () => {
    expect(trainingBlockSchema.safeParse({ type: "PLYO" }).success).toBe(false);
    expect(trainingBlockSchema.safeParse({ type: "exercise" }).success).toBe(false);
  });

  it('defaults a missing type to "EXERCISE"', () => {
    expect(trainingBlockSchema.parse({}).type).toBe("EXERCISE");
  });
});

describe("training draft schemas — null/empty normalization", () => {
  it.each([
    ["absent", {}],
    ["null", { title: null, content: null }],
    ["empty string", { title: "", content: "" }],
  ])("block title/content: %s becomes an empty string, never null", (_label, input) => {
    const block = trainingBlockSchema.parse(input);
    expect(block.title).toBe("");
    expect(block.content).toBe("");
  });

  it.each([
    ["absent", {}],
    ["null", { dayName: null }],
    ["empty string", { dayName: "" }],
  ])('dayName: %s becomes "" (the OCR importer creates empty day names)', (_label, input) => {
    expect(parseDay(input).dayName).toBe("");
  });

  it("defaults missing blocks to an empty array", () => {
    expect(parseDay({ dayName: "Day 1" }).blocks).toEqual([]);
  });

  it("enforces the max lengths: title 200, content 5000, dayName 100", () => {
    expect(trainingBlockSchema.safeParse({ title: "a".repeat(200) }).success).toBe(true);
    expect(trainingBlockSchema.safeParse({ title: "a".repeat(201) }).success).toBe(false);

    expect(trainingBlockSchema.safeParse({ content: "a".repeat(5000) }).success).toBe(true);
    expect(trainingBlockSchema.safeParse({ content: "a".repeat(5001) }).success).toBe(false);

    expect(trainingDaySchema.safeParse({ dayName: "a".repeat(100) }).success).toBe(true);
    expect(trainingDaySchema.safeParse({ dayName: "a".repeat(101) }).success).toBe(false);
  });
});

describe("training draft schemas — limits (the looser of the two old copies wins)", () => {
  const day = (blockCount: number) => ({
    dayName: "Day",
    blocks: Array.from({ length: blockCount }, () => ({ type: "EXERCISE" as const })),
  });

  it("accepts 14 days and rejects 15", () => {
    expect(trainingDaysSchema.safeParse(Array.from({ length: 14 }, () => day(0))).success).toBe(
      true
    );
    expect(trainingDaysSchema.safeParse(Array.from({ length: 15 }, () => day(0))).success).toBe(
      false
    );
  });

  it("accepts 50 blocks in a day and rejects 51 (the route's old cap was 30)", () => {
    expect(trainingDaySchema.safeParse(day(50)).success).toBe(true);
    expect(trainingDaySchema.safeParse(day(51)).success).toBe(false);
  });

  it("accepts a 2000-character clientNotes and rejects 2001 (the action's old cap was 1000)", () => {
    expect(clientNotesSchema.safeParse("n".repeat(2000)).success).toBe(true);
    expect(clientNotesSchema.safeParse("n".repeat(2001)).success).toBe(false);
  });

  it("coerces weeklyFrequency and holds it to 1..7", () => {
    expect(weeklyFrequencySchema.parse("3")).toBe(3);
    expect(weeklyFrequencySchema.safeParse(0).success).toBe(false);
    expect(weeklyFrequencySchema.safeParse(8).success).toBe(false);
  });
});

describe("normalizeTrainingDays", () => {
  const day = (dayName: string, sortOrder?: number): TrainingDayInput =>
    trainingDaySchema.parse({ dayName, ...(sortOrder !== undefined && { sortOrder }) });

  it("stable-sorts by sortOrder and rewrites it to a dense 0..n-1", () => {
    const days = [day("a", 5), day("b", 2), day("c", 2), day("d", 0)];
    const out = normalizeTrainingDays(days);

    expect(out.map((d) => d.dayName)).toEqual(["d", "b", "c", "a"]);
    expect(out.map((d) => d.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("preserves array order and densifies when no sortOrder is sent at all", () => {
    const out = normalizeTrainingDays([day("a"), day("b"), day("c")]);

    expect(out.map((d) => d.dayName)).toEqual(["a", "b", "c"]);
    expect(out.map((d) => d.sortOrder)).toEqual([0, 1, 2]);
  });

  it("normalizes block ordering independently per day", () => {
    const days = trainingDaysSchema.parse([
      {
        dayName: "Day 1",
        sortOrder: 9,
        blocks: [
          { type: "EXERCISE", title: "second", sortOrder: 7 },
          { type: "ACTIVATION", title: "first", sortOrder: 3 },
        ],
      },
      {
        dayName: "Day 2",
        sortOrder: 1,
        blocks: [
          { type: "CARDIO", title: "c-first" },
          { type: "OPTIONAL", title: "c-second" },
        ],
      },
    ]);

    const out = normalizeTrainingDays(days);

    expect(out.map((d) => [d.dayName, d.sortOrder])).toEqual([
      ["Day 2", 0],
      ["Day 1", 1],
    ]);
    expect(out[0].blocks.map((b) => [b.title, b.sortOrder])).toEqual([
      ["c-first", 0],
      ["c-second", 1],
    ]);
    expect(out[1].blocks.map((b) => [b.title, b.sortOrder])).toEqual([
      ["first", 0],
      ["second", 1],
    ]);
  });

  it("never emits null for dayName, title or content", () => {
    const days = trainingDaysSchema.parse([
      { dayName: null, blocks: [{ type: "INSTRUCTION", title: null, content: null }] },
    ]);

    expect(normalizeTrainingDays(days)).toEqual([
      {
        dayName: "",
        sortOrder: 0,
        blocks: [{ type: "INSTRUCTION", title: "", content: "", sortOrder: 0 }],
      },
    ]);
  });
});
