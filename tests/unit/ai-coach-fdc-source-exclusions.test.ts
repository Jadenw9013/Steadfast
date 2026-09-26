import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSourceExclusionsFile,
  decideExclusionRun,
  indexSourceExclusions,
  sourceExclusionsFileSchema,
  DEFAULT_SOURCE_EXCLUSIONS_PATH,
  SOURCE_EXCLUSION_NOTICE,
  SOURCE_EXCLUSION_WRITER,
  type EntryIngestOutcome,
  type SourceExclusion,
} from "@/lib/ai-coach/catalog/fdc/source-exclusions";
import { mapFdcRecordToCatalogItem } from "@/lib/ai-coach/catalog/fdc/mapping";
import { allowlistSchema } from "@/lib/ai-coach/catalog/fdc/allowlist-schema";
import type { AllowlistEntry } from "@/lib/ai-coach/catalog/fdc/allowlist-schema";

const RUN_DATE = "2026-09-26T00:00:00.000Z";

function exclusion(overrides: Partial<SourceExclusion> = {}): SourceExclusion {
  return {
    fdcId: 9000000001,
    canonicalName: "Synthetic Unmappable Item",
    reason: "Energy (kcal) nutrient is missing or has null amount",
    errorCodes: ["MISSING_ENERGY"],
    runDate: RUN_DATE,
    ...overrides,
  };
}

function unmappable(fdcId: number, name: string): EntryIngestOutcome {
  return {
    fdcId,
    canonicalName: name,
    status: "UNMAPPABLE",
    reason: "Energy (kcal) nutrient is missing or has null amount",
    errorCodes: ["MISSING_ENERGY"],
  };
}

function mapped(fdcId: number, name: string): EntryIngestOutcome {
  return { fdcId, canonicalName: name, status: "MAPPED" };
}

describe("T-2035 — FDC source exclusions (the tool's channel, not the reviewer's)", () => {
  /**
   * The whole point of the file. `reviewState: "STRUCK"` means the Registered
   * Dietitian excluded a food and has exactly one writer. On 2026-09-26 a run
   * refused 48 records and 48 entries were hand-set to STRUCK with a sentence
   * about what USDA does not contain — USDA did contain it, and a tool defect
   * was written into the reviewer's field in the reviewer's voice (review r2
   * MB-1). The tool now has somewhere of its own to write, so completing a run
   * never requires touching `reviewState`.
   */
  it("An exclusion record cannot carry a review decision", () => {
    const withReviewState = {
      ...exclusion(),
      reviewState: "STRUCK",
    };
    expect(() =>
      sourceExclusionsFileSchema.parse(
        buildSourceExclusionsFileInput([withReviewState as unknown as SourceExclusion])
      )
    ).toThrow();

    const withReviewerNote = { ...exclusion(), reviewerNote: "excluded by the RD" };
    expect(() =>
      sourceExclusionsFileSchema.parse(
        buildSourceExclusionsFileInput([withReviewerNote as unknown as SourceExclusion])
      )
    ).toThrow();

    // And the allowlist's vocabulary is untouched: STRUCK still exists there
    // and still means the reviewer's act.
    expect(allowlistSchema).toBeDefined();
  });

  it("The file declares a machine writer and the frozen notice, so a hand-written one does not parse", () => {
    const file = buildSourceExclusionsFile({ generatedAt: RUN_DATE, exclusions: [exclusion()] });
    expect(file.writtenBy).toBe(SOURCE_EXCLUSION_WRITER);
    expect(file.notice).toBe(SOURCE_EXCLUSION_NOTICE);
    expect(file.notice).toContain("NEVER A REVIEW DECISION");
    expect(file.toolId).toBe("ai-coach-ingest-fdc");

    expect(() =>
      sourceExclusionsFileSchema.parse({ ...file, writtenBy: "REVIEWER" })
    ).toThrow();
    expect(() =>
      sourceExclusionsFileSchema.parse({ ...file, notice: "excluded during review" })
    ).toThrow();
  });

  it("Exclusions are sorted by fdcId and unique, so a no-change re-run produces no diff", () => {
    const file = buildSourceExclusionsFile({
      generatedAt: RUN_DATE,
      exclusions: [
        exclusion({ fdcId: 300, canonicalName: "C" }),
        exclusion({ fdcId: 100, canonicalName: "A" }),
        exclusion({ fdcId: 200, canonicalName: "B" }),
      ],
    });
    expect(file.exclusions.map((e) => e.fdcId)).toEqual([100, 200, 300]);

    expect(() =>
      sourceExclusionsFileSchema.parse({
        ...file,
        exclusions: [exclusion({ fdcId: 100 }), exclusion({ fdcId: 100, canonicalName: "dup" })],
      })
    ).toThrowError(/Duplicate fdcId 100/);
  });

  it("Every exclusion carries a non-empty verbatim reason and at least one error code", () => {
    expect(() =>
      sourceExclusionsFileSchema.parse(buildSourceExclusionsFileInput([exclusion({ reason: "" })]))
    ).toThrow();
    expect(() =>
      sourceExclusionsFileSchema.parse(buildSourceExclusionsFileInput([exclusion({ errorCodes: [] })]))
    ).toThrow();
  });

  /**
   * The reason is the mapper's own message, not a paraphrase. The paraphrase is
   * what went wrong: "the USDA source record does not carry the macronutrients
   * this catalog requires" was written into 48 reviewer notes and was false.
   */
  it("The reason is the mapper's own message, taken verbatim", () => {
    const entry: AllowlistEntry = {
      fdcId: 9000000501,
      dataType: "Foundation",
      canonicalName: "Synthetic Lipid-Profile-Only Oil",
      synonyms: [],
      categoryId: "FAT_AND_OIL",
      foodState: "NOT_APPLICABLE",
      singleIngredientWholeFood: true,
      patternTags: ["OMNIVORE"],
      ownAllergenCategories: [],
      reviewState: "PROPOSED",
      reviewerNote: null,
    };
    const result = mapFdcRecordToCatalogItem({
      entry,
      record: {
        _synthetic: { label: "SYNTHETIC FIXTURE - NOT A USDA RECORD" },
        fdcId: 9000000501,
        description: "SYNTHETIC FIXTURE - record carrying only a lipid profile",
        dataType: "Foundation",
        publicationDate: "01/01/1902",
        foodNutrients: [
          {
            nutrient: { id: 1258, number: "606", name: "Fatty acids, total saturated", unitName: "G" },
            amount: 14,
          },
        ],
      },
      retrievedAt: RUN_DATE,
      allowlistVersion: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const built = buildSourceExclusionsFile({
      generatedAt: RUN_DATE,
      exclusions: [
        {
          fdcId: entry.fdcId,
          canonicalName: entry.canonicalName,
          reason: result.errors.map((e) => e.message).join("; "),
          errorCodes: result.errors.map((e) => e.code),
          runDate: RUN_DATE,
        },
      ],
    });

    const recorded = built.exclusions[0];
    for (const error of result.errors) {
      expect(recorded.reason).toContain(error.message);
      expect(recorded.errorCodes).toContain(error.code);
    }
    expect(recorded.errorCodes).toContain("MISSING_ENERGY");
    expect(recorded.errorCodes).toContain("MISSING_PROTEIN");
    expect(recorded.errorCodes).toContain("MISSING_FAT");
    expect(recorded.errorCodes).toContain("MISSING_CARBOHYDRATE");
  });

  describe("decideExclusionRun", () => {
    it("Fails closed: an unmappable entry the file does not list refuses the run", () => {
      const decision = decideExclusionRun({
        outcomes: [mapped(1, "Fine"), unmappable(2, "Broken")],
        existing: new Set<number>(),
        runDate: RUN_DATE,
      });
      expect(decision.kind).toBe("WRITE_EXCLUSIONS");
      if (decision.kind !== "WRITE_EXCLUSIONS") return;
      expect(decision.newlyExcluded.map((e) => e.fdcId)).toEqual([2]);
      expect(decision.allExclusions.map((e) => e.fdcId)).toEqual([2]);
      expect(decision.newlyExcluded[0].runDate).toBe(RUN_DATE);
    });

    it("Proceeds only when every unmappable entry is already recorded", () => {
      const decision = decideExclusionRun({
        outcomes: [mapped(1, "Fine"), unmappable(2, "Broken"), unmappable(3, "Also broken")],
        existing: new Set([2, 3]),
        runDate: RUN_DATE,
      });
      expect(decision.kind).toBe("PROCEED");
      if (decision.kind !== "PROCEED") return;
      expect(decision.skippedFdcIds).toEqual([2, 3]);
    });

    it("A recorded entry that now maps is an error, not a silent pass", () => {
      const decision = decideExclusionRun({
        outcomes: [mapped(2, "Now mappable"), mapped(1, "Fine")],
        existing: new Set([2]),
        runDate: RUN_DATE,
      });
      expect(decision.kind).toBe("STALE_EXCLUSIONS");
      if (decision.kind !== "STALE_EXCLUSIONS") return;
      expect(decision.staleFdcIds).toEqual([2]);
      expect(decision.staleNames).toEqual(["Now mappable"]);
    });

    it("Staleness is reported before new exclusions are written", () => {
      // Both conditions at once: the file must not be rewritten while it also
      // contains a claim that has become false.
      const decision = decideExclusionRun({
        outcomes: [mapped(2, "Now mappable"), unmappable(4, "Newly broken")],
        existing: new Set([2]),
        runDate: RUN_DATE,
      });
      expect(decision.kind).toBe("STALE_EXCLUSIONS");
    });

    it("A still-failing recorded entry stays in the file when a new one is added", () => {
      const decision = decideExclusionRun({
        outcomes: [unmappable(2, "Still broken"), unmappable(4, "Newly broken")],
        existing: new Set([2]),
        runDate: RUN_DATE,
      });
      expect(decision.kind).toBe("WRITE_EXCLUSIONS");
      if (decision.kind !== "WRITE_EXCLUSIONS") return;
      expect(decision.newlyExcluded.map((e) => e.fdcId)).toEqual([4]);
      // Both, sorted: rewriting the file must not drop what it already recorded.
      expect(decision.allExclusions.map((e) => e.fdcId)).toEqual([2, 4]);
    });

    it("A run with nothing unmappable proceeds with nothing skipped", () => {
      const decision = decideExclusionRun({
        outcomes: [mapped(1, "A"), mapped(2, "B")],
        existing: new Set<number>(),
        runDate: RUN_DATE,
      });
      expect(decision).toEqual({ kind: "PROCEED", skippedFdcIds: [] });
    });
  });

  it("indexSourceExclusions handles an absent file as 'nothing is excluded'", () => {
    expect(indexSourceExclusions(null).size).toBe(0);
    const file = buildSourceExclusionsFile({
      generatedAt: RUN_DATE,
      exclusions: [exclusion({ fdcId: 7 }), exclusion({ fdcId: 9 })],
    });
    expect([...indexSourceExclusions(file)].sort()).toEqual([7, 9]);
  });

  const exclusionsPath = path.resolve(DEFAULT_SOURCE_EXCLUSIONS_PATH);
  it.skipIf(!fs.existsSync(exclusionsPath))(
    "the checked-in exclusions file parses and is machine-written throughout",
    () => {
      const file = sourceExclusionsFileSchema.parse(
        JSON.parse(fs.readFileSync(exclusionsPath, "utf8"))
      );
      expect(file.writtenBy).toBe(SOURCE_EXCLUSION_WRITER);
      expect(file.notice).toBe(SOURCE_EXCLUSION_NOTICE);
      for (const entry of file.exclusions) {
        expect(entry.reason.length).toBeGreaterThan(0);
        expect(entry.errorCodes.length).toBeGreaterThan(0);
      }
      // Nothing here may reappear as a reviewer strike in the allowlist: the
      // two fields mean different things and must not be conflated.
      const allowlist = allowlistSchema.parse(
        JSON.parse(
          fs.readFileSync(path.resolve("data/ai-coach/catalog/fdc-allowlist.v1.json"), "utf8")
        )
      );
      const excludedIds = new Set(file.exclusions.map((e) => e.fdcId));
      for (const entry of allowlist.entries) {
        if (!excludedIds.has(entry.fdcId)) continue;
        expect(
          entry.reviewState,
          `${entry.fdcId} ${entry.canonicalName}: a tool exclusion must not become a reviewer strike`
        ).not.toBe("STRUCK");
      }
    }
  );
});

function buildSourceExclusionsFileInput(exclusions: SourceExclusion[]) {
  return {
    fileSchemaVersion: 1,
    writtenBy: SOURCE_EXCLUSION_WRITER,
    toolId: "ai-coach-ingest-fdc",
    notice: SOURCE_EXCLUSION_NOTICE,
    generatedAt: RUN_DATE,
    exclusions,
  };
}
