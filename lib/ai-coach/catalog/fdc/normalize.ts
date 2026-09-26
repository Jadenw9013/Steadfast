export type NormalizedFdcNutrient = {
  nutrientNumber: string;
  nutrientName: string;
  unitName: "G" | "MG" | "UG" | "KCAL" | "KJ" | "IU" | string;
  amount: number | null; // null <=> status UNKNOWN
  derivationCode: string | null;
  derivationDescription: string | null;
};

export type NormalizedFdcPortion = {
  gramWeight: number;
  text: string;
};

export type NormalizedFdcRecord = {
  fdcId: number;
  description: string;
  dataType: string;
  publicationDate: string;
  foodCategory: string;
  hasInputFoods: boolean;
  /**
   * The record's own ingredient statement, verbatim, or `null` when the record
   * carries none. Only Branded FDC records have an `ingredients` field; a
   * Foundation or SR Legacy record never does. Read here so that
   * `allergenFactsV2.ingredientStatementAvailable` is a fact off the record
   * rather than a hardcoded assumption (T-2035 review r1, finding B3).
   */
  ingredientStatement: string | null;
  nutrients: NormalizedFdcNutrient[];
  portions: NormalizedFdcPortion[];
};

/**
 * The record's own `foodCategory`, verbatim, or `null` when it carries none.
 *
 * Shaped differently in the two endpoints this pipeline reads, which is why it
 * is one function rather than two copies: `/food/{id}` returns an object
 * (`{ id, code, description }`) and `/foods/search` returns the description as
 * a bare string. `--propose` reads the search shape and `--ingest` reads the
 * record shape, and T-2016 derives `patternTags` and `categoryId` from this
 * value, so the two must not disagree about what "no category" looks like.
 */
export function readFdcFoodCategory(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  let value = "";
  if (typeof record.foodCategory === "string") {
    value = record.foodCategory.trim();
  } else if (
    record.foodCategory &&
    typeof record.foodCategory === "object" &&
    "description" in record.foodCategory &&
    typeof (record.foodCategory as { description: unknown }).description === "string"
  ) {
    value = (record.foodCategory as { description: string }).description.trim();
  } else if (
    record.wweiaFoodCategory &&
    typeof record.wweiaFoodCategory === "object" &&
    "wweiaFoodCategoryDescription" in record.wweiaFoodCategory &&
    typeof (record.wweiaFoodCategory as { wweiaFoodCategoryDescription: unknown })
      .wweiaFoodCategoryDescription === "string"
  ) {
    value = (
      record.wweiaFoodCategory as { wweiaFoodCategoryDescription: string }
    ).wweiaFoodCategoryDescription.trim();
  }

  return value.length > 0 ? value : null;
}

export function normalizeFdcRecord(raw: unknown): NormalizedFdcRecord {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid FDC record: expected an object");
  }

  const record = raw as Record<string, unknown>;

  if (typeof record.fdcId !== "number" || !Number.isFinite(record.fdcId)) {
    throw new Error("Missing or invalid required field 'fdcId'");
  }

  if (typeof record.description !== "string" || !record.description.trim()) {
    throw new Error("Missing or invalid required field 'description'");
  }

  if (typeof record.dataType !== "string" || !record.dataType.trim()) {
    throw new Error("Missing or invalid required field 'dataType'");
  }

  if (typeof record.publicationDate !== "string" || !record.publicationDate.trim()) {
    throw new Error("Missing or invalid required field 'publicationDate'");
  }

  const foodCategory = readFdcFoodCategory(record) ?? "";

  let ingredientStatement: string | null = null;
  if (typeof record.ingredients === "string" && record.ingredients.trim()) {
    ingredientStatement = record.ingredients.trim();
  }

  const hasInputFoods =
    (Array.isArray(record.inputFoods) && record.inputFoods.length > 0) ||
    (Array.isArray(record.foodComponents) && record.foodComponents.length > 0);

  const nutrients: NormalizedFdcNutrient[] = [];
  if (Array.isArray(record.foodNutrients)) {
    for (const fn of record.foodNutrients) {
      if (!fn || typeof fn !== "object") continue;

      let nutrientNumber = "";
      let nutrientName = "";
      let unitName = "";

      if ("nutrient" in fn && fn.nutrient && typeof fn.nutrient === "object") {
        const n = fn.nutrient as Record<string, unknown>;
        nutrientNumber = String(n.number ?? n.id ?? "").trim();
        nutrientName = String(n.name ?? "").trim();
        unitName = String(n.unitName ?? "").trim().toUpperCase();
      } else {
        nutrientNumber = String(fn.nutrientNumber ?? fn.nutrientId ?? "").trim();
        nutrientName = String(fn.nutrientName ?? "").trim();
        unitName = String(fn.unitName ?? "").trim().toUpperCase();
      }

      if (!nutrientNumber) continue;

      let amount: number | null = null;
      if (typeof fn.amount === "number" && Number.isFinite(fn.amount)) {
        amount = fn.amount;
      } else if (typeof fn.value === "number" && Number.isFinite(fn.value)) {
        amount = fn.value;
      }

      let derivationCode: string | null = null;
      let derivationDescription: string | null = null;
      if (
        "foodNutrientDerivation" in fn &&
        fn.foodNutrientDerivation &&
        typeof fn.foodNutrientDerivation === "object"
      ) {
        const d = fn.foodNutrientDerivation as Record<string, unknown>;
        if (typeof d.code === "string") derivationCode = d.code.trim();
        if (typeof d.description === "string") derivationDescription = d.description.trim();
      } else if (typeof fn.derivationCode === "string") {
        derivationCode = fn.derivationCode.trim();
        if (typeof fn.derivationDescription === "string") {
          derivationDescription = fn.derivationDescription.trim();
        }
      }

      nutrients.push({
        nutrientNumber,
        nutrientName,
        unitName,
        amount,
        derivationCode,
        derivationDescription,
      });
    }
  }

  const portions: NormalizedFdcPortion[] = [];
  if (Array.isArray(record.foodPortions)) {
    for (const fp of record.foodPortions) {
      if (!fp || typeof fp !== "object") continue;
      const gramWeight = typeof fp.gramWeight === "number" ? fp.gramWeight : null;
      if (gramWeight === null || !Number.isFinite(gramWeight) || gramWeight <= 0) continue;

      let text = "";
      if (typeof fp.portionDescription === "string" && fp.portionDescription.trim()) {
        text = fp.portionDescription.trim();
      } else if (typeof fp.modifier === "string" && fp.modifier.trim()) {
        const amountStr = typeof fp.amount === "number" ? `${fp.amount} ` : "";
        text = `${amountStr}${fp.modifier.trim()}`.trim();
      } else if (
        fp.measureUnit &&
        typeof fp.measureUnit === "object" &&
        "name" in fp.measureUnit &&
        typeof (fp.measureUnit as { name: unknown }).name === "string"
      ) {
        const unitName = (fp.measureUnit as { name: string }).name.trim();
        const amountStr = typeof fp.amount === "number" ? `${fp.amount} ` : "";
        text = `${amountStr}${unitName}`.trim();
      }

      if (!text) {
        text = `${gramWeight} g`;
      }

      portions.push({
        gramWeight,
        text,
      });
    }
  }

  return {
    fdcId: record.fdcId,
    description: record.description.trim(),
    dataType: record.dataType.trim(),
    publicationDate: record.publicationDate.trim(),
    foodCategory,
    hasInputFoods,
    ingredientStatement,
    nutrients,
    portions,
  };
}
