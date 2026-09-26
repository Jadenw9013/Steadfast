import type {
  SourcedFoodCatalogItem,
} from "@/lib/ai-coach/artifacts/schema";
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

const KNOWN_ANALYTICAL_CODES = new Set([
  "A",
  "AS",
  "AD",
  "FLA",
  "FS",
  "AG",
  "ANALYTICAL",
]);

const KNOWN_CALCULATED_CODES = new Set([
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

export const CORE_TRACKED_NUTRIENTS: ReadonlyArray<{
  nutrientNumber: string;
  altNumber: string;
  nutrientName: string;
  unit: "G" | "MG" | "UG" | "KCAL";
}> = [
  { nutrientNumber: "1008", altNumber: "208", nutrientName: "Energy", unit: "KCAL" },
  { nutrientNumber: "1003", altNumber: "203", nutrientName: "Protein", unit: "G" },
  { nutrientNumber: "1004", altNumber: "204", nutrientName: "Total lipid (fat)", unit: "G" },
  { nutrientNumber: "1005", altNumber: "205", nutrientName: "Carbohydrate, by difference", unit: "G" },
  { nutrientNumber: "1079", altNumber: "291", nutrientName: "Fiber, total dietary", unit: "G" },
  { nutrientNumber: "2000", altNumber: "269", nutrientName: "Sugars, total including NLEA", unit: "G" },
  { nutrientNumber: "1087", altNumber: "301", nutrientName: "Calcium, Ca", unit: "MG" },
  { nutrientNumber: "1089", altNumber: "303", nutrientName: "Iron, Fe", unit: "MG" },
  { nutrientNumber: "1092", altNumber: "306", nutrientName: "Potassium, K", unit: "MG" },
  { nutrientNumber: "1093", altNumber: "307", nutrientName: "Sodium, Na", unit: "MG" },
  { nutrientNumber: "1110", altNumber: "324", nutrientName: "Vitamin D (D2 + D3)", unit: "UG" },
];

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

  // 2. Identify key macronutrients and energy
  const findNutrient = (primaryNum: string, altNum: string, expectedUnit: string) => {
    return norm.nutrients.find(
      (n) =>
        (n.nutrientNumber === primaryNum || n.nutrientNumber === altNum) &&
        normalizeUnit(n.unitName) === expectedUnit
    );
  };

  const energyNutrient = findNutrient("1008", "208", "KCAL");
  const proteinNutrient = findNutrient("1003", "203", "G");
  const fatNutrient = findNutrient("1004", "204", "G");
  const carbNutrient = findNutrient("1005", "205", "G");

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

  // 3. Energy method mapping
  let energyMethod: "ATWATER_GENERAL" | "ATWATER_SPECIFIC" | "SOURCE_REPORTED_UNSPECIFIED" | "UNKNOWN" =
    "SOURCE_REPORTED_UNSPECIFIED";
  const energyDerivationCode = energyNutrient!.derivationCode?.toUpperCase().trim() ?? "";
  const energyDerivationDesc = energyNutrient!.derivationDescription?.toLowerCase().trim() ?? "";

  if (
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
    const hasPrimary = processedNutrientNumbers.has(core.nutrientNumber);
    const hasAlt = processedNutrientNumbers.has(core.altNumber);
    if (!hasPrimary && !hasAlt) {
      const chosenNumber = norm.dataType === "SR Legacy" ? core.altNumber : core.nutrientNumber;
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

  const presentCategories = allergenFactsV2.categories
    .filter((c) => c.presence === "PRESENT")
    .map((c) => c.category);

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
    allergenFacts: {
      contains: presentCategories,
      evidenceSourceId: "USDA-FDC",
      verificationStatus: "REVIEWED_SOURCE",
      crossContactRequiresCurrentVerification: true,
    },
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
      methodDetail: energyNutrient!.derivationDescription ?? energyNutrient!.derivationCode ?? null,
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
