# USDA FoodData Central (FDC) Food Catalog & RD Curation Workflow

This directory documents the ingestion pipeline, allowlist governance, and clinical curation workflow for the Steadfast AI Coach Food Catalog (Ticket T-2035).

---

## 1. Overview & Architecture

To satisfy G02 without burdening Registered Dietitians (RDs) with authoring 250 food records from scratch, Steadfast employs an offline, deterministic ingestion pipeline using the USDA FoodData Central (FDC) API.

Key components:
1. **Coverage Plan** (`data/ai-coach/catalog/fdc-coverage-plan.v1.json`): checked-in specification defining category targets (250 items total across 10 categories) and search terms.
2. **Allowlist** (`data/ai-coach/catalog/fdc-allowlist.v1.json`): checked-in list of curated FDC food candidates with human-assigned canonical names, pattern tags, and RD review states.
3. **Draft Food Catalog Artifact** (`lib/ai-coach/artifacts/drafts/food-catalog-fdc.draft-unsigned.v1.json`): immutable `DRAFT_UNSIGNED` artifact with `SOURCED_V2` profile containing verified nutrient facts, household measures, and tri-state allergen facts.
4. **Offline CLI Tool** (`scripts/ai-coach-ingest-fdc.ts`): provides `--propose` and `--ingest` modes. **Never executes in CI or live runtime.** Requires operator-provided `FDC_API_KEY`.

---

## 2. RD Review & Curation Workflow

Rather than reviewing an unorganized list of 250 entries, the RD curation workflow is organized by category.

### Step 1: Review State by Category
The allowlist (`data/ai-coach/catalog/fdc-allowlist.v1.json`) starts in `curationState: "ENGINEER_DRAFT"`, where every item is initialized to `reviewState: "PROPOSED"`.

The RD reviews items category by category:
- `PROTEIN_ANIMAL` (45 items)
- `PROTEIN_PLANT` (30 items)
- `GRAIN_STARCH` (30 items)
- `VEGETABLE` (45 items)
- `FRUIT` (30 items)
- `DAIRY_AND_ALTERNATIVE` (25 items)
- `FAT_AND_OIL` (15 items)
- `LEGUME` (15 items)
- `NUT_AND_SEED` (15 items)
- `CONDIMENT_AND_SEASONING` (10 items)

For each item, the RD can:
- Keep as `ACCEPTED`: item is verified as a safe, canonical, generic food suitable for coaching plans.
- Mark as `STRUCK`: item is excluded from the catalog (e.g., duplicate, clinically ambiguous, or inappropriate).
- Add a `reviewerNote`: optional context or explanation for why an item was struck or modified.

### Step 2: Transition Curation State
When review begins, update `curationState` to `"REVIEWER_IN_PROGRESS"`.
Once all categories have been reviewed, set `curationState` to `"REVIEWER_COMPLETE"`.

> [!IMPORTANT]
> The engineering team never marks an entry `ACCEPTED`. An allowlist in `ENGINEER_DRAFT` state contains zero `ACCEPTED` entries.

### Step 3: Re-running Ingestion
Once the allowlist review is updated, the operator re-runs the ingestion tool:
```bash
pnpm ai-coach:fdc:ingest -- --allowlist data/ai-coach/catalog/fdc-allowlist.v1.json \
                           --out lib/ai-coach/artifacts/drafts/food-catalog-fdc.draft-unsigned.v1.json
```
- Entries with `reviewState: "STRUCK"` are logged as `STRUCK` and skipped entirely; they never enter the emitted artifact.
- Accepted items are mapped into `SOURCED_V2` food catalog items and validated against strict schema rules.

---

## 3. Allergen Tri-State Rules & Fail-Closed Safety

Allergen facts are evaluated under T-2002's nine frozen major allergen categories:
`MILK, EGG, FISH, CRUSTACEAN_SHELLFISH, TREE_NUT, PEANUT, WHEAT, SOYBEAN, SESAME`.

Each category fact is assigned one of three mechanical states:
1. **`PRESENT`**: source record explicitly names the allergen in its own identity or ingredients.
2. **`VERIFIED_ABSENT`**: source record is a single-ingredient whole food from an unambiguous whole food category, contains no secondary inputs, and is verified absent of allergen terms.
3. **`UNKNOWN`**: source record identity cannot prove absence (e.g., multi-ingredient records, seed/nut adjacency in spices/snacks).

### Cross-Contact Invariant
`crossContact` is **always `UNKNOWN`** with `basis: "NONE"`. USDA FDC does not track agricultural or manufacturing cross-contact advisory labels. Dossier §5.3 forbids converting missing cross-contact data into verified absence.

### Handling `OTHER` Allergen Declarations
Under T-2002, a client can declare an allergen with `category: "OTHER"` (e.g., custom intolerance or rare allergen).
**There is deliberately no catalog counterpart for `OTHER`.**
In T-2036 (meal composer), any client declaration with `category: "OTHER"` fails closed and requires manual RD consultation before meal plan generation. This is an intentional safety invariant; do not attempt to map `OTHER` into catalog categories.

---

## 4. Nutrient Derivation & Energy Discrepancy

- **Derivations**: Analytical codes map to `ANALYTICAL`; calculated codes map to `CALCULATED`; unmapped codes map to `UNKNOWN` with the raw code preserved in `derivationDetail`.
- **Reported Zeros vs UNKNOWN**: Absent nutrients receive `{ value: null, status: "UNKNOWN" }`. Zero is only assigned if the USDA record explicitly reported zero.
- **Macro-Energy Discrepancy**:
  `macroEnergyDiscrepancyKcal = reported kcal - (4 * protein + 4 * carbohydrate + 9 * fat)`
  This discrepancy is recorded as a factual observation and is never adjusted or coerced, per Dossier §6.
