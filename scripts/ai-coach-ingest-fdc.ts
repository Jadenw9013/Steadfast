import fs from "node:fs";
import path from "node:path";
import { contentHash } from "../lib/ai-coach/canonical-json";
import {
  allowlistSchema,
  coveragePlanSchema,
  type AllowlistEntry,
} from "../lib/ai-coach/catalog/fdc/allowlist-schema";
import {
  mapFdcRecordToCatalogItem,
  redactUrl,
} from "../lib/ai-coach/catalog/fdc/mapping";
import {
  foodCatalogContentSchema,
  type SourcedFoodCatalogItem,
} from "../lib/ai-coach/artifacts/schema";
import { draftFoodCatalogFileSchema } from "../lib/ai-coach/artifacts/drafts/loader";

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

async function fetchWithRetry(url: string, retries = 3): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    } catch (err) {
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.length === 0) {
    safeLog(
      "Usage:\n" +
        "  ai-coach-ingest-fdc --plan <path> --out <path>\n" +
        "  ai-coach-ingest-fdc --allowlist <path> --out <path> [--dry-run]\n"
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
  const dryRun = args.includes("--dry-run");

  if (!outPath || (!planPath && !allowlistPath)) {
    safeError("Invalid arguments. Must supply --out and either --plan or --allowlist.");
    process.exit(2);
  }

  // MODE 1: PROPOSE ALLOWLIST
  if (planPath) {
    if (!fs.existsSync(planPath)) {
      safeError(`Coverage plan file not found: ${planPath}`);
      process.exit(2);
    }

    const rawPlan = fs.readFileSync(planPath, "utf8");
    let plan;
    try {
      plan = coveragePlanSchema.parse(JSON.parse(rawPlan));
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

              entries.push({
                fdcId: food.fdcId,
                dataType: food.dataType,
                canonicalName,
                synonyms: [canonicalName.toLowerCase()],
                categoryId: cat.categoryId,
                foodState: canonicalName.toLowerCase().includes("raw") ? "RAW" : "COOKED",
                singleIngredientWholeFood: true,
                patternTags: ["OMNIVORE"],
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

    const proposedAllowlist = {
      allowlistVersion: 1 as const,
      market: "US" as const,
      curationState: "ENGINEER_DRAFT" as const,
      generatedAt: new Date().toISOString(),
      coveragePlanDigest,
      entries,
    };

    try {
      allowlistSchema.parse(proposedAllowlist);
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

    const rawAllowlist = fs.readFileSync(allowlistPath, "utf8");
    let allowlist;
    try {
      allowlist = allowlistSchema.parse(JSON.parse(rawAllowlist));
    } catch (err) {
      safeError(`Failed to parse allowlist: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    const retrievedAt = new Date().toISOString();
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
    let errorCount = 0;

    for (const entry of allowlist.entries) {
      if (entry.reviewState === "STRUCK") {
        safeLog(`${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> STRUCK`);
        struckCount++;
        continue;
      }

      await sleep(250); // Rate limit: fixed 250ms delay
      const recordUrl = `https://api.nal.usda.gov/fdc/v1/food/${entry.fdcId}?api_key=${API_KEY}`;

      let rawRecord: unknown;
      try {
        rawRecord = await fetchWithRetry(recordUrl);
      } catch (err) {
        safeLog(
          `${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> ERROR:${
            err instanceof Error ? err.message : String(err)
          }`
        );
        errorCount++;
        continue;
      }

      const mapResult = mapFdcRecordToCatalogItem({
        entry,
        record: rawRecord,
        retrievedAt,
        allowlistVersion: allowlist.allowlistVersion,
      });

      if (!mapResult.ok) {
        const reasons = mapResult.errors.map((e) => e.message).join("; ");
        safeLog(`${entry.fdcId} ${entry.dataType} ${entry.canonicalName} -> ERROR:${reasons}`);
        errorCount++;
        continue;
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

    safeLog(
      `Summary: Total ${allowlist.entries.length} | OK: ${okCount} | Struck: ${struckCount} | Errors: ${errorCount}`
    );

    if (errorCount > 0) {
      process.exit(1);
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
