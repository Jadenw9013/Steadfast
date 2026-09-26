import {
  SOURCED_V2_CARBOHYDRATE_NUTRIENT_IDS,
  SOURCED_V2_ENERGY_NUTRIENT_IDS,
  SOURCED_V2_FAT_NUTRIENT_IDS,
  SOURCED_V2_PROTEIN_NUTRIENT_IDS,
  type AllergenCategory,
  type SourcedFoodCatalogItem,
} from "@/lib/ai-coach/artifacts/schema";
import { LEGACY_TOKEN_BY_CATEGORY } from "@/lib/ai-coach/intake-allergens";
import type { AllowlistEntry } from "./allowlist-schema";
import { normalizeFdcRecord, type NormalizedFdcRecord } from "./normalize";
import { proposeAllergenFacts } from "./allergen-rules";

export type FdcDataType = "Foundation" | "SR Legacy";

export type MapFoodRecordInput = {
  entry: AllowlistEntry;
  record: unknown;
  retrievedAt: string;
  allowlistVersion: number;
};

export type MappingWarning = {
  code: string;
  message: string;
};

export type MappingError = {
  code: string;
  message: string;
};

export type MapFoodRecordResult =
  | { ok: true; item: SourcedFoodCatalogItem; warnings: MappingWarning[] }
  | { ok: false; errors: MappingError[] };

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const keysToDelete: string[] = [];
    url.searchParams.forEach((_, key) => {
      const lower = key.toLowerCase();
      if (lower === "api_key" || lower === "apikey") {
        keysToDelete.push(key);
      }
    });
    for (const k of keysToDelete) {
      url.searchParams.delete(k);
    }
    return url.toString();
  } catch {
    return rawUrl
      .replace(/([?&])api_key=[^&]*/gi, "")
      .replace(/([?&])apikey=[^&]*/gi, "")
      .replace(/\?&/, "?")
      .replace(/[?&]$/, "");
  }
}

/**
 * Analytical means *measured*. `AS` ("calculated using Atwater specific
 * factors") and `AG` ("calculated using Atwater general factors") are
 * calculations, not measurements, so they belong below and not here — review
 * r1 finding B4: every shipped item read `derivation: "ANALYTICAL"` next to a
 * `derivationDetail` that said "Calculated". The Atwater information is not
 * lost: it is carried by `energyFact.method`, which is its right home.
 */
const KNOWN_ANALYTICAL_CODES = new Set([
  "A",
  "AD",
  "FLA",
  "FS",
  "ANALYTICAL",
]);

const KNOWN_CALCULATED_CODES = new Set([
  "AS",
  "AG",
  "NC",
  "C",
  "CALC",
  "CALCULATED",
  "BF",
  "NR",
  "NP",
  "LC",
]);

export function mapNutrientDerivation(
  fdcDataType: string,
  derivationCode: string | null,
  derivationDescription: string | null
): {
  derivation: "ANALYTICAL" | "CALCULATED" | "MANUFACTURER_LABEL" | "UNKNOWN";
  derivationDetail: string | null;
} {
  if (derivationCode) {
    const upperCode = derivationCode.toUpperCase().trim();
    if (KNOWN_ANALYTICAL_CODES.has(upperCode)) {
      return {
        derivation: "ANALYTICAL",
        derivationDetail: derivationDescription ?? derivationCode,
      };
    }
    if (KNOWN_CALCULATED_CODES.has(upperCode)) {
      return {
        derivation: "CALCULATED",
        derivationDetail: derivationDescription ?? derivationCode,
      };
    }
    return {
      derivation: "UNKNOWN",
      derivationDetail: derivationCode,
    };
  }

  if (fdcDataType === "Foundation") {
    return {
      derivation: "ANALYTICAL",
      derivationDetail: "Inferred from Foundation dataset default",
    };
  }
  if (fdcDataType === "SR Legacy") {
    return {
      derivation: "CALCULATED",
      derivationDetail: "Inferred from SR Legacy dataset default",
    };
  }

  return {
    derivation: "UNKNOWN",
    derivationDetail: null,
  };
}

function normalizeUnit(rawUnit: string): "G" | "MG" | "UG" | "KCAL" | "KJ" | "IU" | null {
  const u = rawUnit.toUpperCase().trim();
  if (u === "G") return "G";
  if (u === "MG") return "MG";
  if (u === "UG" || u === "MCG" || u === "µG" || u === "MICROGRAMS") return "UG";
  if (u === "KCAL") return "KCAL";
  if (u === "KJ") return "KJ";
  if (u === "IU") return "IU";
  return null;
}

/**
 * The nutrients every catalog item accounts for, reported or explicitly
 * `UNKNOWN`.
 *
 * **`nutrientNumber` and `fdcNutrientId` are different identifiers and the
 * distinction is load-bearing.** A FoodData Central nutrient row carries both:
 * `nutrient.number` is the INFOODS tagname (`"208"`, `"203"`) and `nutrient.id`
 * is FDC's own key (`1008`, `1003`). `normalizeFdcRecord` reads
 * `number ?? id`, so a real response yields the *number*. Confusing the two is
 * how the 2026-09-26 run refused 48 records that carried every macro it needed
 * (commit 6646483); the pairs below are the table that keeps them straight, and
 * four of them are re-verified live in that commit's message.
 */
export const CORE_TRACKED_NUTRIENTS: ReadonlyArray<{
  /** `nutrient.number` — the INFOODS tagname a real response carries. */
  nutrientNumber: string;
  /** `nutrient.id` — FDC's own key, seen only when a row omits `number`. */
  fdcNutrientId: string;
  /**
   * Further *numbers* that report the same quantity. A record carrying one of
   * these is not missing the nutrient, so no `UNKNOWN` placeholder is added and
   * the number does not land in `missingNutrientIds`. `"958"`/`"957"` are the
   * Atwater specific/general energies and `"298"` is Total fat (NLEA).
   */
  otherNumbers?: readonly string[];
  nutrientName: string;
  unit: "G" | "MG" | "UG" | "KCAL";
}> = [
  {
    nutrientNumber: "208",
    fdcNutrientId: "1008",
    otherNumbers: ["958", "957"],
    nutrientName: "Energy",
    unit: "KCAL",
  },
  { nutrientNumber: "203", fdcNutrientId: "1003", nutrientName: "Protein", unit: "G" },
  {
    nutrientNumber: "204",
    fdcNutrientId: "1004",
    otherNumbers: ["298"],
    nutrientName: "Total lipid (fat)",
    unit: "G",
  },
  { nutrientNumber: "205", fdcNutrientId: "1005", nutrientName: "Carbohydrate, by difference", unit: "G" },
  { nutrientNumber: "291", fdcNutrientId: "1079", nutrientName: "Fiber, total dietary", unit: "G" },
  { nutrientNumber: "269", fdcNutrientId: "2000", nutrientName: "Sugars, total including NLEA", unit: "G" },
  { nutrientNumber: "301", fdcNutrientId: "1087", nutrientName: "Calcium, Ca", unit: "MG" },
  { nutrientNumber: "303", fdcNutrientId: "1089", nutrientName: "Iron, Fe", unit: "MG" },
  { nutrientNumber: "306", fdcNutrientId: "1092", nutrientName: "Potassium, K", unit: "MG" },
  { nutrientNumber: "307", fdcNutrientId: "1093", nutrientName: "Sodium, Na", unit: "MG" },
  { nutrientNumber: "324", fdcNutrientId: "1110", nutrientName: "Vitamin D (D2 + D3)", unit: "UG" },
];

/**
 * `allergenFacts.contains` is written in the **legacy** exclusion-token
 * vocabulary (`lib/ai-coach/catalog/schema.ts` `allergenSchema` plus `SESAME`),
 * not in the nine-value catalog category vocabulary, because that is what every
 * existing consumer of an allergen token speaks: `deriveLegacyAllergyTokens`
 * projects a client's declarations into it and `matchAllergen`
 * (`composition-feasibility.ts`) matches against it. Writing `"SOYBEAN"` here
 * while a declaration derives `"SOY"` would make the first comparison in T-2036
 * miss — i.e. fail *open* on an allergen (review r1, finding F1).
 *
 * `LEGACY_TOKEN_BY_CATEGORY` is imported, never re-declared: one translation
 * table, one truth. `SESAME` has no value in the legacy `allergenSchema` enum
 * and is emitted anyway, because omitting it would make a sesame-containing
 * food look sesame-free; a `SESAME` declaration derives the same `"SESAME"`
 * token, so the comparison matches and fails closed.
 *
 * The result is sorted and de-duplicated so the artifact digest is stable.
 *
 * **This mapper no longer calls it.** Review r2 MB-4: projecting a tri-state
 * into a two-state `contains` list asserts absence for every category the
 * source said nothing about, so SOURCED_V2 items carry no `allergenFacts` at
 * all. The translation itself is still the one true table and is exported for
 * the consumer (T-2036) that has to compare a client's declared token against
 * an `allergenFactsV2` category — that comparison needs exactly this mapping,
 * and needs it to be the same one `deriveLegacyAllergyTokens` uses.
 */
export function toLegacyAllergenTokens(categories: readonly AllergenCategory[]): string[] {
  const tokens = categories
    .map((category) => LEGACY_TOKEN_BY_CATEGORY[category])
    .filter((token): token is string => Boolean(token && token.length > 0));
  return Array.from(new Set(tokens)).sort();
}

/**
 * The single definition of "this allowlist entry reaches the catalog". A
 * `STRUCK` entry is one the reviewer removed: it is never fetched and never
 * emitted. `scripts/ai-coach-ingest-fdc.ts` calls this rather than repeating
 * the predicate, so the test of this function is a test of the tool's
 * behaviour rather than of a filter re-written inside the test.
 */
export function isIngestableEntry(entry: Pick<AllowlistEntry, "reviewState">): boolean {
  return entry.reviewState !== "STRUCK";
}

/** Convenience wrapper over {@link isIngestableEntry} for a whole allowlist. */
export function selectIngestableEntries<T extends Pick<AllowlistEntry, "reviewState">>(
  entries: readonly T[]
): T[] {
  return entries.filter((entry) => isIngestableEntry(entry));
}

export function mapFdcRecordToCatalogItem(input: MapFoodRecordInput): MapFoodRecordResult {
  const warnings: MappingWarning[] = [];
  const errors: MappingError[] = [];

  let norm: NormalizedFdcRecord;
  try {
    norm = normalizeFdcRecord(input.record);
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_FDC_RECORD",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  // 1. Data type fencing
  if (norm.dataType !== "Foundation" && norm.dataType !== "SR Legacy") {
    return {
      ok: false,
      errors: [
        {
          code: "DISALLOWED_DATA_TYPE",
          message: `Data type '${norm.dataType}' is not allowed. Only 'Foundation' and 'SR Legacy' are supported.`,
        },
      ],
    };
  }

  // 2. Identify key macronutrients and energy.
  //
  // The numbers come from the schema's exported id sets, so the mapper and the
  // SOURCED_V2 refinement cannot disagree about what backs a macro.
  //
  // Review r2 MB-1: this lookup used to read only `1008`/`208` for energy and
  // `1004`/`204` for fat. Modern Foundation records report energy under the
  // Atwater ids `2047`/`2048` and fat under `1085` "Total fat (NLEA)", so the
  // tool refused 48 records — plain chicken breast, Pacific cod, olive oil,
  // bell peppers, walnuts, peanut butter — that carry every macronutrient it
  // needs. Verified live on `2258588 "Peppers, bell, green, raw"`: no `1008`
  // row, and `2047` 22.9291, `2048` 19.692148, `1003` 0.715, `1004` 0.1063,
  // `1005` 4.7781 (board/evidence/T-2035-real-run.md). The ids are searched in
  // priority order, so the choice is deterministic for a record carrying more
  // than one. Nothing is derived or computed: a record that truly lacks a macro
  // is still refused below.
  const findNutrient = (numbers: readonly string[], expectedUnit: string) => {
    for (const number of numbers) {
      const match = norm.nutrients.find(
        (n) =>
          n.nutrientNumber === number &&
          normalizeUnit(n.unitName) === expectedUnit &&
          n.amount !== null
      );
      if (match) return match;
    }
    // Fall back to a row with the right id but a null amount, so the error
    // below distinguishes "not reported" from "absent" identically to before.
    return norm.nutrients.find(
      (n) => numbers.includes(n.nutrientNumber) && normalizeUnit(n.unitName) === expectedUnit
    );
  };

  const energyNutrient = findNutrient(SOURCED_V2_ENERGY_NUTRIENT_IDS, "KCAL");
  const proteinNutrient = findNutrient(SOURCED_V2_PROTEIN_NUTRIENT_IDS, "G");
  const fatNutrient = findNutrient(SOURCED_V2_FAT_NUTRIENT_IDS, "G");
  const carbNutrient = findNutrient(SOURCED_V2_CARBOHYDRATE_NUTRIENT_IDS, "G");

  if (!energyNutrient || energyNutrient.amount === null) {
    errors.push({
      code: "MISSING_ENERGY",
      message: "Energy (kcal) nutrient is missing or has null amount",
    });
  }

  if (!proteinNutrient || proteinNutrient.amount === null) {
    errors.push({
      code: "MISSING_PROTEIN",
      message: "Protein nutrient is missing or has null amount",
    });
  }

  if (!fatNutrient || fatNutrient.amount === null) {
    errors.push({
      code: "MISSING_FAT",
      message: "Fat nutrient is missing or has null amount",
    });
  }

  if (!carbNutrient || carbNutrient.amount === null) {
    errors.push({
      code: "MISSING_CARBOHYDRATE",
      message: "Carbohydrate nutrient is missing or has null amount",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const energyKcal = energyNutrient!.amount!;
  const proteinGrams = proteinNutrient!.amount!;
  const fatGrams = fatNutrient!.amount!;
  const carbohydrateGrams = carbNutrient!.amount!;

  // 3. Energy method mapping.
  //
  // The nutrient id itself is the strongest statement the record makes about
  // how the kcal figure was arrived at: `2048` *is* "Energy (Atwater Specific
  // Factors)" and `2047` *is* "Energy (Atwater General Factors)". When the
  // figure was taken from one of those rows the method is read off the id, so
  // the artifact records which of a record's several energy values was used.
  // Otherwise the derivation code/description decides, as before.
  let energyMethod: "ATWATER_GENERAL" | "ATWATER_SPECIFIC" | "SOURCE_REPORTED_UNSPECIFIED" | "UNKNOWN" =
    "SOURCE_REPORTED_UNSPECIFIED";
  const energyDerivationCode = energyNutrient!.derivationCode?.toUpperCase().trim() ?? "";
  const energyDerivationDesc = energyNutrient!.derivationDescription?.toLowerCase().trim() ?? "";

  // Nutrient NUMBERS, not ids: "Energy (Atwater Specific Factors)" is id 2048 /
  // number "958", and "Energy (Atwater General Factors)" is id 2047 / number
  // "957". Matching on the ids here matches nothing, because the normalized row
  // carries the number. Verified live against /food/2258588.
  if (energyNutrient!.nutrientNumber === "958") {
    energyMethod = "ATWATER_SPECIFIC";
  } else if (energyNutrient!.nutrientNumber === "957") {
    energyMethod = "ATWATER_GENERAL";
  } else if (
    energyDerivationCode === "AS" ||
    energyDerivationCode === "ATWATER_SPECIFIC" ||
    energyDerivationDesc.includes("atwater specific") ||
    energyDerivationDesc.includes("specific atwater")
  ) {
    energyMethod = "ATWATER_SPECIFIC";
  } else if (
    energyDerivationCode === "AG" ||
    energyDerivationCode === "ATWATER_GENERAL" ||
    energyDerivationDesc.includes("atwater general") ||
    energyDerivationDesc.includes("general atwater")
  ) {
    energyMethod = "ATWATER_GENERAL";
  }

  const macroEnergyDiscrepancyKcal = Number(
    (energyKcal - (4 * proteinGrams + 4 * carbohydrateGrams + 9 * fatGrams)).toFixed(4)
  );

  // 4. Map nutrient facts
  type SourcedNutrientFact = NonNullable<SourcedFoodCatalogItem["nutrientFacts"]>[number];
  const nutrientFacts: SourcedNutrientFact[] = [];
  const processedNutrientNumbers = new Set<string>();

  for (const n of norm.nutrients) {
    const unit = normalizeUnit(n.unitName);
    if (!unit) {
      warnings.push({
        code: "UNRECOGNIZED_NUTRIENT_UNIT",
        message: `Nutrient ${n.nutrientNumber} (${n.nutrientName}) has unmappable unit '${n.unitName}'; skipping`,
      });
      continue;
    }

    const { derivation, derivationDetail } = mapNutrientDerivation(
      norm.dataType,
      n.derivationCode,
      n.derivationDescription
    );

    nutrientFacts.push({
      nutrientId: n.nutrientNumber,
      nutrientName: n.nutrientName,
      unit,
      value: n.amount,
      status: n.amount !== null ? "REPORTED" : "UNKNOWN",
      derivation,
      derivationDetail,
    });
    processedNutrientNumbers.add(n.nutrientNumber);
  }

  // Ensure core tracked nutrients are present in nutrientFacts (as UNKNOWN if not reported)
  for (const core of CORE_TRACKED_NUTRIENTS) {
    const hasNumber = processedNutrientNumbers.has(core.nutrientNumber);
    const hasFdcId = processedNutrientNumbers.has(core.fdcNutrientId);
    const hasOther = (core.otherNumbers ?? []).some((num) => processedNutrientNumbers.has(num));
    if (!hasNumber && !hasFdcId && !hasOther) {
      // Always the INFOODS number, whatever the data type. The placeholder must
      // speak the same vocabulary as the reported rows beside it, or
      // `missingNutrientIds` lists an identifier no reported fact could match.
      const chosenNumber = core.nutrientNumber;
      nutrientFacts.push({
        nutrientId: chosenNumber,
        nutrientName: core.nutrientName,
        unit: core.unit,
        value: null,
        status: "UNKNOWN",
        derivation: "UNKNOWN",
        derivationDetail: "Nutrient not reported in source record",
      });
      processedNutrientNumbers.add(chosenNumber);
    }
  }

  // 5. Portions & household measures
  const householdMeasures = norm.portions.map((p) => ({
    text: p.text,
    gramWeight: p.gramWeight,
    provenance: "SOURCE_PORTION" as const,
  }));

  // 6. Propose allergen facts
  const allergenFactsV2 = proposeAllergenFacts(input.entry, norm, input.retrievedAt);

  // 7. Assemble SourcedFoodCatalogItem
  const recordUrl = redactUrl(
    `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${norm.fdcId}/nutrients`
  );

  const missingNutrientIds = nutrientFacts
    .filter((n) => n.status === "UNKNOWN")
    .map((n) => n.nutrientId);

  const item: SourcedFoodCatalogItem = {
    id: `fdc-${norm.fdcId}`,
    version: 1,
    name: input.entry.canonicalName,
    source: {
      sourceId: "USDA-FDC",
      sourceVersion: `allowlist-v${input.allowlistVersion}`,
      sourceUrl: recordUrl,
      reviewedAt: input.retrievedAt,
      licenseClassification: "CC0_PUBLIC_DOMAIN",
      authority: "REVIEWED_SOURCE",
    },
    foodState: input.entry.foodState,
    servingGrams: 100,
    nutrients: {
      energyKcal,
      proteinGrams,
      carbohydrateGrams,
      fatGrams,
      missingNutrientIds,
    },
    // No `allergenFacts`. See the field's own note in `artifacts/schema.ts` and
    // review r2 MB-4: the legacy struct has no way to say UNKNOWN, so writing
    // it here stamped all 197 items "REVIEWED_SOURCE, contains <only the
    // PRESENT ones>" and silently dropped 1643 UNKNOWN facts — `Nuts, almonds`
    // shipped as reviewed and containing nothing. `allergenFactsV2` is the only
    // allergen surface a SOURCED_V2 item has, and the schema now refuses an
    // item that carries both.
    synonyms: input.entry.synonyms,
    sourceRecord: {
      system: "USDA_FDC",
      recordId: String(norm.fdcId),
      dataType: norm.dataType === "Foundation" ? "FOUNDATION" : "SR_LEGACY",
      publicationDate: norm.publicationDate,
      sourceReleaseLabel:
        norm.dataType === "Foundation"
          ? "USDA FoodData Central Foundation Foods"
          : "USDA FoodData Central SR Legacy",
      retrievedAt: input.retrievedAt,
      recordUrl,
      license: "CC0_PUBLIC_DOMAIN",
      attributionText: `USDA FoodData Central (FDC ID: ${norm.fdcId}, Data Type: ${norm.dataType}, Released: ${norm.publicationDate}). Public domain (CC0).`,
    },
    amountBasis: {
      basisGrams: 100,
      ediblePortionFactor: null,
      ediblePortionProvenance: "UNKNOWN",
      householdMeasures,
      yieldMethod: "NONE_APPLIED",
    },
    nutrientFacts,
    energyFact: {
      kcal: energyKcal,
      method: energyMethod,
      // The row's own name when the record gives no derivation: "Energy
      // (Atwater Specific Factors)" is source text, not an inference.
      methodDetail:
        energyNutrient!.derivationDescription ??
        energyNutrient!.derivationCode ??
        energyNutrient!.nutrientName ??
        null,
      macroEnergyDiscrepancyKcal,
    },
    allergenFactsV2,
    patternTags: input.entry.patternTags,
    reviewState: input.entry.reviewState === "STRUCK" ? undefined : input.entry.reviewState,
    supersedesItemId: null,
  };

  return {
    ok: true,
    item,
    warnings,
  };
}
