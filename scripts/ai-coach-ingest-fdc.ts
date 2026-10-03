import fs from "node:fs";
import { contentHash } from "../lib/ai-coach/canonical-json";
import {
  allowlistSchemaForPlan,
  coveragePlanSchema,
  type AllowlistEntry,
  type CoveragePlan,
} from "../lib/ai-coach/catalog/fdc/allowlist-schema";
import {
  isIngestableEntry,
  mapFdcRecordToCatalogItem,
  redactUrl,
} from "../lib/ai-coach/catalog/fdc/mapping";
import { readFdcFoodCategory } from "../lib/ai-coach/catalog/fdc/normalize";
import { proposeCuration, TRIAGE_FLAGS } from "../lib/ai-coach/catalog/fdc/curation";
import { isSignedFoodCatalogFile } from "../lib/ai-coach/catalog/fdc/signed-file-guard";
import {
  foodCatalogContentSchema,
  type SourcedFoodCatalogItem,
} from "../lib/ai-coach/artifacts/schema";
import { draftFoodCatalogFileSchema } from "../lib/ai-coach/artifacts/drafts/loader";
import {
  buildSourceExclusionsFile,
  decideExclusionRun,
  indexSourceExclusions,
  sourceExclusionsFileSchema,
  DEFAULT_SOURCE_EXCLUSIONS_PATH,
  type EntryIngestOutcome,
  type SourceExclusionsFile,
} from "../lib/ai-coach/catalog/fdc/source-exclusions";

const API_KEY = process.env.FDC_API_KEY;

function redact(msg: string): string {
  let out = redactUrl(msg);
  if (API_KEY && API_KEY.trim().length > 0) {
    out = out.split(API_KEY).join("[REDACTED_API_KEY]");
  }
  return out;
}

function safeLog(...args: unknown[]): void {
  const line = args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
  console.log(redact(line));
}

function safeError(...args: unknown[]): void {
  const line = args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
  console.error(redact(line));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

/**
 * 429 and 5xx are transient. Everything else is not: a 403 is a rejected or
 * missing API key and a 404 is a record that does not exist, and retrying
 * either one four times just makes the operator wait (review r1, MINOR 3).
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchWithRetry(url: string, retries = 3): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
      const statusError = new HttpStatusError(res.status, res.statusText);
      if (!isRetryableStatus(res.status) || attempt >= retries) {
        throw statusError;
      }
      await sleep(1000 * Math.pow(2, attempt));
      continue;
    } catch (err) {
      if (err instanceof HttpStatusError && !isRetryableStatus(err.status)) {
        throw err;
      }
      if (attempt >= retries) {
        throw new Error(
          `Request failed after ${retries + 1} attempts: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw new Error("Request retries exhausted");
}

const DEFAULT_COVERAGE_PLAN_PATH = "data/ai-coach/catalog/fdc-coverage-plan.v1.json";

function readCoveragePlan(planPath: string): CoveragePlan {
  const rawPlan = fs.readFileSync(planPath, "utf8");
  return coveragePlanSchema.parse(JSON.parse(rawPlan));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length === 0) {
    safeLog(
      "Usage:\n" +
        "  ai-coach-ingest-fdc --plan <path> --out <path>\n" +
        "  ai-coach-ingest-fdc --allowlist <path> --out <path> [--plan <path>]\n" +
        "                      [--source-exclusions <path>] [--dry-run] [--force]\n" +
        "\n" +
        "--out must never point at a signed catalog file (reviewMetadata.decision\n" +
        "APPROVED) — write a new version file instead. --force overrides the refusal.\n"
    );
    process.exit(2);
  }

  if (!API_KEY || !API_KEY.trim()) {
    safeError("Missing required environment variable FDC_API_KEY");
    process.exit(2);
  }

  const getArg = (flag: string): string | null => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return null;
  };

  const planPath = getArg("--plan");
  const allowlistPath = getArg("--allowlist");
  const outPath = getArg("--out");
  const exclusionsPath = getArg("--source-exclusions") ?? DEFAULT_SOURCE_EXCLUSIONS_PATH;
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  if (!outPath || (!planPath && !allowlistPath)) {
    safeError("Invalid arguments. Must supply --out and either --plan or --allowlist.");
    process.exit(2);
  }

  // MODE 1: PROPOSE ALLOWLIST (selected only when no --allowlist was supplied,
  // so that --ingest may take a --plan for its coveragePlanDigest re-check).
  if (planPath && !allowlistPath) {
    if (!fs.existsSync(planPath)) {
      safeError(`Coverage plan file not found: ${planPath}`);
      process.exit(2);
    }

    let plan;
    try {
      plan = readCoveragePlan(planPath);
    } catch (err) {
      safeError(`Failed to parse coverage plan: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const coveragePlanDigest = contentHash(plan);
    const seenFdcIds = new Set<number>();
    const seenNames = new Set<string>();
    const entries: AllowlistEntry[] = [];

    safeLog(`Proposing allowlist from coverage plan (${plan.categories.length} categories)...`);

    for (const cat of plan.categories) {
      safeLog(`Processing category ${cat.categoryId} (target: ${cat.targetCount})...`);
      let categoryCount = 0;

      for (const term of cat.searchTerms) {
        if (categoryCount >= cat.targetCount) break;

        await sleep(250); // rate limiting
        const searchUrl =
          `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(term)}` +
          `&dataType=Foundation,SR%20Legacy&pageSize=5&api_key=${API_KEY}`;

        try {
          const searchRes = (await fetchWithRetry(searchUrl)) as {
            foods?: Array<{
              fdcId: number;
              description: string;
              dataType: "Foundation" | "SR Legacy";
              // `/foods/search` carries the category as a bare string; read via
              // readFdcFoodCategory so both endpoints are read one way.
              foodCategory?: unknown;
            }>;
          };

          if (Array.isArray(searchRes.foods)) {
            for (const food of searchRes.foods) {
              if (categoryCount >= cat.targetCount) break;
              if (seenFdcIds.has(food.fdcId)) continue;

              const canonicalName = food.description.trim();
              const lowerName = canonicalName.toLowerCase();
              if (seenNames.has(lowerName)) continue;

              seenFdcIds.add(food.fdcId);
              seenNames.add(lowerName);

              // T-2016: `patternTags` and `categoryId` are derived from the
              // record's own USDA food category, so the derivation needs that
              // category. The search response usually carries it; when it does
              // not, fetch the record rather than fall back silently, because a
              // missing category means omnivore-only for that entry and an
              // empty catalog for a vegan client is the defect this replaces.
              let sourceFoodCategory = readFdcFoodCategory(food);
              if (sourceFoodCategory === null) {
                await sleep(250);
                try {
                  const detail = await fetchWithRetry(
                    `https://api.nal.usda.gov/fdc/v1/food/${food.fdcId}?api_key=${API_KEY}`
                  );
                  sourceFoodCategory = readFdcFoodCategory(detail);
                } catch (err) {
                  safeError(
                    `Could not read a food category for ${food.fdcId} ${canonicalName}: ` +
                      `${err instanceof Error ? err.message : String(err)}. ` +
                      `Its pattern tags fall back to omnivore-only.`
                  );
                }
              }

              const curation = proposeCuration({
                description: canonicalName,
                foodCategory: sourceFoodCategory,
                planCategoryId: cat.categoryId,
              });

              entries.push({
                fdcId: food.fdcId,
                dataType: food.dataType,
                canonicalName,
                synonyms: [canonicalName.toLowerCase()],
                sourceFoodCategory,
                categoryId: curation.categoryId,
                categoryIdBasis: curation.categoryIdBasis,
                foodState: canonicalName.toLowerCase().includes("raw") ? "RAW" : "COOKED",
                patternTags: curation.patternTags,
                patternTagsBasis: curation.patternTagsBasis,
                patternTagsNarrowedBy: curation.patternTagsNarrowedBy,
                triageFlags: curation.triageFlags,
                ownAllergenCategories: [],
                reviewState: "PROPOSED",
                reviewerNote: null,
              });

              categoryCount++;
            }
          }
        } catch (err) {
          safeError(`Error searching for term '${term}': ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // What the derivation actually produced, printed so an operator sees it
    // without diffing the file. `patternTags` reaching a client is T-2036's
    // concern; that every entry is omnivore-only is this ticket's defect, so it
    // is reported at the end of every run.
    const countBy = <K extends string>(values: readonly K[]): Map<K, number> => {
      const counts = new Map<K, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      return counts;
    };
    const patternBases = countBy(entries.map((e) => e.patternTagsBasis));
    const categoryBases = countBy(entries.map((e) => e.categoryIdBasis));
    const withoutSourceCategory = entries.filter((e) => e.sourceFoodCategory === null).length;

    safeLog("Curation derived from each record's own USDA food category:");
    for (const [basis, count] of [...patternBases].sort()) {
      safeLog(`  patternTagsBasis ${basis}: ${count}`);
    }
    for (const [basis, count] of [...categoryBases].sort()) {
      safeLog(`  categoryIdBasis ${basis}: ${count}`);
    }
    for (const pattern of ["VEGAN", "LACTO_OVO_VEGETARIAN", "PESCATARIAN", "OMNIVORE"] as const) {
      const count = entries.filter((e) => e.patternTags.includes(pattern)).length;
      safeLog(`  entries tagged ${pattern}: ${count}`);
    }
    safeLog(`  entries with no food category on the record: ${withoutSourceCategory}`);
    const narrowed = entries.filter((e) => e.patternTagsNarrowedBy.length > 0);
    safeLog(`  entries narrowed by their own description: ${narrowed.length}`);
    for (const entry of narrowed) {
      safeLog(
        `    ${entry.fdcId} ${entry.canonicalName} -> [${entry.patternTags.join(",")}] ` +
          `(narrowed by ${entry.patternTagsNarrowedBy.join(", ")})`
      );
    }
    for (const flag of TRIAGE_FLAGS) {
      const count = entries.filter((e) => e.triageFlags.includes(flag)).length;
      if (count > 0) safeLog(`  triageFlag ${flag}: ${count}`);
    }

    // If no entry carried a food category, nothing was derived from the source
    // at all and every entry is omnivore-only — the exact state T-2016 exists to
    // remove, and silent because the file still parses. Refuse instead.
    if (entries.length > 0 && withoutSourceCategory === entries.length) {
      safeError(
        `None of the ${entries.length} proposed entries carried a USDA food category, so no ` +
          `patternTags or categoryId could be derived from the source and every entry would be ` +
          `omnivore-only. That is the defect T-2016 removed, so nothing was written. Check the ` +
          `search response shape before re-running.`
      );
      process.exit(1);
    }

    const proposedAllowlist = {
      allowlistVersion: 1 as const,
      market: "US" as const,
      curationState: "ENGINEER_DRAFT" as const,
      generatedAt: new Date().toISOString(),
      coveragePlanDigest,
      entries,
    };

    try {
      allowlistSchemaForPlan(plan).parse(proposedAllowlist);
    } catch (err) {
      safeError(`Generated allowlist failed validation: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    fs.writeFileSync(outPath, JSON.stringify(proposedAllowlist, null, 2), "utf8");
    safeLog(`Wrote ${entries.length} proposed allowlist entries to ${outPath}`);
    process.exit(0);
  }

  // MODE 2: INGEST ALLOWLIST TO DRAFT FOOD CATALOG
  if (allowlistPath) {
    if (!fs.existsSync(allowlistPath)) {
      safeError(`Allowlist file not found: ${allowlistPath}`);
      process.exit(2);
    }

    // The allowlist names a coverage plan by digest. Re-check it here: an
    // allowlist generated against an older plan must not ingest silently
    // (review r1, MINOR 2). The check fails closed — a missing or unreadable
    // plan stops the run rather than skipping the comparison.
    const ingestPlanPath = planPath ?? DEFAULT_COVERAGE_PLAN_PATH;
    if (!fs.existsSync(ingestPlanPath)) {
      safeError(
        `Coverage plan file not found: ${ingestPlanPath}. --ingest re-verifies the allowlist's ` +
          `coveragePlanDigest against it; pass --plan <path> if it lives elsewhere.`
      );
      process.exit(1);
    }

    let ingestPlan: CoveragePlan;
    try {
      ingestPlan = readCoveragePlan(ingestPlanPath);
    } catch (err) {
      safeError(`Failed to parse coverage plan: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const rawAllowlist = fs.readFileSync(allowlistPath, "utf8");
    let allowlist;
    try {
      allowlist = allowlistSchemaForPlan(ingestPlan).parse(JSON.parse(rawAllowlist));
    } catch (err) {
      safeError(`Failed to parse allowlist: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const expectedPlanDigest = contentHash(ingestPlan);
    if (allowlist.coveragePlanDigest !== expectedPlanDigest) {
      safeError(
        `Allowlist coveragePlanDigest ${allowlist.coveragePlanDigest} does not match ` +
          `${ingestPlanPath} (${expectedPlanDigest}). Re-run --propose against the current plan.`
      );
      process.exit(1);
    }

    // The tool's own exclusion channel. Records a SOURCE LIMITATION, never a
    // review decision: `reviewState` stays the reviewer's field and nothing
    // here writes it. Parse failure aborts — an unreadable exclusions file must
    // not silently become "no exclusions", which would refuse the whole run
    // with no explanation.
    let exclusionsFile: SourceExclusionsFile | null = null;
    if (fs.existsSync(exclusionsPath)) {
      try {
        exclusionsFile = sourceExclusionsFileSchema.parse(
          JSON.parse(fs.readFileSync(exclusionsPath, "utf8"))
        );
      } catch (err) {
        safeError(
          `Failed to parse source exclusions file ${exclusionsPath}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        process.exit(1);
      }
      safeLog(
        `Loaded ${exclusionsFile.exclusions.length} source exclusions from ${exclusionsPath}`
      );
    }
    const excludedFdcIds = indexSourceExclusions(exclusionsFile);

    const retrievedAt = new Date().toISOString();
    const outcomes: EntryIngestOutcome[] = [];
    const catalogItems: SourcedFoodCatalogItem[] = [];
    const proposalProvenance: Array<{
      parameterId: string;
      sourceClaimId: string;
      sourceId: string;
      sourceUrl: string;
      sourceLocator: string;
    }> = [];

    let okCount = 0;
    let struckCount = 0;
    /**
     * Transport failures only. A 404 or a timeout is not a statement about what
     * the source contains, so it never becomes a source exclusion; it aborts
     * the run on its own.
     */
    let fetchErrorCount = 0;
    /** Entries listed in the exclusions file the run could not re-check. */
    let uncheckedExcludedCount = 0;

    for (const entry of allowlist.entries) {
      if (!isIngestableEntry(entry)) {
        safeLog(`${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> STRUCK`);
        struckCount++;
        continue;
      }

      await sleep(250); // Rate limit: fixed 250ms delay
      const recordUrl = `https://api.nal.usda.gov/fdc/v1/food/${entry.fdcId}?api_key=${API_KEY}`;

      const isExcluded = excludedFdcIds.has(entry.fdcId);

      let rawRecord: unknown;
      try {
        rawRecord = await fetchWithRetry(recordUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isExcluded) {
          // Already excluded, so it cannot enter the catalog either way. Log
          // that the staleness re-check did not happen rather than claim it did.
          safeLog(
            `${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> SKIPPED (source-excluded; not re-checked: ${message})`
          );
          uncheckedExcludedCount++;
          continue;
        }
        safeLog(`${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> ERROR:${message}`);
        fetchErrorCount++;
        continue;
      }

      // An excluded entry is still fetched and still mapped. That is the only
      // way to find out that the file's claim has gone stale, and a stale claim
      // silently drops a food the source can now supply.
      const mapResult = mapFdcRecordToCatalogItem({
        entry,
        record: rawRecord,
        retrievedAt,
        allowlistVersion: allowlist.allowlistVersion,
      });

      if (!mapResult.ok) {
        const reasons = mapResult.errors.map((e) => e.message).join("; ");
        outcomes.push({
          fdcId: entry.fdcId,
          canonicalName: entry.canonicalName,
          status: "UNMAPPABLE",
          reason: reasons,
          errorCodes: mapResult.errors.map((e) => e.code),
        });
        safeLog(
          `${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> ${
            isExcluded ? "SKIPPED (source-excluded)" : "UNMAPPABLE"
          }:${reasons}`
        );
        continue;
      }

      outcomes.push({
        fdcId: entry.fdcId,
        canonicalName: entry.canonicalName,
        status: "MAPPED",
      });

      if (isExcluded) {
        // Do not add it to the catalog on this run: the decision below refuses
        // the whole run so the operator can remove the stale entry deliberately.
        safeLog(
          `${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> STALE EXCLUSION (maps successfully)`
        );
        continue;
      }

      // Warnings are not refusals, but an invisible warning is not a warning.
      // ENTRY_SOURCE_CATEGORY_MISMATCH means the entry's derived patternTags and
      // categoryId came from a different category than the record carries.
      for (const warning of mapResult.warnings) {
        safeLog(
          `${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> WARN:${warning.code}: ${warning.message}`
        );
      }

      safeLog(`${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> OK`);
      okCount++;
      catalogItems.push(mapResult.item);

      const pubDate =
        mapResult.item.sourceRecord?.publicationDate ?? "unknown";
      proposalProvenance.push({
        parameterId: mapResult.item.id,
        sourceClaimId: "GAP-N12",
        sourceId: "USDA-FDC",
        sourceUrl: mapResult.item.sourceRecord!.recordUrl,
        sourceLocator: `fdcId ${entry.fdcId}; dataType ${entry.dataType}; publication ${pubDate}`,
      });
    }

    const decision = decideExclusionRun({
      outcomes,
      existing: excludedFdcIds,
      runDate: retrievedAt,
    });
    const unmappableCount = outcomes.filter((o) => o.status === "UNMAPPABLE").length;

    safeLog(
      `Summary: Total ${allowlist.entries.length} | OK: ${okCount} | Struck: ${struckCount} | ` +
        `Unmappable: ${unmappableCount} | Fetch errors: ${fetchErrorCount}`
    );

    // A transport failure is not a statement about the source, so it is never
    // written to the exclusions file and it stops the run on its own.
    if (fetchErrorCount > 0) {
      safeError(
        `${fetchErrorCount} record(s) could not be fetched. That is a transport failure, not a source ` +
          `limitation, so nothing was written to ${exclusionsPath}. Re-run.`
      );
      process.exit(1);
    }

    if (decision.kind === "STALE_EXCLUSIONS") {
      safeError(
        `${decision.staleFdcIds.length} entr(ies) in ${exclusionsPath} now map successfully, so that file ` +
          `claims a source limitation that no longer holds and a usable food would be dropped. Remove ` +
          `them and re-run:`
      );
      decision.staleFdcIds.forEach((fdcId, index) => {
        safeError(`  ${fdcId} ${decision.staleNames[index]}`);
      });
      process.exit(1);
    }

    if (decision.kind === "WRITE_EXCLUSIONS") {
      safeError(
        `${decision.newlyExcluded.length} entr(ies) could not be mapped and are not recorded in ` +
          `${exclusionsPath}:`
      );
      for (const exclusion of decision.newlyExcluded) {
        safeError(`  ${exclusion.fdcId} ${exclusion.canonicalName}: ${exclusion.reason}`);
      }

      if (dryRun) {
        safeLog(
          `Dry run: would write ${decision.allExclusions.length} source exclusions to ${exclusionsPath}.`
        );
      } else {
        const exclusionsOut = buildSourceExclusionsFile({
          generatedAt: retrievedAt,
          exclusions: decision.allExclusions,
        });
        fs.writeFileSync(exclusionsPath, `${JSON.stringify(exclusionsOut, null, 2)}\n`, "utf8");
        safeLog(
          `Wrote ${decision.allExclusions.length} source exclusions to ${exclusionsPath}. These record a ` +
            `SOURCE LIMITATION, not a review decision: reviewState is untouched. Re-run to ingest the rest.`
        );
      }
      process.exit(1);
    }

    if (decision.skippedFdcIds.length > 0 || uncheckedExcludedCount > 0) {
      safeLog(
        `Skipped ${decision.skippedFdcIds.length + uncheckedExcludedCount} entr(ies) recorded in ` +
          `${exclusionsPath} as source limitations` +
          (uncheckedExcludedCount > 0
            ? ` (${uncheckedExcludedCount} of them could not be re-checked this run)`
            : "") +
          `. They remain PROPOSED for the reviewer; nothing here is a strike.`
      );
    }

    const foodCatalogContent = {
      artifactKey: "food-catalog",
      version: 1,
      catalogProfile: "SOURCED_V2" as const,
      market: "US" as const,
      items: catalogItems,
    };

    try {
      foodCatalogContentSchema.parse(foodCatalogContent);
    } catch (err) {
      safeError(
        `Food catalog content failed SOURCED_V2 validation: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      process.exit(1);
    }

    const draftFile = {
      fileSchemaVersion: 1 as const,
      reviewMetadata: {
        decision: "DRAFT_UNSIGNED" as const,
        preparedBy: "ENGINEERING_DRAFT_FROM_REVIEWED_SOURCE" as const,
        preparedAt: retrievedAt,
        draftRecordId: "fdc-food-catalog-draft-v1",
        worksheetSectionIds: ["D07", "D08", "D12"],
        proposalProvenance,
        unsignedNotice:
          "PROPOSED VALUES AWAITING QUALIFIED PROFESSIONAL REVIEW. NOT APPROVED. NOT FOR LIVE USE.",
      },
      content: foodCatalogContent,
    };

    try {
      draftFoodCatalogFileSchema.parse(draftFile);
    } catch (err) {
      safeError(
        `Draft food catalog file failed validation: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      process.exit(1);
    }

    if (!dryRun) {
      // S-31 review round 1, finding 5: this used to be a bare writeFileSync, and
      // the README documented pointing --out at the *signed* v1 file, so a
      // re-ingest run would silently downgrade a signed artifact's
      // `reviewMetadata.decision` from APPROVED to DRAFT_UNSIGNED in place. Refuse
      // unless the caller explicitly accepts that with --force.
      if (fs.existsSync(outPath) && !force) {
        let alreadySigned = false;
        try {
          alreadySigned = isSignedFoodCatalogFile(JSON.parse(fs.readFileSync(outPath, "utf8")));
        } catch {
          alreadySigned = false;
        }
        if (alreadySigned) {
          safeError(
            `Refusing to write ${outPath}: its reviewMetadata.decision is APPROVED (signed). ` +
              "Re-ingesting would overwrite a signed artifact in place and silently downgrade it to " +
              "DRAFT_UNSIGNED. Point --out at a new version file instead, or pass --force to override."
          );
          process.exit(1);
        }
      }
      fs.writeFileSync(outPath, JSON.stringify(draftFile, null, 2), "utf8");
      safeLog(`Wrote draft food catalog to ${outPath}`);
    } else {
      safeLog(`Dry run complete. Validated ${catalogItems.length} items without writing.`);
    }

    process.exit(0);
  }
}

main().catch((err) => {
  safeError(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
