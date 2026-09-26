# USDA FoodData Central (FDC) food catalog and RD curation workflow

This directory documents the ingestion pipeline, allowlist governance, and clinical curation workflow for the Steadfast AI Coach food catalog (ticket T-2035).

> **The data files are outputs of a real operator run, never hand-written.**
> The first version of this ticket shipped a hand-authored 260-item allowlist and catalog whose FDC ids were a
> contiguous counter (171001..171260) and whose "recorded" fixtures described foods that do not exist in USDA,
> while asserting a CC0 attribution and a retrieval date for every one. All of it was deleted
> (`board/evidence/T-2035.md`). Nothing stands in for it: `data/ai-coach/catalog/*.json` and
> `lib/ai-coach/artifacts/drafts/food-catalog-fdc.draft-unsigned.v1.json` are absent until an operator runs the
> tool against the live API and commits the run output as evidence. A record carrying a source's name,
> attribution or retrieval date is a claim that it was retrieved from that source; if it was not, it must not
> exist. When you cannot make the run, the answer is to stop, not to write plausible rows.

---

## 1. Overview and architecture

To satisfy G02 without asking a Registered Dietitian to author hundreds of food records from nothing, Steadfast uses an offline, deterministic ingestion pipeline over the USDA FoodData Central API.

| Component | Path | Checked in? |
|---|---|---|
| Coverage plan | `data/ai-coach/catalog/fdc-coverage-plan.v1.json` | engineer-authored; category ids, per-category target counts and search terms |
| Allowlist | `data/ai-coach/catalog/fdc-allowlist.v1.json` | **output of `--propose`** against the live API |
| Draft catalog artifact | `lib/ai-coach/artifacts/drafts/food-catalog-fdc.draft-unsigned.v1.json` | **output of `--ingest`** against the live API |
| Offline CLI | `scripts/ai-coach-ingest-fdc.ts` | yes. Never executes in CI or at runtime; requires an operator-supplied `FDC_API_KEY` |
| Pure mapping modules | `lib/ai-coach/catalog/fdc/*.ts` | yes. No network, no fs, no `process.env` |

The catalog size is whatever the coverage plan's `targetCount` values sum to and whatever the run actually returns — the two differ whenever a search term returns fewer usable candidates than its target, and the run output is the authority. Do not restate a fixed item count here or in a ticket log; the previous version of this file said "250 items total" while the shipped allowlist held 260, and both numbers were invented.

`loadDraftUnsignedFoodCatalog()` reads the artifact at call time and throws a named error while it does not exist, so a missing run is a loud failure rather than a silently empty catalog. It also refuses to load at all when `NODE_ENV === "production"`.

---

## 2. RD review and curation workflow

The allowlist starts at `curationState: "ENGINEER_DRAFT"` with every entry at `reviewState: "PROPOSED"`. Review proceeds category by category (`categoryId` groups the entries; the coverage plan defines which ids exist and `--ingest` rejects an allowlist naming any other).

For each entry the RD either:
- sets `reviewState: "ACCEPTED"` — a canonical, generic food suitable for coaching plans; or
- sets `reviewState: "STRUCK"` — excluded (duplicate, ambiguous, or unsuitable), with a `reviewerNote`.

Then update `curationState` to `"REVIEWER_IN_PROGRESS"` while working and `"REVIEWER_COMPLETE"` when every category has been reviewed.

> [!IMPORTANT]
> Engineering never marks an entry `ACCEPTED`. An allowlist in `ENGINEER_DRAFT` contains zero `ACCEPTED` entries, and a unit test asserts it over the checked-in file.

Re-run ingestion after review:

```bash
FDC_API_KEY="$(cat ~/.steadfast-fdc-key)" pnpm ai-coach:fdc:ingest -- \
  --allowlist data/ai-coach/catalog/fdc-allowlist.v1.json \
  --out lib/ai-coach/artifacts/drafts/food-catalog-fdc.draft-unsigned.v1.json
```

`--ingest` re-verifies the allowlist's `coveragePlanDigest` against the coverage plan before fetching anything, so an allowlist generated against an older plan stops the run instead of ingesting silently. `STRUCK` entries are logged and skipped; they are never fetched and never reach the artifact. Per-entry acceptance lives in the allowlist and nowhere else — the review metadata has no acceptance array, so there is one writer and one truth.

The artifact is `DRAFT_UNSIGNED` whatever the run returns. Real source data is not a substitute for the RD signature (G01); it is the precondition for asking for one.

---

## 3. Allergen tri-state rules and fail-closed safety

Allergen facts use T-2002's nine frozen categories: `MILK, EGG, FISH, CRUSTACEAN_SHELLFISH, TREE_NUT, PEANUT, WHEAT, SOYBEAN, SESAME`.

**The rule: `VERIFIED_ABSENT` requires positive evidence in the source record that the allergen is absent. Everything else is `UNKNOWN`.**

- **`PRESENT`** — the record's own identity names the allergen (description, category or a curated synonym), or the allowlist entry declares the food *is* that allergen. `basis: "SOURCE_RECORD_IDENTITY"`.
- **`UNKNOWN`** — everything else. `basis: "NONE"`, `verifiedAt: null`.
- **`VERIFIED_ABSENT`** — not emitted by ingestion at all, and the emitted type says so rather than a comment saying so.

Why there is no absence branch, from the record structure itself (probed live 2026-09-26):

- A **Foundation** record has 16 top-level keys (`dataType, description, fdcId, foodAttributes, foodCategory, foodClass, foodComponents, foodNutrients, foodPortions, footnote, inputFoods, isHistoricalReference, ndbNumber, nutrientConversionFactors, publicationDate, scientificName`). There is no `ingredients` field, no "contains" declaration, no allergen field.
- An **SR Legacy** record is the same minus `inputFoods`/`foodComponents`, and its descriptions include commercially prepared foods whose real ingredient statements routinely include soybean oil, milk solids and sesame.
- A **Branded** record is the only data type carrying an `ingredients` statement, because US labelling law requires one. v1 does not accept Branded records and does not parse ingredient statements.

Absence of an ingredient list is not evidence of absence. A category label is not evidence of absence. An empty `inputFoods` array is not evidence of absence. A `singleIngredientWholeFood` flag is not in the record at all. The deleted catalog inferred absence from exactly those signals and produced 2,119 `VERIFIED_ABSENT` facts out of 2,340 — including sesame and soy "absent" from sourdough, rye and pita, and milk and soy "absent" from a pea protein powder. A real Branded whole wheat bread's ingredient statement contains `SOYBEAN AND/OR CANOLA OIL`.

The consequence is intended: the catalog is mostly `UNKNOWN`, and downstream (T-2036) `UNKNOWN` **blocks** the food for a client who declared that allergen. A food excluded on an unanswered question is the correct outcome; a food served on an unverified absence claim is not. Do not "improve" this by inferring absence from a category, a species name or a single-commodity identity.

### Cross-contact invariant
`crossContact` is **always `UNKNOWN`** with `basis: "NONE"`, frozen at the type level. FDC carries no processing or advisory-label facts, and dossier §5.3 forbids converting missing "may contain" text into verified absence.

### Allergen token vocabulary
`allergenFacts.contains` is written in the **legacy exclusion-token** vocabulary (`lib/ai-coach/catalog/schema.ts` `allergenSchema`, plus `SESAME`), not in the nine-value category vocabulary, via the single translation table `LEGACY_TOKEN_BY_CATEGORY` in `lib/ai-coach/intake-allergens.ts`. A client's declared allergy is projected into that same vocabulary, so `SOYBEAN` → `SOY` and `CRUSTACEAN_SHELLFISH` → `SHELLFISH`. Writing the category name instead would make the first comparison miss, i.e. fail **open** on an allergen. `SESAME` has no legacy catalog value and is emitted anyway, because omitting it would make a sesame-containing food look sesame-free; a `SESAME` declaration derives the same token, so the comparison matches and fails closed. A unit test pins the exact string set in both directions.

### Handling `OTHER` allergen declarations
T-2002 allows a client to declare `category: "OTHER"` with free-text specificity. **There is deliberately no catalog counterpart for `OTHER`.** Such a declaration resolves to no catalog category and therefore fails closed in T-2036. This is an intentional safety invariant; do not attempt to map `OTHER` into catalog categories.

---

## 4. Nutrient derivation and energy

- **Derivation.** Analytical means *measured*. FDC codes `AS` ("Atwater specific factors") and `AG` ("Atwater general factors") are **calculations** and map to `CALCULATED`; only genuinely analytical codes map to `ANALYTICAL`; an unmapped code maps to `UNKNOWN` with the raw code preserved in `derivationDetail`. The Atwater information lives in `energyFact.method`, which is its right home.
- **Reported zero vs UNKNOWN.** An unreported nutrient is `{ value: null, status: "UNKNOWN" }`. Zero is written only when the record explicitly reports zero.
- **Macro-energy discrepancy.** `macroEnergyDiscrepancyKcal = reported kcal - (4·protein + 4·carbohydrate + 9·fat)`, recorded as an observation. It is never used to correct a value and never compared to a threshold.

---

## 5. Test fixtures: synthetic vs recorded

Two directories, and the distinction is structural on purpose:

- **`tests/fixtures/ai-coach/fdc-synthetic/`** — hand-built fixtures that exercise specific code paths. Every file carries a `_synthetic` block naming the path it exercises. They have **no attribution, no licence, no retrieval date and no fdcId in any real range** (they sit above 9,000,000,000). Their key structure mirrors a real `/food/{id}` response so the mapping code is exercised against something representative, but no value in them came from anywhere. They are never evidence of anything about a real food.
- **`tests/fixtures/ai-coach/fdc-recorded/`** *(created by the real run)* — responses recorded verbatim from the API with only the API key removed, each carrying its fdcId, retrieval date and CC0 attribution. The provenance tests bind to these.

A fixture is one or the other. A hand-built file that carries a provenance claim is the failure this ticket was rewritten to remove.
