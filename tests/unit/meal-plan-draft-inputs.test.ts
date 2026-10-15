import { describe, it, expect, vi } from "vitest";

/**
 * T-101 — the input contracts of the shared draft-lifecycle service
 * (`lib/meal-plans/drafts.ts`). These are pure schema/helper assertions, so the
 * DB singleton is stubbed out entirely: importing the real one runs
 * connection-string validation at module load.
 */
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  mealPlanItemSchema,
  supportContentInputSchema,
  resolveStartBlank,
} from "@/lib/meal-plans/drafts";

describe("supportContentInputSchema (plan notes write semantics)", () => {
  it("leaves the column unchanged when the field is omitted", () => {
    expect(supportContentInputSchema.parse(undefined)).toBeUndefined();
  });

  it("treats an empty string as 'leave unchanged', never as 'clear'", () => {
    // Load-bearing: iOS sends a non-optional String that defaults to "" on
    // every save, so clearing here would wipe a web coach's notes.
    expect(supportContentInputSchema.parse("")).toBeUndefined();
  });

  it("treats a whitespace-only string as 'leave unchanged'", () => {
    expect(supportContentInputSchema.parse("   \n ")).toBeUndefined();
  });

  it("passes an explicit null through so it can clear the column", () => {
    expect(supportContentInputSchema.parse(null)).toBeNull();
  });

  it("passes a non-empty string through unchanged", () => {
    expect(supportContentInputSchema.parse("Drink water")).toBe("Drink water");
  });

  it("has no max length — existing rows may exceed any limit we would invent", () => {
    const long = "x".repeat(30_000);
    expect(supportContentInputSchema.parse(long)).toBe(long);
  });
});

describe("mealPlanItemSchema (moved verbatim from the two entry points)", () => {
  const base = {
    mealName: "Breakfast",
    sortOrder: 0,
    foodName: "Oatmeal",
    quantity: "1",
    unit: "cup",
  };

  it("coerces numeric strings to integers", () => {
    const parsed = mealPlanItemSchema.parse({ ...base, calories: "300" });
    expect(parsed.calories).toBe(300);
  });

  it("defaults missing macros to 0", () => {
    const parsed = mealPlanItemSchema.parse(base);
    expect(parsed).toMatchObject({ calories: 0, protein: 0, carbs: 0, fats: 0 });
  });

  it("rejects an empty foodName", () => {
    expect(mealPlanItemSchema.safeParse({ ...base, foodName: "" }).success).toBe(false);
  });
});

describe("resolveStartBlank", () => {
  it("defaults to copy-forward when neither field is sent", () => {
    expect(resolveStartBlank({})).toBe(false);
  });

  it("starts blank on an explicit startBlank: true", () => {
    expect(resolveStartBlank({ startBlank: true })).toBe(true);
  });

  it("honors the legacy explicit copyFromPublished: false as 'start blank'", () => {
    expect(resolveStartBlank({ copyFromPublished: false })).toBe(true);
  });

  it("copies forward on copyFromPublished: true", () => {
    expect(resolveStartBlank({ copyFromPublished: true })).toBe(false);
  });

  it("lets an explicit startBlank win over the legacy field", () => {
    expect(resolveStartBlank({ startBlank: false, copyFromPublished: false })).toBe(false);
  });
});
