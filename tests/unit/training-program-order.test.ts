import { describe, it, expect } from "vitest";
import {
  PUBLISHED_TRAINING_ORDER_BY,
  DRAFT_TRAINING_ORDER_BY,
} from "@/lib/queries/training-programs";

/**
 * T-803: pins the exact ordering used by every published/draft TrainingProgram
 * lookup so a future edit that drops `nulls: "last"` or a tiebreak fails here
 * instead of silently reintroducing D1/D2.
 */
describe("PUBLISHED_TRAINING_ORDER_BY", () => {
  it("is exactly publishedAt desc nulls last, then createdAt desc, then id desc", () => {
    expect(PUBLISHED_TRAINING_ORDER_BY).toEqual([
      { publishedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });
});

describe("DRAFT_TRAINING_ORDER_BY", () => {
  it("is exactly updatedAt desc, then id desc", () => {
    expect(DRAFT_TRAINING_ORDER_BY).toEqual([
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
  });
});
