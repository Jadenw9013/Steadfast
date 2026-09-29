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

## 4. Training and Progression Parameters (46)

Per T-2005 / T-2039, 46 training and progression parameters are defined for deterministic exercise and cardio composition:
- 34 composer parameters (11 proposed under T-2039, 23 adopted by the accountable owner under S-23)
- 12 progression parameters (all 12 adopted by the accountable owner under S-23)

**Provenance of the 35 values adopted on 2026-09-29 (Sections 4.2 and 4.3).** Recorded in the
accountable owner's own words on every one of their `proposalProvenance` rows, and not to be
reworded: *"proposed by engineering, adopted by me, not verified against a primary literature
source."* Twelve of the eighteen dose values in Section 4.2 are numerically identical to the
`syntheticTrainingParameterValue()` test fixture; that overlap was checked and recorded before
ingestion (`steadfast-hq/board/DOSE-WORKSHEET-2.md`) and is consistent with the provenance above.
They are **not** derived from, or verified against, any published source.

### 4.1 Proposed Training Parameters (11)

These 11 parameters carry product and engineering proposals derived from board ticket specs (T-2002 / T-2005 / T-2039) and are populated in the draft bundle file (`lib/ai-coach/artifacts/drafts/policy-bundle-nutrition.draft-unsigned.v1.json`):

| Parameter ID | Unit | Worksheet Section | Rule ID | Claim ID | Status |
| --- | --- | --- | --- | --- | --- |
| `TRAINING.SESSION.EXERCISE_COUNT.UNDER_30.MAX` | `EXERCISES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.EXERCISE_COUNT.MIN_30_45.MAX` | `EXERCISES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.EXERCISE_COUNT.MIN_45_60.MAX` | `EXERCISES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.EXERCISE_COUNT.MIN_60_90.MAX` | `EXERCISES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.EXERCISE_COUNT.OVER_90.MAX` | `EXERCISES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.EXERCISE_COUNT.MIN` | `EXERCISES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.PLANNED_MINUTES.UNDER_30` | `MINUTES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.PLANNED_MINUTES.MIN_30_45` | `MINUTES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.PLANNED_MINUTES.MIN_45_60` | `MINUTES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.PLANNED_MINUTES.MIN_60_90` | `MINUTES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |
| `TRAINING.SESSION.PLANNED_MINUTES.OVER_90` | `MINUTES_PER_SESSION` | D05 | `TRAINING.RULE.SESSION_STRUCTURE.V1` | `CLAIM.STEADFAST.T2039.TRAINING.PROPOSAL` | Proposed in Draft |

### 4.2 Training Dose and Workload Parameters (23)

These 23 composer dose and workload cap parameters have no authoritative universal value. They were adopted by the accountable owner on 2026-09-29 under the provenance stated above and written into the signed bundle by S-23:

| Parameter ID | Unit | Worksheet Section | Rule ID | Claim ID | Status |
| --- | --- | --- | --- | --- | --- |
| `TRAINING.DOSE.NEW.SETS_PER_EXERCISE` | `SETS` | D05 | `TRAINING.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.DOSE.RETURNING.SETS_PER_EXERCISE` | `SETS` | D05 | `TRAINING.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.DOSE.EXPERIENCED.SETS_PER_EXERCISE` | `SETS` | D05 | `TRAINING.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.DOSE.NEW.REPS_PER_SET` | `REPETITIONS` | D05 | `TRAINING.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.DOSE.RETURNING.REPS_PER_SET` | `REPETITIONS` | D05 | `TRAINING.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.DOSE.EXPERIENCED.REPS_PER_SET` | `REPETITIONS` | D05 | `TRAINING.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.DOSE.NEW.REST_SECONDS` | `SECONDS` | D05 | `TRAINING.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.DOSE.RETURNING.REST_SECONDS` | `SECONDS` | D05 | `TRAINING.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.DOSE.EXPERIENCED.REST_SECONDS` | `SECONDS` | D05 | `TRAINING.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.TEMPLATE.DAYS.MAX_STRENGTH_SESSIONS.NEW` | `SESSIONS_PER_WEEK` | D05 | `TRAINING.TEMPLATE.SELECTION.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.TEMPLATE.DAYS.MAX_STRENGTH_SESSIONS.RETURNING` | `SESSIONS_PER_WEEK` | D05 | `TRAINING.TEMPLATE.SELECTION.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `TRAINING.TEMPLATE.DAYS.MAX_STRENGTH_SESSIONS.EXPERIENCED` | `SESSIONS_PER_WEEK` | D05 | `TRAINING.TEMPLATE.SELECTION.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `CARDIO.DOSE.NEW.SESSION_MINUTES` | `MINUTES_PER_SESSION` | D05 | `CARDIO.RULE.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `CARDIO.DOSE.RETURNING.SESSION_MINUTES` | `MINUTES_PER_SESSION` | D05 | `CARDIO.RULE.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `CARDIO.DOSE.EXPERIENCED.SESSION_MINUTES` | `MINUTES_PER_SESSION` | D05 | `CARDIO.RULE.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `CARDIO.DOSE.NEW.SESSIONS_PER_WEEK` | `SESSIONS_PER_WEEK` | D05 | `CARDIO.RULE.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `CARDIO.DOSE.RETURNING.SESSIONS_PER_WEEK` | `SESSIONS_PER_WEEK` | D05 | `CARDIO.RULE.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `CARDIO.DOSE.EXPERIENCED.SESSIONS_PER_WEEK` | `SESSIONS_PER_WEEK` | D05 | `CARDIO.RULE.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `CARDIO.DOSE.MAX_SESSION_MINUTES` | `MINUTES_PER_SESSION` | D05 | `CARDIO.RULE.DOSE.BEGINNER.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `WORKLOAD.WEEKLY.TOTAL_SESSIONS.MAX` | `SESSIONS_PER_WEEK` | D05 | `WORKLOAD.RULE.COMBINED.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX` | `MINUTES_PER_WEEK` | D05 | `WORKLOAD.RULE.COMBINED.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `WORKLOAD.WEEKLY.TRAINING_MINUTES.MAX_WHEN_ENERGY_REDUCED` | `MINUTES_PER_WEEK` | D05 | `WORKLOAD.RULE.COMBINED.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `WORKLOAD.WEEKLY.CONSECUTIVE_TRAINING_DAYS.MAX` | `DAYS` | D05 | `WORKLOAD.RULE.COMBINED.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |

### 4.3 Progression Parameters (12)

These 12 progression parameters govern weekly controller progression (T-2007) and are declared in `TRAINING_PROGRESSION_PARAMETER_IDS`. They were adopted by the accountable owner on 2026-09-29 under the provenance stated above and written into the signed bundle by S-23. They stay **inert** until the 18 `WEEKLY.*` values and `ROUNDING.MACRO_GRAMS.DECIMALS` in Section 5 also exist, because `resolveWeeklyParameters` fails closed on those:

| Parameter ID | Unit | Worksheet Section | Rule ID | Claim ID | Status |
| --- | --- | --- | --- | --- | --- |
| `PROGRESSION.STRENGTH.REPS.INCREMENT` | `REPETITIONS` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.STRENGTH.REPS.MAX_ABOVE_INITIAL` | `REPETITIONS` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.STRENGTH.SETS.INCREMENT` | `SETS` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.STRENGTH.SETS.MAX_ABOVE_INITIAL` | `SETS` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.STRENGTH.LOAD.INCREMENT_FRACTION` | `FRACTION_OF_CURRENT_LOAD` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.STRENGTH.LOAD.MAX_INCREASE_FRACTION_PER_WINDOW` | `FRACTION_OF_CURRENT_LOAD` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.CARDIO.MINUTES.INCREMENT` | `MINUTES_PER_SESSION` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.CARDIO.MINUTES.MAX_ABOVE_INITIAL` | `MINUTES_PER_SESSION` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.EVIDENCE.MIN_COMPLETE_SESSION_WEEKS` | `WEEKS` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.EVIDENCE.MIN_COMPLETE_SETS_FRACTION` | `FRACTION_OF_PRESCRIBED_SETS` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.EVIDENCE.MAX_EFFORT_RATING` | `RPE_POINTS` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |
| `PROGRESSION.WINDOW.MIN_DAYS_BETWEEN_INCREASES` | `DAYS` | D05 | `PROGRESSION.RULE.BOUNDED_TRAINING.V1` | `CLAIM.ACSM.PROGRESSION.TRAINING.SESSION_STRUCTURE` | Adopted 2026-09-29 |

T-2007 consumes ten of these twelve progression parameters. The two `PROGRESSION.STRENGTH.LOAD.*` parameters are **not read in v1** because the plan payload has no prescribed-load field; signing them does not create an unenforced load limit.

---

## 5. Weekly Review Parameters (18)

All 18 weekly parameters below are non-delegable policy decisions and remain omitted from the unsigned draft bundle until qualified review. The controller fails closed when any is absent.

| Parameter ID | Unit | Rule family | Status |
| --- | --- | --- | --- |
| `WEEKLY.EVIDENCE.MIN_CONSECUTIVE_WEEKS` | `WEEKS` | `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` | Awaiting Review |
| `WEEKLY.EVIDENCE.MAX_MISSING_WEEKS` | `WEEKS` | `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` | Awaiting Review |
| `WEEKLY.EVIDENCE.MIN_COMPLETE_CHECK_INS_PER_WEEK` | `CHECK_INS_PER_WEEK` | `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` | Awaiting Review |
| `WEEKLY.EVIDENCE.MIN_PLAN_FOLLOWING_DAYS` | `DAYS_PER_WEEK` | `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` | Awaiting Review |
| `WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_PER_WEEK` | `OBSERVATIONS_PER_WEEK` | `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` | Awaiting Review |
| `WEEKLY.EVIDENCE.MIN_COMPARABLE_WEIGH_INS_TOTAL` | `OBSERVATIONS` | `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` | Awaiting Review |
| `WEEKLY.EVIDENCE.MAX_COMPARABLE_SPREAD_FRACTION` | `FRACTION_OF_MEDIAN_BODY_WEIGHT` | `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` | Awaiting Review |
| `WEEKLY.EVIDENCE.PLATEAU_MAX_RELATIVE_CHANGE` | `FRACTION_OF_BODY_WEIGHT` | `WEEKLY.RULE.EVIDENCE_SUFFICIENCY.V1` | Awaiting Review |
| `WEEKLY.ADJUSTMENT.ENERGY.STEP_FRACTION` | `FRACTION_OF_CURRENT_ENERGY` | selected `WEEKLY.ADJUSTMENT.ENERGY.*` rule | Awaiting Review |
| `WEEKLY.ADJUSTMENT.ENERGY.STEP_TOLERANCE_KCAL` | `KCAL_PER_DAY` | selected `WEEKLY.ADJUSTMENT.ENERGY.*` rule | Awaiting Review |
| `WEEKLY.COOLDOWN.MIN_DAYS_BETWEEN_MATERIAL_CHANGES` | `DAYS` | `WEEKLY.RULE.COOLDOWN.V1` | Awaiting Review |
| `WEEKLY.CUMULATIVE.WINDOW_DAYS` | `DAYS` | `WEEKLY.RULE.CUMULATIVE_LIMIT.V1` | Awaiting Review |
| `WEEKLY.CUMULATIVE.MAX_MATERIAL_CHANGES_PER_WINDOW` | `CHANGES_PER_WINDOW` | `WEEKLY.RULE.CUMULATIVE_LIMIT.V1` | Awaiting Review |
| `WEEKLY.CUMULATIVE.ENERGY.MAX_REDUCTION_FRACTION` | `FRACTION_OF_BASELINE_ENERGY` | `WEEKLY.RULE.CUMULATIVE_LIMIT.V1` | Awaiting Review |
| `WEEKLY.CUMULATIVE.MAX_CHANGED_DOMAINS_PER_REVIEW` | `DOMAINS_PER_REVIEW` | `WEEKLY.RULE.CUMULATIVE_LIMIT.V1` | Awaiting Review |
| `WEEKLY.SIMPLIFY.TRAINING_DAYS.DECREMENT` | `SESSIONS_PER_WEEK` | selected `WEEKLY.RULE.SIMPLIFY_*` rule | Awaiting Review |
| `WEEKLY.SIMPLIFY.CARDIO.MINUTES.DECREMENT` | `MINUTES_PER_SESSION` | selected `WEEKLY.RULE.SIMPLIFY_*` rule | Awaiting Review |
| `WEEKLY.SIMPLIFY.CARDIO.MINUTES.FLOOR` | `MINUTES_PER_SESSION` | selected `WEEKLY.RULE.SIMPLIFY_*` rule | Awaiting Review |

The draft declares the rule vocabulary and chooses `REESTIMATE_FROM_CURRENT_WEIGHT` plus `SIMPLIFY_BY_RECOMPOSITION`, but supplies no `WEEKLY.*` values. `ROUNDING.MACRO_GRAMS.DECIMALS` and the ten consumed `PROGRESSION.*` rows are reused by ID; they are also awaiting review.

---

## 6. Change History

- **2026-09-25** (T-2034): Created initial catalogue with 62 source-backed proposed parameters and 13 parameters awaiting RD review per Amendment 1 §A1.3.
- **2026-09-26** (T-2039): Added Section 4 with 46 training and progression parameters (11 proposed, 23 composer dose awaiting review, 12 progression awaiting review).
- **2026-09-28** (T-2007): Added the weekly evidence, adjustment, cooldown, cumulative, and simplification catalogue; documented the ten consumed progression rows and the two load rows not read in v1.
- **2026-09-29** (S-23): The accountable owner adopted the 23 Section 4.2 and 12 Section 4.3 values; they were written into the signed policy bundle and the bundle was re-signed. `resolveTrainingParameters` now resolves; `resolvePrescriptionParameters` still fails closed on the 13 Section 3 values, so no plan composes. Measured across 4064 synthetic profiles in `steadfast-hq/board/evidence/v1-dose-harness.md`.
