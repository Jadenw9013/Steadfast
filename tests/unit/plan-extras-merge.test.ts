import { describe, expect, it } from "vitest";
import { mergePlanExtras } from "@/lib/meal-plans/plan-extras-merge";

describe("mergePlanExtras — T-841 frozen semantics", () => {
  it("case 1 — stored metadata/confidence survive an iOS-shaped dayOverrides-only save; dayOverrides is replaced", () => {
    const stored = {
      metadata: {
        phase: "cutting",
        startDate: "2026-09-14",
        bodyweight: "173 lbs",
        coachNotes: "Hit protein first",
        highlightedChanges: "more carbs on Monday",
      },
      dayOverrides: [{ label: "High Carb Day", color: "blue", weekdays: ["Monday"] }],
      confidence: { meals: 0.92 },
    };
    const incoming = { dayOverrides: [{ label: "Refeed", color: "blue", weekdays: ["Friday"] }] };

    const result = mergePlanExtras(stored, incoming);

    expect(result).toEqual({
      metadata: stored.metadata,
      confidence: stored.confidence,
      dayOverrides: incoming.dayOverrides,
    });
  });

  it("case 2 — stored SQL null → result deep-equals incoming", () => {
    const incoming = { dayOverrides: [{ label: "Refeed" }] };
    expect(mergePlanExtras(null, incoming)).toEqual(incoming);
  });

  it("case 3 — non-object stored values are treated as {} (array, string, number, JSON null)", () => {
    const incoming = { metadata: { phase: "bulking" } };
    expect(mergePlanExtras([{ metadata: { phase: "old" } }] as unknown as never, incoming)).toEqual(incoming);
    expect(mergePlanExtras("not-an-object" as unknown as never, incoming)).toEqual(incoming);
    expect(mergePlanExtras(42 as unknown as never, incoming)).toEqual(incoming);
    expect(mergePlanExtras(null, incoming)).toEqual(incoming);
  });

  it("case 4 — unknown legacy top-level keys are preserved verbatim alongside merged keys (raw-JSON guard)", () => {
    const stored = {
      rules: ["Drink 3L"],
      cardio: { type: "LISS", minutes: 30 },
      hydration: "3L/day",
      supplements: [{ name: "Creatine" }],
      metadata: { phase: "cutting" },
    };
    const incoming = { dayOverrides: [{ label: "Refeed" }] };

    const result = mergePlanExtras(stored, incoming);

    expect(result).toEqual({
      rules: stored.rules,
      cardio: stored.cardio,
      hydration: stored.hydration,
      supplements: stored.supplements,
      metadata: stored.metadata,
      dayOverrides: incoming.dayOverrides,
    });
  });

  it("case 5 — incoming {} → result deep-equals stored", () => {
    const stored = { metadata: { phase: "cutting" }, dayOverrides: [{ label: "Refeed" }] };
    expect(mergePlanExtras(stored, {})).toEqual(stored);
  });

  it("case 6 — incoming dayOverrides: [] clears overrides; metadata survives", () => {
    const stored = { metadata: { phase: "cutting" }, dayOverrides: [{ label: "Refeed" }] };
    const result = mergePlanExtras(stored, { dayOverrides: [] });
    expect(result).toEqual({ metadata: stored.metadata, dayOverrides: [] });
  });

  it("case 7 — shallow, not deep: incoming metadata omitting a sub-key drops it entirely", () => {
    const stored = {
      metadata: { phase: "cutting", highlightedChanges: "more carbs on Monday" },
    };
    const incoming = { metadata: { phase: "cutting" } };

    const result = mergePlanExtras(stored, incoming);

    expect(result).toEqual({ metadata: { phase: "cutting" } });
    expect((result as { metadata: { highlightedChanges?: string } }).metadata.highlightedChanges).toBeUndefined();
  });

  it("case 9 — an incoming key explicitly set to undefined never clears the stored value (rule 3)", () => {
    const stored = { metadata: { phase: "cutting" }, confidence: { meals: 0.9 } };
    const incoming = { metadata: { phase: "cutting" }, confidence: undefined };

    const result = mergePlanExtras(stored, incoming);

    expect(result).toEqual({ metadata: { phase: "cutting" }, confidence: stored.confidence });
  });

  it("case 8 — stored is not mutated and the result is not reference-equal to either input", () => {
    const stored = { metadata: { phase: "cutting" }, dayOverrides: [{ label: "Refeed" }] };
    const storedSnapshot = JSON.parse(JSON.stringify(stored));
    const incoming = { dayOverrides: [{ label: "New" }] };

    const result = mergePlanExtras(stored, incoming);

    expect(stored).toEqual(storedSnapshot);
    expect(result).not.toBe(stored);
    expect(result).not.toBe(incoming);
  });
});
