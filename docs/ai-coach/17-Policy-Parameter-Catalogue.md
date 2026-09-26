# Policy Parameter Catalogue (T-2034)

Status: **UNAPPROVED DRAFT CATALOGUE FOR QUALIFIED REGISTERED DIETITIAN (RD) REVIEW.**

> [!WARNING]
> No value in this catalogue or in the draft nutrition policy bundle is approved for live coaching or human use.
> All values are engineering draft proposals derived from cited public authorities or placeholders awaiting professional decision.
> Live activation requires a qualified Registered Dietitian to review, correct, and sign the policy bundle, replacing the `DRAFT_UNSIGNED` review metadata with an immutable signed review record.

---

## 1. Overview and Five-Way Rule Grouping

Per T-2003 Amendment 1 §A1.3, the 75 numeric parameters of the prescription engine are partitioned across five calculation method and adjustment rule identifiers:

| Rule / Method ID                                    | Declared In            | Parameters                                                                                                           | Count | Worksheet Owner |
| --------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ----- | --------------- |
| `NASEM.ENERGY.2023.ADULT.EER.LINEAR.V1`             | `calculationMethodIds` | 40 `ENERGY.EER.NASEM2023.<pop>.<activity>.<slot>`, 6 `INPUT_RANGE.*`, `ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS` | 47    | D03             |
| `MACRO.PROTEIN.WEIGHT_BASIS.CURRENT_BODY_WEIGHT.V1` | `calculationMethodIds` | 9 `MACRO.PROTEIN.G_PER_KG.<ctx>.<slot>`                                                                              | 9     | D05             |
| `GOAL.ADJUSTMENT.BOUNDED.V1`                        | `adjustmentRuleIds`    | 5 `GOAL.ADJUSTMENT.*.ENERGY_DELTA_FRACTION`, 2 `GOAL.BOUND.RELATIVE.*`, `ENERGY.BODY_MASS.ENERGY_PER_KG`             | 8     | D04             |
| `MACRO.COMPOSITION.DRI_AMDR.V1`                     | `calculationMethodIds` | 4 `MACRO.*.PERCENT_ENERGY.*`, 3 `MACRO.ENERGY_DENSITY.*`                                                             | 7     | D05             |
| `PRESCRIPTION.ROUNDING.ORDER.V1`                    | `calculationMethodIds` | 3 `ROUNDING.*`, `COMPOSITION.TOLERANCE_PERCENT`                                                                      | 4     | D03             |

**Total: 75 numeric parameters.**

Of these 75 parameters:

- **62 parameters** are source-backed from cited scientific authorities and are proposed in the checked-in draft bundle (`lib/ai-coach/artifacts/drafts/policy-bundle-nutrition.draft-unsigned.v1.json`) with complete table/page provenance.
- **13 parameters** represent non-delegable professional risk decisions with no authoritative universal value. Under the fail-closed omit-don't-guess rule (Amendment 1 §A1.3), these are **omitted** from the draft bundle until reviewed and signed by the RD.

---

## 2. Source-Backed Proposed Parameters (62)

These 62 parameters are populated in the draft bundle and traceable to cited reports:

### 2.1 Adult EER Coefficients (40 parameters — D03, `NASEM.ENERGY.2023.ADULT.EER.LINEAR.V1`)

_Source: NASEM 2023 Dietary Reference Intakes for Energy, Chapter 5, Table 5-16, pp. 163-164 (`NASEM-ENERGY-2023`). Claim ID: `CLAIM.NASEM.ENERGY.2023.TABLE_5_16`._

| Parameter ID                                                         | Unit                     | Value   | Status            |
| -------------------------------------------------------------------- | ------------------------ | ------- | ----------------- |
| `ENERGY.EER.NASEM2023.MALE_ADULT.INACTIVE.INTERCEPT`                 | `KCAL_PER_DAY`           | 753.07  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.INACTIVE.AGE_COEFFICIENT`           | `KCAL_PER_DAY_PER_YEAR`  | -10.83  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.INACTIVE.WEIGHT_COEFFICIENT`        | `KCAL_PER_DAY_PER_KG`    | 14.10   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.INACTIVE.HEIGHT_COEFFICIENT`        | `KCAL_PER_DAY_PER_METRE` | 650     | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.INACTIVE.ACTIVITY_COEFFICIENT`      | `RATIO`                  | 1       | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.LOW_ACTIVE.INTERCEPT`               | `KCAL_PER_DAY`           | 581.47  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.LOW_ACTIVE.AGE_COEFFICIENT`         | `KCAL_PER_DAY_PER_YEAR`  | -10.83  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.LOW_ACTIVE.WEIGHT_COEFFICIENT`      | `KCAL_PER_DAY_PER_KG`    | 14.94   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.LOW_ACTIVE.HEIGHT_COEFFICIENT`      | `KCAL_PER_DAY_PER_METRE` | 830     | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.LOW_ACTIVE.ACTIVITY_COEFFICIENT`    | `RATIO`                  | 1       | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.ACTIVE.INTERCEPT`                   | `KCAL_PER_DAY`           | 1004.82 | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.ACTIVE.AGE_COEFFICIENT`             | `KCAL_PER_DAY_PER_YEAR`  | -10.83  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.ACTIVE.WEIGHT_COEFFICIENT`          | `KCAL_PER_DAY_PER_KG`    | 15.91   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.ACTIVE.HEIGHT_COEFFICIENT`          | `KCAL_PER_DAY_PER_METRE` | 652     | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.ACTIVE.ACTIVITY_COEFFICIENT`        | `RATIO`                  | 1       | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.VERY_ACTIVE.INTERCEPT`              | `KCAL_PER_DAY`           | -517.88 | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.VERY_ACTIVE.AGE_COEFFICIENT`        | `KCAL_PER_DAY_PER_YEAR`  | -10.83  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.VERY_ACTIVE.WEIGHT_COEFFICIENT`     | `KCAL_PER_DAY_PER_KG`    | 19.11   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.VERY_ACTIVE.HEIGHT_COEFFICIENT`     | `KCAL_PER_DAY_PER_METRE` | 1561    | Proposed in Draft |
| `ENERGY.EER.NASEM2023.MALE_ADULT.VERY_ACTIVE.ACTIVITY_COEFFICIENT`   | `RATIO`                  | 1       | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.INACTIVE.INTERCEPT`               | `KCAL_PER_DAY`           | 584.90  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.INACTIVE.AGE_COEFFICIENT`         | `KCAL_PER_DAY_PER_YEAR`  | -7.01   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.INACTIVE.WEIGHT_COEFFICIENT`      | `KCAL_PER_DAY_PER_KG`    | 11.71   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.INACTIVE.HEIGHT_COEFFICIENT`      | `KCAL_PER_DAY_PER_METRE` | 572     | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.INACTIVE.ACTIVITY_COEFFICIENT`    | `RATIO`                  | 1       | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.LOW_ACTIVE.INTERCEPT`             | `KCAL_PER_DAY`           | 575.77  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.LOW_ACTIVE.AGE_COEFFICIENT`       | `KCAL_PER_DAY_PER_YEAR`  | -7.01   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.LOW_ACTIVE.WEIGHT_COEFFICIENT`    | `KCAL_PER_DAY_PER_KG`    | 12.14   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.LOW_ACTIVE.HEIGHT_COEFFICIENT`    | `KCAL_PER_DAY_PER_METRE` | 660     | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.LOW_ACTIVE.ACTIVITY_COEFFICIENT`  | `RATIO`                  | 1       | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.ACTIVE.INTERCEPT`                 | `KCAL_PER_DAY`           | 710.25  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.ACTIVE.AGE_COEFFICIENT`           | `KCAL_PER_DAY_PER_YEAR`  | -7.01   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.ACTIVE.WEIGHT_COEFFICIENT`        | `KCAL_PER_DAY_PER_KG`    | 12.34   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.ACTIVE.HEIGHT_COEFFICIENT`        | `KCAL_PER_DAY_PER_METRE` | 654     | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.ACTIVE.ACTIVITY_COEFFICIENT`      | `RATIO`                  | 1       | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.VERY_ACTIVE.INTERCEPT`            | `KCAL_PER_DAY`           | 511.83  | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.VERY_ACTIVE.AGE_COEFFICIENT`      | `KCAL_PER_DAY_PER_YEAR`  | -7.01   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.VERY_ACTIVE.WEIGHT_COEFFICIENT`   | `KCAL_PER_DAY_PER_KG`    | 12.56   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.VERY_ACTIVE.HEIGHT_COEFFICIENT`   | `KCAL_PER_DAY_PER_METRE` | 907     | Proposed in Draft |
| `ENERGY.EER.NASEM2023.FEMALE_ADULT.VERY_ACTIVE.ACTIVITY_COEFFICIENT` | `RATIO`                  | 1       | Proposed in Draft |

### 2.2 Input Ranges (6 parameters — D03, `NASEM.ENERGY.2023.ADULT.EER.LINEAR.V1`)

_Source: NASEM 2023 Table 5-16 dataset ranges. Claim ID: `CLAIM.NASEM.ENERGY.2023.INPUT_RANGES`._

| Parameter ID                                     | Unit          | Value | Status            |
| ------------------------------------------------ | ------------- | ----- | ----------------- |
| `ENERGY.EER.NASEM2023.INPUT_RANGE.AGE_YEARS.MIN` | `YEARS`       | 19    | Proposed in Draft |
| `ENERGY.EER.NASEM2023.INPUT_RANGE.AGE_YEARS.MAX` | `YEARS`       | 80    | Proposed in Draft |
| `ENERGY.EER.NASEM2023.INPUT_RANGE.HEIGHT_CM.MIN` | `CENTIMETRES` | 140   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.INPUT_RANGE.HEIGHT_CM.MAX` | `CENTIMETRES` | 220   | Proposed in Draft |
| `ENERGY.EER.NASEM2023.INPUT_RANGE.WEIGHT_KG.MIN` | `KILOGRAMS`   | 40    | Proposed in Draft |
| `ENERGY.EER.NASEM2023.INPUT_RANGE.WEIGHT_KG.MAX` | `KILOGRAMS`   | 200   | Proposed in Draft |

### 2.3 AMDR Percent Bounds (4 parameters — D05, `MACRO.COMPOSITION.DRI_AMDR.V1`)

_Source: NASEM DRI Collection, Table 11-1, p. 769. Claim ID: `CLAIM.NASEM.DRI.MACRONUTRIENTS.AMDR`._

| Parameter ID                            | Unit                      | Value | Status            |
| --------------------------------------- | ------------------------- | ----- | ----------------- |
| `MACRO.CARBOHYDRATE.PERCENT_ENERGY.MIN` | `PERCENT_OF_TOTAL_ENERGY` | 45    | Proposed in Draft |
| `MACRO.CARBOHYDRATE.PERCENT_ENERGY.MAX` | `PERCENT_OF_TOTAL_ENERGY` | 65    | Proposed in Draft |
| `MACRO.FAT.PERCENT_ENERGY.MIN`          | `PERCENT_OF_TOTAL_ENERGY` | 20    | Proposed in Draft |
| `MACRO.FAT.PERCENT_ENERGY.MAX`          | `PERCENT_OF_TOTAL_ENERGY` | 35    | Proposed in Draft |

### 2.4 Energy Densities (3 parameters — D05, `MACRO.COMPOSITION.DRI_AMDR.V1`)

_Source: NASEM DRI Collection, pp. 69-70 (Atwater factors). Claim ID: `CLAIM.NASEM.DRI.ATWATER_ENERGY_DENSITY`._

| Parameter ID                                   | Unit            | Value | Status            |
| ---------------------------------------------- | --------------- | ----- | ----------------- |
| `MACRO.ENERGY_DENSITY.PROTEIN.KCAL_PER_G`      | `KCAL_PER_GRAM` | 4     | Proposed in Draft |
| `MACRO.ENERGY_DENSITY.CARBOHYDRATE.KCAL_PER_G` | `KCAL_PER_GRAM` | 4     | Proposed in Draft |
| `MACRO.ENERGY_DENSITY.FAT.KCAL_PER_G`          | `KCAL_PER_GRAM` | 9     | Proposed in Draft |

### 2.5 Protein g/kg by Training Context (9 parameters — D05, `MACRO.PROTEIN.WEIGHT_BASIS.CURRENT_BODY_WEIGHT.V1`)

_Sources: NONE = NASEM DRI Collection, Chapter 10, p. 589 (`CLAIM.NASEM.DRI.PROTEIN.BASELINE`); OCCASIONAL = AND-DC-ACSM 2016, pp. 547-548 (`CLAIM.ACSM.AND.PROTEIN.ACTIVE_ADULT`); REGULAR = ISSN 2017 / Morton 2018 (`CLAIM.ISSN.MORTON.PROTEIN.RESISTANCE_TRAINING`)._

| Parameter ID                               | Unit                           | Value | Status            |
| ------------------------------------------ | ------------------------------ | ----- | ----------------- |
| `MACRO.PROTEIN.G_PER_KG.NONE.MIN`          | `G_PER_KG_BODY_WEIGHT_PER_DAY` | 0.8   | Proposed in Draft |
| `MACRO.PROTEIN.G_PER_KG.NONE.TARGET`       | `G_PER_KG_BODY_WEIGHT_PER_DAY` | 0.8   | Proposed in Draft |
| `MACRO.PROTEIN.G_PER_KG.NONE.MAX`          | `G_PER_KG_BODY_WEIGHT_PER_DAY` | 1.2   | Proposed in Draft |
| `MACRO.PROTEIN.G_PER_KG.OCCASIONAL.MIN`    | `G_PER_KG_BODY_WEIGHT_PER_DAY` | 1.2   | Proposed in Draft |
| `MACRO.PROTEIN.G_PER_KG.OCCASIONAL.TARGET` | `G_PER_KG_BODY_WEIGHT_PER_DAY` | 1.4   | Proposed in Draft |
| `MACRO.PROTEIN.G_PER_KG.OCCASIONAL.MAX`    | `G_PER_KG_BODY_WEIGHT_PER_DAY` | 1.6   | Proposed in Draft |
| `MACRO.PROTEIN.G_PER_KG.REGULAR.MIN`       | `G_PER_KG_BODY_WEIGHT_PER_DAY` | 1.6   | Proposed in Draft |
| `MACRO.PROTEIN.G_PER_KG.REGULAR.TARGET`    | `G_PER_KG_BODY_WEIGHT_PER_DAY` | 2.0   | Proposed in Draft |
| `MACRO.PROTEIN.G_PER_KG.REGULAR.MAX`       | `G_PER_KG_BODY_WEIGHT_PER_DAY` | 2.4   | Proposed in Draft |

---

## 3. Awaiting Qualified Professional Review (13)

These 13 parameters are professional risk decisions with no authoritative universal values. Under the fail-closed omit-don't-guess rule, they are **omitted from the draft bundle file** and await RD sign-off in the professional review worksheet:

| Parameter ID                                          | Unit                             | Worksheet Section | Rule ID                                 | Claim ID                  | Status          |
| ----------------------------------------------------- | -------------------------------- | ----------------- | --------------------------------------- | ------------------------- | --------------- |
| `GOAL.ADJUSTMENT.LOSE.GRADUAL.ENERGY_DELTA_FRACTION`  | `FRACTION_OF_MAINTENANCE_ENERGY` | D04               | `GOAL.ADJUSTMENT.BOUNDED.V1`            | `PENDING-RD-DECISION.D04` | Awaiting Review |
| `GOAL.ADJUSTMENT.LOSE.MODERATE.ENERGY_DELTA_FRACTION` | `FRACTION_OF_MAINTENANCE_ENERGY` | D04               | `GOAL.ADJUSTMENT.BOUNDED.V1`            | `PENDING-RD-DECISION.D04` | Awaiting Review |
| `GOAL.ADJUSTMENT.GAIN.GRADUAL.ENERGY_DELTA_FRACTION`  | `FRACTION_OF_MAINTENANCE_ENERGY` | D04               | `GOAL.ADJUSTMENT.BOUNDED.V1`            | `PENDING-RD-DECISION.D04` | Awaiting Review |
| `GOAL.ADJUSTMENT.GAIN.MODERATE.ENERGY_DELTA_FRACTION` | `FRACTION_OF_MAINTENANCE_ENERGY` | D04               | `GOAL.ADJUSTMENT.BOUNDED.V1`            | `PENDING-RD-DECISION.D04` | Awaiting Review |
| `GOAL.ADJUSTMENT.MAINTAIN.ANY.ENERGY_DELTA_FRACTION`  | `FRACTION_OF_MAINTENANCE_ENERGY` | D04               | `GOAL.ADJUSTMENT.BOUNDED.V1`            | `PENDING-RD-DECISION.D04` | Awaiting Review |
| `GOAL.BOUND.RELATIVE.MAX_REDUCTION_FRACTION`          | `FRACTION_OF_MAINTENANCE_ENERGY` | D04               | `GOAL.ADJUSTMENT.BOUNDED.V1`            | `PENDING-RD-DECISION.D04` | Awaiting Review |
| `GOAL.BOUND.RELATIVE.MAX_INCREASE_FRACTION`           | `FRACTION_OF_MAINTENANCE_ENERGY` | D04               | `GOAL.ADJUSTMENT.BOUNDED.V1`            | `PENDING-RD-DECISION.D04` | Awaiting Review |
| `ENERGY.BODY_MASS.ENERGY_PER_KG`                      | `KCAL_PER_KG_BODY_MASS`          | D04               | `GOAL.ADJUSTMENT.BOUNDED.V1`            | `PENDING-RD-DECISION.D04` | Awaiting Review |
| `ENERGY.INPUT.WEIGHT_MEASUREMENT.MAX_AGE_DAYS`        | `DAYS`                           | D03               | `NASEM.ENERGY.2023.ADULT.EER.LINEAR.V1` | `PENDING-RD-DECISION.D03` | Awaiting Review |
| `ROUNDING.ENERGY_KCAL.STEP`                           | `KCAL_PER_DAY`                   | D03               | `PRESCRIPTION.ROUNDING.ORDER.V1`        | `PENDING-RD-DECISION.D03` | Awaiting Review |
| `ROUNDING.MACRO_GRAMS.DECIMALS`                       | `DECIMAL_PLACES`                 | D03               | `PRESCRIPTION.ROUNDING.ORDER.V1`        | `PENDING-RD-DECISION.D03` | Awaiting Review |
| `ROUNDING.PROJECTED_WEEKLY_CHANGE_KG.DECIMALS`        | `DECIMAL_PLACES`                 | D03               | `PRESCRIPTION.ROUNDING.ORDER.V1`        | `PENDING-RD-DECISION.D03` | Awaiting Review |
| `COMPOSITION.TOLERANCE_PERCENT`                       | `PERCENT`                        | D03               | `PRESCRIPTION.ROUNDING.ORDER.V1`        | `PENDING-RD-DECISION.D03` | Awaiting Review |

---

## 4. Change History

- **2026-09-25** (T-2034): Created initial catalogue with 62 source-backed proposed parameters and 13 parameters awaiting RD review per Amendment 1 §A1.3.
