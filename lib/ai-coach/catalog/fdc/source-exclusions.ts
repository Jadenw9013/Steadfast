import { z } from "zod";

/**
 * T-2035 — the ingestion tool's own channel for recording an entry it cannot
 * map.
 *
 * **Why this exists, and what it is not.**
 *
 * `reviewState: "STRUCK"` in the allowlist means *the Registered Dietitian
 * excluded this food*. It has exactly one writer: the RD, by hand, in review.
 * On 2026-09-26 a run refused 48 records and 48 entries were hand-set to
 * `STRUCK` carrying a sentence about what USDA does or does not contain. USDA
 * did contain it; the tool's nutrient lookup was too narrow. A tool defect was
 * written into the reviewer's field, in their voice, in a file that is
 * otherwise run output (review r2 MB-1).
 *
 * The fix is not "be more careful". It is that the tool needs somewhere of its
 * own to write, so that completing a run never requires touching the reviewer's
 * field. This file is that place:
 *
 *  - It records a **source limitation** — the record does not carry what the
 *    catalog needs — and never a review decision. The two must never be
 *    conflated. An entry here is still `PROPOSED`; the RD may still accept or
 *    strike it, and a future run may pick it up if the source improves.
 *  - It is **written only by `scripts/ai-coach-ingest-fdc.ts`**, never by hand.
 *    `writtenBy` is a literal, so a file claiming any other author does not
 *    parse.
 *  - Every `reason` is the mapper's own message, verbatim. Nobody paraphrases
 *    what the source did or did not supply — that paraphrase is what went wrong
 *    last time.
 *  - It is checked in, so the RD can see exactly what the tool dropped and why
 *    without running anything.
 *
 * It is fail-closed in both directions. An unmappable entry that is *not*
 * listed here still aborts the run. An entry that *is* listed here but now maps
 * successfully also aborts the run: the file's claim is that the source cannot
 * supply the macros, and if it can, the claim is stale and a usable food would
 * otherwise be silently dropped.
 */

export const DEFAULT_SOURCE_EXCLUSIONS_PATH =
  "data/ai-coach/catalog/fdc-source-exclusions.v1.json";

/** Frozen. Restated in the file itself so it cannot be read out of context. */
export const SOURCE_EXCLUSION_NOTICE =
  "MACHINE-WRITTEN BY THE INGESTION TOOL. RECORDS A SOURCE LIMITATION, NEVER A REVIEW DECISION. NOT A REVIEWER STRIKE. DO NOT EDIT BY HAND.";

export const SOURCE_EXCLUSION_WRITER = "INGESTION_TOOL" as const;

export const sourceExclusionSchema = z
  .object({
    fdcId: z.number().int().positive(),
    /** The allowlist entry's canonical name, so the RD can read the list. */
    canonicalName: z.string().min(1).max(240),
    /** The mapper's own message(s), verbatim. Never a paraphrase. */
    reason: z.string().min(1).max(600),
    /** The mapper's error codes, so the list can be grouped without parsing prose. */
    errorCodes: z.array(z.string().min(1).max(60)).min(1).max(10),
    /** The date of the run that could not map it. */
    runDate: z.string().datetime({ offset: true }),
  })
  .strict();

export type SourceExclusion = z.infer<typeof sourceExclusionSchema>;

export const sourceExclusionsFileSchema = z
  .object({
    fileSchemaVersion: z.literal(1),
    writtenBy: z.literal(SOURCE_EXCLUSION_WRITER),
    toolId: z.literal("ai-coach-ingest-fdc"),
    notice: z.literal(SOURCE_EXCLUSION_NOTICE),
    generatedAt: z.string().datetime({ offset: true }),
    exclusions: z.array(sourceExclusionSchema).max(2000),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<number>();
    file.exclusions.forEach((exclusion, index) => {
      if (seen.has(exclusion.fdcId)) {
        ctx.addIssue({
          code: "custom",
          path: ["exclusions", index, "fdcId"],
          message: `Duplicate fdcId ${exclusion.fdcId}`,
        });
      }
      seen.add(exclusion.fdcId);
    });
  });

export type SourceExclusionsFile = z.infer<typeof sourceExclusionsFileSchema>;

/**
 * Builds the file. Sorted by `fdcId` so a re-run that changes nothing produces
 * a byte-identical file and an empty diff.
 */
export function buildSourceExclusionsFile(input: {
  generatedAt: string;
  exclusions: readonly SourceExclusion[];
}): SourceExclusionsFile {
  return sourceExclusionsFileSchema.parse({
    fileSchemaVersion: 1,
    writtenBy: SOURCE_EXCLUSION_WRITER,
    toolId: "ai-coach-ingest-fdc",
    notice: SOURCE_EXCLUSION_NOTICE,
    generatedAt: input.generatedAt,
    exclusions: [...input.exclusions].sort((a, b) => a.fdcId - b.fdcId),
  });
}

export function indexSourceExclusions(
  file: SourceExclusionsFile | null
): ReadonlySet<number> {
  return new Set((file?.exclusions ?? []).map((exclusion) => exclusion.fdcId));
}

/** One entry's outcome, as the run observed it. */
export type EntryIngestOutcome =
  | { fdcId: number; canonicalName: string; status: "MAPPED" }
  | {
      fdcId: number;
      canonicalName: string;
      status: "UNMAPPABLE";
      reason: string;
      errorCodes: string[];
    };

export type ExclusionRunDecision =
  /**
   * The file lists entries the source can now supply. Refuse: skipping them
   * would drop a usable food on a claim that is no longer true.
   */
  | { kind: "STALE_EXCLUSIONS"; staleFdcIds: number[]; staleNames: string[] }
  /**
   * Entries the file does not list cannot be mapped. Refuse, and hand back the
   * complete exclusion set for the tool to write.
   */
  | { kind: "WRITE_EXCLUSIONS"; newlyExcluded: SourceExclusion[]; allExclusions: SourceExclusion[] }
  /** Every unmappable entry was already recorded. The catalog may be written. */
  | { kind: "PROCEED"; skippedFdcIds: number[] };

/**
 * The whole decision, as a pure function of what the run observed. The CLI does
 * network and file I/O and then switches on this; the rule itself is tested
 * without either.
 *
 * Note the ordering: staleness is reported before new exclusions, because a
 * stale file is a claim that has become false and the operator must look at it
 * before anything else is written.
 */
export function decideExclusionRun(input: {
  outcomes: readonly EntryIngestOutcome[];
  existing: ReadonlySet<number>;
  runDate: string;
}): ExclusionRunDecision {
  const stale: EntryIngestOutcome[] = [];
  const unmappable: SourceExclusion[] = [];
  const newly: SourceExclusion[] = [];

  for (const outcome of input.outcomes) {
    const listed = input.existing.has(outcome.fdcId);
    if (outcome.status === "MAPPED") {
      if (listed) stale.push(outcome);
      continue;
    }
    const exclusion: SourceExclusion = {
      fdcId: outcome.fdcId,
      canonicalName: outcome.canonicalName,
      reason: outcome.reason,
      errorCodes: outcome.errorCodes,
      runDate: input.runDate,
    };
    unmappable.push(exclusion);
    if (!listed) newly.push(exclusion);
  }

  if (stale.length > 0) {
    return {
      kind: "STALE_EXCLUSIONS",
      staleFdcIds: stale.map((outcome) => outcome.fdcId),
      staleNames: stale.map((outcome) => outcome.canonicalName),
    };
  }

  if (newly.length > 0) {
    return {
      kind: "WRITE_EXCLUSIONS",
      newlyExcluded: newly,
      allExclusions: [...unmappable].sort((a, b) => a.fdcId - b.fdcId),
    };
  }

  return {
    kind: "PROCEED",
    skippedFdcIds: unmappable.map((exclusion) => exclusion.fdcId),
  };
}
